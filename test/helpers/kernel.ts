import { buildClaim, conversationEvidence } from '../../src/agents/a04-record-steward/claims.js';
import type { ActingContext } from '../../src/agents/a04-record-steward/service.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import type { ReviewStaffing } from '../../src/runtime/human-review.js';
import { FixedClock } from '../../src/shared/clock.js';
import type { EvidenceRef } from '../../src/shared/evidence.js';
import type { ClaimInput } from '../../src/shared/facts.js';
import { SequentialIdGenerator } from '../../src/shared/ids.js';
import type { Actor } from '../../src/shared/permissions.js';
import { SystemKernel, type TaskSpec } from '../../src/system/kernel.js';

export const TENANT = 'tenant_a';

export function makeKernel(opts: { model?: ModelGateway; reviewStaffing?: ReviewStaffing; now?: string } = {}) {
  const clock = new FixedClock(opts.now ?? '2026-09-27T10:00:00Z');
  const ids = new SequentialIdGenerator();
  const kernelOpts: ConstructorParameters<typeof SystemKernel>[0] = { clock, ids };
  if (opts.model) kernelOpts.model = opts.model;
  if (opts.reviewStaffing) kernelOpts.reviewStaffing = opts.reviewStaffing;
  const kernel = new SystemKernel(kernelOpts);
  const student: Actor = { id: 'acct_student_1', kind: 'student', tenantId: TENANT };
  const studentId = kernel.records.createStudent({ tenantId: TENANT, ownerActorId: student.id });
  const ui: ActingContext = { actor: student, viaRole: 'ui', purpose: 'counseling' };
  let n = 0;

  /** Seed facts through the real mutation path (as direct student edits). */
  const seed = (claims: ClaimInput[], actor: Actor = student, viaRole = 'ui') => {
    const r = kernel.records.applyMutation({ actor, viaRole, purpose: 'counseling' }, TENANT, studentId, {
      mutationId: `seed_${++n}`,
      operation: 'add_claims',
      claims,
      targetClaimIds: [],
      expectedRecordVersion: kernel.records.recordVersion(TENANT, studentId)!,
      reason: 'test seed',
    });
    if (r.outcome !== 'accepted') throw new Error(`seed rejected: ${r.reasons.join('; ')}`);
    return r;
  };

  const task = (spec: Omit<TaskSpec, 'tenantId' | 'studentId' | 'actor'> & { actor?: Actor }) =>
    kernel.buildRequest({ tenantId: TENANT, studentId, actor: spec.actor ?? student, ...spec });

  return { kernel, clock, ids, student, studentId, ui, seed, task };
}

export const said = (quote: string, turn = 't1', modality: 'text' | 'voice' = 'text'): EvidenceRef => conversationEvidence('conv_1', turn, quote, modality);

export function doc(documentId: string, page: number, text: string, version = 1): EvidenceRef {
  return { kind: 'document_anchor', documentId, documentVersion: version, page, region: { kind: 'table_cell', tableIndex: 0, row: 0, column: 0 }, originalText: text, method: 'text_layer' };
}

/** A student-confirmed statement claim. */
export function stated(actor: Actor, attribute: string, value: unknown, extra: Partial<Parameters<typeof buildClaim>[0]> = {}): ClaimInput {
  return buildClaim({ attribute, value, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(String(typeof value === 'object' ? JSON.stringify(value) : value))], actor, viaRole: 'ui', ...extra });
}

/** A clean document-extracted claim. */
export function extracted(actor: Actor, entity: string, entityId: string, attribute: string, value: unknown, text: string, extra: Partial<Parameters<typeof buildClaim>[0]> = {}): ClaimInput {
  return buildClaim({ entity, entityId, attribute, value, origin: 'document_extraction', evidence: [doc('doc_1', 1, text)], actor, viaRole: 'ui', ...extra });
}

export function ibCourse(actor: Actor, id: string, opts: { subject: string; basis?: 'verified_mapping' | 'broad_taxonomy' | 'student_stated'; level?: 'IB_HL' | 'IB_SL' | null; grade?: string; status?: 'final' | 'predicted'; name?: string; attempt?: number; courseKey?: string }): ClaimInput[] {
  const claims: ClaimInput[] = [
    extracted(actor, 'course', id, 'name_original', opts.name ?? 'Mathematics: Analysis and Approaches', opts.name ?? 'Mathematics: Analysis and Approaches'),
    extracted(actor, 'course', id, 'subject_mapping', { key: opts.subject, basis: opts.basis ?? 'verified_mapping' }, opts.name ?? 'Mathematics'),
  ];
  if (opts.level !== undefined) claims.push(extracted(actor, 'course', id, 'level', { original: opts.level === null ? null : opts.level === 'IB_HL' ? 'HL' : 'SL', normalized: opts.level }, opts.level === null ? 'Mathematics' : opts.level === 'IB_HL' ? 'HL' : 'SL'));
  if (opts.grade !== undefined) claims.push(extracted(actor, 'course', id, 'grade', { original: opts.grade, scaleRef: 'ib_subject_1_7', status: opts.status ?? 'final', weighting: null }, opts.grade));
  if (opts.attempt !== undefined) claims.push(extracted(actor, 'course', id, 'attempt', { number: opts.attempt, kind: opts.attempt > 1 ? 'resit' : 'first' }, `attempt ${opts.attempt}`));
  if (opts.courseKey !== undefined) claims.push(extracted(actor, 'course', id, 'course_key', opts.courseKey, opts.courseKey));
  return claims;
}
