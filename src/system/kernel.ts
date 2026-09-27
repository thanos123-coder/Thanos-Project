import { registerRecordTools } from '../agents/a04-record-steward/tools.js';
import { RecordService } from '../agents/a04-record-steward/service.js';
import { RulePackageRegistry, registerRuleTools } from '../agents/a06-eligibility/registry.js';
import type { SpecialistAgent } from '../agents/common/specialist.js';
import { NullModelGateway, type ModelGateway } from '../model/gateway.js';
import { AuditLog } from '../runtime/audit.js';
import { BudgetTracker, DEFAULT_ROLE_BUDGETS } from '../runtime/budget.js';
import { CancellationToken } from '../runtime/cancellation.js';
import { EventBus } from '../runtime/event-bus.js';
import { ExternalActionService } from '../runtime/external-actions.js';
import { HumanReviewService, type ReviewStaffing } from '../runtime/human-review.js';
import { ROLE_TOOL_MATRIX, TaskContext, ToolGateway } from '../runtime/tool-gateway.js';
import { ContractRegistry, validateResult } from '../runtime/validation.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { RequestEnvelopeSchema, type BudgetLimits, type RequestEnvelope, type ResultEnvelope, type RoleId } from '../shared/envelopes.js';
import { AccessDeniedError, BudgetExhaustedError, SecurityIncidentError, TaskCancelledError, errorMessage } from '../shared/errors.js';
import { RandomIdGenerator, type IdGenerator } from '../shared/ids.js';
import type { Actor, Purpose } from '../shared/permissions.js';
import { z } from 'zod';

/**
 * System kernel: the shared services underneath the agents (blueprint,
 * "The services underneath the agents") wired together, plus the single place
 * where a specialist task is started, bounded, validated and finished.
 */

export interface KernelOptions {
  clock?: Clock;
  ids?: IdGenerator;
  model?: ModelGateway;
  reviewStaffing?: ReviewStaffing;
}

export interface TaskSpec {
  role: RoleId;
  purpose: Purpose;
  objective: string;
  actor: Actor;
  tenantId: string;
  studentId: string;
  scope: Record<string, unknown>;
  completionContract: string;
  allowedTools?: readonly string[];
  budget?: Partial<BudgetLimits>;
  parentTaskId?: string;
  dependsOn?: readonly string[];
  idempotencyKey?: string;
  factRefs?: readonly string[];
}

export interface InvocationOutcome {
  result: ResultEnvelope;
  /** True when the result passed contract validation and may be published. */
  accepted: boolean;
  issues: string[];
  context: TaskContext;
}

export class SystemKernel {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly records: RecordService;
  readonly gateway: ToolGateway;
  readonly rules: RulePackageRegistry;
  readonly events: EventBus;
  readonly actions: ExternalActionService;
  readonly review: HumanReviewService;
  readonly contracts = new ContractRegistry();
  readonly model: ModelGateway;
  private readonly specialists = new Map<RoleId, SpecialistAgent>();
  private readonly running = new Map<string, TaskContext>();

  constructor(options: KernelOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? new RandomIdGenerator();
    this.audit = new AuditLog(this.clock);
    this.records = new RecordService(this.clock, this.ids, this.audit);
    this.gateway = new ToolGateway(this.audit, { isStillAuthorized: (a, t, s, p) => this.records.permissions.isStillAuthorized(a, t, s, p) });
    this.rules = new RulePackageRegistry();
    this.events = new EventBus(this.clock);
    this.actions = new ExternalActionService(this.clock, this.ids, this.audit);
    this.review = new HumanReviewService(options.reviewStaffing ?? { staffed: false }, this.clock, this.ids, this.audit);
    this.model = options.model ?? new NullModelGateway();
    registerRecordTools(this.gateway, this.records);
    registerRuleTools(this.gateway, this.rules);
    this.registerActionTools();
    // Rule changes invalidate dependent findings through the record service.
    this.rules.onChange((c) => {
      if (!c.previousRef) return;
      // Results computed from the previous rule version become stale everywhere at once (07T02, XT06).
      this.records.invalidateEverywhereByRuleOrSource({ ruleVersion: c.previousRef }, `rule package changed: ${c.previousRef} -> ${c.packageRef}`);
      this.events.publish({ eventId: this.ids.next('event'), type: 'rule_package.changed', tenantId: 'public', entityRef: c.packageRef, changedFields: [], causeRef: c.previousRef, occurredAt: this.clock.nowIso(), sensitivePayloadIncluded: false });
    });
  }

