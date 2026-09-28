import { describe, expect, it } from 'vitest';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { RuleNode } from '../../src/agents/a06-eligibility/rules.js';
import type { Actor } from '../../src/shared/permissions.js';
import type { EligibilityScopeInput } from '../../src/shared/scope.js';
import { cycle, opportunity, session, source as oppSource } from '../fixtures/opportunities.js';
import { buildPdf, ibTranscriptWithPredicted } from '../fixtures/pdfs.js';
import { engineeringPackage, languageRoutes, mathHL, qualificationQ } from '../fixtures/rule-packages.js';
import { said, stated, TENANT } from '../helpers/kernel.js';
import { amara } from '../helpers/opportunities.js';
import { makeSystem } from '../helpers/system.js';

/**
 * Cross-agent acceptance suite (spec "Cross agent acceptance suite", XT01–XT20),
 * run end to end through the CounselorSystem with real specialists. Some cases
 * also have focused tests in the specialists' own suites; those are named.
 */

type H = ReturnType<typeof makeSystem>;

const target = (over: Partial<EligibilityScopeInput> = {}): EligibilityScopeInput => ({ institutionRef: 'example_university', campusRef: null, programRef: 'beng_engineering', degreeLevel: 'undergraduate_first_degree', entryCycle: '2027', applicantCategory: 'first_year', decisionStage: 'application', ...over });
const FREE = [{ component: 'tuition' as const, amount: { amount: '0.00', currency: 'EUR' }, estimate: false, required: true }, { component: 'local_transport' as const, amount: { amount: '0.00', currency: 'EUR' }, estimate: false, required: true }];
const root = (children: RuleNode[]): RuleNode => ({ kind: 'all', id: 'root', label: 'All mandatory requirements', children } as RuleNode);

function addProject(h: H, id: string, over: Record<string, unknown> = {}) {
  const src = `src_${id}`;
  h.system.opportunities.addSource(oppSource(src, `https://${id.replace(/_/g, '-')}.example.org/`));
  h.system.opportunities.curate(opportunity(id, src, { category: 'volunteering', title: `Project ${id}`, cycles: [cycle(src, { costs: FREE })], ...over }));
}

function ibDiploma(h: H) {
  h.seed([
    stated(h.student, 'education.qualification_system', { id: 'IB_DP', label: 'IB Diploma' }),
    stated(h.student, 'credential', { id: 'IB_DIPLOMA', label: 'IB Diploma' }, { entity: 'qualification', entityId: 'q1' }),
    stated(h.student, 'status', 'in_progress', { entity: 'qualification', entityId: 'q1' }),
  ]);
}

function childTasks(h: H, role: string): number {
  return new Set(h.system.kernel.audit.list({ kind: 'tool_call' }).filter((e) => e.role === role).map((e) => e.taskId)).size;
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !cond(); i += 1) await new Promise((r) => setTimeout(r, 0));
  if (!cond()) throw new Error('condition not reached');
}

function gate() {
  let release!: () => void;
  const opened = new Promise<void>((r) => (release = r));
  return { opened, release };
}

async function uploadTranscript(h: H) {
  const up = await h.system.uploadDocument(h.student, TENANT, h.studentId, await buildPdf(ibTranscriptWithPredicted()), { mediaType: 'application/pdf' });
  if (up.status !== 'accepted') throw new Error(`upload ${up.status}`);
  return up.document.id;
}

const mathHL7: RuleNode = { ...(mathHL as Extract<RuleNode, { kind: 'predicate' }>), id: 'math_hl_7', label: 'Mathematics at Higher Level, grade 7', predicate: { type: 'subject_result', subjectKeys: ['ib.math_aa', 'ib.math_ai'], levels: ['IB_HL'], minimumGrade: { scaleRef: 'ib_subject_1_7', original: '7' }, attemptPolicy: 'any' } } as RuleNode;

