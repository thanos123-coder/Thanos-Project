import type { ContractDefinition } from '../../runtime/validation.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type {
  ExternalActionProposal,
  Handoff,
  ProposedMutationInput,
  ResultEnvelope,
  ResultStatus,
  RoleId,
  Uncertainty,
} from '../../shared/envelopes.js';
import type { ScopedView } from '../a04-record-steward/service.js';
import { RecordView } from '../a04-record-steward/view-reader.js';

/**
 * The contract every specialist implements. A specialist receives a task
 * context (typed request, budget, cancellation, gateway-mediated tools) and
 * returns a result envelope. It never holds service references directly.
 */
export interface SpecialistAgent {
  readonly role: RoleId;
  readonly contracts: readonly ContractDefinition<any>[];
  handle(ctx: TaskContext): Promise<ResultEnvelope>;
}

export interface ResultInit<P> {
  status: ResultStatus;
  summary: string;
  payload: P;
  completionReason: string;
  /** Claim ids the result actually relies on (must have been served to the task). */
  claimIds?: readonly string[];
  recordVersion?: number;
  ruleVersions?: readonly string[];
  sourceVersions?: readonly string[];
  modelVersions?: readonly string[];
  sourceRefs?: readonly string[];
  uncertainties?: readonly Uncertainty[];
  proposedMutations?: readonly ProposedMutationInput[];
  handoffs?: readonly Handoff[];
  externalActions?: readonly ExternalActionProposal[];
}

export function makeResult<P>(ctx: TaskContext, init: ResultInit<P>): ResultEnvelope<P> {
  return {
    taskId: ctx.request.taskId,
    role: ctx.request.role,
    status: init.status,
    summary: init.summary,
    payload: init.payload,
    completionContract: ctx.request.completionContract,
    inputVersions: {
      recordVersion: init.recordVersion ?? ctx.request.recordVersion,
      claimIds: [...new Set(init.claimIds ?? [])],
      ruleVersions: [...new Set(init.ruleVersions ?? [])],
      sourceVersions: [...new Set(init.sourceVersions ?? [])],
      modelVersions: [...new Set(init.modelVersions ?? [])],
      permissionSnapshot: ctx.request.permissionSnapshot,
    },
    sourceRefs: [...new Set(init.sourceRefs ?? [])],
    uncertainties: [...(init.uncertainties ?? [])],
    proposedMutations: (init.proposedMutations ?? []).map((m) => ({
      mutationId: m.mutationId,
      operation: m.operation,
      claims: m.claims ?? [],
      targetClaimIds: m.targetClaimIds ?? [],
      expectedRecordVersion: m.expectedRecordVersion,
      reason: m.reason,
    })) as ResultEnvelope['proposedMutations'],
    handoffs: [...(init.handoffs ?? [])],
    externalActions: [...(init.externalActions ?? [])],
    completionReason: init.completionReason,
  };
}

/** Read the role-scoped view through the gateway (never directly from the service). */
export async function readView(
  ctx: TaskContext,
  mode: 'model_context' | 'local',
  narrow: { entityTypes?: string[]; catalogKeys?: string[] } = {},
): Promise<RecordView> {
  const args: Record<string, unknown> = { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mode };
  if (narrow.entityTypes) args['entityTypes'] = narrow.entityTypes;
  if (narrow.catalogKeys) args['catalogKeys'] = narrow.catalogKeys;
  const view = await ctx.call<ScopedView>('record.read_scoped', args);
  return new RecordView(view);
}

/** Build a stable mutation id from the task's idempotency key so retries never duplicate effects. */
export function mutationIdFor(ctx: TaskContext, suffix: string): string {
  return `${ctx.request.idempotencyKey}:${suffix}`;
}

export function scopeOf<T>(ctx: TaskContext, parse: (raw: unknown) => T): T {
  return parse(ctx.request.scope);
}

/** A standard failure result when a task cannot start (invalid scope, denied access). */
export function failedResult(ctx: TaskContext, status: Extract<ResultStatus, 'failed' | 'blocked' | 'cancelled'>, summary: string, reason: string): ResultEnvelope<{ error: string }> {
  return makeResult(ctx, { status, summary, payload: { error: reason }, completionReason: reason });
}