  registerSpecialist(agent: SpecialistAgent): void {
    if (this.specialists.has(agent.role)) throw new Error(`Specialist ${agent.role} already registered`);
    this.specialists.set(agent.role, agent);
    for (const c of agent.contracts) if (!this.contracts.get(c.id)) this.contracts.register(c);
  }

  specialist(role: RoleId): SpecialistAgent | undefined {
    return this.specialists.get(role);
  }

  /** Build a typed request envelope with the live record version and permission snapshot. */
  buildRequest(spec: TaskSpec): RequestEnvelope {
    const taskId = this.ids.next('task');
    const defaults = DEFAULT_ROLE_BUDGETS[spec.role]!;
    const budget: BudgetLimits = { ...defaults, ...spec.budget } as BudgetLimits;
    const matrix = ROLE_TOOL_MATRIX[spec.role];
    const allowedTools = (spec.allowedTools ?? matrix).filter((t) => matrix.includes(t));
    const request: RequestEnvelope = {
      taskId,
      role: spec.role,
      purpose: spec.purpose,
      objective: spec.objective,
      tenantId: spec.tenantId,
      studentId: spec.studentId,
      actor: spec.actor,
      recordVersion: this.records.recordVersion(spec.tenantId, spec.studentId) ?? 0,
      scope: spec.scope,
      factRefs: [...(spec.factRefs ?? [])],
      permissionSnapshot: this.records.permissions.snapshot(spec.actor, spec.tenantId, spec.studentId),
      allowedTools,
      budget,
      completionContract: spec.completionContract,
      dependsOn: [...(spec.dependsOn ?? [])],
      idempotencyKey: spec.idempotencyKey ?? taskId,
    };
    if (spec.parentTaskId) request.parentTaskId = spec.parentTaskId;
    return request;
  }

  createContext(request: RequestEnvelope, parent?: TaskContext): TaskContext {
    const budget = parent ? parent.budget.child(request.budget) : new BudgetTracker(request.budget, this.clock);
    const token = parent ? parent.token.child(request.taskId) : new CancellationToken(request.taskId);
    const ctx = new TaskContext(request, budget, token, this.gateway, this.clock, this.ids);
    return ctx;
  }

  /** Cancel a running task (and its children). Late results are discarded. */
  cancel(taskId: string, reason: string): boolean {
    const ctx = this.running.get(taskId);
    if (!ctx) return false;
    ctx.token.cancel(reason);
    this.audit.record({ kind: 'tool_call', taskId, name: 'tasks.cancel', outcome: 'cancelled' });
    return true;
  }

