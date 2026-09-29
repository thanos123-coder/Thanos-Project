import { describe, expect, it } from 'vitest';
import { PORTFOLIO_CONTRACT, type PortfolioPayload } from '../../src/agents/a14-portfolio/agent.js';
import { checkRounds, targetsOf, type ProposedApplication } from '../../src/agents/a14-portfolio/rounds.js';
import { applyTargets, feasibility, resolveControllingDates, sharedDependencies, type Task } from '../../src/agents/a14-portfolio/workload.js';
import { TENANT } from '../helpers/kernel.js';
import { ASHBY, BRIGHTWATER, COPPERFIELD, LARKSPUR, MAPLECREST, UAS, UCAP, makePortfolioHarness } from '../helpers/portfolio.js';

/** Fictional options used across tests. */
const lark = (over: Record<string, unknown> = {}) => ({ optionRef: 'lark', institution: 'Larkspur University', round: 'restrictive_early_action', ...over });
const bright = (over: Record<string, unknown> = {}) => ({ optionRef: 'bright', institution: 'Brightwater Institute', round: 'early_action', ...over });
const copper = (over: Record<string, unknown> = {}) => ({ optionRef: 'copper', institution: 'Copperfield State University', round: 'early_action', ...over });
const wren = (over: Record<string, unknown> = {}) => ({ optionRef: 'wren', institution: 'Wrenfield College', round: 'early_decision', ...over });
const ashby = (over: Record<string, unknown> = {}) => ({ optionRef: 'ashby', institution: 'Ashby College', round: 'regular', ...over });
const maple = (over: Record<string, unknown> = {}) => ({ optionRef: 'maple', institution: 'Maplecrest University', program: 'Nursing', round: 'regular', ...over });

const text = (p: PortfolioPayload) => JSON.stringify(p);

describe('Agent 14 — round constraint engine (unit)', () => {
  const app = (over: Partial<ProposedApplication>): ProposedApplication => ({ optionRef: 'x', institutionId: 'x', institutionName: 'X', country: 'US', control: 'private', round: 'regular', rule: null, exceptionEvidence: [], ...over });
  const rule = (v: Partial<NonNullable<ProposedApplication['rule']>>): NonNullable<ProposedApplication['rule']> => ({ round: 'r', kind: 'regular', binding: false, restrictions: [], requiresOutcome: [], decisionRelease: null, replyBy: null, agreementCycle: null, commitmentText: null, text: 'rule', claimId: 'c1', status: 'verified', retrievedAt: '2026-09-27T10:00:00Z', ...v });

  it('classifies rounds by kind, control and country', () => {
    const us = app({ country: 'US' });
    expect([...targetsOf(app({ control: 'private', rule: rule({ kind: 'early_action' }) }), us)].sort()).toEqual(['any_early_action', 'private_early_action']);
    expect([...targetsOf(app({ control: 'public', rule: rule({ kind: 'early_action' }) }), us)].sort()).toEqual(['any_early_action', 'public_early_action']);
    expect([...targetsOf(app({ rule: rule({ kind: 'early_decision', binding: true }) }), us)].sort()).toEqual(['binding_round', 'early_decision']);
    expect(targetsOf(app({ country: 'CA', rule: rule({ kind: 'early_action' }) }), us).has('foreign_early_round')).toBe(true);
    expect(targetsOf(app({ rule: rule({ kind: 'rolling' }) }), us).has('rolling_admission')).toBe(true);
    // With no rule on file, the round name alone is used and never makes a round look unrestricted.
    expect(targetsOf(app({ round: 'early_decision_ii' }), us).has('binding_round')).toBe(true);
  });

  it('evaluates every ordered pair in the whole set, not one pair at a time', () => {
    const a = app({ optionRef: 'a', institutionId: 'a', rule: rule({ kind: 'restrictive_early_action', restrictions: [{ target: 'binding_round', exceptions: [] }] }) });
    const b = app({ optionRef: 'b', institutionId: 'b', control: 'public', rule: rule({ kind: 'early_action' }) });
    const c = app({ optionRef: 'c', institutionId: 'c', rule: rule({ kind: 'early_decision', binding: true, restrictions: [{ target: 'early_decision', exceptions: [] }] }) });
    const r = checkRounds([a, b, c]);
    expect(r.conflicts.map((x) => `${x.restricting}>${x.restricted}:${x.target}`)).toEqual(['a>c:binding_round']);
    // The pair (a, b) alone is fine; adding c creates the conflict.
    expect(checkRounds([a, b]).conflicts).toEqual([]);
  });

  it('lists applications whose rules are missing or unverified', () => {
    const r = checkRounds([app({ optionRef: 'a', institutionId: 'a' }), app({ optionRef: 'b', institutionId: 'b', rule: rule({ status: 'provisional' }) })]);
    expect(r.unverifiedRules).toEqual(['a', 'b']);
  });
});