describe('Cross-agent acceptance suite', () => {
  it('XT01: an imported predicted grade stays predicted through eligibility and planning', async () => {
    const h = makeSystem();
    h.system.kernel.rules.add(engineeringPackage({ rules: root([mathHL7]) }));
    const documentId = await uploadTranscript(h);
    const r = await h.ok('I uploaded my transcript. Can I apply to engineering, and what should I do this year?', { context: { documentIds: [documentId], targets: [target()] } });
    const eligibility = r.answer!.sections.find((s) => s.role === '06')!;
    expect(eligibility.summary).toMatch(/on track, provided that: Final grade in Mathematics: Analysis and Approaches of at least 7\. Planned or predicted results are not treated as achieved/);
    expect(r.answer!.headline).not.toMatch(/appear to meet/);
    const math12 = h.record().fields.filter((f) => f.fieldKey.endsWith('.grade')).map((f) => f.current?.value as { original: string; status: string }).find((g) => g.original === '7')!;
    expect(math12.status).toBe('predicted');
    expect(r.answer!.progress.map((p) => p.role)).toEqual(['03', '06', '07']);
  });

  it('XT02: a correction during parallel research invalidates and recomputes only what it affects', async () => {
    const g = gate();
    let first = true;
    const h = makeSystem({ search: async () => (first ? ((first = false), await g.opened) : undefined, []) });
    h.system.kernel.rules.add(engineeringPackage({ rules: root([qualificationQ]) }));
    h.seed(amara(h.student));
    ibDiploma(h);
    addProject(h, 'local_lab');
    const pending = h.ask('Can I apply to engineering, and find me a summer activity?', { context: { targets: [target()] } });
    await until(() => h.searches.length > 0);
    // The student lowers their budget from another screen while the search is running.
    h.seed([stated(h.student, 'constraints.opportunity_budget', { amount: { amount: '80.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all', appliesTo: 'per_opportunity' })]);
    g.release();
    const r = await pending;
    expect(r.answer!.notices.find((n) => n.code === 'revalidated')!.message).toMatch(/while the opportunity search was running/);
    expect(childTasks(h, '06')).toBe(1);
    expect(childTasks(h, '09')).toBe(2);
    const shortlists = h.system.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'opportunity_shortlist' });
    expect(shortlists.filter((a) => a.status === 'current')).toHaveLength(1);
  });

  it('XT03: a supporter whose permission is revoked mid-task receives nothing', async () => {
    const g = gate();
    const h = makeSystem({ search: async () => (await g.opened, []) });
    h.seed(amara(h.student));
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    const grant = h.system.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['counseling', 'opportunity_research'], categories: ['practical_constraints', 'goals_preferences', 'plans_tasks', 'findings'], access: ['read', 'write'], policyBasis: 'student_invitation' });
    const pending = h.ask('Find a summer engineering workshop for her', {}, parent);
    await until(() => h.searches.length > 0);
    h.system.kernel.records.permissions.revoke(h.student, grant.id);
    g.release();
    const r = await pending;
    expect(r.accepted).toBe(false);
    expect(r.answer).toBeNull();
    expect(h.system.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'opportunity_shortlist' })).toEqual([]);
  });

  it('XT04: deleting a document removes results and cached answers built from it', async () => {
    const h = makeSystem();
    h.system.kernel.rules.add(engineeringPackage({ rules: root([mathHL]) }));
    const documentId = await uploadTranscript(h);
    const r = await h.ok('Here is my transcript. Do I meet the maths requirement for engineering?', { context: { documentIds: [documentId], targets: [target()] } });
    expect(r.answer!.sections.find((s) => s.role === '06')!.summary).toMatch(/appear to meet/);
    await h.system.kernel.records.deleteDocument({ ...h.ui, purpose: 'deletion' }, TENANT, h.studentId, documentId);
    const o = h.system.objectives.get(TENANT, h.studentId, h.student.id, r.objectiveId!);
    expect(o.answer).toBeNull();
    expect(o.nodes.map((n) => [n.role, n.state])).toEqual([['03', 'stale'], ['06', 'stale']]);
    expect(JSON.stringify(o.nodes)).not.toMatch(/Mathematics|appear to meet/);
    // Asking again uses only what remains: nothing is reconstructed from the deleted document.
    const again = await h.ok('Do I meet the maths requirement for engineering?', { context: { targets: [target()] } });
    expect(again.answer!.sections.find((s) => s.role === '06')!.summary).not.toMatch(/appear to meet/);
  });

  it('XT05: conflicting updates from two roles are preserved as a conflict, without losing either', async () => {
    const h = makeSystem();
    const documentId = await uploadTranscript(h);
    await h.ok('Please read my transcript.', { context: { documentIds: [documentId] } });
    const mathY11 = h.record().fields.find((f) => f.fieldKey.endsWith('.grade') && (f.current?.value as { original: string; status: string }).status === 'final' && h.record().fields.some((n) => n.fieldKey === f.fieldKey.replace('.grade', '.name_original') && n.current?.value === 'Mathematics: Analysis and Approaches'))!;
    const entityId = mathY11.field.entityId;
    const r = await h.ok('My Year 11 maths grade was actually 7, not 6.', { context: { correction: { field: { entity: 'course', entityId, attribute: 'grade' }, value: { original: '7', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null } } } });
    expect(r.answer!.conflicts[0]).toMatchObject({ kind: 'fact', routeTo: '04' });
    const grade = h.record().fields.find((f) => f.fieldKey === mathY11.fieldKey)!;
    expect(grade.state).toBe('conflict');
    expect(grade.conflicting.map((c) => (c.value as { original: string }).original).sort()).toEqual(['6', '7']);
  });

  it('XT06: a rule change after a plan was saved marks the plan stale and it is recomputed on review', async () => {
    const h = makeSystem();
    h.system.kernel.rules.add(engineeringPackage({ rules: root([qualificationQ]) }));
    ibDiploma(h);
    const r = await h.ok('Can I apply to engineering and what should I do this year?', { context: { targets: [target()] } });
    // A new version of the published rules (same conditions, reissued): everything computed from the old version is stale.
    h.system.kernel.rules.add(engineeringPackage({ version: '4', rules: root([qualificationQ]) }));
    const u = await h.system.updates(h.student, TENANT, h.studentId);
    expect(u.answer!.updates.map((x) => x.kind)).toEqual(['eligibility_finding', 'academic_plan']);
    const resumed = await h.system.resume(h.student, TENANT, h.studentId, r.objectiveId!);
    expect(resumed.answer!.progress.map((p) => p.role)).toEqual(['06', '07']);
    expect(childTasks(h, '06')).toBe(2);
    const plans = h.system.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'academic_plan' });
    expect(plans.map((p) => p.status).sort()).toEqual(['current', 'superseded']);
  });

  it('XT07: a misrecognized spoken budget waits for confirmation and never makes an expensive option affordable', async () => {
    const h = makeSystem();
    h.seed(amara(h.student, { budget: null }));
    // Heard as €1,050 by voice; not yet confirmed.
    h.seed([buildClaim({ attribute: 'constraints.opportunity_budget', value: { amount: { amount: '1050.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all', appliesTo: 'per_opportunity' }, origin: 'student_statement', confirmation: 'unreviewed', evidence: [said('one hundred fifty euros in total', 't9', 'voice')], actor: h.student, viaRole: '02' })]);
    addProject(h, 'pricey_course', { category: 'course', title: 'Pricey Course', cycles: [cycle('src_pricey_course', { sessions: [session({ format: 'online', location: null, schedule: { timezone: 'Europe/Athens', dailyStart: '10:00', dailyEnd: '12:00', weekdays: [2] } })], costs: [{ component: 'tuition', amount: { amount: '600.00', currency: 'EUR' }, estimate: false, required: true }] })] });
    const r = await h.ok('Find me a summer engineering course');
    const card = JSON.stringify(r.answer!.sections);
    expect(card).not.toMatch(/Fits now: Pricey Course/);
    expect(h.system.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'opportunity_shortlist' })[0]!.payload).toMatchObject({ shortlist: { conditional: [expect.objectContaining({ opportunityId: 'pricey_course', cost: expect.objectContaining({ verdict: 'budget_unknown' }) })] } });
  });

  it('XT09: a recurring opportunity with no published dates stays provisional downstream', async () => {
    const h = makeSystem();
    h.seed(amara(h.student));
    addProject(h, 'annual_camp', { title: 'Annual Camp', cycles: [cycle('src_annual_camp', { id: 'c2026', label: 'Summer 2026', year: 2026, status: 'past', applicationDeadline: { date: '2026-03-01', time: '17:00', timezone: 'Europe/Athens', originalText: 'Closed 1 March 2026' }, sessions: [session({ start: '2026-07-06', end: '2026-07-10' })], costs: FREE })] });
    const save = await h.system.kernel.invoke(h.system.kernel.buildRequest({ role: '09', purpose: 'opportunity_research', objective: 'save', actor: h.student, tenantId: TENANT, studentId: h.studentId, completionContract: 'opportunity_dossier_v1', scope: { action: 'save', opportunityId: 'annual_camp' } }));
    expect(save.accepted).toBe(true);
    expect(save.result.handoffs.map((x) => x.toRole)).not.toContain('30');
    const r = await h.ok('Help me choose between economics and engineering');
    expect(r.answer!.priorities.filter((p) => p.reasons.includes('deadline_dependency'))).toEqual([]);
  });

  it('XT10: an unknown AND condition means no summary calls the student eligible', async () => {
    const h = makeSystem();
    h.system.kernel.rules.add(engineeringPackage({ rules: root([qualificationQ, mathHL]) }));
    ibDiploma(h);
    const r = await h.ok('Can I apply to engineering and what should I do this year?', { context: { targets: [target()] } });
    const text = [r.summary, r.answer!.headline, ...r.answer!.sections.map((s) => s.summary)].join(' ');
    expect(text).not.toMatch(/appear to meet|you are eligible|fully eligible/i);
    expect(r.answer!.sections.find((s) => s.role === '06')!.status).not.toBe('completed');
  });

  it('XT11: a verified OR route is kept even when the other routes fail', async () => {
    const h = makeSystem();
    h.system.kernel.rules.add(engineeringPackage({ rules: root([languageRoutes]) }));
    h.seed([stated(h.student, 'education.schooling_language', { language: 'en', yearsOfInstruction: 6 })]);
    const r = await h.ok('Do I meet the English requirement for engineering?', { context: { targets: [target()] } });
    expect(r.answer!.sections.find((s) => s.role === '06')!.summary).toMatch(/appear to meet each mandatory published condition/);
  });

  it('XT12: family and student goals stay attributed, and each person sees only what they may', async () => {
    const h = makeSystem();
    h.seed([
      buildClaim({ entity: 'preference', entityId: 'p1', attribute: 'statement', value: { text: 'I love graphic design and drawing', topic: 'major', normalized: [] }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('I love graphic design and drawing')], actor: h.student, viaRole: 'ui' }),
      buildClaim({ entity: 'preference', entityId: 'p2', attribute: 'statement', value: { text: 'my parents want me to study medicine', topic: 'major', normalized: [] }, origin: 'student_statement', confirmation: 'student_confirmed', holder: { kind: 'reported_other', label: 'parents' }, evidence: [said('my parents want me to study medicine')], actor: h.student, viaRole: 'ui' }),
      stated(h.student, 'text', { text: 'Honestly I dread hospitals', about: 'medicine' }, { entity: 'reflection', entityId: 'r1' }),
    ]);
    const r = await h.ok('What should I study? I am not sure what to choose.');
    const node = h.system.objectives.get(TENANT, h.studentId, h.student.id, r.objectiveId!).nodes.find((n) => n.role === '05')!;
    const exploration = node.result!.payload as { attributedViews: Array<{ holderLabel: string; text: string }>; hypotheses: Array<{ evidence: Array<{ quote: string }> }> };
    // The parents' view stays attributed to them and is never used as the student's own evidence.
    expect(exploration.attributedViews).toEqual([expect.objectContaining({ holderLabel: 'parents', text: 'my parents want me to study medicine' })]);
    expect(exploration.hypotheses.flatMap((x) => x.evidence.map((e) => e.quote)).join(' ')).not.toMatch(/parents want/);
    // A parent with a counseling grant for plans only sees none of it.
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    h.system.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['counseling'], categories: ['plans_tasks'], access: ['read'], policyBasis: 'student_invitation' });
    const p = await h.ok('What is my child leaning towards?', {}, parent);
    expect(JSON.stringify(p.answer)).not.toMatch(/graphic design|dread hospitals|medicine/i);
  });

  it('XT13: asking for an essay after an activity review produces no invented essay', async () => {
    const h = makeSystem();
    const r = await h.ok('Now write my college essay about my robotics club for me.');
    expect(r.answer!.laterRoles.map((l) => l.toRole)).toEqual(['17']);
    expect(r.answer!.sections).toEqual([]);
    expect(r.answer!.headline.length).toBeLessThan(400);
  });

  it('XT14: switching from voice to text keeps the interview and the ability to correct', async () => {
    const h = makeSystem();
    const r = await h.ok("Let's get started", { modality: 'voice' });
    const sessionId = r.answer!.question!.intakeSessionId;
    expect(sessionId).not.toBeNull();
    const objective = h.system.objectives.get(TENANT, h.studentId, h.student.id, r.objectiveId!);
    expect((objective.nodes.find((n) => n.role === '02')!.result!.payload as { mode: string }).mode).toBe('voice');
    // The student types the next answer instead of speaking: the same interview continues.
    const typed = await h.system.reply(h.student, TENANT, h.studentId, r.objectiveId!, 'I want to find a summer program in engineering', { modality: 'text' });
    expect(typed.accepted).toBe(true);
    expect(h.system.objectives.get(TENANT, h.studentId, h.student.id, r.objectiveId!).intakeSessionId).toBe(sessionId);
    const goal = h.record().fields.find((f) => f.fieldKey === 'student:self.goals.current_objective');
    expect(goal?.current?.evidenceKinds).toEqual(['conversation_span']);
  });

  it('XT15: the same event or message delivered repeatedly has one effect', async () => {
    const h = makeSystem();
    h.seed(amara(h.student));
    addProject(h, 'repeat_project');
    let seen = 0;
    h.system.kernel.events.subscribe({ name: 'counter', types: ['opportunity.changed'], handle: async () => void (seen += 1) });
    h.system.opportunities.curate(opportunity('repeat_project', 'src_repeat_project', { category: 'volunteering', title: 'Project repeat_project', cycles: [cycle('src_repeat_project', { status: 'filled', costs: FREE })] }));
    const e = h.system.kernel.events.events('opportunity.changed')[0]!;
    h.system.kernel.events.redeliver(e.eventId);
    h.system.kernel.events.redeliver(e.eventId);
    await h.system.kernel.events.drain();
    expect(seen).toBe(1);
    const a = await h.ok('Find me a summer engineering activity', { deliveryKey: 'm-1' });
    const b = await h.ok('Find me a summer engineering activity', { deliveryKey: 'm-1' });
    expect(b.objectiveId).toBe(a.objectiveId);
    expect(childTasks(h, '09')).toBe(1);
  });

  it('XT16: a provider timeout after partial success is reported, and a retry duplicates nothing', async () => {
    let calls = 0;
    const h = makeSystem({
      search: async () => {
        calls += 1;
        if (calls === 2) throw new Error('timeout');
        return [
          { url: 'https://leads.example.net/a', title: 'Lead A', snippet: 'engineering', publisher: null },
          { url: 'https://leads.example.net/b', title: 'Lead B', snippet: 'engineering', publisher: null },
        ];
      },
    });
    // A budget above the low-cost threshold means a general and a low-cost query are both run.
    h.seed(amara(h.student, { budget: { amount: { amount: '500.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all', appliesTo: 'per_opportunity' } }));
    const r = await h.ok('Find me a summer engineering activity');
    const shortlist = h.system.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'opportunity_shortlist' })[0]!.payload as { notices: Array<{ code: string }> };
    expect(shortlist.notices.map((n) => n.code)).toContain('search_failed');
    expect(r.accepted).toBe(true);
    const leadsAfterFirst = h.system.opportunities.allLeads().map((l) => l.url).sort();
    await h.ok('Find me a summer engineering activity again');
    expect(h.system.opportunities.allLeads().map((l) => l.url).sort()).toEqual(leadsAfterFirst);
  });

  it('XT17: a readable document with an unsupported credential gets no eligibility certification', async () => {
    const h = makeSystem();
    h.system.kernel.rules.add(engineeringPackage({ rules: root([qualificationQ]) }));
    h.seed([stated(h.student, 'education.qualification_system', { id: 'national_lyceum_certificate', label: 'National Lyceum Certificate' })]);
    const r = await h.ok('Can I apply to engineering?', { context: { targets: [target()] } });
    const s = r.answer!.sections.find((x) => x.role === '06')!;
    expect(s.summary).toMatch(/have not been validated for National Lyceum Certificate/);
    expect(s.summary).not.toMatch(/appear to meet/);
  });

  it('XT18: a paid sponsor that fits poorly does not outrank a free option that fits well', async () => {
    const h = makeSystem();
    h.seed(amara(h.student));
    addProject(h, 'free_good_fit', { title: 'Free Good Fit' });
    addProject(h, 'sponsored_poor_fit', { title: 'Sponsored Poor Fit', topics: ['physics'], category: 'course', sponsorship: { paidPlacement: true, affiliateCommission: true, sponsor: 'Sponsor Ltd' }, cycles: [cycle('src_sponsored_poor_fit', { costs: [{ component: 'tuition', amount: { amount: '140.00', currency: 'EUR' }, estimate: false, required: true }, FREE[1]!] })] });
    const r = await h.ok('Find me a summer engineering or physics activity', { context: { opportunity: { topics: ['engineering', 'physics'] } } });
    expect(r.answer!.headline).toMatch(/^Fits now: Free Good Fit/);
  });
});

