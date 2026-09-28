import { describe, expect, it } from 'vitest';
import { RecordService } from '../../src/agents/a04-record-steward/service.js';
import { RecordView } from '../../src/agents/a04-record-steward/view-reader.js';
import type { DerivativeStore } from '../../src/agents/a04-record-steward/types.js';
import { absent } from '../../src/shared/absence.js';
import { AccessDeniedError } from '../../src/shared/errors.js';
import type { Actor } from '../../src/shared/permissions.js';
import { TENANT, buildClaim, docAnchor, makeRecords, said } from '../helpers/records.js';

const course = (id: string, attribute: string, value: unknown, evidence: ReturnType<typeof docAnchor>, extra: Record<string, unknown> = {}) => ({ entity: 'course', entityId: id, attribute, value, evidence: [evidence], ...extra });

describe('Agent 04 — Student record and evidence steward', () => {
  it('04T01 same mutation delivered twice: one committed effect and a repeatable response', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const m = mutation([buildClaim({ attribute: 'education.expected_graduation', value: '2027-06', origin: 'student_statement', lifecycle: 'planned', evidence: [said('June 2027')], actor: studentActor, viaRole: 'ui' })]);
    const r1 = records.applyMutation(ui, TENANT, studentId, m);
    const r2 = records.applyMutation(ui, TENANT, studentId, m);
    expect(r1.outcome).toBe('accepted');
    expect(r2).toEqual(r1);
    expect(records.recordVersion(TENANT, studentId)).toBe(1);
    expect(records.history(ui, TENANT, studentId, 'student:self.education.expected_graduation')).toHaveLength(1);
    // Reusing the id for different content is refused.
    const reuse = records.applyMutation(ui, TENANT, studentId, { ...m, claims: [{ ...m.claims[0]!, value: '2028-06' }] });
    expect(reuse.outcome).toBe('rejected');
    expect(reuse.reasons.join()).toMatch(/idempotency_key_reused/);
  });

  it('04T02 two edits against the same version of the same fact: conflict, no lost update', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const base = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'course', entityId: 'c1', attribute: 'level', value: { original: 'SL', normalized: 'IB_SL' }, origin: 'student_statement', evidence: [said('SL')], actor: studentActor, viaRole: 'ui' })]));
    const v = base.recordVersion!;
    const a = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'course', entityId: 'c1', attribute: 'level', value: { original: 'HL', normalized: 'IB_HL' }, origin: 'student_statement', evidence: [said('HL actually')], actor: studentActor, viaRole: 'ui' })], v));
    const b = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'course', entityId: 'c1', attribute: 'grade', value: { original: '6', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null }, origin: 'student_statement', evidence: [said('I got a 6')], actor: studentActor, viaRole: 'ui' })], v));
    expect(a.outcome).toBe('accepted');
    // Grade and level are jointly reviewed on the same course: the second edit was based on a stale read.
    expect(b.outcome).toBe('conflict');
    // An unrelated field edited from the same stale version rebases cleanly.
    const c = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ attribute: 'preferences.interaction_mode', value: 'text', origin: 'student_statement', evidence: [said('text please')], actor: studentActor, viaRole: 'ui' })], v));
    expect(c.outcome).toBe('accepted');
    const view = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '04', mode: 'local' }));
    expect(view.value('course', 'c1', 'level')).toEqual({ original: 'HL', normalized: 'IB_HL' });
  });

  it('04T03 a parent preference and the student preference stay separately attributed', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    records.permissions.grant(studentActor, { tenantId: TENANT, studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['counseling'], categories: ['goals_preferences'], access: ['read', 'write'], policyBasis: 'student_invitation' });
    records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'preference', entityId: 'field_of_study', attribute: 'statement', value: { text: 'I want design', topic: 'field_of_study', normalized: ['design'] }, origin: 'student_statement', evidence: [said('I want design')], actor: studentActor, viaRole: 'ui' })]));
    const parentCtx = { actor: parent, viaRole: 'ui', purpose: 'counseling' as const };
    const r = records.applyMutation(parentCtx, TENANT, studentId, mutation([buildClaim({ entity: 'preference', entityId: 'field_of_study', attribute: 'statement', value: { text: 'They want medicine', topic: 'field_of_study', normalized: ['medicine'] }, origin: 'supporter_statement', holder: { kind: 'supporter', actorId: parent.id }, evidence: [said('They want medicine')], actor: parent, viaRole: 'ui' })]));
    expect(r.outcome).toBe('accepted');
    // A supporter cannot state the student's own preference.
    const hijack = records.applyMutation(parentCtx, TENANT, studentId, mutation([buildClaim({ entity: 'preference', entityId: 'field_of_study', attribute: 'statement', value: { text: 'medicine', topic: 'field_of_study', normalized: [] }, origin: 'supporter_statement', evidence: [said('medicine')], actor: parent, viaRole: 'ui' })]));
    expect(hijack.outcome).toBe('rejected');
    const view = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '05', mode: 'local' }));
    const variants = view.holderVariants('preference', 'field_of_study', 'statement');
    expect(variants).toHaveLength(2);
    expect(view.value('preference', 'field_of_study', 'statement')).toMatchObject({ text: 'I want design' });
    expect(view.value('preference', 'field_of_study', 'statement', { kind: 'supporter', actorId: parent.id })).toMatchObject({ text: 'They want medicine' });
  });

  it('04T04 document and student disagree on a final grade: the conflict stays visible until evidence resolves it', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const grade = (g: string) => ({ original: g, scaleRef: 'ib_subject_1_7', status: 'final', weighting: null });
    records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'grade', grade('5'), docAnchor('doc_1', 1, 1, '5')), origin: 'document_extraction', actor: studentActor, viaRole: '03' })]));
    records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'course', entityId: 'c1', attribute: 'grade', value: grade('6'), origin: 'student_statement', evidence: [said('It was a 6')], actor: studentActor, viaRole: 'ui' })]));
    const view = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '06', mode: 'local' }));
    const f = view.field('course', 'c1', 'grade')!;
    expect(f.state).toBe('conflict');
    expect(view.value('course', 'c1', 'grade')).toBeUndefined(); // neither value is silently chosen
    // Resolving by assertion alone is not enough.
    const byWord = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'course', entityId: 'c1', attribute: 'grade', value: grade('6'), origin: 'student_statement', evidence: [said('Trust me, 6')], actor: studentActor, viaRole: 'ui', supersedes: f.conflicting.map((c) => c.claimId) })], undefined, 'resolve_conflict'));
    expect(byWord.outcome).toBe('requires_review');
    // A corrected document resolves it.
    const byDoc = records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'grade', grade('6'), docAnchor('doc_1', 2, 1, '6')), origin: 'document_extraction', actor: studentActor, viaRole: '03', supersedes: f.conflicting.map((c) => c.claimId) })], undefined, 'resolve_conflict'));
    expect(byDoc.outcome).toBe('accepted');
    const after = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '06', mode: 'local' }));
    expect(after.value('course', 'c1', 'grade')).toMatchObject({ original: '6' });
    // History is preserved.
    expect(records.history(ui, TENANT, studentId, 'course:c1.grade').map((c) => c.status)).toEqual(['superseded', 'superseded', 'active']);
  });

  it('04T05 a course correction invalidates the dependent finding and plan', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const r = records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'level', { original: 'SL', normalized: 'IB_SL' }, docAnchor('doc_1', 1, 2, 'SL')), origin: 'document_extraction', actor: studentActor, viaRole: '03' })]));
    const claimId = r.createdClaimIds[0]!;
    const finding = records.putDerived({ ...ui, viaRole: '06' }, { tenantId: TENANT, studentId, kind: 'eligibility_finding', scopeKey: 'uni|bsc|2027', payload: { overall: 'requirement_not_met' }, inputClaimIds: [claimId], recordVersion: r.recordVersion! });
    const plan = records.putDerived({ ...ui, viaRole: '07' }, { tenantId: TENANT, studentId, kind: 'academic_plan', scopeKey: 'plan', payload: { actions: [] }, inputClaimIds: [claimId], recordVersion: r.recordVersion! });
    expect(finding.status).toBe('current');
    const fix = records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'level', { original: 'HL', normalized: 'IB_HL' }, docAnchor('doc_1', 2, 2, 'HL')), origin: 'document_extraction', actor: studentActor, viaRole: '03' })]));
    expect(fix.outcome).toBe('accepted');
    expect(fix.invalidatedArtifactIds.sort()).toEqual([finding.id, plan.id].sort());
    expect(records.getArtifact(ui, TENANT, studentId, finding.id)!.status).toBe('stale');
    expect(fix.studentSummary).toMatch(/Course level: SL → HL/);
  });

  it('04T06 an unrelated display preference change does not invalidate transcript-derived work', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const r = records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'grade', { original: '6', scaleRef: 'ib_subject_1_7', status: 'predicted', weighting: null }, docAnchor('doc_1', 1, 1, '6')), origin: 'document_extraction', actor: studentActor, viaRole: '03' })]));
    const extraction = records.putDerived({ ...ui, viaRole: '06' }, { tenantId: TENANT, studentId, kind: 'eligibility_finding', scopeKey: 's', payload: {}, inputClaimIds: r.createdClaimIds, recordVersion: r.recordVersion! });
    const pref = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ attribute: 'preferences.interaction_mode', value: 'voice', origin: 'student_statement', evidence: [said('voice')], actor: studentActor, viaRole: 'ui' })]));
    expect(pref.invalidatedArtifactIds).toEqual([]);
    expect(records.getArtifact(ui, TENANT, studentId, extraction.id)!.status).toBe('current');
  });

  it('04T07 revoking a supporter blocks views, caches, links and queued work immediately', () => {
    const { records, studentId, ui, studentActor } = makeRecords();
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    const g = records.permissions.grant(studentActor, { tenantId: TENANT, studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['schedule_view'], categories: ['plans_tasks'], access: ['read'], policyBasis: 'student_invitation' });
    const plan = records.putDerived({ ...ui, viaRole: '07' }, { tenantId: TENANT, studentId, kind: 'academic_plan', scopeKey: 'p', payload: { deadline: 'x' }, inputClaimIds: [], recordVersion: 0, categoryFloor: 'plans_tasks' });
    const parentCtx = { actor: parent, viaRole: '01', purpose: 'schedule_view' as const };
    const snapBefore = records.permissions.snapshot(parent, TENANT, studentId);
    expect(records.getArtifact(parentCtx, TENANT, studentId, plan.id)).toBeDefined();
    const link = records.permissions.createShareLink(studentActor, g.id, plan.id);
    expect(records.permissions.resolveShareLink(link.token)).toBeDefined();
    records.permissions.revoke(studentActor, g.id);
    expect(records.getArtifact(parentCtx, TENANT, studentId, plan.id)).toBeUndefined();
    expect(() => records.readScoped(parentCtx, { tenantId: TENANT, studentId, role: '01', mode: 'local' })).toThrow(AccessDeniedError);
    expect(records.permissions.resolveShareLink(link.token)).toBeUndefined();
    expect(records.permissions.snapshot(parent, TENANT, studentId)).not.toBe(snapBefore); // caches keyed by snapshot miss
    expect(records.permissions.isStillAuthorized(parent, TENANT, studentId, 'schedule_view')).toBe(false); // queued jobs fail at the gateway
  });

  it('04T08 deleting a source document removes derived content under the service’s control', async () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const purged: string[] = [];
    const ocrCache: DerivativeStore = { name: 'ocr_cache', purgeByDocument: (_t, _s, d) => { purged.push(`doc:${d}`); return 1; }, purgeByClaims: (_t, _s, ids) => { purged.push(...ids.map((i) => `claim:${i}`)); return ids.length; }, purgeByStudent: () => 0 };
    records.registerDerivativeStore(ocrCache);
    const r = records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'grade', { original: '6', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null }, docAnchor('doc_9', 1, 1, '6')), origin: 'document_extraction', actor: studentActor, viaRole: '03' })]));
    const summary = records.putDerived({ ...ui, viaRole: '06' }, { tenantId: TENANT, studentId, kind: 'summary', scopeKey: 's', payload: { text: 'grade 6' }, inputClaimIds: r.createdClaimIds, recordVersion: r.recordVersion! });
    const out = await records.deleteDocument({ ...ui, purpose: 'deletion' }, TENANT, studentId, 'doc_9');
    expect(out).toMatchObject({ deletedClaims: 1, deletedArtifacts: 1, processorsNotified: ['ocr_cache'] });
    expect(purged).toContain('doc:doc_9');
    expect(records.getArtifact(ui, TENANT, studentId, summary.id)).toBeUndefined();
    const view = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '06', mode: 'local' }));
    expect(view.field('course', 'c1', 'grade')).toBeUndefined();
    expect(JSON.stringify(records.deletionLedger())).not.toContain('grade');
    // A late result that still references the deleted fact cannot be published.
    expect(() => records.putDerived({ ...ui, viaRole: '07' }, { tenantId: TENANT, studentId, kind: 'plan', scopeKey: 'p', payload: {}, inputClaimIds: r.createdClaimIds, recordVersion: r.recordVersion! })).toThrow(AccessDeniedError);
    expect(records.takeOutbox().map((e) => e.type)).toEqual(expect.arrayContaining(['student_fact.deleted', 'derived_artifact.deleted', 'document.deleted']));
  });

  it('04T09 restoring a backup taken before a deletion does not resurrect deleted content', async () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const r = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'reflection', entityId: 'r1', attribute: 'text', value: { text: 'A private reflection', about: null }, origin: 'student_statement', evidence: [said('A private reflection')], actor: studentActor, viaRole: 'ui' })]));
    const backup = records.exportBackup();
    await records.deleteClaim({ ...ui, purpose: 'deletion' }, TENANT, studentId, r.createdClaimIds[0]!);
    const { reapplied } = records.restoreBackup(backup);
    expect(reapplied).toBeGreaterThan(0);
    const view = records.readScoped(ui, { tenantId: TENANT, studentId, role: '05', mode: 'local' });
    expect(JSON.stringify(view)).not.toContain('A private reflection');
  });

  it('04T10 similar names in separate accounts are never merged', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const other: Actor = { id: 'acct_student_2', kind: 'student', tenantId: TENANT };
    const otherId = records.createStudent({ tenantId: TENANT, ownerActorId: other.id });
    records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ attribute: 'identity.legal_name', value: 'Maria Papadopoulou', origin: 'student_statement', evidence: [said('Maria Papadopoulou')], actor: studentActor, viaRole: 'ui' })]));
    records.applyMutation({ actor: other, viaRole: 'ui', purpose: 'counseling' }, TENANT, otherId, mutation([buildClaim({ attribute: 'identity.legal_name', value: 'Maria Papadopoulou', origin: 'student_statement', evidence: [said('Maria Papadopoulou')], actor: other, viaRole: 'ui' })], 0));
    expect(otherId).not.toBe(studentId);
    expect(records.readScoped(ui, { tenantId: TENANT, studentId, role: '04', mode: 'local' }).fields).toHaveLength(1);
    expect(() => records.readScoped(ui, { tenantId: TENANT, studentId: otherId, role: '04', mode: 'local' })).toThrow(AccessDeniedError);
  });

  it('04T11 a model recommendation cannot be stored as a fact', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const asFact = records.applyMutation({ ...ui, viaRole: '05' }, TENANT, studentId, mutation([buildClaim({ attribute: 'goals.current_objective', value: 'You should study medicine', origin: 'model_interpretation', evidence: [{ kind: 'derivation', method: 'model', softwareVersion: 'x', inputClaimIds: ['c'] }], actor: studentActor, viaRole: '05' })]));
    expect(asFact.outcome).toBe('rejected');
    expect(asFact.reasons.join()).toMatch(/model interpretation cannot be stored/);
    const unknownField = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ attribute: 'recommendation.best_major', value: 'medicine', origin: 'student_statement', evidence: [said('x')], actor: studentActor, viaRole: 'ui' })]));
    expect(unknownField.reasons.join()).toMatch(/unknown_field/);
    // A labelled hypothesis is allowed.
    const hypo = records.applyMutation({ ...ui, viaRole: '05' }, TENANT, studentId, mutation([buildClaim({ entity: 'hypothesis', entityId: 'h1', attribute: 'statement', value: { text: 'Enjoys explaining how systems work', commitmentLevel: 'tentative', evidenceClaimIds: [] }, origin: 'model_interpretation', evidence: [said('I like explaining things')], actor: studentActor, viaRole: '05' })]));
    expect(hypo.outcome).toBe('accepted');
  });

  it('04T12 an unknown answer submitted as zero is rejected; the absence is preserved', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const zero = records.applyMutation({ ...ui, viaRole: '02' }, TENANT, studentId, mutation([buildClaim({ attribute: 'constraints.weekly_hours_available', value: { min: 0, max: 0 }, origin: 'student_statement', evidence: [said("I don't know yet")], actor: studentActor, viaRole: '02' })]));
    expect(zero.outcome).toBe('rejected');
    const kept = records.applyMutation({ ...ui, viaRole: '02' }, TENANT, studentId, mutation([buildClaim({ attribute: 'constraints.weekly_hours_available', value: absent('unknown_to_student'), origin: 'student_statement', evidence: [said("I don't know yet")], actor: studentActor, viaRole: '02' })]));
    expect(kept.outcome).toBe('accepted');
    const view = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '07', mode: 'local' }));
    expect(view.absence('student', 'self', 'constraints.weekly_hours_available')).toEqual({ kind: 'absent', reason: 'unknown_to_student' });
    expect(view.studentValue('constraints.weekly_hours_available')).toBeUndefined();
  });

  it('04T13 a summary built from restricted input inherits the restriction', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    records.permissions.grant(studentActor, { tenantId: TENANT, studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['progress_view'], categories: ['plans_tasks', 'findings'], access: ['read'], policyBasis: 'student_invitation' });
    const r = records.applyMutation({ ...ui, viaRole: '02' }, TENANT, studentId, mutation([buildClaim({ attribute: 'support.family_responsibilities', value: { hasRegularResponsibilities: true, broadDescription: 'regular family caregiving', hoursPerWeek: { min: 8, max: 10 } }, origin: 'student_statement', evidence: [said('I look after my grandmother')], actor: studentActor, viaRole: '02' })]));
    const summary = records.putDerived({ ...ui, viaRole: '07' }, { tenantId: TENANT, studentId, kind: 'weekly_plan', scopeKey: 'w', payload: { note: 'Plan around caregiving' }, inputClaimIds: r.createdClaimIds, recordVersion: r.recordVersion! });
    expect(summary.category).toBe('family_context');
    expect(records.getArtifact({ actor: parent, viaRole: '01', purpose: 'progress_view' }, TENANT, studentId, summary.id)).toBeUndefined();
    expect(records.getArtifact(ui, TENANT, studentId, summary.id)).toBeDefined();
  });

  it('04T14 a change in school enrollment or age flags permissions for review without auto-changing rights', () => {
    const { records, studentId, studentActor } = makeRecords();
    const counselor: Actor = { id: 'acct_counselor', kind: 'school_counselor', tenantId: TENANT };
    const g = records.permissions.grant(studentActor, { tenantId: TENANT, studentId, granteeActorId: counselor.id, relationship: 'school_counselor', purposes: ['counseling'], categories: ['academic_record'], access: ['read'], policyBasis: 'student_invitation' });
    const flagged = records.permissions.flagForReview(TENANT, studentId, 'school_enrollment_change');
    expect(flagged.map((x) => x.id)).toEqual([g.id]);
    expect(records.permissions.reviewTriggers(g.id)).toEqual(['school_enrollment_change']);
    expect(records.permissions.authorize({ actor: counselor, tenantId: TENANT, studentId, category: 'academic_record', access: 'read', purpose: 'counseling' }).allowed).toBe(true);
  });

  it('04T15 a cross-tenant id fails exactly like a missing record', () => {
    const { records, studentId } = makeRecords();
    const outsider: Actor = { id: 'acct_x', kind: 'student', tenantId: 'tenant_b' };
    const ctx = { actor: outsider, viaRole: 'ui', purpose: 'counseling' as const };
    const e1 = (() => { try { records.readScoped(ctx, { tenantId: TENANT, studentId, role: '04', mode: 'local' }); } catch (e) { return e as AccessDeniedError; } return undefined; })();
    const e2 = (() => { try { records.readScoped({ ...ctx, actor: { ...outsider, tenantId: TENANT } }, { tenantId: TENANT, studentId: 'student_missing', role: '04', mode: 'local' }); } catch (e) { return e as AccessDeniedError; } return undefined; })();
    expect(e1?.code).toBe('not_found_or_denied');
    expect(e2?.code).toBe('not_found_or_denied');
    expect(e1?.message).toBe(e2?.message);
    const m = records.applyMutation(ctx, TENANT, studentId, { mutationId: 'x', operation: 'add_claims', claims: [], targetClaimIds: [], expectedRecordVersion: 0, reason: 'x' });
    expect(m.reasons).toEqual(['not_found_or_denied']);
  });

  it('04T16 recorded time and valid time stay distinct for a fact learned late', () => {
    const { records, studentId, ui, studentActor, mutation, clock } = makeRecords('2026-10-15T09:00:00Z');
    records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ attribute: 'education.school_name', value: 'Example Lyceum', origin: 'student_statement', validity: { validFrom: '2026-09' }, evidence: [said('I changed schools in September')], actor: studentActor, viaRole: 'ui' })]));
    const h = records.history(ui, TENANT, studentId, 'student:self.education.school_name')[0]!;
    expect(h.validity.validFrom).toBe('2026-09');
    expect(h.recordedAt).toBe(clock.nowIso());
    expect(h.recordedAt.startsWith('2026-10-15')).toBe(true);
  });
});