describe('Agent 14 — workload scheduler (unit)', () => {
  const t = (over: Partial<Task>): Task => ({ taskId: 't', optionRefs: ['o'], label: 'T', kind: 'writing', owner: 'student', hours: { low: 1, high: 2 }, officialDeadline: null, controllingDate: null, controlledBy: null, requestBy: null, internalTarget: null, dependsOn: [], ...over });

  it('propagates the earliest controlling date through dependencies', () => {
    const tasks = [t({ taskId: 'essay' }), t({ taskId: 'app', dependsOn: ['essay'], officialDeadline: { date: '2027-01-05', time: null, timezone: null, sourceRef: null } }), t({ taskId: 'schol', dependsOn: ['app'], officialDeadline: { date: '2026-12-01', time: null, timezone: null, sourceRef: null }, label: 'Scholarship' })];
    resolveControllingDates(tasks);
    expect(tasks.map((x) => [x.taskId, x.controllingDate])).toEqual([['essay', '2026-12-01'], ['app', '2026-12-01'], ['schol', '2026-12-01']]);
    expect(tasks[1]!.controlledBy).toBe('Scholarship');
  });

  it('keeps internal targets before the official date and computes request dates from lead time', () => {
    const tasks = [t({ taskId: 'rec', owner: 'recommender', kind: 'recommendation_request', officialDeadline: { date: '2026-11-01', time: null, timezone: null, sourceRef: null } })];
    resolveControllingDates(tasks);
    applyTargets(tasks, 7, { recommendation_request: 21 });
    expect(tasks[0]!.internalTarget).toBe('2026-10-25');
    expect(tasks[0]!.requestBy).toBe('2026-10-11');
  });

  it('classifies feasibility from the student’s own hours only', () => {
    const d = { date: '2026-10-25' as const, time: null, timezone: null, sourceRef: null };
    const tasks = [t({ taskId: 'a', hours: { low: 10, high: 14 }, officialDeadline: d }), t({ taskId: 'r', owner: 'recommender', hours: { low: 50, high: 60 }, officialDeadline: d })];
    resolveControllingDates(tasks);
    // Four weeks to 2026-10-25: 4–8 hours at 1–2 hours a week, so 10 hours of the student's own work cannot fit.
    expect(feasibility(tasks, '2026-09-27', { min: 1, max: 2 }).status).toBe('infeasible');
    expect(feasibility(tasks, '2026-09-27', { min: 2, max: 3 }).status).toBe('tight');
    expect(feasibility(tasks, '2026-09-27', { min: 4, max: 6 }).status).toBe('comfortable');
    expect(feasibility(tasks, '2026-09-27', null).status).toBe('unknown');
    expect(feasibility(tasks, '2026-09-27', null).totalHours).toEqual({ low: 10, high: 14 });
  });

  it('finds external dependencies shared by several applications', () => {
    expect(sharedDependencies([t({ taskId: 's', owner: 'school', optionRefs: ['b', 'a'] }), t({ taskId: 'w', optionRefs: ['a', 'b'] })])).toEqual([{ label: 'T', owner: 'school', optionRefs: ['a', 'b'] }]);
  });
});

