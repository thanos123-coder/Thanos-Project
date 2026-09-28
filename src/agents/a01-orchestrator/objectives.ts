import { z } from 'zod';
import type { TaskNode, TaskNodeState, TaskReason } from '../../runtime/task-graph.js';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import type { Clock } from '../../shared/clock.js';
import type { RoleId } from '../../shared/envelopes.js';
import { RoleIdSchema } from '../../shared/envelopes.js';
import { AccessDeniedError } from '../../shared/errors.js';
import type { IdGenerator } from '../../shared/ids.js';
import type { DerivativeStore } from '../a04-record-steward/types.js';

/**
 * Task state for the lead counselor (01 "Data and tool contract"): objectives
 * with the student's own wording, normalized outcomes, labelled priority
 * reasons, and the bounded task graph with each node's inputs, dependencies,
 * state and result reference. Interruptions, status requests, cancellations
 * and checkpoints are explicit events, so the interface and background work
 * agree about what is still active (01 "Priority and interruption policy").
 *
 * An objective is visible only to the person who started it: a supporter
 * cannot read a student's objectives, and vice versa.
 */

export const OUTCOMES = [
  'correct_fact',
  'interpret_document',
  'collect_information',
  'explore_goals',
  'check_requirement',
  'plan_academics',
  'assess_experiences',
  'find_opportunities',
  'explain_concept',
  'route_beyond',
  'guarantee_request',
  'concrete_objective_needed',
] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OutcomeSchema = z.enum(OUTCOMES);

export const TASK_REASONS = ['requested_by_student', 'deadline_dependency', 'missing_required_information', 'dependency_of_requested_work', 'optional_improvement', 'correction_propagation'] as const satisfies readonly TaskReason[];

export type ObjectiveStatus = 'active' | 'waiting_for_student' | 'completed' | 'partial' | 'cancelled' | 'checkpointed';

/** A task-graph node as the coordinator records it: the runtime node plus its attempts' task ids and validation issues. */
export interface NodeRecord extends TaskNode {
  /** Child task ids, one per attempt. */
  taskIds: string[];
  /** Validation issues of a rejected attempt; rejected output itself is never stored. */
  issues: string[];
}

export interface ObjectiveEvent {
  at: string;
  kind: 'created' | 'wave_finished' | 'status_requested' | 'cancel_requested' | 'cancelled' | 'checkpointed' | 'resumed' | 'interrupted' | 'answered' | 'duplicate_delivery' | 'completed' | 'revalidated';
  detail: string;
}

export interface ObjectiveRecord {
  id: string;
  tenantId: string;
  studentId: string;
  actorId: string;
  /** Client delivery key (e.g. conversation + message id): a repeated delivery maps to the same objective. */
  deliveryKey: string | null;
  /** The student's own wording, kept recoverable. */
  studentWording: string;
  outcomes: Outcome[];
  reasons: TaskReason[];
  status: ObjectiveStatus;
  nodes: NodeRecord[];
  /** The last composed answer, replayed on duplicate delivery. */
  answer: unknown;
  conversationId: string | null;
  intakeSessionId: string | null;
  events: ObjectiveEvent[];
  createdAt: string;
  updatedAt: string;
}

const NodeStateSchema = z.enum(['pending', 'running', 'waiting', 'completed', 'partial', 'needs_student_input', 'needs_source', 'needs_human_review', 'blocked', 'failed', 'cancelled', 'stale', 'invalid']);
const ReasonSchema = z.enum(TASK_REASONS);

const NodeRecordSchema = z
  .object({
    id: z.string().min(1),
    role: RoleIdSchema,
    purpose: z.string().min(1),
    objective: z.string().min(1),
    completionContract: z.string().min(1),
    scope: z.record(z.string(), z.unknown()),
    dependsOn: z.array(z.string()),
    acceptsPartialDependencies: z.boolean(),
    acceptStates: z.array(NodeStateSchema).optional(),
    reasons: z.array(ReasonSchema),
    state: NodeStateSchema,
    attempts: z.number().int().nonnegative(),
    taskIds: z.array(z.string()),
    result: z.unknown().optional(),
    issues: z.array(z.string()),
    error: z.string().optional(),
  })
  .strict();