describe('Agent 04 — worked examples and cross-cutting behavior', () => {
  it('graduation: the document says 2027, the student later says 2028; 2028 is used for planning and the document is preserved', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ attribute: 'education.expected_graduation', value: '2027-06', origin: 'document_extraction', lifecycle: 'planned', evidence: [docAnchor('doc_1', 1, 1, 'Expected graduation: June 2027')], actor: studentActor, viaRole: '03' })]));
    const r = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ attribute: 'education.expected_graduation', value: '2028-06', origin: 'student_statement', confirmation: 'student_confirmed', lifecycle: 'planned', evidence: [said('I transferred schools so it is June 2028 now')], actor: studentActor, viaRole: 'ui' })]));
    const v = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '07', mode: 'local' }));
    const f = v.student('education.expected_graduation')!;
    expect(f.current?.value).toBe('2028-06');
    expect(f.documentationPending).toBe(true);
    expect(f.alternatives.map((a) => a.value)).toEqual(['2027-06']);
    expect(r.studentSummary).toMatch(/June 2027 → June 2028/);
  });

  it('an ambiguous grade (6 or 8) stays unresolved until the student confirms; a later official 8 opens a conflict', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const amb = records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'grade', absent('pending_evidence', 'Confirm whether the grade is 6 or 8'), docAnchor('doc_1', 1, 2, '6?')), origin: 'document_extraction', extractionReview: { state: 'ambiguous', candidates: ['6', '8'] }, actor: studentActor, viaRole: '03' })]));
    let v = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '06', mode: 'local' }));
    expect(v.value('course', 'c1', 'grade')).toBeUndefined();
    expect(v.field('course', 'c1', 'grade')!.needsConfirmation).toBe(true);
    records.applyMutation({ ...ui, viaRole: '03' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'grade', { original: '6', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null }, docAnchor('doc_1', 1, 2, '6?')), origin: 'document_extraction', confirmation: 'student_confirmed', evidence: [docAnchor('doc_1', 1, 2, '6?'), said('It is a 6')], actor: studentActor, viaRole: '03', supersedes: amb.createdClaimIds })], undefined, 'confirm_claim'));
    v = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '06', mode: 'local' }));
    expect(v.value('course', 'c1', 'grade')).toMatchObject({ original: '6' });
    expect(v.current('course', 'c1', 'grade')!.confirmation).toBe('student_confirmed');
  });

  it('agent write scopes: an opportunity or writing role cannot change the academic record', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const r = records.applyMutation({ ...ui, viaRole: '08' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'grade', { original: '7', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null }, docAnchor('doc_1', 1, 1, '7')), origin: 'document_extraction', actor: studentActor, viaRole: '08' })]));
    expect(r.outcome).toBe('rejected');
    expect(r.reasons.join()).toMatch(/role 08 may not write course.grade/);
  });

  it('a planned competition entry can never become an award', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const r = records.applyMutation({ ...ui, viaRole: '08' }, TENANT, studentId, mutation([buildClaim({ entity: 'award', entityId: 'a1', attribute: 'definition', value: { title: 'Regional Science Fair', organizer: null, date: '2027-03', scope: 'regional', stage: 'winner', attribution: 'individual', experienceRef: null, selectionNote: null }, origin: 'student_statement', lifecycle: 'planned', evidence: [said('I am entering the regional fair')], actor: studentActor, viaRole: '08' })]));
    expect(r.outcome).toBe('rejected');
  });

  it('replacing an issuer-verified value with a statement requires review', () => {
    const { records, studentId, studentActor, mutation } = makeRecords();
    const admin: Actor = { id: 'acct_school', kind: 'institution_admin', tenantId: TENANT };
    records.permissions.grant({ ...studentActor }, { tenantId: TENANT, studentId, granteeActorId: admin.id, relationship: 'school_counselor', purposes: ['record_maintenance'], categories: ['academic_record'], access: ['read', 'write'], policyBasis: 'student_invitation' });
    const feed = records.applyMutation({ actor: admin, viaRole: 'ui', purpose: 'record_maintenance' }, TENANT, studentId, mutation([buildClaim({ ...course('c1', 'grade', { original: '5', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null }, docAnchor('feed_1', 1, 1, '5')), origin: 'school_feed', confirmation: 'issuer_verified', actor: admin, viaRole: 'ui' })]));
    expect(feed.outcome).toBe('accepted');
    const r = records.applyMutation({ actor: studentActor, viaRole: 'ui', purpose: 'counseling' }, TENANT, studentId, mutation([buildClaim({ entity: 'course', entityId: 'c1', attribute: 'grade', value: { original: '6', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null }, origin: 'student_statement', evidence: [said('It should be 6')], actor: studentActor, viaRole: 'ui', supersedes: feed.createdClaimIds })]));
    expect(r.outcome).toBe('requires_review');
  });

  it('views for a model context exclude what the role must not send to a model', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    records.applyMutation({ ...ui, viaRole: '02' }, TENANT, studentId, mutation([
      buildClaim({ attribute: 'identity.citizenships', value: ['GR'], origin: 'student_statement', evidence: [said('Greek')], actor: studentActor, viaRole: '02' }),
      buildClaim({ attribute: 'constraints.location_broad', value: { country: 'GR', region: 'Attica', city: 'Athens' }, origin: 'student_statement', evidence: [said('Athens')], actor: studentActor, viaRole: '02' }),
    ]));
    const modelView = records.readScoped({ ...ui, purpose: 'opportunity_research' }, { tenantId: TENANT, studentId, role: '09', mode: 'model_context' });
    const localView = records.readScoped({ ...ui, purpose: 'opportunity_research' }, { tenantId: TENANT, studentId, role: '09', mode: 'local' });
    expect(modelView.fields.map((f) => f.field.attribute)).toEqual(['constraints.location_broad']);
    expect(localView.fields.map((f) => f.field.attribute).sort()).toEqual(['constraints.location_broad', 'identity.citizenships']);
    expect(RecordService.claimIdsOf(modelView)).toHaveLength(1);
  });

  it('retracting a mistaken interpretation removes it from the current view without argument', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const h = records.applyMutation({ ...ui, viaRole: '05' }, TENANT, studentId, mutation([buildClaim({ entity: 'hypothesis', entityId: 'h1', attribute: 'statement', value: { text: 'You are a natural leader', commitmentLevel: 'tentative', evidenceClaimIds: [] }, origin: 'model_interpretation', evidence: [said('I organized practice')], actor: studentActor, viaRole: '05' })]));
    const r = records.applyMutation(ui, TENANT, studentId, mutation([], undefined, 'retract_claim', h.createdClaimIds));
    expect(r.outcome).toBe('accepted');
    const v = new RecordView(records.readScoped(ui, { tenantId: TENANT, studentId, role: '05', mode: 'local' }));
    expect(v.field('hypothesis', 'h1', 'statement')).toBeUndefined();
  });

  it('a grant covers only its own purposes, and stops at its expiry time', () => {
    const { records, studentId, studentActor, clock } = makeRecords();
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    records.permissions.grant(studentActor, { tenantId: TENANT, studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['schedule_view'], categories: ['plans_tasks'], access: ['read'], policyBasis: 'student_invitation', expiresAt: '2026-10-01T00:00:00.000Z' });
    expect(records.permissions.isStillAuthorized(parent, TENANT, studentId, 'schedule_view')).toBe(true);
    // The same category for another purpose is not covered.
    expect(records.permissions.isStillAuthorized(parent, TENANT, studentId, 'counseling')).toBe(false);
    expect(() => records.readScoped({ actor: parent, viaRole: '01', purpose: 'counseling' }, { tenantId: TENANT, studentId, role: '01', mode: 'local' })).toThrow(AccessDeniedError);
    clock.set('2026-10-01T00:00:00.000Z');
    expect(records.permissions.isStillAuthorized(parent, TENANT, studentId, 'schedule_view')).toBe(false);
  });

  it('deleting a fact needs delete access to its category; a supporter with read and write cannot', async () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    records.permissions.grant(studentActor, { tenantId: TENANT, studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['counseling', 'deletion'], categories: ['goals_preferences'], access: ['read', 'write'], policyBasis: 'student_invitation' });
    const r = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'preference', entityId: 'p1', attribute: 'statement', value: { text: 'I like building things', topic: 'field_of_study', normalized: ['engineering'] }, origin: 'student_statement', evidence: [said('I like building things')], actor: studentActor, viaRole: 'ui' })]));
    await expect(records.deleteClaim({ actor: parent, viaRole: 'ui', purpose: 'deletion' }, TENANT, studentId, r.createdClaimIds[0]!)).rejects.toThrow(AccessDeniedError);
    expect(records.getClaim(ui, TENANT, studentId, r.createdClaimIds[0]!)).toBeDefined();
    await records.deleteClaim({ ...ui, purpose: 'deletion' }, TENANT, studentId, r.createdClaimIds[0]!);
    expect(records.getClaim(ui, TENANT, studentId, r.createdClaimIds[0]!)).toBeUndefined();
  });

  it('a mutation that claims a record version newer than the record is rejected', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const r = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ attribute: 'preferences.interaction_mode', value: 'text', origin: 'student_statement', evidence: [said('text please')], actor: studentActor, viaRole: 'ui' })], 5));
    expect(r.outcome).toBe('rejected');
    expect(r.reasons.join()).toMatch(/newer than the record/);
    expect(records.recordVersion(TENANT, studentId)).toBe(0);
  });
});

