import { z } from 'zod';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { AccessDeniedError } from '../../shared/errors.js';
import { FieldRefSchema, HolderSchema, fieldKey } from '../../shared/facts.js';
import { FIELD_CATALOG } from '../../shared/fields.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import { buildClaim, conversationEvidence } from './claims.js';
import type { MutationResponse } from './types.js';

/**
 * Agent 04 as a specialist: applies student corrections routed by the lead
 * counselor (01T01: "Routes a scoped mutation; does not invoke unrelated
 * roles") and explains what the record holds and why. Most of Agent 04 is the
 * record service itself; this handler is the conversational entry point.
 */

export const CorrectionSchema = z
  .object({
    field: FieldRefSchema,
    holder: HolderSchema.optional(),
    value: z.unknown(),
    /** What the student said, used as evidence. */
    quote: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    modality: z.enum(['text', 'voice']).default('text'),
    /** When the correction replaces a specific claim, name it; otherwise the current claim is superseded. */
    replacesClaimId: z.string().optional(),
  })
  .strict();

export const RecordStewardScopeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('apply_correction'), corrections: z.array(CorrectionSchema).min(1) }).strict(),
  z.object({ action: z.literal('explain_fields'), fieldKeys: z.array(z.string()).min(1) }).strict(),
]);

export const RecordChangePayloadSchema = z
  .object({
    outcome: z.enum(['accepted', 'rejected', 'conflict', 'requires_review']),
    changedFields: z.array(z.object({ fieldKey: z.string(), label: z.string() }).strict()),
    /** Fields where the correction and another source now disagree (kept as a conflict, nothing lost). */
    conflicts: z.array(z.object({ fieldKey: z.string(), label: z.string() }).strict()).default([]),
    invalidatedArtifactIds: z.array(z.string()),
    studentSummary: z.string(),
    reasons: z.array(z.string()),
  })
  .strict();