const EventKindSchema = z.enum(['created', 'wave_finished', 'status_requested', 'cancel_requested', 'cancelled', 'checkpointed', 'resumed', 'interrupted', 'answered', 'duplicate_delivery', 'completed', 'revalidated']);

const TERMINAL: ReadonlySet<TaskNodeState> = new Set(['completed', 'partial', 'needs_student_input', 'needs_source', 'needs_human_review', 'blocked', 'failed', 'cancelled', 'invalid']);

/**
 * The objective store holds specialist results and composed answers, so it is
 * a derivative store: deleting a document, a fact or a whole record removes
 * every stored result and answer built from it (scenario six, XT04).
 */
export class ObjectiveStore implements DerivativeStore {
  readonly name = 'objective_store';
  private readonly objectives = new Map<string, ObjectiveRecord>();
  /** objectiveId -> running task id -> the node and role it runs for (null for the coordinating task). */
  private readonly running = new Map<string, Map<string, { nodeId: string; role: RoleId } | null>>();

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    /** Cancels a running kernel task (and its children). */
    private readonly cancelTask: (taskId: string, reason: string) => boolean,
  ) {}

  private visible(tenantId: string, studentId: string, actorId: string, objectiveId: string): ObjectiveRecord {
    const o = this.objectives.get(objectiveId);
    if (!o || o.tenantId !== tenantId || o.studentId !== studentId || o.actorId !== actorId) throw new AccessDeniedError('not_found_or_denied', 'Objective not found');
    return o;
  }

  create(input: { tenantId: string; studentId: string; actorId: string; deliveryKey: string | null; studentWording: string; outcomes: Outcome[]; reasons: TaskReason[]; conversationId: string | null }, runningTaskId: string): { objective: ObjectiveRecord; existing: boolean } {
    if (input.deliveryKey) {
      const existing = [...this.objectives.values()].find((o) => o.tenantId === input.tenantId && o.studentId === input.studentId && o.actorId === input.actorId && o.deliveryKey === input.deliveryKey);
      if (existing) {
        this.event(existing, 'duplicate_delivery', 'The same message was delivered again; nothing was repeated.');
        return { objective: structuredClone(existing), existing: true };
      }
    }
    const now = this.clock.nowIso();
    const o: ObjectiveRecord = { id: this.ids.next('objective'), ...input, status: 'active', nodes: [], answer: null, intakeSessionId: null, events: [], createdAt: now, updatedAt: now };
    this.event(o, 'created', `Objective created for: ${input.outcomes.join(', ') || 'clarification'}`);
    this.objectives.set(o.id, o);
    this.attach(o.id, runningTaskId, null);
    return { objective: structuredClone(o), existing: false };
  }

  get(tenantId: string, studentId: string, actorId: string, objectiveId: string): ObjectiveRecord {
    return structuredClone(this.visible(tenantId, studentId, actorId, objectiveId));
  }

  /** All of an actor's objectives for a student, newest first. */
  list(tenantId: string, studentId: string, actorId: string): ObjectiveRecord[] {
    return [...this.objectives.values()].filter((o) => o.tenantId === tenantId && o.studentId === studentId && o.actorId === actorId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((o) => structuredClone(o));
  }

  update(tenantId: string, studentId: string, actorId: string, objectiveId: string, u: { status?: ObjectiveStatus; nodes?: NodeRecord[]; answer?: unknown; event?: { kind: ObjectiveEvent['kind']; detail: string }; intakeSessionId?: string | null; outcomes?: Outcome[] }, runningTaskId: string | null): ObjectiveRecord {
    const o = this.visible(tenantId, studentId, actorId, objectiveId);
    // A cancelled objective does not come back to life through a late update.
    if (o.status === 'cancelled' && u.status !== undefined && u.event?.kind !== 'resumed') {
      if (u.event) this.event(o, u.event.kind, u.event.detail);
      return structuredClone(o);
    }
    if (u.nodes) {
      // Nodes cancelled meanwhile stay cancelled.
      const cancelled = new Set(o.nodes.filter((n) => n.state === 'cancelled').map((n) => n.id));
      o.nodes = u.nodes.map((n) => (cancelled.has(n.id) && u.event?.kind !== 'resumed' ? { ...structuredClone(n), state: 'cancelled' as const } : structuredClone(n)));
    }
    if (u.status) o.status = u.status;
    if (u.answer !== undefined) o.answer = structuredClone(u.answer);
    if (u.intakeSessionId !== undefined) o.intakeSessionId = u.intakeSessionId;
    if (u.outcomes) o.outcomes = [...u.outcomes];
    if (u.event) this.event(o, u.event.kind, u.event.detail);
    if (runningTaskId && u.event?.kind === 'resumed') this.attach(o.id, runningTaskId, null);
    // The coordinating task is no longer running once it has settled the objective's status.
    if (runningTaskId && u.status && u.status !== 'active' && u.event?.kind !== 'resumed') this.detach(o.id, runningTaskId);
    o.updatedAt = this.clock.nowIso();
    return structuredClone(o);
  }

  /**
   * Cancel an objective or one branch of it. Running work is cancelled at once;
   * completed work stays completed; a late result from cancelled work is never
   * recorded (01T05, XT20).
   */
  cancel(tenantId: string, studentId: string, actorId: string, objectiveId: string, branch: RoleId | 'all', reason: string): { objective: ObjectiveRecord; cancelledNodes: string[] } {
    const o = this.visible(tenantId, studentId, actorId, objectiveId);
    const cancelledNodes: string[] = [];
    for (const n of o.nodes) {
      if ((branch === 'all' || n.role === branch) && !TERMINAL.has(n.state)) {
        n.state = 'cancelled';
        n.error = reason;
        cancelledNodes.push(n.id);
      }
    }
    const tasks = this.running.get(o.id) ?? new Map<string, { nodeId: string; role: RoleId } | null>();
    for (const [taskId, ref] of tasks) {
      const node = ref ? o.nodes.find((n) => n.id === ref.nodeId) : undefined;
      if (branch === 'all' || ref?.role === branch) {
        this.cancelTask(taskId, reason);
        if (node && !cancelledNodes.includes(node.id)) {
          node.state = 'cancelled';
          node.error = reason;
          cancelledNodes.push(node.id);
        } else if (ref && !node) {
          cancelledNodes.push(ref.nodeId);
        }
      }
    }
    if (branch === 'all') o.status = 'cancelled';
    this.event(o, 'cancelled', branch === 'all' ? `Cancelled: ${reason}` : `Cancelled the ${branch} branch: ${reason}`);
    o.updatedAt = this.clock.nowIso();
    return { objective: structuredClone(o), cancelledNodes };
  }

  attach(objectiveId: string, taskId: string, ref: { nodeId: string; role: RoleId } | null): void {
    const m = this.running.get(objectiveId) ?? new Map<string, { nodeId: string; role: RoleId } | null>();
    m.set(taskId, ref);
    this.running.set(objectiveId, m);
  }

  detach(objectiveId: string, taskId: string): void {
    this.running.get(objectiveId)?.delete(taskId);
  }

  isNodeCancelled(objectiveId: string, nodeId: string): boolean {
    return this.objectives.get(objectiveId)?.nodes.find((n) => n.id === nodeId)?.state === 'cancelled';
  }

  purgeByDocument(tenantId: string, studentId: string, documentId: string): number {
    return this.purge(tenantId, studentId, (n) => n.scope['documentId'] === documentId);
  }

  purgeByClaims(tenantId: string, studentId: string, claimIds: readonly string[]): number {
    const ids = new Set(claimIds);
    return this.purge(tenantId, studentId, (n) => (n.result?.inputVersions.claimIds ?? []).some((c) => ids.has(c)));
  }

  purgeByStudent(tenantId: string, studentId: string): number {
    let n = 0;
    for (const [id, o] of this.objectives) {
      if (o.tenantId === tenantId && o.studentId === studentId) {
        this.objectives.delete(id);
        this.running.delete(id);
        n += 1;
      }
    }
    return n;
  }

  /** Drop results built from removed evidence; the node becomes stale and the stored answer is discarded. */
  private purge(tenantId: string, studentId: string, affected: (n: NodeRecord) => boolean): number {
    let count = 0;
    for (const o of this.objectives.values()) {
      if (o.tenantId !== tenantId || o.studentId !== studentId) continue;
      let changed = false;
      for (const n of o.nodes) {
        if (!affected(n)) continue;
        delete n.result;
        n.issues = [];
        if (n.state !== 'cancelled') n.state = 'stale';
        n.error = 'based on information that was deleted';
        changed = true;
        count += 1;
      }
      if (changed) {
        o.answer = null;
        this.event(o, 'revalidated', 'Results based on deleted information were removed; they are recomputed from the remaining record if the request continues.');
      }
    }
    return count;
  }

  private event(o: ObjectiveRecord, kind: ObjectiveEvent['kind'], detail: string): void {
    o.events.push({ at: this.clock.nowIso(), kind, detail });
  }
}

