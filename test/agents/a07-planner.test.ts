import { describe, expect, it } from 'vitest';
import type { RuleNode, RulePackageInput, TestingPolicy } from '../../src/agents/a06-eligibility/rules.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { Actor } from '../../src/shared/permissions.js';
import type { EligibilityScopeInput } from '../../src/shared/scope.js';
import { engineeringPackage, mathHL, qualificationQ, source } from '../fixtures/rule-packages.js';
import { makePlannerHarness } from '../helpers/planner.js';
import { extracted, said, stated, TENANT } from '../helpers/kernel.js';

type H = ReturnType<typeof makePlannerHarness>;

const scope = (over: Partial<EligibilityScopeInput> = {}): EligibilityScopeInput => ({ institutionRef: 'example_university', programRef: 'beng_engineering', degreeLevel: 'undergraduate_first_degree', entryCycle: '2027', applicantCategory: 'first_year', decisionStage: 'application', ...over });
const policy = (over: Partial<TestingPolicy>): TestingPolicy => ({
  family: 'SAT',
  purpose: 'admission',
  applicantCategories: ['first_year'],
  policy: 'required',
  acceptedVersions: ['sat_400_1600'],
  reporting: 'self_report_then_official',
  superscore: 'unknown',
  lastAcceptedTestDate: '2026-12-31',
  receiptDeadline: '2027-01-15',
  alternativeGroup: null,
  source: { sourceId: 'src_program', quote: 'Testing policy (synthetic).' },
  ...over,
});
const onlyQualification: RuleNode = { kind: 'all', id: 'root', label: 'All requirements', children: [qualificationQ] };
const pkg = (testingPolicies: TestingPolicy[], over: Partial<RulePackageInput> = {}) => engineeringPackage({ rules: onlyQualification, testingPolicies, ...over });
const satRequired = [policy({ family: 'SAT' })];

function offering(actor: Actor, id: string, value: Record<string, unknown>) {
  return extracted(actor, 'school_offering', id, 'course', { termsOffered: [], prerequisites: [], subjectKey: null, level: null, ...value }, String(value['name']));
}

async function planFor(h: H, extra: Record<string, unknown> = {}, targets = [{ eligibility: scope(), purposes: ['admission'] }]) {
  return h.ok({ action: 'plan', targets, ...extra });
}

