import { z } from 'zod';
import { ResultEnvelopeSchema, type RequestEnvelope, type ResultEnvelope, type RoleId } from '../shared/envelopes.js';
import { ungroundedTokens } from './grounding.js';

/**
 * Result validation (01R07): "Check schema, task identity, permission scope,
 * relevant input versions, source support, and completion criteria before
 * accepting a specialist answer." Syntactic validity is not enough: a result
 * can be valid JSON and still be logically inconsistent (spec, Schema and
 * interface validation), so each contract adds semantic checks.
 */

export interface ContractDefinition<P = unknown> {
  id: string;
  role: RoleId;
  payload: z.ZodType<P>;
  /** Semantic checks returning human-readable issues; empty means valid. */
  semantic?: (payload: P, result: ResultEnvelope<P>) => string[];
  /** Whether the summary must be grounded in the payload (default true). */
  groundSummary?: boolean;
}

export class ContractRegistry {
  private readonly contracts = new Map<string, ContractDefinition<any>>();

  register<P>(def: ContractDefinition<P>): void {
    if (this.contracts.has(def.id)) throw new Error(`Contract already registered: ${def.id}`);
    this.contracts.set(def.id, def);
  }

  get(id: string): ContractDefinition | undefined {
    return this.contracts.get(id);
  }
}

export const FailurePayloadSchema = z.object({ error: z.string().min(1) }).strict();

/** Phrases that describe uncertainty without naming what it affects or how to resolve it. */
const VAGUE_PHRASES = [/^may be inaccurate\.?$/i, /^might be wrong\.?$/i, /^could be incorrect\.?$/i, /^please verify\.?$/i, /^uncertain\.?$/i, /^not sure\.?$/i];

export interface ValidationContext {
  request: RequestEnvelope;
  servedClaimIds: ReadonlySet<string>;
  /** Source ids served to the task through tools; results may only cite these. */
  servedSourceIds?: ReadonlySet<string>;
  /** The current permission snapshot for the task's actor; a mismatch means permissions changed mid-task. */
  currentPermissionSnapshot: string;
  registry: ContractRegistry;
}

export type ValidationOutcome<P> = { ok: true; result: ResultEnvelope<P> } | { ok: false; issues: string[]; repairable: boolean };

export function validateResult<P = unknown>(raw: unknown, ctx: ValidationContext): ValidationOutcome<P> {
  const parsed = ResultEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, repairable: true, issues: parsed.error.issues.map((i) => `envelope.${i.path.join('.')}: ${i.message}`) };
  }
  const result = parsed.data as ResultEnvelope<unknown>;
  const issues: string[] = [];
  let repairable = true;

  if (result.taskId !== ctx.request.taskId) {
    issues.push(`task identity mismatch: expected ${ctx.request.taskId}`);
    repairable = false;
  }
  if (result.role !== ctx.request.role) {
    issues.push(`role mismatch: expected ${ctx.request.role}`);
    repairable = false;
  }
  if (result.completionContract !== ctx.request.completionContract) issues.push(`completion contract mismatch: expected ${ctx.request.completionContract}`);
  if (result.inputVersions.permissionSnapshot !== ctx.request.permissionSnapshot || ctx.currentPermissionSnapshot !== ctx.request.permissionSnapshot) {
    issues.push('permission snapshot changed during the task; the result must be regenerated under current permissions');
    repairable = false;
  }
  if (result.inputVersions.recordVersion < ctx.request.recordVersion) issues.push('result was computed from an older record version than the request');

  for (const id of result.inputVersions.claimIds) {
    if (!ctx.servedClaimIds.has(id)) issues.push(`cites claim ${id}, which was not served to this task`);
  }
  if (ctx.servedSourceIds) {
    for (const id of result.sourceRefs) if (!ctx.servedSourceIds.has(id)) issues.push(`cites source ${id}, which was not served to this task`);
  }
  for (const u of result.uncertainties) {
    if (VAGUE_PHRASES.some((re) => re.test(u.description.trim()))) issues.push(`uncertainty for ${u.affects} is too vague to act on`);
  }

  const contract = ctx.registry.get(result.completionContract);
  if (!contract) {
    issues.push(`unknown completion contract ${result.completionContract}`);
    return { ok: false, issues, repairable: false };
  }
  // Failed, blocked and cancelled results carry a standard error payload instead of the contract payload.
  const failureStatus = result.status === 'failed' || result.status === 'blocked' || result.status === 'cancelled';
  const payload = failureStatus ? FailurePayloadSchema.safeParse(result.payload) : contract.payload.safeParse(result.payload);
  if (!payload.success) {
    issues.push(...payload.error.issues.map((i) => `payload.${i.path.join('.')}: ${i.message}`));
  } else {
    const typed = { ...result, payload: payload.data } as ResultEnvelope<unknown>;
    if (contract.semantic && !failureStatus) issues.push(...contract.semantic(payload.data, typed));
    if (contract.groundSummary !== false && !failureStatus) {
      const ungrounded = ungroundedTokens(result.summary, { payload: payload.data, sources: result.sourceRefs, uncertainties: result.uncertainties });
      for (const t of ungrounded) issues.push(`summary mentions ${t.kind} "${t.text}" that is not in the structured payload`);
    }
    if (issues.length === 0) return { ok: true, result: typed as ResultEnvelope<P> };
  }
  return { ok: false, issues, repairable };
}