export const RecordExplanationPayloadSchema = z
  .object({
    fields: z.array(
      z
        .object({
          fieldKey: z.string(),
          label: z.string(),
          state: z.enum(['current', 'conflict', 'absent', 'not_visible']),
          value: z.unknown().optional(),
          source: z.string().nullable(),
          confirmation: z.string().nullable(),
          needsConfirmation: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const RECORD_CHANGE_CONTRACT: ContractDefinition<z.infer<typeof RecordChangePayloadSchema>> = {
  id: 'record_change_v1',
  role: '04',
  payload: RecordChangePayloadSchema,
  groundSummary: false,
  semantic: (p) => (p.outcome === 'accepted' && p.reasons.length > 0 ? ['accepted changes cannot carry rejection reasons'] : []),
};

export const RECORD_EXPLANATION_CONTRACT: ContractDefinition<z.infer<typeof RecordExplanationPayloadSchema>> = {
  id: 'record_explanation_v1',
  role: '04',
  payload: RecordExplanationPayloadSchema,
  groundSummary: false,
};

export class RecordStewardAgent implements SpecialistAgent {
  readonly role = '04' as const;
  readonly contracts = [RECORD_CHANGE_CONTRACT, RECORD_EXPLANATION_CONTRACT];

  async handle(ctx: TaskContext) {
    const scope = RecordStewardScopeSchema.safeParse(ctx.request.scope);
    if (!scope.success) return failedResult(ctx, 'failed', 'The correction request was not in a supported form.', 'invalid_scope');
    try {
      return scope.data.action === 'apply_correction' ? await this.applyCorrections(ctx, scope.data.corrections) : await this.explain(ctx, scope.data.fieldKeys);
    } catch (e) {
      if (e instanceof AccessDeniedError) return failedResult(ctx, 'blocked', 'That information is not available with the current permissions.', e.code);
      throw e;
    }
  }

  private async applyCorrections(ctx: TaskContext, corrections: z.infer<typeof CorrectionSchema>[]) {
    const view = await readView(ctx, 'local');
    const claims = corrections.map((c) => {
      const def = FIELD_CATALOG.get(`${c.field.entity}.${c.field.attribute}`);
      const holder = def?.holderScoped ? (c.holder ?? { kind: 'student' as const }) : undefined;
      const existing = view.field(c.field.entity, c.field.entityId, c.field.attribute, holder);
      const supersedes = c.replacesClaimId ? [c.replacesClaimId] : existing?.current && existing.current.origin === 'student_statement' ? [existing.current.claimId] : [];
      const claimInput: Parameters<typeof buildClaim>[0] = {
        entity: c.field.entity,
        entityId: c.field.entityId,
        attribute: c.field.attribute,
        value: c.value,
        origin: ctx.request.actor.kind === 'supporter' ? 'supporter_statement' : ctx.request.actor.kind === 'school_counselor' ? 'counselor_statement' : 'student_statement',
        confirmation: ctx.request.actor.kind === 'student' ? 'student_confirmed' : ctx.request.actor.kind === 'school_counselor' ? 'counselor_confirmed' : 'unreviewed',
        lifecycle: existing?.current?.lifecycle ?? 'current',
        evidence: [conversationEvidence(c.conversationId, c.turnId, c.quote, c.modality)],
        actor: ctx.request.actor,
        viaRole: '04',
        supersedes,
      };
      if (holder) claimInput.holder = holder;
      return buildClaim(claimInput);
    });
    const response = await ctx.call<MutationResponse>('record.propose_change', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      mutation: { mutationId: mutationIdFor(ctx, 'correction'), operation: 'add_claims', claims, expectedRecordVersion: view.recordVersion, reason: 'student_correction' },
    });
    const labels = new Map(corrections.map((c) => [fieldKey(c.field, c.holder), FIELD_CATALOG.get(`${c.field.entity}.${c.field.attribute}`)?.label ?? c.field.attribute]));
    const status = response.outcome === 'accepted' ? 'completed' : response.outcome === 'requires_review' ? 'needs_human_review' : response.outcome === 'conflict' ? 'partial' : 'failed';
    const payload = {
      outcome: response.outcome,
      changedFields: response.changedFieldKeys.map((k) => ({ fieldKey: k, label: labels.get(k) ?? k })),
      conflicts: response.conflictedFieldKeys.map((k) => ({ fieldKey: k, label: labels.get(k) ?? k })),
      invalidatedArtifactIds: response.invalidatedArtifactIds,
      studentSummary: response.studentSummary,
      reasons: response.reasons,
    };
    if (status === 'failed') return failedResult(ctx, 'failed', 'The correction could not be applied.', response.reasons.join('; ') || 'rejected');
    return makeResult(ctx, {
      status,
      summary: response.studentSummary,
      payload,
      recordVersion: response.recordVersion ?? view.recordVersion,
      completionReason: `correction_${response.outcome}`,
    });
  }

  private async explain(ctx: TaskContext, keys: string[]) {
    const view = await readView(ctx, 'local');
    const byKey = new Map(view.fields().map((f) => [f.fieldKey, f]));
    const fields = keys.map((k) => {
      const f = byKey.get(k);
      if (!f) return { fieldKey: k, label: k, state: 'not_visible' as const, source: null, confirmation: null, needsConfirmation: false };
      const out: z.infer<typeof RecordExplanationPayloadSchema>['fields'][number] = {
        fieldKey: k,
        label: f.label,
        state: f.state,
        source: f.current ? f.current.origin.replace(/_/g, ' ') : null,
        confirmation: f.current ? f.current.confirmation.replace(/_/g, ' ') : null,
        needsConfirmation: f.needsConfirmation,
      };
      if (f.current) out.value = f.current.value;
      return out;
    });
    const claimIds = view.supportingClaimIds(keys.map((k) => byKey.get(k)));
    return makeResult(ctx, {
      status: 'completed',
      summary: `Here is what the record holds for ${fields.length === 1 ? 'that item' : `${fields.length} items`} and where each came from.`,
      payload: { fields },
      claimIds,
      recordVersion: view.recordVersion,
      completionReason: 'explained',
    });
  }
}