/** Task-state tools for the lead counselor. Arguments never carry another person's identifiers: scope comes from the task. */
export function registerTaskTools(gateway: ToolGateway, store: ObjectiveStore): void {
  gateway.register({
    name: 'tasks.create',
    description: 'Create an objective (or return the existing one for a repeated delivery).',
    kind: 'orchestration',
    args: z
      .object({
        tenantId: z.string(),
        studentId: z.string(),
        deliveryKey: z.string().min(1).max(200).nullable(),
        studentWording: z.string().max(4000),
        outcomes: z.array(OutcomeSchema).max(12),
        reasons: z.array(ReasonSchema).max(6),
        conversationId: z.string().nullable(),
      })
      .strict(),
    handler: async (inv, args) => store.create({ ...args, actorId: inv.actor.id }, inv.taskId),
  });

  gateway.register({
    name: 'tasks.checkpoint',
    description: 'Read an objective, or save its task graph, status, answer and an explicit event.',
    kind: 'orchestration',
    args: z
      .object({
        tenantId: z.string(),
        studentId: z.string(),
        objectiveId: z.string().min(1),
        update: z
          .object({
            status: z.enum(['active', 'waiting_for_student', 'completed', 'partial', 'cancelled', 'checkpointed']).optional(),
            nodes: z.array(NodeRecordSchema).max(40).optional(),
            answer: z.unknown().optional(),
            event: z.object({ kind: EventKindSchema, detail: z.string().max(500) }).strict().optional(),
            intakeSessionId: z.string().nullable().optional(),
            outcomes: z.array(OutcomeSchema).max(12).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    handler: async (inv, args): Promise<ObjectiveRecord> => {
      if (!args.update) return store.get(args.tenantId, args.studentId, inv.actor.id, args.objectiveId);
      const u: Parameters<ObjectiveStore['update']>[4] = {};
      if (args.update.status) u.status = args.update.status;
      if (args.update.nodes) u.nodes = args.update.nodes as NodeRecord[];
      if (args.update.answer !== undefined) u.answer = args.update.answer;
      if (args.update.event) u.event = args.update.event;
      if (args.update.intakeSessionId !== undefined) u.intakeSessionId = args.update.intakeSessionId;
      if (args.update.outcomes) u.outcomes = args.update.outcomes;
      return store.update(args.tenantId, args.studentId, inv.actor.id, args.objectiveId, u, inv.taskId);
    },
  });

  gateway.register({
    name: 'tasks.cancel',
    description: 'Cancel an objective or one specialist branch of it. Running work stops; late results are discarded.',
    kind: 'orchestration',
    args: z.object({ tenantId: z.string(), studentId: z.string(), objectiveId: z.string().min(1), branch: z.union([z.literal('all'), RoleIdSchema]), reason: z.string().min(1).max(300) }).strict(),
    handler: async (inv, args) => store.cancel(args.tenantId, args.studentId, inv.actor.id, args.objectiveId, args.branch, args.reason),
  });
}
