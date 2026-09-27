import { buildClaim, conversationEvidence } from '../../src/agents/a04-record-steward/claims.js';
import { RecordService, type ActingContext } from '../../src/agents/a04-record-steward/service.js';
import { AuditLog } from '../../src/runtime/audit.js';
import { FixedClock } from '../../src/shared/clock.js';
import type { EvidenceRef } from '../../src/shared/evidence.js';
import type { ClaimInput } from '../../src/shared/facts.js';
import { SequentialIdGenerator } from '../../src/shared/ids.js';
import type { Actor } from '../../src/shared/permissions.js';

export const TENANT = 'tenant_a';

export function makeRecords(startIso = '2026-09-27T10:00:00Z') {
  const clock = new FixedClock(startIso);
  const ids = new SequentialIdGenerator();
  const audit = new AuditLog(clock);
  const records = new RecordService(clock, ids, audit);
  const studentActor: Actor = { id: 'acct_student_1', kind: 'student', tenantId: TENANT };
  const studentId = records.createStudent({ tenantId: TENANT, ownerActorId: studentActor.id });
  const ui: ActingContext = { actor: studentActor, viaRole: 'ui', purpose: 'counseling' };
  const as = (viaRole: string, purpose: ActingContext['purpose'] = 'counseling', actor: Actor = studentActor): ActingContext => ({ actor, viaRole, purpose });
  let m = 0;
  const mutation = (claims: ClaimInput[], expectedRecordVersion = records.recordVersion(TENANT, studentId)!, operation: 'add_claims' | 'confirm_claim' | 'retract_claim' | 'resolve_conflict' = 'add_claims', targetClaimIds: string[] = []) => ({
    mutationId: `mut_${++m}`,
    operation,
    claims,
    targetClaimIds,
    expectedRecordVersion,
    reason: 'test',
  });
  return { clock, ids, audit, records, studentActor, studentId, ui, as, mutation };
}

export function said(quote: string, turn = 't1', modality: 'text' | 'voice' = 'text'): EvidenceRef {
  return conversationEvidence('conv_1', turn, quote, modality);
}

export function docAnchor(documentId: string, version: number, page: number, originalText: string, row = 0, column = 0): EvidenceRef {
  return { kind: 'document_anchor', documentId, documentVersion: version, page, region: { kind: 'table_cell', tableIndex: 0, row, column }, originalText, method: 'text_layer' };
}

export { buildClaim };