  /**
   * Run one specialist task end to end. The request is validated and the actor's
   * authorization checked *before* any private data is read. The result is
   * validated against its contract; an invalid or late result is never published.
   */
  async invoke(request: RequestEnvelope, parent?: TaskContext, onContext?: (ctx: TaskContext) => void): Promise<InvocationOutcome> {
    const parsed = RequestEnvelopeSchema.safeParse(request);
    const agent = this.specialists.get(request.role);
    const ctx = this.createContext(parsed.success ? parsed.data : request, parent);
    onContext?.(ctx);
    const fail = (status: 'failed' | 'blocked' | 'cancelled', reason: string, issues: string[] = []): InvocationOutcome => ({
      result: {
        taskId: request.taskId,
        role: request.role,
        status,
        summary: status === 'cancelled' ? 'This work was cancelled.' : status === 'blocked' ? 'This work could not run with the current permissions.' : 'This work could not be completed.',
        payload: { error: reason },
        completionContract: request.completionContract,
        inputVersions: { recordVersion: request.recordVersion, claimIds: [], ruleVersions: [], sourceVersions: [], modelVersions: [], permissionSnapshot: request.permissionSnapshot },
        sourceRefs: [],
        uncertainties: [],
        proposedMutations: [],
        handoffs: [],
        externalActions: [],
        completionReason: reason,
      },
      accepted: false,
      issues,
      context: ctx,
    });
    if (!parsed.success) return fail('failed', 'invalid_request', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    if (!agent) return fail('failed', 'unknown_specialist');
    if (!this.contracts.get(request.completionContract)) return fail('failed', 'unknown_completion_contract');
    if (request.actor.kind === 'agent') return fail('blocked', 'agents_act_for_people');
    if (!this.records.permissions.isStillAuthorized(request.actor, request.tenantId, request.studentId, request.purpose)) return fail('blocked', 'not_found_or_denied');
    if (this.records.permissions.snapshot(request.actor, request.tenantId, request.studentId) !== request.permissionSnapshot) return fail('blocked', 'permission_snapshot_stale');

    this.running.set(request.taskId, ctx);
    try {
      let raw: ResultEnvelope;
      try {
        raw = await agent.handle(ctx);
      } catch (e) {
        if (e instanceof TaskCancelledError || ctx.token.isCancelled) return fail('cancelled', 'cancelled');
        if (e instanceof AccessDeniedError) return fail(e.code === 'task_cancelled' ? 'cancelled' : 'blocked', e.code);
        if (e instanceof BudgetExhaustedError) return fail('failed', `budget_exhausted:${e.dimension}`);
        if (e instanceof SecurityIncidentError) {
          this.audit.record({ kind: 'incident', taskId: request.taskId, role: request.role, tenantId: request.tenantId, name: e.incidentKind, outcome: 'flow_stopped' });
          return fail('blocked', `security_incident:${e.incidentKind}`);
        }
        return fail('failed', `specialist_error:${errorMessage(e).slice(0, 200)}`);
      }
      // A result that arrives after cancellation is never published (01T05, XT20).
      if (ctx.token.isCancelled) return fail('cancelled', 'cancelled_before_publication');
      const current = this.records.permissions.snapshot(request.actor, request.tenantId, request.studentId);
      const v = validateResult(raw, { request, servedClaimIds: ctx.servedClaimIds, servedSourceIds: ctx.servedSourceIds, currentPermissionSnapshot: current, registry: this.contracts });
      if (!v.ok) {
        this.audit.record({ kind: 'tool_call', taskId: request.taskId, role: request.role, name: 'result_validation', outcome: 'rejected' });
        return { ...fail('failed', 'result_failed_validation', v.issues), issues: v.issues };
      }
      return { result: v.result, accepted: true, issues: [], context: ctx };
    } finally {
      this.running.delete(request.taskId);
      await this.flushEvents();
    }
  }

  /** Move committed record events to the bus and deliver them. */
  async flushEvents(): Promise<void> {
    for (const e of this.records.takeOutbox()) this.events.publish(e);
    await this.events.drain();
  }

  private registerActionTools(): void {
    this.gateway.register({
      name: 'actions.propose',
      description: 'Propose an external action (message, registration, submission) for explicit human approval. Nothing is sent.',
      kind: 'propose',
      args: z
        .object({
          kind: z.enum(['send_message', 'submit_application', 'register_for_test', 'enroll_course', 'pay_fee', 'contact_organizer', 'calendar_write', 'other']),
          destination: z.string().min(1),
          exactContent: z.string(),
          consequence: z.string().min(1),
        })
        .strict(),
      handler: async (inv, args) => this.actions.propose(args, { tenantId: inv.tenantId, studentId: inv.studentId, taskId: inv.taskId, role: inv.role }),
    });
  }
}