describe('CounselorSystem — access and deletion', () => {
  it('a message from someone with no access is refused and nothing is stored', async () => {
    const h = makeSystem();
    h.seed(amara(h.student));
    const stranger: Actor = { id: 'acct_stranger', kind: 'supporter', tenantId: TENANT };
    const r = await h.ask('Show me everything about this student', {}, stranger);
    expect(r.accepted).toBe(false);
    expect(r.status).toBe('blocked');
    expect(r.answer).toBeNull();
    expect(r.turnId).toBeNull();
    expect(h.system.conversations.list(TENANT, h.studentId, `conv_${h.studentId}`)).toEqual([]);
    expect(h.system.objectives.list(TENANT, h.studentId, stranger.id)).toEqual([]);
  });

  it('deleting the account stops work in flight and leaves nothing behind', async () => {
    const g = gate();
    const h = makeSystem({ search: async () => (await g.opened, []) });
    h.seed(amara(h.student));
    const pending = h.ask('Find me a summer engineering workshop', { deliveryKey: 'msg-1' });
    await until(() => h.searches.length > 0);
    const out = await h.system.deleteAccount(h.student, TENANT, h.studentId);
    expect(out.cancelledTasks).toBeGreaterThan(0);
    expect(out.processorsNotified).toEqual(expect.arrayContaining(['objective_store', 'delivery_keys']));
    g.release();
    const r = await pending;
    expect(r.accepted).toBe(false);
    // Nothing was re-created by the work that was still running.
    expect(h.system.conversations.list(TENANT, h.studentId, `conv_${h.studentId}`)).toEqual([]);
    expect(h.system.objectives.list(TENANT, h.studentId, h.student.id)).toEqual([]);
    expect(h.system.kernel.records.recordVersion(TENANT, h.studentId)).toBeUndefined();
    expect(h.system.kernel.records.deletionLedger().filter((e) => e.scope === 'account' && e.tenantId === TENANT)).toHaveLength(1);
    // The same message delivered again is refused, not replayed.
    const again = await h.ask('Find me a summer engineering workshop', { deliveryKey: 'msg-1' });
    expect(again.accepted).toBe(false);
    expect(again.turnId).toBeNull();
  });

  it('only the student can delete their account; a supporter attempt changes nothing', async () => {
    const h = makeSystem();
    h.seed(amara(h.student));
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    h.system.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['counseling', 'deletion'], categories: ['practical_constraints', 'goals_preferences'], access: ['read', 'write', 'delete'], policyBasis: 'student_invitation' });
    const before = h.system.kernel.records.recordVersion(TENANT, h.studentId);
    await expect(h.system.deleteAccount(parent, TENANT, h.studentId)).rejects.toMatchObject({ code: 'not_found_or_denied' });
    expect(h.system.kernel.records.recordVersion(TENANT, h.studentId)).toBe(before);
    expect((await h.ok('What do you know about my summer plans?')).accepted).toBe(true);
  });

  it('deleting one fact through the system removes the results built from it', async () => {
    const h = makeSystem();
    h.system.kernel.rules.add(engineeringPackage({ rules: root([mathHL]) }));
    const documentId = await uploadTranscript(h);
    await h.ok('Here is my transcript. Do I meet the maths requirement for engineering?', { context: { documentIds: [documentId], targets: [target()] } });
    const finding = h.system.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'eligibility_finding' })[0]!;
    const out = await h.system.deleteFact(h.student, TENANT, h.studentId, finding.inputs.claimIds[0]!);
    expect(out.deletedClaims).toBe(1);
    expect(h.system.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'eligibility_finding' })).toEqual([]);
  });
});