describe('Agent 14 — application portfolio and round strategist', () => {
  it('14T01 blocks a combination one institution’s rules forbid, even when the other is unrestricted', async () => {
    const h = makePortfolioHarness();
    const rules = h.standardRules();
    const r = await h.plan([lark(), bright()]);
    expect(r.payload.status).toBe('blocked');
    expect(r.payload.rounds!.conflicts).toHaveLength(1);
    expect(r.payload.rounds!.conflicts[0]).toMatchObject({ restricting: 'lark', restricted: 'bright', target: 'any_early_action', sourceRef: `iclaim:${rules.larkspurRea.claimId}` });
    // Brightwater's own round is unrestricted; the conflict comes only from Larkspur's rule.
    expect(r.payload.rounds!.conflicts.some((c) => c.restricting === 'bright')).toBe(false);
    expect(r.payload.nextDecision).toBe('choose compatible rounds');
    expect(r.payload.notices.find((n) => n.code === 'round_conflict')!.message).toContain('Larkspur University’s restrictive early action rule does not allow Brightwater Institute’s early action');
    expect(r.payload.alternatives.find((a) => a.plan === 'compatible_rounds')!.why).toContain('Brightwater Institute');
    // The order the options are given in does not matter.
    const reversed = await h.plan([bright(), lark()]);
    expect(reversed.payload.rounds!.conflicts.map((c) => `${c.restricting}>${c.restricted}`)).toEqual(['lark>bright']);
    // A blocked plan cannot be approved.
    const blocked = await h.run({ action: 'approve', cycle: '2027', planVersion: reversed.payload.version, confirmedByStudent: true });
    expect(blocked.result.completionReason).toBe('plan_blocked');
    // A public institution's early action is within the published exception.
    const pub = await h.plan([lark(), copper()]);
    expect(pub.payload.rounds!.conflicts).toEqual([]);
    expect(pub.payload.rounds!.exceptionsApplied[0]).toMatchObject({ restricting: 'lark', restricted: 'copper', condition: 'public_institution' });
    expect(pub.payload.status).toBe('proposed');
  });

  it('14T02 applies a scholarship exception only with evidence that the exact condition holds', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.award(h.fictionalScholarship('bright_merit', { name: 'Brightwater Merit Award', award: { kind: 'fixed', amount: { amount: '10000.00', currency: 'USD' }, duration: 'one_academic_year', portability: 'destination_restricted', destinations: [{ institutionRef: BRIGHTWATER, programRef: null }] } }));
    h.award(h.fictionalScholarship('bright_early', { name: 'Brightwater Founders Scholarship', award: { kind: 'fixed', amount: { amount: '20000.00', currency: 'USD' }, duration: 'full_degree', portability: 'destination_restricted', destinations: [{ institutionRef: BRIGHTWATER, programRef: null }] }, requiresAdmissionRound: { institutionRef: BRIGHTWATER, round: 'early_action', sourceRef: 'ssrc_bright_early' } }));
    // No scholarship named: the exception is not assumed.
    const none = await h.plan([lark(), bright({ exceptionEvidence: [{ condition: 'scholarship_requires_early' }] })]);
    expect(none.payload.status).toBe('blocked');
    expect(none.payload.rounds!.conflicts[0]!.pendingException).toContain('no scholarship was named');
    // A merit award that happens to exist does not authorize the early application.
    const merit = await h.plan([lark(), bright({ exceptionEvidence: [{ condition: 'scholarship_requires_early', scholarshipId: 'bright_merit' }] })]);
    expect(merit.payload.status).toBe('blocked');
    expect(merit.payload.rounds!.conflicts[0]!.pendingException).toContain('Brightwater Merit Award does not state that it requires this round');
    // A verified scholarship that requires this exact round satisfies the exception, and the evidence is cited.
    const ok = await h.plan([lark(), bright({ exceptionEvidence: [{ condition: 'scholarship_requires_early', scholarshipId: 'bright_early' }] })]);
    expect(ok.payload.rounds!.conflicts).toEqual([]);
    expect(ok.payload.rounds!.exceptionsApplied[0]!.detail).toContain('Brightwater Founders Scholarship requires applying to Brightwater Institute in early action');
    expect(ok.sourceRefs).toContain('scholarship:bright_early@1');
    // The same scholarship does not cover a different round.
    const other = await h.plan([lark(), bright({ round: 'regular' }), wren({ exceptionEvidence: [{ condition: 'scholarship_requires_early', scholarshipId: 'bright_early' }] })]);
    expect(other.payload.rounds!.conflicts.some((c) => c.restricted === 'wren')).toBe(true);
    // A condition the registry cannot check needs confirmation from the institution.
    const note = await h.plan([lark(), bright({ exceptionEvidence: [{ condition: 'other', note: 'my counselor said it is fine' }] })]);
    expect(note.payload.status).toBe('blocked');
  });

  it('14T03 withholds a definitive binding recommendation when the agreement on file is from an old cycle', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.affordability('wren', 'supported');
    const r = await h.plan([wren({ firstChoiceConfirmed: true, supportersReviewedFinances: true })]);
    const o = h.opt(r, 'wren');
    expect(o.binding).toBe(true);
    expect(o.bindingReadiness).toEqual({ ready: false, unmet: ['the agreement on file is for 2025, not 2027'] });
    expect(o.notes.join(' ')).toContain('No definitive recommendation for this binding round yet');
    expect(o.notes.join(' ')).toContain('it is not an option to abandon later');
    expect(r.payload.questions.find((q) => q.code === 'binding_terms_wren')).toMatchObject({ for: 'admissions_office' });
    expect(r.handoffs.find((x) => x.toRole === '11')!.requestedOutcome).toContain('2027 round rules, agreements and deadlines');
    expect(r.payload.nextDecision).toBe('settle the open questions before a binding round');
    // With the current agreement verified, the readiness check passes.
    const h2 = makePortfolioHarness();
    h2.rule(h2.registry.institutionOf('wrenfield_c')!.id, 'early_decision', { kind: 'early_decision', binding: true, restrictions: [{ target: 'binding_round', exceptions: [] }], agreementCycle: '2027', commitmentText: 'If admitted, I will enroll.', text: 'Early Decision is binding for 2027 entry.' });
    h2.deadline('wrenfield_c', 'early_decision', '2026-11-01');
    h2.affordability('wren', 'supported');
    const ready = await h2.plan([wren({ firstChoiceConfirmed: true, supportersReviewedFinances: true })]);
    expect(h2.opt(ready, 'wren').bindingReadiness).toEqual({ ready: true, unmet: [] });
    expect(ready.payload.nextDecision).toBe('review and approve the plan');
  });

  it('14T04 shows affordability uncertainty before a binding choice and routes to financial review', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    const r = await h.plan([wren({ firstChoiceConfirmed: true, supportersReviewedFinances: true })]);
    const o = h.opt(r, 'wren');
    expect(o.affordability).toBe('not_calculated');
    expect(o.bindingReadiness!.unmet).toContain('affordability has not been established on confirmed resources');
    expect(r.payload.questions.find((q) => q.code === 'aid_review_wren')).toMatchObject({ for: 'aid_office' });
    const h15 = r.handoffs.find((x) => x.toRole === '15')!;
    expect(h15.reason).toBe('A binding round is proposed without confirmed affordability.');
    expect(h15.inputRefs).toEqual(['wren']);
    // A conditional scenario (unawarded funding) is not enough either.
    h.affordability('wren', 'conditional');
    const cond = await h.plan([wren({ firstChoiceConfirmed: true, supportersReviewedFinances: true })]);
    expect(h.opt(cond, 'wren').bindingReadiness!.unmet).toContain('affordability is conditional');
    expect(cond.handoffs.some((x) => x.toRole === '15')).toBe(true);
    // Readiness also needs a genuine first choice and the people paying to have reviewed the numbers.
    const unsure = await h.plan([wren()]);
    expect(h.opt(unsure, 'wren').bindingReadiness!.unmet).toEqual(expect.arrayContaining(['you have not confirmed it is your clear first choice', 'the people paying or signing have not reviewed the financial assumptions']));
  });

  it('14T05 reports that no confirmed affordable alternative exists when every option needs competitive funding', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    for (const ref of ['copper', 'ashby', 'maple']) h.affordability(ref, 'conditional');
    const r = await h.plan([copper(), ashby(), maple()]);
    expect(r.payload.coverage!.confirmedAffordablePath).toBe(false);
    const g = h.gap(r, 'no_confirmed_affordable_alternative');
    expect(g).toHaveLength(1);
    expect(g[0]!.message).toContain('depend on funding that is not awarded');
    expect(r.payload.nextDecision).toBe('research an affordable option or pathway');
    expect(r.handoffs.find((x) => x.toRole === '12')!.unresolved).toContain('no_confirmed_affordable_alternative');
    // No lower-cost plan is invented when nothing is affordable.
    expect(r.payload.alternatives.some((a) => a.plan === 'lower_cost')).toBe(false);
  });

  it('14T06 does not treat a less selective but unaffordable college as a financial fallback', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.assessment('ashby', 'plausible_option_with_material_uncertainty');
    h.affordability('ashby', 'gap_identified');
    h.assessment('lark', 'highly_uncertain_selection');
    h.affordability('lark', 'supported');
    const r = await h.plan([lark({ round: 'regular' }), ashby()]);
    expect(h.gap(r, 'unaffordable_fallback')[0]!.message).toBe('Ashby College has clearer admission evidence but is not affordable on confirmed resources, so it is not a financial fallback.');
    expect(r.payload.coverage!.credibleAffordablePath).toBe(false);
    expect(r.payload.coverage!.confirmedAffordablePath).toBe(true);
    // An option that is both plausible and affordable is a credible affordable path.
    h.assessment('copper', 'plausible_option_with_material_uncertainty');
    h.affordability('copper', 'supported');
    const r2 = await h.plan([lark({ round: 'regular' }), ashby(), copper()]);
    expect(r2.payload.coverage!.credibleAffordablePath).toBe(true);
  });

  it('14T07 offers a smaller plan or later rounds when writing exceeds available time, never ghostwriting', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.prompt(UCAP, 'personal_essay', 'personal_essay', 'Personal essay');
    h.prompt(LARKSPUR, 'why_larkspur', 'supplement', 'Why Larkspur');
    h.prompt(COPPERFIELD, 'community', 'supplement', 'Community essay');
    h.prompt(BRIGHTWATER, 'curiosity', 'supplement', 'Curiosity essay');
    h.weekly(1.5, 2);
    const opts = [lark({ platform: UCAP, system: 'common_app', priority: 1 }), copper({ platform: UCAP, system: 'common_app', priority: 2 }), bright({ round: 'regular', platform: UCAP, system: 'common_app', priority: 3 })];
    const r = await h.plan(opts);
    // One shared personal essay is counted once, not per application.
    expect(r.payload.tasks.filter((t) => t.label.startsWith('Write: Personal essay'))).toHaveLength(1);
    expect(h.task(r, 'write_ucap_personal_essay')!.optionRefs.sort()).toEqual(['copper', 'lark', 'bright'].sort());
    expect(r.payload.workload!.status).toBe('infeasible');
    expect(r.payload.nextDecision).toBe('choose a plan that fits your time');
    const fits = r.payload.alternatives.find((a) => a.plan === 'fits_your_time')!;
    // Larkspur's early round cannot fit in five weeks at this pace; the other two can.
    expect(fits.optionRefs).toEqual(['copper', 'bright']);
    expect(fits.why).toContain('Using AI to write the essays is not a way to close the gap: the writing has to be yours.');
    expect(r.payload.alternatives.find((a) => a.plan === 'later_rounds')!.why).toContain('Moving Larkspur University and Copperfield State University to a later round');
    // The student's own pace setting scales writing effort without any deficit label.
    const paced = await h.plan(opts, { paceMultiplier: 1.5 });
    expect(h.task(paced, 'write_lark_why_larkspur')).toMatchObject({ hours: { low: 4.5, high: 9 } });
    expect(text(paced.payload)).not.toMatch(/\b(slow|deficit|weak writer|behind)\b/i);
    expect(r.externalActions).toEqual([]);
  });

  it('14T08 schedules an external recommendation from its owner’s lead time and flags a late request', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    const rec = { key: 'rec_chemistry', label: 'Recommendation from your chemistry teacher', kind: 'recommendation_request', owner: 'recommender' };
    const r = await h.plan([copper({ externalItems: [rec] })]);
    const t = h.task(r, 'external_rec_chemistry')!;
    expect(t).toMatchObject({ owner: 'recommender', controllingDate: '2026-11-15', requestBy: '2026-10-25', internalTarget: '2026-11-08' });
    expect(h.task(r, 'submit_copper')!.dependsOn).toContain('external_rec_chemistry');
    // The recommender's work is not counted as the student's hours.
    expect(r.payload.workload!.totalHours).toEqual({ low: 1, high: 2 });
    expect(r.externalActions).toEqual([]);
    // A longer lead time makes the request already late, and the plan says so.
    const late = await h.plan([copper({ externalItems: [rec] })], { leadTimes: { recommendation_request: 60, school_report_request: 14, transcript_request: 10, nomination_request: 21 } });
    expect(late.payload.notices.find((n) => n.code === 'late_request')!.message).toContain('Recommendation from your chemistry teacher should have been requested by 2026-09-16');
  });

  it('14T09 approving a plan records the approval and does not submit, pay or message anyone', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    const r = await h.plan([copper({ applicationFee: { amount: '65.00', currency: 'USD' } }), ashby()]);
    expect(r.payload.status).toBe('proposed');
    const wrong = await h.run({ action: 'approve', cycle: '2027', planVersion: 99, confirmedByStudent: true });
    expect(wrong.result.completionReason).toBe('plan_version_mismatch');
    const unconfirmed = await h.ok({ action: 'approve', cycle: '2027', planVersion: r.payload.version, confirmedByStudent: false });
    expect(unconfirmed.status).toBe('needs_student_input');
    const a = await h.ok({ action: 'approve', cycle: '2027', planVersion: r.payload.version, confirmedByStudent: true });
    expect(a.payload.status).toBe('approved');
    expect(a.payload.notices.find((n) => n.code === 'nothing_sent')!.message).toBe('Approving the plan does not submit an application, pay a fee or contact anyone. Each of those is a separate step that you authorize yourself.');
    expect(a.externalActions).toEqual([]);
    expect(a.payload.actionsTaken).toEqual([]);
    const statuses = h.kernel.records.history(h.ui, TENANT, h.studentId, 'application:copper.status');
    expect(statuses.map((c) => c.value)).toEqual(['approved']);
    expect(h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'portfolio_approval' })[0]!.payload).toMatchObject({ planVersion: 1, optionRefs: ['copper', 'ashby'] });
  });

  it('14T10 keeps submission, receipt and completeness as separate states', async () => {
    const h = makePortfolioHarness();
    const receipt = { kind: 'portal_receipt', quote: 'Your application to Copperfield State University was submitted on 2026-11-10.', documentId: 'doc_receipt', documentVersion: 1 };
    const r = await h.ok({ action: 'record_status', optionRef: 'copper', state: 'submitted', evidence: receipt, items: [{ item: 'Transcript', owner: 'school', status: 'requested' }, { item: 'Application form', owner: 'student', status: 'received' }] });
    expect(r.payload.applicationStates[0]).toEqual({ optionRef: 'copper', submission: 'submitted', completeness: 'incomplete', missing: ['Transcript'], confirmedBy: 'portal receipt' });
    // Claiming "complete" while the transcript is outstanding records receipt, not completeness.
    const c = await h.ok({ action: 'record_status', optionRef: 'copper', state: 'complete', evidence: receipt, items: [{ item: 'Transcript', owner: 'school', status: 'requested' }] });
    expect(c.payload.applicationStates[0]!.submission).toBe('received');
    expect(c.payload.notices.find((n) => n.code === 'not_complete')!.message).toBe('The application cannot be marked complete: Transcript is not confirmed received.');
    // A student marking a task done does not create a receipt.
    const said = await h.ok({ action: 'record_status', optionRef: 'ashby', state: 'received', evidence: { kind: 'student_report', quote: 'I think Ashby got it' }, items: [] });
    expect(said.payload.applicationStates[0]).toMatchObject({ submission: 'submitted', completeness: 'unknown', confirmedBy: null });
    expect(said.payload.notices.map((n) => n.code)).toContain('receipt_needed');
    expect(h.kernel.records.history(h.ui, TENANT, h.studentId, 'application:ashby.status').map((x) => x.value)).toEqual(['submitted']);
    // Items are recorded with their owners.
    const item = h.kernel.records.history(h.ui, TENANT, h.studentId, 'application_item:copper_transcript.definition');
    expect(item.at(-1)!.value).toEqual({ applicationRef: 'copper', item: 'Transcript', owner: 'school', status: 'requested' });
  });

  it('14T11 schedules an earlier scholarship dependency as the controlling date', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.award(
      h.fictionalScholarship('maple_leaders', {
        name: 'Maplecrest Leaders Scholarship',
        award: { kind: 'fixed', amount: { amount: '15000.00', currency: 'USD' }, duration: 'full_degree', portability: 'destination_restricted', destinations: [{ institutionRef: MAPLECREST, programRef: null }] },
        stages: [
          { stageId: 'admission', kind: 'admission_application', label: 'Apply for admission', owner: 'student', deadline: { date: '2026-12-01', time: '23:59', timezone: 'America/New_York', sourceRef: 'ssrc_maple_leaders' }, dependsOn: [] },
          { stageId: 'essay', kind: 'award_application', label: 'Scholarship essay', owner: 'student', deadline: { date: '2026-12-15', time: '23:59', timezone: 'America/New_York', sourceRef: 'ssrc_maple_leaders' }, dependsOn: ['admission'], details: { essays: 1 } },
        ],
      }),
    );
    h.pursue('maple_leaders');
    const r = await h.plan([maple()]);
    const submit = h.task(r, 'submit_maple')!;
    // The official admission deadline is kept, and the scholarship's earlier date controls the task.
    expect(submit.officialDeadline!.date).toBe('2027-01-10');
    expect(submit.controllingDate).toBe('2026-12-01');
    expect(submit.controlledBy).toBe('Maplecrest Leaders Scholarship: Apply for admission by the scholarship’s date');
    expect(submit.internalTarget).toBe('2026-11-24');
    expect(h.task(r, 'scholarship_maple_leaders_essay')).toMatchObject({ owner: 'student', controllingDate: '2026-12-15' });
    expect(r.sourceRefs).toContain('scholarship:maple_leaders@1');
    // A stopped scholarship no longer controls the schedule.
    h.pursue('maple_leaders', 'stopped');
    const after = await h.plan([maple()]);
    expect(h.task(after, 'submit_maple')!.controllingDate).toBe('2027-01-10');
  });

  it('14T12 opens an outcome-dependent round only after the outcome is confirmed and the rule is current', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    const candidate = { optionRef: 'wren_ed2', institution: 'Wrenfield College', round: 'early_decision_ii' };
    const reported = await h.ok({ action: 'report_outcome', optionRef: 'lark', institution: 'Larkspur University', cycle: '2027', outcome: 'deferred', evidence: { kind: 'student_report', quote: 'I was deferred from Larkspur' }, candidates: [candidate] });
    expect(reported.status).toBe('needs_student_input');
    expect(reported.payload.changes).toEqual(['Wrenfield College early decision ii may open after a deferred, but it is not added yet.']);
    expect(reported.payload.questions.map((q) => q.code)).toEqual(['confirm_outcome_lark']);
    const notice = { kind: 'portal_notice', quote: 'Your application has been deferred to Regular Decision.', documentId: 'doc_notice', documentVersion: 1 };
    const confirmed = await h.ok({ action: 'report_outcome', optionRef: 'lark', institution: 'Larkspur University', cycle: '2027', outcome: 'deferred', evidence: notice, candidates: [candidate] });
    expect(confirmed.status).toBe('completed');
    expect(confirmed.payload.changes[0]).toContain('Wrenfield College early decision ii is now open to you');
    expect(confirmed.payload.changes[0]).toContain('nothing is submitted');
    expect(confirmed.externalActions).toEqual([]);
    expect(h.kernel.records.history(h.ui, TENANT, h.studentId, 'application:lark.outcome').at(-1)!.value).toBe('deferred');
    // A rule last checked more than a week ago is re-verified first.
    h.clock.advanceMs(10 * 86400000);
    const stale = await h.ok({ action: 'report_outcome', optionRef: 'lark', institution: 'Larkspur University', cycle: '2027', outcome: 'deferred', evidence: notice, candidates: [candidate] });
    expect(stale.payload.changes[0]).toContain('is not added yet');
    expect(stale.payload.questions.map((q) => q.code)).toEqual(['recheck_rule_wren_ed2']);
    expect(stale.handoffs[0]).toMatchObject({ toRole: '11' });
    // An admission does not open a round that needs a deferral or denial.
    const admitted = await h.ok({ action: 'report_outcome', optionRef: 'copper', institution: 'Copperfield State University', cycle: '2027', outcome: 'admitted', evidence: notice, candidates: [candidate] });
    expect(admitted.payload.changes).toEqual([]);
  });

  it('14T13 recalculates when a budget change removes financial coverage, keeping the prior approval as history', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.budget('30000.00');
    h.affordability('copper', 'supported', ['attendance_budget:*.definition']);
    h.affordability('ashby', 'gap_identified', ['attendance_budget:*.definition']);
    const v1 = await h.plan([copper(), ashby()]);
    expect(v1.payload.coverage!.confirmedAffordablePath).toBe(true);
    await h.ok({ action: 'approve', cycle: '2027', planVersion: 1, confirmedByStudent: true });
    // The family lowers its confirmed contribution: the affordability results, the plan and its approval become stale.
    h.budget('18000.00');
    expect(h.plans().find((p) => (p.payload as { version: number }).version === 1)!.status).toBe('stale');
    expect(h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'portfolio_approval' })[0]!.status).toBe('stale');
    // Agent 15 recalculates: Copperfield now depends on funding that is not awarded.
    h.affordability('copper', 'conditional', ['attendance_budget:*.definition']);
    h.affordability('ashby', 'gap_identified', ['attendance_budget:*.definition']);
    const v2 = await h.plan([copper(), ashby()]);
    expect(v2.payload.version).toBe(2);
    expect(v2.payload.status).toBe('proposed');
    expect(v2.payload.changes).toEqual(['Copperfield State University: affordability supported → conditional.', 'The plan no longer has an option you would attend that is affordable on confirmed resources.']);
    expect(h.gap(v2, 'no_confirmed_affordable_alternative')).toHaveLength(1);
    expect(v2.payload.notices.map((n) => n.code)).toEqual(expect.arrayContaining(['plan_revised', 'prior_approval_historical']));
    expect(v2.payload.notices.find((n) => n.code === 'prior_approval_historical')!.message).toBe('You approved plan version 1. That approval is kept as history and does not apply to version 2, which needs your review.');
    // The old plan is kept, superseded, not erased.
    expect(h.plans().map((p) => [(p.payload as { version: number }).version, p.status])).toEqual([[1, 'superseded'], [2, 'current']]);
    // The old version can no longer be approved.
    const old = await h.run({ action: 'approve', cycle: '2027', planVersion: 1, confirmedByStudent: true });
    expect(old.result.completionReason).toBe('plan_version_mismatch');
  });

  it('14T14 applies the application system’s current choice limit and explains the conflict', async () => {
    const h = makePortfolioHarness();
    h.choiceLimit(UAS, 'ucas', 5, [{ rule: 'history', max: 2, text: 'No more than two of your choices may be in history.' }]);
    const gb = [
      ['h_econ', 'Harrowgate University', 'Economics'],
      ['h_hist', 'Harrowgate University', 'History'],
      ['t_econ', 'Thornbury University', 'Economics'],
      ['t_hist', 'Thornbury University', 'History'],
      ['e_econ', 'Elmsworth University', 'Economics'],
      ['e_hist', 'Elmsworth University', 'History'],
    ] as const;
    const choices = gb.map(([ref, institution, program]) => ({ optionRef: ref, institution, program, round: 'ucas_main', system: 'ucas', platform: UAS, platformTags: program === 'History' ? ['history'] : [] }));
    const r = await h.plan(choices);
    expect(r.payload.status).toBe('blocked');
    expect(r.payload.rounds!.choiceLimit).toEqual(['Undergraduate Admissions Service allows 5 choices in one application and 6 are proposed (“You can choose up to 5 courses in one application.”). Choose which to keep; these are not 6 independent applications.', 'No more than two of your choices may be in history. (3 proposed).']);
    expect(r.payload.nextDecision).toBe('choose which choices to keep within the system limit');
    const five = await h.plan(choices.filter((c) => c.optionRef !== 'e_hist'));
    expect(five.payload.rounds!.choiceLimit).toEqual([]);
    expect(five.payload.status).toBe('proposed');
    // A provisional limit is not applied as the current rule.
    const h2 = makePortfolioHarness();
    h2.official(UAS, 'application_choice_limit', 'ucas', { system: 'ucas', maxChoices: 3, restrictions: [], text: 'Up to three choices (draft).' }, 'Up to three choices (draft).', { status: 'provisional' });
    const draft = await h2.plan(choices.slice(0, 5));
    expect(draft.payload.rounds!.choiceLimit).toEqual([]);
  });

  it('14T15 preserves the official deadline time and zone and converts it correctly to the student’s time', async () => {
    const h = makePortfolioHarness();
    h.deadline('harrowgate_u_econ', 'ucas_main', '2026-10-15', '18:00', 'Europe/London', 'UK time');
    h.timezone('America/New_York');
    const r = await h.plan([{ optionRef: 'h_econ', institution: 'Harrowgate University', program: 'Economics', round: 'ucas_main', system: 'ucas' }]);
    const o = h.opt(r, 'h_econ');
    expect(o.deadline).toMatchObject({ official: '2026-10-15 18:00 UK time', timezone: 'Europe/London', yourLocalTime: '2026-10-15 13:00 (America/New_York)' });
    expect(h.task(r, 'submit_h_econ')!.officialDeadline).toMatchObject({ date: '2026-10-15', time: '18:00', timezone: 'Europe/London' });
    // The same instant crosses the date line for a student in Tokyo.
    h.timezone('Asia/Tokyo');
    const tokyo = await h.plan([{ optionRef: 'h_econ', institution: 'Harrowgate University', program: 'Economics', round: 'ucas_main', system: 'ucas' }]);
    expect(h.opt(tokyo, 'h_econ').deadline.yourLocalTime).toBe('2026-10-16 02:00 (Asia/Tokyo)');
    // Without the student's zone, no local time is guessed.
    const h2 = makePortfolioHarness();
    h2.deadline('harrowgate_u_econ', 'ucas_main', '2026-10-15', '18:00', 'Europe/London', 'UK time');
    const none = await h2.plan([{ optionRef: 'h_econ', institution: 'Harrowgate University', program: 'Economics', round: 'ucas_main', system: 'ucas' }]);
    expect(h2.opt(none, 'h_econ').deadline.yourLocalTime).toBeNull();
  });

  it('14T16 researches permitted alternatives after a missed deadline without promising an exception', async () => {
    const h = makePortfolioHarness({ now: '2026-11-03T12:00:00Z' });
    h.standardRules();
    const r = await h.ok({ action: 'missed_deadline', cycle: '2027', option: lark() });
    expect(r.payload.alternatives).toEqual([{ plan: 'regular_round', optionRefs: ['lark'], why: 'Larkspur University’s regular deadline is 2027-01-05 23:59 Eastern Time; check its conditions before relying on it.' }]);
    expect(r.payload.notices.find((n) => n.code === 'no_exception_promised')!.message).toContain('will not promise an exception or suggest giving a reason that is not true');
    expect(r.payload.questions[0]).toMatchObject({ code: 'late_policy', for: 'admissions_office' });
    expect(r.handoffs[0]).toMatchObject({ toRole: '11' });
    expect(r.externalActions).toEqual([]);
    expect(text(r.payload)).not.toMatch(/technical (problem|issue|glitch)|guarantee/i);
  });

  it('14T17 does not count a fallback the student would not attend as an acceptable outcome', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.affordability('ashby', 'supported');
    h.assessment('ashby', 'plausible_option_with_material_uncertainty');
    h.affordability('lark', 'conditional');
    const r = await h.plan([lark({ round: 'regular' }), ashby({ studentWouldAttend: false })]);
    expect(h.opt(r, 'ashby').acceptable).toBe(false);
    expect(r.payload.coverage!.acceptableOutcomes).toBe(1);
    expect(r.payload.coverage!.confirmedAffordablePath).toBe(false);
    expect(h.gap(r, 'not_an_outcome')[0]!.message).toBe('Ashby College is not counted: You said you would not attend, so it is not counted as an acceptable outcome.');
    expect(h.gap(r, 'no_confirmed_affordable_alternative')).toHaveLength(1);
    // An option the student set aside in the record is treated the same way.
    h.setAside('ashby', 'too far from home');
    const r2 = await h.plan([lark({ round: 'regular' }), ashby()]);
    expect(h.opt(r2, 'ashby').notes[0]).toBe('You set this aside: too far from home.');
    expect(r2.payload.coverage!.confirmedAffordablePath).toBe(false);
  });

  it('14T18 shows a dependency shared by several applications instead of treating outcomes as independent', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    const report = { key: 'school_report', label: 'School report and counselor letter', kind: 'school_report_request', owner: 'school' };
    const r = await h.plan([copper({ externalItems: [report] }), ashby({ externalItems: [report] }), maple({ externalItems: [report] })]);
    expect(r.payload.coverage!.sharedDependencies).toEqual([{ label: 'School report and counselor letter', owner: 'school', optionRefs: ['ashby', 'copper', 'maple'] }]);
    expect(h.gap(r, 'shared_dependency')[0]!.message).toBe('School report and counselor letter is needed by 3 applications (ashby, copper, maple); if it is late, all of them are affected, so they are not independent.');
    expect(h.task(r, 'external_school_report')!.controllingDate).toBe('2026-11-15');
    expect(r.payload.coverage!.combinedChance).toBeNull();
    expect(text(r.payload)).not.toMatch(/chance of at least one|at least one (offer|admission) is \d/i);
  });

  it('keeps inputs from other roles as they are and cites them', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    const af = h.affordability('copper', 'supported');
    const as = h.assessment('copper', 'plausible_option_with_material_uncertainty');
    const r = await h.plan([copper()]);
    expect(h.opt(r, 'copper')).toMatchObject({ affordability: 'supported', selection: 'plausible_option_with_material_uncertainty' });
    const stored = h.plans()[0]!;
    expect(stored.inputs.sourceIds).toEqual(expect.arrayContaining([`artifact:${af.id}`, `artifact:${as.id}`]));
    // A stale affordability result is not used as if current.
    h.kernel.records.invalidateByRuleOrSource(TENANT, h.studentId, { sourceId: 'nothing' }, 'noop');
    h.kernel.records.putDerived({ ...h.ui, viaRole: '15' }, { tenantId: TENANT, studentId: h.studentId, kind: 'affordability_scenario', scopeKey: 'copper', payload: { optionRef: 'copper', state: 'supported' }, inputClaimIds: [], inputFieldKeys: ['attendance_budget:*.definition'], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
    h.budget('10000.00');
    const r2 = await h.plan([copper()]);
    expect(h.opt(r2, 'copper').affordability).toBe('unknown');
    // An unverified round rule is reported and sent for research, not assumed unrestricted.
    const h2 = makePortfolioHarness();
    h2.rule(ASHBY, 'regular', { kind: 'regular', text: 'Regular Decision (unconfirmed).' }, { status: 'provisional' });
    const r3 = await h2.plan([ashby()]);
    expect(r3.payload.rounds!.unverifiedRules).toEqual(['ashby']);
    expect(r3.handoffs.some((x) => x.toRole === '11')).toBe(true);
  });

  it('checks fees against the application budget and keeps waived fees out', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.affordability('copper', 'supported');
    const fee = (a: string) => ({ amount: a, currency: 'USD' });
    const r = await h.plan([copper({ applicationFee: fee('60.00') }), ashby({ applicationFee: fee('75.00') }), maple({ applicationFee: fee('90.00'), feeWaiver: true })], { applicationBudget: fee('100.00') });
    expect(r.payload.fees).toEqual({ total: fee('135.00'), budget: fee('100.00'), withinBudget: false, waived: ['maple'] });
    expect(r.payload.alternatives.find((a) => a.plan === 'lower_cost')!.optionRefs.sort()).toEqual(['copper', 'maple']);
  });

  it('asks the student about an institution it cannot resolve instead of guessing', async () => {
    const h = makePortfolioHarness();
    const r = await h.plan([{ optionRef: 'mystery', institution: 'Nonexistent Academy', round: 'regular' }]);
    expect(h.opt(r, 'mystery').resolved).toBe(false);
    expect(r.payload.questions[0]!.code).toBe('resolve_mystery');
    expect(r.status).toBe('partial');
  });

  it('the worked portfolio repair: resolves program access and nominations first, then repairs after a budget change', async () => {
    const h = makePortfolioHarness();
    h.standardRules();
    h.prompt(UCAP, 'personal_essay', 'personal_essay', 'Personal essay');
    for (const [id, pid] of [[LARKSPUR, 'why_larkspur'], [BRIGHTWATER, 'curiosity'], [ASHBY, 'why_ashby'], [MAPLECREST, 'why_nursing']] as const) h.prompt(id, pid, 'supplement', `Supplement ${pid}`);
    h.weekly(3, 5);
    h.budget('24000.00');
    const afford = (ref: string, s: 'supported' | 'conditional' | 'gap_identified') => h.affordability(ref, s, ['attendance_budget:*.definition']);
    // Three options depend on uncertain admission and substantial aid; one is affordable but has a program access question.
    for (const ref of ['lark', 'bright', 'wren']) {
      h.assessment(ref, 'highly_uncertain_selection');
      afford(ref, 'conditional');
    }
    h.official('maplecrest_nursing', 'program_access_route', '', { route: 'later_competitive_selection', guaranteed: false, text: 'Students admitted to Maplecrest apply to the nursing major after the first year; places are limited.' }, 'Students admitted to Maplecrest apply to the nursing major after the first year; places are limited.');
    h.assessment('maple', 'plausible_option_with_material_uncertainty');
    afford('maple', 'supported');
    h.assessment('copper', 'plausible_option_with_material_uncertainty');
    afford('copper', 'gap_identified');
    h.assessment('ashby', 'plausible_option_with_material_uncertainty');
    afford('ashby', 'gap_identified');
    // Two need separate scholarship applications and school nominations.
    for (const [id, inst, name] of [['lark_scholars', LARKSPUR, 'Larkspur Scholars Program'], ['ashby_fellows', ASHBY, 'Ashby Fellows Award']] as const) {
      h.award(
        h.fictionalScholarship(id, {
          name,
          award: { kind: 'fixed', amount: { amount: '12000.00', currency: 'USD' }, duration: 'full_degree', portability: 'destination_restricted', destinations: [{ institutionRef: inst, programRef: null }] },
          stages: [
            { stageId: 'admission', kind: 'admission_application', label: 'Apply for admission', owner: 'student', deadline: { date: '2026-12-01', time: '17:00', timezone: 'America/New_York', sourceRef: `ssrc_${id}` } },
            { stageId: 'nomination', kind: 'nomination', label: 'School nomination', owner: 'school', deadline: { date: '2026-11-20', time: null, timezone: null, sourceRef: `ssrc_${id}` }, internalDeadline: 'unknown', details: { perSchoolLimit: 1 } },
            { stageId: 'application', kind: 'award_application', label: 'Scholarship application', owner: 'student', deadline: { date: '2026-12-01', time: '17:00', timezone: 'America/New_York', sourceRef: `ssrc_${id}` }, dependsOn: ['nomination', 'admission'], details: { essays: 2 } },
          ],
        }),
      );
      h.pursue(id);
    }
    const fee = { amount: '80.00', currency: 'USD' };
    const six = [
      lark({ round: 'regular', platform: UCAP, system: 'common_app', priority: 3, applicationFee: fee }),
      bright({ round: 'regular', platform: UCAP, system: 'common_app', priority: 4, applicationFee: fee }),
      wren({ round: 'regular', platform: UCAP, system: 'common_app', priority: 5, applicationFee: fee }),
      maple({ platform: UCAP, system: 'common_app', priority: 1, applicationFee: fee }),
      copper({ platform: UCAP, system: 'common_app', priority: 2, applicationFee: fee }),
      ashby({ platform: UCAP, system: 'common_app', priority: 6, applicationFee: fee }),
    ];
    h.rule('wrenfield_c', 'regular', { kind: 'regular', text: 'Regular Decision places no restrictions on other applications.' });
    h.deadline('wrenfield_c', 'regular', '2027-01-05');
    const v1 = await h.plan(six, { applicationBudget: { amount: '300.00', currency: 'USD' } });
    // It starts with the questions that could change coverage, not with ordering names.
    expect(v1.payload.nextDecision).toBe('resolve the program access question and nomination feasibility first');
    expect(v1.payload.questions.find((q) => q.code === 'program_access_maple')).toMatchObject({ for: 'admissions_office' });
    expect(v1.payload.questions.filter((q) => q.code.startsWith('nomination_')).map((q) => q.for)).toEqual(['school', 'school']);
    expect(h.gap(v1, 'nomination_competition')[0]!.message).toContain('Ashby Fellows Award and Larkspur Scholars Program each need a nomination from your school');
    expect(v1.handoffs.find((x) => x.toRole === '16')!.unresolved).toEqual(['internal_deadline:ashby_fellows', 'internal_deadline:lark_scholars']);
    // The scholarship's earlier date controls the admission application it depends on.
    expect(h.task(v1, 'submit_lark')!.controllingDate).toBe('2026-12-01');
    // Fees exceed the budget; the round set is compatible; workload is measured against the student's hours.
    expect(v1.payload.fees!.withinBudget).toBe(false);
    expect(v1.payload.rounds!.conflicts).toEqual([]);
    expect(['tight', 'infeasible']).toContain(v1.payload.workload!.status);
    // The two scholarship-heavy applications due first are the ones the smaller plan sets aside, with reasons.
    const smaller = v1.payload.alternatives.find((a) => a.plan === 'fits_your_time')!;
    expect(smaller.optionRefs).toEqual(['maple', 'copper', 'bright', 'wren']);
    expect(smaller.why).toContain('By 2026-12-01 the plan needs 35–65 hours of your own work');
    expect(v1.payload.coverage!.confirmedAffordablePath).toBe(true);
    expect(h.gap(v1, 'unaffordable_fallback').map((g) => g.message.split(' has')[0])).toEqual(['Copperfield State University', 'Ashby College']);
    await h.ok({ action: 'approve', cycle: '2027', planVersion: 1, confirmedByStudent: true });

    // Later the family lowers its confirmed contribution; Agent 15 marks two options newly conditional.
    h.budget('15000.00');
    for (const ref of ['lark', 'bright', 'wren']) afford(ref, 'conditional');
    afford('maple', 'conditional');
    afford('copper', 'conditional');
    afford('ashby', 'gap_identified');
    const v2 = await h.plan(six, { applicationBudget: { amount: '300.00', currency: 'USD' } });
    expect(v2.payload.version).toBe(2);
    expect(v2.payload.changes).toEqual(['Nursing at Maplecrest University: affordability supported → conditional.', 'Copperfield State University: affordability gap identified → conditional.', 'The plan no longer has an option you would attend that is affordable on confirmed resources.']);
    expect(h.gap(v2, 'no_confirmed_affordable_alternative')).toHaveLength(1);
    expect(v2.payload.notices.find((n) => n.code === 'prior_approval_historical')).toBeDefined();
    expect(v2.handoffs.find((x) => x.toRole === '12')).toBeDefined();
    expect(text(v2.payload)).not.toMatch(/\bbalanced\b/i);
  });

  it('the contract rejects a proposed plan with a conflict, a combined chance, or a binding round called a free option', () => {
    const base: PortfolioPayload = { action: 'plan', version: 1, status: 'proposed', options: [], rounds: { conflicts: [{ restricting: 'a', restricted: 'b', target: 'binding_round', rule: 'r', sourceRef: null, pendingException: null }], exceptionsApplied: [], unverifiedRules: [], choiceLimit: [] }, coverage: null, tasks: [], workload: null, fees: null, alternatives: [], changes: [], applicationStates: [], nextDecision: null, questions: [], notices: [], actionsTaken: [] };
    expect(PORTFOLIO_CONTRACT.semantic!(base, {} as never)).toContain('a plan with a round conflict must be blocked, not proposed');
    const chance = { ...base, rounds: null, notices: [{ code: 'x', message: 'Your chance of at least one offer is 90%.' }] };
    expect(PORTFOLIO_CONTRACT.semantic!(chance, {} as never)).toContain('no combined chance may be stated');
    const free = { ...base, rounds: null, notices: [{ code: 'x', message: 'Early decision is a free option; you can back out.' }] };
    expect(PORTFOLIO_CONTRACT.semantic!(free, {} as never)).toContain('a binding round is never described as a free option');
    const acted = PORTFOLIO_CONTRACT.payload.safeParse({ ...base, rounds: null, actionsTaken: ['submitted'] });
    expect(acted.success).toBe(false);
  });
});