describe('Agent 04 — volume two fields', () => {
  const project = (studentActor: Actor, attribute: string, value: unknown) => buildClaim({ entity: 'project', entityId: 'p1', attribute, value, origin: 'student_statement', evidence: [said('as I described it')], actor: studentActor, viaRole: 'ui' });
  const log = { items: [{ description: 'Chose the five links to keep', by: 'student', evidence: 'my notes' }, { description: 'Built the search feature', by: 'other_student', evidence: 'repository history' }] };
  const completion = (studentContribution: string[]) => ({ outputs: [{ description: 'Club resource page', state: 'prototype' }], studentContribution, teamContribution: [], otherContributions: [], measures: [], unfinished: [], learned: null });

  it('a project completion cannot credit the student with work the contribution log gives to someone else (XT01)', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    records.applyMutation(ui, TENANT, studentId, mutation([project(studentActor, 'contribution_log', log)]));
    const overstated = records.applyMutation(ui, TENANT, studentId, mutation([project(studentActor, 'completion', completion(['Chose the five links to keep', 'Built the search feature']))]));
    expect(overstated.outcome).toBe('rejected');
    expect(overstated.reasons.join()).toMatch(/credits you with "Built the search feature", which the project's contribution record attributes to other student/);
    const accurate = records.applyMutation(ui, TENANT, studentId, mutation([project(studentActor, 'completion', completion(['Chose the five links to keep']))]));
    expect(accurate.outcome).toBe('accepted');
  });

  it('a received or complete application state needs a receipt, not a ticked task', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const status = (value: string, evidence: ReturnType<typeof said>) => buildClaim({ entity: 'application', entityId: 'app1', attribute: 'status', value, origin: value === 'received' && evidence.kind === 'document_anchor' ? 'document_extraction' : 'student_statement', evidence: [evidence], actor: studentActor, viaRole: 'ui' });
    expect(records.applyMutation(ui, TENANT, studentId, mutation([status('submitted', said('I submitted it'))])).outcome).toBe('accepted');
    const noReceipt = records.applyMutation(ui, TENANT, studentId, mutation([status('received', said('they got it'))]));
    expect(noReceipt.outcome).toBe('rejected');
    expect(noReceipt.reasons.join()).toMatch(/needs a receipt/);
    expect(records.applyMutation(ui, TENANT, studentId, mutation([status('received', docAnchor('doc_receipt', 1, 1, 'Application received'))])).outcome).toBe('accepted');
  });

  it('confirmed funding needs the provider’s document; a student estimate cannot claim a supporter’s confirmation', () => {
    const { records, studentId, ui, studentActor, mutation } = makeRecords();
    const award = { provider: 'Fictional Foundation', name: 'Fictional Award', kind: 'external_scholarship', amount: { amount: '5000.00', currency: 'USD' }, period: 'one_academic_year', coveredCosts: null, stage: 'confirmed_for_disbursement', optionRef: null, renewal: null };
    const said1 = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'funding_award', entityId: 'award_1', attribute: 'definition', value: award, origin: 'student_statement', evidence: [said('they said it is confirmed')], actor: studentActor, viaRole: 'ui' })]));
    expect(said1.outcome).toBe('rejected');
    expect(said1.reasons.join()).toMatch(/provider’s document/);
    const budget = { min: null, max: { amount: '18000.00', currency: 'USD' }, period: 'annual', includesTravelAndPersonal: null, basis: 'supporter_confirmed', availableFrom: null };
    const selfConfirmed = records.applyMutation(ui, TENANT, studentId, mutation([buildClaim({ entity: 'attendance_budget', entityId: 'b1', attribute: 'definition', value: budget, origin: 'student_statement', evidence: [said('my parents can do 18000')], actor: studentActor, viaRole: 'ui' })]));
    expect(selfConfirmed.outcome).toBe('rejected');
    expect(selfConfirmed.reasons.join()).toMatch(/must be stated by that supporter/);
  });
});
