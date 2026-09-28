import type { ResultEnvelope, ResultStatus, RoleId } from '../shared/envelopes.js';
import type { Purpose } from '../shared/permissions.js';

/**
 * Bounded task graph (01R05, 01R06). "The graph should describe data
 * dependencies, not performative agent discussion." Nodes run when their
 * dependencies have produced usable results; independent nodes may run
 * concurrently; cancelling a node cancels the branch that depends on it.
 */

export type TaskNodeState =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'partial'
  | 'needs_student_input'
  | 'needs_source'
  | 'needs_human_review'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'invalid';

export interface TaskNode {
  id: string;
  role: RoleId;
  purpose: Purpose;
  objective: string;
  completionContract: string;
  scope: Record<string, unknown>;
  dependsOn: string[];
  /** Whether a dependency's partial/needs_* result is enough to proceed (e.g. use supported work). */
  acceptsPartialDependencies: boolean;
  /** Exact dependency states that let this node run, overriding acceptsPartialDependencies (e.g. plan on a partial finding, but wait while it needs the student's answer). */
  acceptStates?: TaskNodeState[];
  state: TaskNodeState;
  attempts: number;
  result?: ResultEnvelope;
  error?: string;
  /** Why this node exists, in labelled terms (01 priority policy): no opaque priority score. */
  reasons: TaskReason[];
}

export type TaskReason = 'requested_by_student' | 'deadline_dependency' | 'missing_required_information' | 'dependency_of_requested_work' | 'optional_improvement' | 'correction_propagation';

const SUCCESS_STATES: ReadonlySet<TaskNodeState> = new Set(['completed']);
const USABLE_PARTIAL_STATES: ReadonlySet<TaskNodeState> = new Set(['completed', 'partial', 'needs_student_input', 'needs_source', 'needs_human_review']);
export const TERMINAL_STATES: ReadonlySet<TaskNodeState> = new Set(['completed', 'partial', 'needs_student_input', 'needs_source', 'needs_human_review', 'blocked', 'failed', 'cancelled', 'invalid']);

export function stateFromResultStatus(status: ResultStatus): TaskNodeState {
  return status;
}

export class TaskGraph<N extends TaskNode = TaskNode> {
  private readonly nodes = new Map<string, N>();

  add(node: Omit<N, 'state' | 'attempts'> & Partial<Pick<N, 'state' | 'attempts'>>): N {
    if (this.nodes.has(node.id)) throw new Error(`Duplicate task node ${node.id}`);
    const n = { ...node, state: node.state ?? 'pending', attempts: node.attempts ?? 0 } as N;
    this.nodes.set(n.id, n);
    return n;
  }

  get(id: string): N | undefined {
    return this.nodes.get(id);
  }

  all(): N[] {
    return [...this.nodes.values()];
  }

  /** Throws when a dependency is unknown or the graph contains a cycle. */
  validate(): void {
    for (const n of this.nodes.values()) {
      for (const d of n.dependsOn) if (!this.nodes.has(d)) throw new Error(`Task ${n.id} depends on unknown task ${d}`);
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string, path: string[]): void => {
      if (done.has(id)) return;
      if (visiting.has(id)) throw new Error(`Task graph contains a cycle: ${[...path, id].join(' -> ')}`);
      visiting.add(id);
      for (const d of this.nodes.get(id)!.dependsOn) visit(d, [...path, id]);
      visiting.delete(id);
      done.add(id);
    };
    for (const id of this.nodes.keys()) visit(id, []);
  }

  /** Pending nodes whose dependencies are satisfied. */
  ready(): N[] {
    return this.all().filter((n) => n.state === 'pending' && n.dependsOn.every((d) => this.dependencySatisfied(n, d)));
  }

  /** Pending nodes that can never run because a dependency ended unusably. */
  unrunnable(): N[] {
    return this.all().filter((n) => n.state === 'pending' && n.dependsOn.some((d) => this.dependencyDead(n, d)));
  }

  private dependencySatisfied(n: TaskNode, depId: string): boolean {
    const d = this.nodes.get(depId)!;
    if (n.acceptStates) return n.acceptStates.includes(d.state);
    return n.acceptsPartialDependencies ? USABLE_PARTIAL_STATES.has(d.state) : SUCCESS_STATES.has(d.state);
  }

  private dependencyDead(n: TaskNode, depId: string): boolean {
    const d = this.nodes.get(depId)!;
    if (!TERMINAL_STATES.has(d.state)) return false;
    return !this.dependencySatisfied(n, depId);
  }

  /** Transitive dependents of a node. */
  dependents(id: string): N[] {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const n of this.nodes.values()) {
        if (n.dependsOn.includes(cur) && !out.has(n.id)) {
          out.add(n.id);
          stack.push(n.id);
        }
      }
    }
    return [...out].map((x) => this.nodes.get(x)!);
  }

  /** Cancel a node and everything that depends on it. Completed work stays completed. */
  cancelBranch(id: string, reason: string): N[] {
    const affected = [this.nodes.get(id)!, ...this.dependents(id)].filter(Boolean);
    const cancelled: N[] = [];
    for (const n of affected) {
      if (!TERMINAL_STATES.has(n.state) || n.state === 'needs_student_input') {
        n.state = 'cancelled';
        n.error = reason;
        cancelled.push(n);
      }
    }
    return cancelled;
  }

  /** Mark nodes stale (their inputs changed); they return to pending so they can be recomputed. */
  markStale(ids: readonly string[]): N[] {
    const out: N[] = [];
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (!n || n.state === 'cancelled') continue;
      n.state = 'pending';
      delete n.result;
      out.push(n);
      for (const dep of this.dependents(id)) {
        if (dep.state !== 'cancelled') {
          dep.state = 'pending';
          delete dep.result;
          out.push(dep);
        }
      }
    }
    return out;
  }

  isFinished(): boolean {
    return this.all().every((n) => TERMINAL_STATES.has(n.state) || (n.state === 'pending' && this.unrunnable().includes(n)));
  }

  checkpoint(): TaskGraphCheckpoint {
    return {
      nodes: this.all().map((n) => ({
        id: n.id,
        role: n.role,
        objective: n.objective,
        state: n.state,
        dependsOn: [...n.dependsOn],
        resultStatus: n.result?.status ?? null,
        recordVersion: n.result?.inputVersions.recordVersion ?? null,
        completionReason: n.result?.completionReason ?? n.error ?? null,
      })),
    };
  }
}

export interface TaskGraphCheckpoint {
  nodes: Array<{
    id: string;
    role: RoleId;
    objective: string;
    state: TaskNodeState;
    dependsOn: string[];
    resultStatus: ResultStatus | null;
    recordVersion: number | null;
    completionReason: string | null;
  }>;
}