describe('Agent 07 academic and testing planner', () => {
  it('07T01 a test the target does not consider for the stated purpose is not planned', async () => {
    const h = makePlannerHarness();
    h.addPackage(
      engineeringPackage({
        id: 'example_state_bsc',
        institutionRef: 'example_state',
        institutionName: 'Example State University (synthetic)',
        programRef: 'bsc_biology',
        programName: 'BSc Biology',
        rules: onlyQualification,
        sources: [source('src_program')],
        testingPolicies: ['admission', 'scholarship'].flatMap((purpose) => ['SAT', 'ACT'].map((family) => policy({ family: family as 'SAT', purpose: purpose as 'admission', policy: 'not_considered' }))),
      }),
    );
    const r = await planFor(h, {}, [{ eligibility: scope({ institutionRef: 'example_state', programRef: 'bsc_biology' }), purposes: ['admission', 'scholarship'] }]);
    expect(r.payload.testing.needs).toHaveLength(0);
    expect(r.payload.testing.notNeeded).toHaveLength(4);
    expect(r.payload.testing.notNeeded[0]!.reason).toMatch(/does not consider SAT for admission in the 2027 cycle/);
    expect(r.payload.attempts).toHaveLength(0);
    expect(r.payload.notices.some((n) => n.code === 'no_testing_needed')).toBe(true);
    expect(r.payload.milestones.some((m) => m.branch.startsWith('test:'))).toBe(false);
  });

  it('07T02 a changed testing policy makes the saved plan stale and the refresh explains the source change', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg([policy({ family: 'SAT', policy: 'optional' })]));
    const r1 = await planFor(h);
    expect(r1.payload.testing.needs).toHaveLength(0);
    const planId = r1.payload.planId!;
    h.addPackage(pkg([policy({ family: 'SAT', policy: 'required' })], { version: '4' }));
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, planId)?.status).toBe('stale');
    const r2 = await h.ok({ action: 'replan', previousPlanId: planId, cause: { kind: 'policy_changed' } });
    expect(r2.payload.changes!.summary.join(' ')).toMatch(/SAT for admission changed from optional to required \(rule set example_university_beng@3 → example_university_beng@4, source src_program\)/);
    expect(r2.payload.testing.needs.map((n) => n.family)).toEqual(['SAT']);
    expect(r2.inputVersions.ruleVersions).toEqual(['example_university_beng@4']);
  });

  it('07T03 a course whose prerequisite is not offered is conditional with alternatives', async () => {
    const h = makePlannerHarness();
    h.addPackage(engineeringPackage({ rules: { kind: 'all', id: 'root', label: 'All', children: [qualificationQ, mathHL] } }));
    h.seed([offering(h.student, 'off_math_hl', { name: 'Mathematics: Analysis and Approaches HL', subjectKey: 'ib.math_aa', level: 'IB_HL', termsOffered: ['2027 Spring'], prerequisites: ['Mathematics Foundations'], availability: 'confirmed_running' })]);
    await h.checkEligibility(scope());
    const r = await planFor(h, { terms: ['2026 Autumn', '2027 Spring'] });
    const item = r.payload.coursePlan.items.find((i) => i.course === 'Mathematics: Analysis and Approaches HL')!;
    expect(item.status).toBe('conditional');
    expect(item.confirmationNeeded).toMatch(/requires Mathematics Foundations, which is not offered at your school/);
    expect(item.confirmationNeeded).toMatch(/cannot be scheduled before its prerequisite/);
    expect(item.alternatives.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.payload.coursePlan)).not.toMatch(/"enrolled"|"approved"/);
  });

  it('07T04 a catalog listing is not treated as a course that runs', async () => {
    const h = makePlannerHarness();
    h.addPackage(engineeringPackage({ rules: { kind: 'all', id: 'root', label: 'All', children: [qualificationQ, mathHL] } }));
    h.seed([offering(h.student, 'off_math_hl', { name: 'Mathematics: Analysis and Approaches HL', subjectKey: 'ib.math_aa', level: 'IB_HL', termsOffered: ['2027 Spring'], availability: 'catalog_listed' })]);
    await h.checkEligibility(scope());
    const r = await planFor(h);
    const item = r.payload.coursePlan.items.find((i) => i.course === 'Mathematics: Analysis and Approaches HL')!;
    expect(item.availability).toBe('catalog_listed');
    expect(item.status).toBe('conditional');
    expect(item.confirmationNeeded).toMatch(/does not confirm it runs in 2027 Spring/);
    expect(r.payload.milestones.find((m) => m.id === `confirm_${item.id}`)!.owner).toBe('student_with_school_counselor');
    expect(r.status).toBe('partial');
  });

  it('07T05 optional work is reduced when the plan exceeds the student’s time', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg([...satRequired, policy({ family: 'TOEFL_IBT', purpose: 'language_proficiency', policy: 'optional', acceptedVersions: ['toefl_ibt_band_1_6'], lastAcceptedTestDate: null, receiptDeadline: null })]));
    h.seed([stated(h.student, 'constraints.weekly_hours_available', { min: 3, max: 3 })]);
    const r = await planFor(h, { studentSelectedTests: ['TOEFL_IBT'] }, [{ eligibility: scope(), purposes: ['admission', 'language_proficiency'] }]);
    expect(r.payload.testing.needs.map((n) => n.family).sort()).toEqual(['SAT', 'TOEFL_IBT']);
    expect(r.payload.workload.reductions.join(' ')).toMatch(/Optional TOEFL IBT preparation is left out/);
    expect(r.payload.workload.plannedHoursPerWeek).toBeLessThanOrEqual(3);
    expect(r.payload.workload.overCapacity).toBe(false);
    expect(r.payload.prep.map((p) => p.family)).toEqual(['SAT']);
  });

  it('07T06 a pending accommodation stays a visible dependency; approval is never assumed', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg(satRequired));
    h.seed([buildClaim({ entity: 'accommodation', entityId: 'acc1', attribute: 'status', value: { organization: 'College Board', status: 'pending' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('my accommodation request is pending')], actor: h.student, viaRole: 'ui' })]);
    const r = await planFor(h);
    const a = r.payload.attempts[0]!.primary!;
    expect(a.accommodation.status).toBe('pending');
    expect(a.feasibility).toBe('feasible_with_dependencies');
    expect(a.accommodation.dependency).toMatch(/still pending.*approval is not assumed/);
    const dep = r.payload.milestones.find((m) => m.id === `accommodation_${a.administrationId}`)!;
    expect(dep.kind).toBe('dependency');
    expect(r.payload.milestones.find((m) => m.id === `register_${a.administrationId}`)!.dependsOn).toContain(dep.id);
    expect(JSON.stringify(r.payload)).not.toMatch(/accommodation (is )?approved/i);
  });

  it('07T07 a date with late score receipt is not presented as a reliable way to meet the deadline', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg([policy({ family: 'SAT', receiptDeadline: '2026-12-01' })]));
    const r = await planFor(h);
    const sel = r.payload.attempts[0]!;
    expect(sel.primary).toBeNull();
    expect(sel.alternative!.feasibility).toBe('not_reliable_for_deadline');
    expect(sel.alternative!.receipt.note).toMatch(/not reliable/);
    expect(r.payload.unresolved.join(' ')).toMatch(/No listed SAT administration fits the deadlines/);
    expect(r.handoffs.some((x) => x.toRole === '34')).toBe(true);
  });

  it('07T08 an earlier device-loan deadline is part of the dependency chain', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg(satRequired));
    h.seed([stated(h.student, 'constraints.device_access', 'none')]);
    const r = await planFor(h);
    const a = r.payload.attempts[0]!.primary!;
    expect(a.device.needed).toBe(true);
    const device = r.payload.milestones.find((m) => m.id === `device_${a.administrationId}`)!;
    expect(device).toMatchObject({ kind: 'official_deadline', due: { date: '2026-10-02', time: '23:59', timezone: 'America/New_York' } });
    expect(r.payload.milestones.find((m) => m.id === `register_${a.administrationId}`)!.dependsOn).toContain(device.id);
  });

  it('07T09 mixed ACT formats are listed separately with no homemade composite', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg([]));
    h.seed([
      extracted(h.student, 'test_attempt', 'act1', 'record', { family: 'ACT', versionRef: 'act_four_section', administrationDate: '2025-06-14', sections: { english: 30, math: 28, reading: 31, science: 27 }, reportedTotal: 29, reportStatus: 'official' }, 'ACT composite 29'),
      extracted(h.student, 'test_attempt', 'act2', 'record', { family: 'ACT', versionRef: 'act_enhanced', administrationDate: '2026-06-13', sections: { english: 31, math: 30, reading: 29 }, reportedTotal: 30, reportStatus: 'official' }, 'ACT composite 30'),
    ]);
    const r = await planFor(h);
    expect(r.payload.scores.map((s) => [s.versionRef, s.administrationDate])).toEqual([['act_four_section', '2025-06-14'], ['act_enhanced', '2026-06-13']]);
    expect(r.payload.scoreNotes[0]).toMatch(/different formats or scales \(act_four_section, act_enhanced\).*no combined score is calculated/);
    expect(JSON.stringify(r.payload)).not.toMatch(/"composite":\s*\d/);
  });

  it('07T10 TOEFL results on different scales keep their scale and date explicit', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg([]));
    h.seed([
      extracted(h.student, 'test_attempt', 't1', 'record', { family: 'TOEFL_IBT', versionRef: 'toefl_ibt_0_120', administrationDate: '2025-10-04', sections: { reading: 27, listening: 26, speaking: 24, writing: 25 }, reportedTotal: 102, reportStatus: 'official' }, 'TOEFL 102'),
      extracted(h.student, 'test_attempt', 't2', 'record', { family: 'TOEFL_IBT', versionRef: 'toefl_ibt_band_1_6', administrationDate: '2026-05-02', sections: { reading: 5, listening: 5, speaking: 4.5, writing: 5 }, reportedTotal: 5, reportStatus: 'official' }, 'TOEFL band 5'),
    ]);
    const r = await planFor(h);
    const [old, now] = r.payload.scores;
    expect(old!.scaleNote).toMatch(/total 0-120/);
    expect(now!.scaleNote).toMatch(/band scale 1-6/);
    expect(r.payload.scoreNotes[0]).toMatch(/toefl_ibt_0_120, toefl_ibt_band_1_6/);
  });

  it('07T11 a listed test date is never treated as a reserved seat', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg(satRequired));
    const r = await planFor(h);
    const a = r.payload.attempts[0]!.primary!;
    expect(a.seatAvailability).toBe('unknown');
    expect(r.payload.milestones.find((m) => m.id === `seat_${a.administrationId}`)!.title).toMatch(/does not guarantee a seat/);
    expect(r.uncertainties.some((u) => u.affects === `attempt:${a.administrationId}`)).toBe(true);
  });

  it('07T12 without money for paid preparation, useful free options remain', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg(satRequired));
    const r = await planFor(h);
    expect(r.payload.prep[0]!.resources.every((x) => x.cost === 'free')).toBe(true);
    expect(r.payload.prep[0]!.blocks.length).toBeGreaterThan(0);
    expect(r.payload.notices.find((n) => n.code === 'free_resources')!.message).toMatch(/paid tutoring is never required/);
  });

  it('07T13 a request for a guaranteed score increase gets controllable steps and honesty', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg(satRequired));
    const r = await planFor(h, { question: 'Can you guarantee I will get 1500 if I follow this?' });
    expect(r.payload.notices.find((n) => n.code === 'no_guarantee')!.message).toMatch(/No plan can guarantee a score increase/);
    for (const c of r.payload.prep[0]!.completionCriteria) expect(c).not.toMatch(/\d{3,4}|score of/);
  });

  it('07T14 a cancelled test date replans only that branch and keeps completed work', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg(satRequired));
    h.seed([offering(h.student, 'off_physics', { name: 'Physics HL', subjectKey: 'ib.physics', level: 'IB_HL', availability: 'catalog_listed' })]);
    const r1 = await planFor(h);
    expect(r1.payload.attempts[0]!.primary!.administrationId).toBe('sat_2026_11_07');
    h.calendars.cancel('sat_2026_11_07');
    const r2 = await h.ok({ action: 'replan', previousPlanId: r1.payload.planId!, cause: { kind: 'test_administration_cancelled', ref: 'sat_2026_11_07' }, completedMilestones: ['prep_start_SAT'] });
    expect(r2.payload.attempts[0]!.primary!.administrationId).toBe('sat_2026_12_05');
    expect(r2.payload.changes!.summary.join(' ')).toMatch(/test SAT: \d+ steps? no longer apply \(test administration cancelled\)/);
    expect(r2.payload.milestones.find((m) => m.id === 'prep_start_SAT')!.status).toBe('completed');
    expect(r2.payload.changes!.preserved.join(' ')).toMatch(/Start preparation/);
  });

  it('07T15 an unpublished future calendar gives a provisional window and a recheck, not a date', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg([policy({ family: 'TOEFL_IBT', purpose: 'language_proficiency', acceptedVersions: ['toefl_ibt_band_1_6'], lastAcceptedTestDate: null, receiptDeadline: '2027-05-01' })]));
    const r = await planFor(h, {}, [{ eligibility: scope(), purposes: ['language_proficiency'] }]);
    const sel = r.payload.attempts[0]!;
    expect(sel.primary).toBeNull();
    expect(sel.provisional).toMatchObject({ family: 'TOEFL_IBT', window: { from: '2027-01-01' }, recheckOn: '2027-01-01' });
    expect(sel.provisional!.note).toMatch(/no date is assumed/);
    expect(r.payload.milestones.find((m) => m.id === 'recheck_TOEFL_IBT')!.kind).toBe('provisional_recheck');
    expect(r.payload.milestones.some((m) => m.id.startsWith('test_'))).toBe(false);
  });

  it('07T16 a registration request prepares exact details and requires authorization', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg(satRequired));
    const r1 = await planFor(h);
    const r = await h.ok({ action: 'request_registration', planId: r1.payload.planId!, administrationId: 'sat_2026_11_07' });
    expect(r.externalActions[0]).toMatchObject({ kind: 'register_for_test', authorizationState: 'proposed' });
    expect(r.externalActions[0]!.exactContent).toMatch(/2026-11-07.*\n.*October 23.*\n.*\$68/);
    expect(r.payload.externalRegistrationsMade).toBe(false);
    expect(h.kernel.actions.list(TENANT, h.studentId).every((a) => a.state === 'proposed')).toBe(true);
  });

  it('flags a weekly commitment on the test day and picks one test when either of two is accepted', async () => {
    const h = makePlannerHarness();
    h.addPackage(pkg([policy({ family: 'SAT', alternativeGroup: 'sat_or_act' }), policy({ family: 'ACT', acceptedVersions: ['act_enhanced'], alternativeGroup: 'sat_or_act' })]));
    h.seed([buildClaim({ entity: 'commitment', entityId: 'shift', attribute: 'definition', value: { label: 'Saturday shift at work', kind: 'paid_work', weekly: [{ weekday: 6, start: '09:00', end: '15:00' }], period: null }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('I work Saturdays')], actor: h.student, viaRole: 'ui' })]);
    const r = await planFor(h);
    expect(r.payload.testing.needs).toHaveLength(1);
    expect(r.payload.testing.needs[0]).toMatchObject({ family: 'SAT', reason: 'required_one_of', alternatives: ['ACT'] });
    const sel = r.payload.attempts[0]!;
    expect(sel.primary).toBeNull();
    expect(sel.alternative!.conflicts[0]).toMatch(/Saturday, when you have “Saturday shift at work”/);
  });
});
