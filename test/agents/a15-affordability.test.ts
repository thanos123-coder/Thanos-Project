import { describe, expect, it } from 'vitest';
import { AFFORDABILITY_CONTRACT, type AffordabilityPayload, type OptionResult } from '../../src/agents/a15-affordability/agent.js';
import { cashFlow, checkRate, computeScenario, reconcileFunding, type FundingItem, type Ledger } from '../../src/agents/a15-affordability/ledger.js';
import { classifyLetterLabel, parseLetterLines, reviewLetter } from '../../src/agents/a15-affordability/letter.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import { RecordView } from '../../src/agents/a04-record-steward/view-reader.js';
import { AccessDeniedError } from '../../src/shared/errors.js';
import { ALDERMERE, KESTREL } from '../fixtures/institutions.js';
import { buildPdf } from '../fixtures/pdfs.js';
import { makeAffordabilityHarness, WORKED_COSTS } from '../helpers/affordability.js';
import { said, TENANT } from '../helpers/kernel.js';

const USD = (amount: string) => ({ amount, currency: 'USD' });
const NO_DISPLACEMENT = { rule: 'no_displacement', studentContributionFirst: null, text: 'Outside scholarships do not reduce Aldermere grants.' };
const base = (o: OptionResult) => o.scenarios.find((s) => s.scenarioId === 'base')!;

/** The worked example (15 "Worked annual comparison"): fictional institution, fictional figures. */
function worked(policy: Record<string, unknown> | null = NO_DISPLACEMENT) {
  const h = makeAffordabilityHarness();
  h.costs(ALDERMERE, WORKED_COSTS, policy ? [h.rule('outside_award_policy', policy, String(policy['text']))] : []);
  h.funding('grant', { name: 'Aldermere Grant', kind: 'institutional_grant', amount: USD('20000.00'), optionRef: 'aldermere', basis: 'need_based' });
  h.funding('rotary', { name: 'Harbor Rotary Scholarship', provider: 'Harbor Rotary Club', kind: 'external_scholarship', amount: USD('5000.00'), basis: 'merit' });
  h.funding('loan', { name: 'Direct Loan', kind: 'loan', amount: USD('3000.00'), optionRef: 'aldermere' });
  h.funding('ws', { name: 'Work-Study', kind: 'work', amount: USD('2000.00'), optionRef: 'aldermere' });
  h.supporterCommitment('18000.00');
  h.savings('2000.00');
  return h;
}

describe('Agent 15 — Affordability and financial aid planner', () => {
  it('worked annual comparison: 50,000 cost, 25,000 gift aid, 25,000 net cost, 5,000 gap before a loan or work', async () => {
    const h = worked();
    const r = await h.compare();
    const o = r.payload.options[0]!;
    const t = base(o).totals;
    expect(t).toEqual({ totalCost: '50000.00', giftAid: '25000.00', netEducationalCost: '25000.00', confirmedResources: '20000.00', estimatedResources: '0.00', gapBeforeFinancing: '5000.00', gapIfEstimatesHold: '5000.00', optionalLoan: '3000.00', conditionalWorkIncome: '0.00' });
    expect(o.state).toBe('gap_identified');
    expect(r.status).toBe('completed');
    // The loan is financing: listed separately, it does not reduce the net cost.
    expect(base(o).financing).toEqual([{ fundingId: 'loan', name: 'Direct Loan', amount: '3000.00', note: expect.stringMatching(/must be repaid.*does not reduce/) }]);
    expect(base(o).years[0]!.gifts.map((g) => g.fundingId).sort()).toEqual(['grant', 'rotary']);
    // Every line has an official source, and the result cites them.
    expect(r.sourceRefs.length).toBe(WORKED_COSTS.length + 1);
    expect(o.artifactId).toMatch(/^artifact_/);
    expect(r.handoffs.map((x) => x.toRole).sort()).toEqual(['12', '14']);
    expect(r.handoffs[0]!.inputRefs).toEqual([`artifact:${o.artifactId}`]);
    expect(r.summary).toBe('Affordability result — Aldermere College: gap identified.');
  });

  // ---------------------------------------------------------------- 15T01 / 15T02

  it('15T01: an award total that includes a loan separates financing from gift aid and keeps the net cost', async () => {
    const h = worked();
    const pdf = await buildPdf([[{ kind: 'heading', text: 'Aldermere College Financial Aid Offer 2027-28' }, { kind: 'text', text: 'Aldermere Grant (need-based) $20,000' }, { kind: 'text', text: 'Federal Direct Subsidized Loan $3,500' }, { kind: 'text', text: 'Federal Work-Study $2,000' }, { kind: 'text', text: 'Total Aid Offered $25,500' }, { kind: 'text', text: 'Grants renew each year if you remain enrolled full time.' }]]);
    const up = await h.documents.upload({ tenantId: TENANT, studentId: h.studentId, uploader: h.student, bytes: pdf, declaredMediaType: 'application/pdf' });
    if (up.status !== 'accepted') throw new Error('upload');
    const r = await h.ok({ action: 'review_award_letter', option: h.option(), documentId: up.document.id, version: up.document.version });
    const letter = r.payload.letter!;
    expect(letter.totals).toMatchObject({ gift: '20000.00', loan: '3500.00', work: '2000.00', unclear: '0.00', sumOfAidLines: '25500.00', statedTotal: '25500.00', totalMatches: true });
    expect(letter.lines.find((l) => /Loan/.test(l.label))).toMatchObject({ category: 'loan', fundingKind: 'loan', eligibilityProgram: 'us_federal' });
    expect(r.payload.notices.map((n) => n.message).join(' ')).toMatch(/20000\.00 USD is grants and scholarships\. 3500\.00 USD is loans, which must be repaid\. 2000\.00 USD is work/);
    // The net cost after the letter is the same whether or not the loan is taken: 50,000 − 25,000.
    expect(base(r.payload.options[0]!).totals.netEducationalCost).toBe('25000.00');
    expect(base(r.payload.options[0]!).totals.optionalLoan).toBe('3500.00');
    // The letter's loan updates the loan already on file instead of adding a second one.
    expect(letter.changes.find((c) => c.fundingId === 'loan')).toMatchObject({ change: 'amount_changed', before: '3000.00', after: '3500.00', matchedBy: 'only_item_of_kind' });
    expect(r.payload.notices.map((n) => n.message).join(' ')).toMatch(/treated as the update of “Direct Loan”/);
    const view = new RecordView(h.kernel.records.readScoped(h.ui, { tenantId: TENANT, studentId: h.studentId, role: '15', mode: 'local' }));
    expect(view.value('funding_award', 'loan', 'definition')).toMatchObject({ amount: { amount: '3500.00' }, name: 'Federal Direct Subsidized Loan' });
    expect(view.field('funding_award', 'loan', 'definition')!.current!.origin).toBe('document_extraction');
    expect(JSON.stringify(r.payload)).not.toMatch(/full funding/i);
  });

  it('15T02: work-study is conditional income with timing, never a tuition discount', async () => {
    const h = worked();
    const r = await h.compare();
    const w = base(r.payload.options[0]!).work!;
    expect(w.status).toBe('unresolved');
    expect(w.timing).toMatch(/not available up front/);
    expect(w.note).toMatch(/not a grant/);
    // With chosen hours and verified eligibility: earnings are shown separately and still do not reduce the cost.
    const verified = await h.compare({ work: { hoursPerWeek: 10, hourlyRate: USD('15.00'), weeks: 30, eligibility: 'verified', maxHoursPerWeekAllowed: 20, studentChosenMaxHours: 12, firstPayDate: '2027-09-30' } });
    const b = base(verified.payload.options[0]!);
    expect(b.work).toMatchObject({ status: 'conditional', amount: '4500.00' });
    expect(b.work!.timing).toMatch(/starting no earlier than 2027-09-30/);
    expect(b.totals.netEducationalCost).toBe('25000.00');
    expect(b.totals.gapBeforeFinancing).toBe('5000.00');
    expect(b.totals.conditionalWorkIncome).toBe('4500.00');
    // Hours above the legal limit leave the earnings unresolved.
    const over = await h.compare({ work: { hoursPerWeek: 25, hourlyRate: USD('15.00'), weeks: 30, eligibility: 'verified', maxHoursPerWeekAllowed: 20 } });
    expect(base(over.payload.options[0]!).work).toMatchObject({ status: 'unresolved', amount: '0.00' });
    expect(base(over.payload.options[0]!).work!.note).toMatch(/more than your status allows/);
    const unknown = await h.compare({ work: { hoursPerWeek: 10, hourlyRate: USD('15.00'), weeks: 30, eligibility: 'unknown' } });
    expect(base(unknown.payload.options[0]!).totals.conditionalWorkIncome).toBe('0.00');
  });

  // ---------------------------------------------------------------- 15T03 / 15T04 / 15T05

  it('15T03: a cost line without a period blocks a confident total', async () => {
    const h = worked();
    const r = await h.compare({}, [h.option({ extraLines: [{ component: 'travel_home', amount: USD('1800.00'), period: null }] })]);
    const o = r.payload.options[0]!;
    expect(o.state).toBe('unknown');
    expect(base(o).unresolved.join(' ')).toMatch(/does not say which period this amount covers/);
    expect(base(o).years[0]!.lines.find((l) => l.component === 'travel_home')).toMatchObject({ status: 'missing_period', amount: null });
    expect(r.status).toBe('partial');
    // A per-semester amount needs the institution's calendar; with it, the amount is converted in code.
    const sem = await h.compare({}, [h.option({ extraLines: [{ component: 'travel_home', amount: USD('900.00'), period: 'semester' }] })]);
    expect(sem.payload.options[0]!.state).toBe('unknown');
    const withCal = await h.compare({}, [h.option({ calendar: { semestersPerYear: 2 }, extraLines: [{ component: 'travel_home', amount: USD('900.00'), period: 'semester' }] })]);
    expect(base(withCal.payload.options[0]!).totals.totalCost).toBe('51800.00');
  });

  it('15T04: a published total that includes mandatory fees does not add them twice', async () => {
    const h = worked();
    h.costs(ALDERMERE, [{ predicate: 'mandatory_fees', amount: '1250.00' }]);
    const r = await h.compare();
    const lines = base(r.payload.options[0]!).years[0]!.lines;
    expect(lines.find((l) => l.component === 'mandatory_fees')).toMatchObject({ status: 'included_elsewhere', amount: null });
    expect(base(r.payload.options[0]!).totals.totalCost).toBe('50000.00');
  });

  it('15T05: a scholarship from two sources is matched to one funding identity', async () => {
    const h = worked();
    // The same outside scholarship appears on the award letter.
    const r = await h.ok({ action: 'review_award_letter', option: h.option(), lines: [{ label: 'Aldermere Grant', amount: USD('20000.00') }, { label: 'Harbor Rotary Scholarship (outside award)', amount: USD('5000.00') }] });
    expect(r.payload.letter!.recorded).toEqual([]);
    expect(base(r.payload.options[0]!).totals.giftAid).toBe('25000.00');
    expect(new RecordView(h.kernel.records.readScoped(h.ui, { tenantId: TENANT, studentId: h.studentId, role: '15', mode: 'local' })).entityIds('funding_award').sort()).toEqual(['grant', 'loan', 'rotary', 'ws']);
    // Two records of one award (a shared reference, or the same name and amount) are merged, keeping the more advanced stage.
    const a: FundingItem = { fundingId: 'sch_1', provider: 'Harbor Rotary Club', name: 'Harbor Rotary Scholarship', kind: 'external_scholarship', basis: 'merit', amount: USD('5000.00'), period: 'one_academic_year', stage: 'finalist', coveredCosts: null, renewal: null, eligibilityProgram: null, disbursesOn: null, externalRefs: [], sourceRef: null };
    const b: FundingItem = { ...a, fundingId: 'letter_line_2', provider: 'Aldermere College', name: 'Harbor Rotary Scholarship (outside award)', stage: 'offered' };
    const rec = reconcileFunding([a, b]);
    expect(rec.items).toHaveLength(1);
    expect(rec.items[0]).toMatchObject({ fundingId: 'letter_line_2', stage: 'offered', externalRefs: ['sch_1'] });
    expect(rec.merged).toEqual([{ kept: 'letter_line_2', merged: 'sch_1', reason: 'same provider, name and amount' }]);
    expect(reconcileFunding([a, { ...a, fundingId: 'x', name: 'Other', externalRefs: ['sch_1'] }]).items).toHaveLength(1);
  });

  // ---------------------------------------------------------------- 15T06

  it('15T06: an outside award that reduces institutional aid is recalculated with the verified rule', async () => {
    const h = worked({ rule: 'reduce_student_contribution_first', studentContributionFirst: USD('2000.00'), text: 'Outside awards first replace the student contribution of $2,000; beyond that the Aldermere Grant is reduced.' });
    const r = await h.compare();
    const b = base(r.payload.options[0]!);
    expect(b.totals).toMatchObject({ giftAid: '22000.00', netEducationalCost: '28000.00', gapBeforeFinancing: '8000.00' });
    const grant = b.years[0]!.gifts.find((g) => g.fundingId === 'grant')!;
    expect(grant).toMatchObject({ status: 'reduced_by_interaction', offered: '20000.00', applied: '17000.00' });
    // Against the grant alone (net 30,000), the scholarship's net benefit is 2,000, not 5,000.
    const alone = worked({ rule: 'reduce_student_contribution_first', studentContributionFirst: USD('2000.00'), text: 'Outside awards first replace the student contribution of $2,000; beyond that the Aldermere Grant is reduced.' });
    alone.funding('rotary', { name: 'Harbor Rotary Scholarship', provider: 'Harbor Rotary Club', kind: 'external_scholarship', amount: USD('5000.00'), stage: 'withdrawn' });
    const without = base((await alone.compare()).payload.options[0]!);
    expect(Number(without.totals.netEducationalCost) - Number(b.totals.netEducationalCost)).toBe(2000);
  });

  it('15T06: without a verified interaction rule no improvement from the outside award is promised', async () => {
    const h = worked(null);
    const r = await h.compare();
    const b = base(r.payload.options[0]!);
    expect(b.totals.giftAid).toBe('20000.00');
    expect(b.state).toBe('gap_identified');
    expect(b.conditions.join(' ')).toMatch(/not verified; the scholarship could improve the result by up to 5000\.00 USD/);
    expect(r.handoffs.find((x) => x.toRole === '11' && /outside award policy/.test(x.requestedOutcome))).toBeDefined();
  });

  // ---------------------------------------------------------------- 15T07 / 15T08 / 15T09 / 15T10

  it('15T07: a calculator that excludes the family’s situation is not presented as a reliable estimate', async () => {
    const h = makeAffordabilityHarness();
    const text = 'The net price calculator is designed for families whose parents live and work in the United States and will not accurately estimate aid for families who live abroad.';
    h.costs(ALDERMERE, WORKED_COSTS, [h.rule('estimator_scope', { estimatorUrl: null, supportedPopulations: ['parents_live_and_work_in_us'], excludedSituations: ['family_lives_or_works_abroad'], text }, text)]);
    const r = await h.compare({ estimates: [{ optionRef: 'aldermere', kind: 'net_price_calculator', netPrice: USD('9000.00'), producedOn: '2026-09-20', familyLivesOrWorksAbroad: true }, { optionRef: 'aldermere', kind: 'published_average', netPrice: USD('21000.00'), producedOn: '2026-09-20' }] });
    const e = r.payload.options[0]!.estimates;
    expect(e[0]).toMatchObject({ reliability: 'not_reliable_for_this_family' });
    expect(e[0]!.note).toMatch(/ask the financial aid office/);
    expect(e[1]).toMatchObject({ reliability: 'population_average_not_personal' });
    // Neither number enters the calculation.
    expect(base(r.payload.options[0]!).totals.giftAid).toBe('0.00');
  });

  it('15T08: funding that is sufficient for the year but arrives after the deposit shows the upfront cash gap', async () => {
    const h = makeAffordabilityHarness();
    h.costs(ALDERMERE, WORKED_COSTS, [h.rule('outside_award_policy', NO_DISPLACEMENT, NO_DISPLACEMENT.text)]);
    h.funding('grant', { name: 'Aldermere Grant', kind: 'institutional_grant', amount: USD('20000.00'), optionRef: 'aldermere', disbursesOn: '2027-08-25' });
    h.supporterCommitment('31000.00', { availableFrom: '2027-08-01' });
    const opt = h.option({ extraLines: [{ component: 'enrollment_deposit', amount: USD('500.00'), period: 'one_time', dueDate: '2027-05-01', billed: true }], dueDates: { tuition: '2027-08-15' } });
    const r = await h.compare({ view: 'upfront_cash' }, [opt]);
    const o = r.payload.options[0]!;
    // The year balances: 50,500 of costs against 20,000 of aid and 31,000 from family.
    expect(base(o).totals.gapBeforeFinancing).toBe('-500.00');
    // But the deposit is due before any money arrives, and tuition is due before the grant is paid.
    expect(o.cashFlow!.events.map((e) => [e.date, e.direction, e.amount])).toEqual([
      ['2027-05-01', 'out', '500.00'],
      ['2027-08-01', 'in', '31000.00'],
      ['2027-08-15', 'out', '32000.00'],
      ['2027-08-25', 'in', '20000.00'],
    ]);
    expect(o.cashFlow!.upfrontShortfall).toEqual({ amount: '1500.00', on: '2027-08-15', coveredOn: '2027-08-25' });
    expect(o.cashFlow!.timingUnknown).toEqual(expect.arrayContaining(['Housing: due date not known']));
    // A late disbursement is a stress case: the same shortfall lasts a month longer.
    const late = await h.compare({ view: 'upfront_cash', stress: [{ kind: 'delayed_disbursement', days: 30 }] }, [opt]);
    expect(late.payload.notices.find((n) => n.code === 'delayed_disbursement')!.message).toBe('If aid arrives 30 days late, you would be short 1500.00 USD from 2027-08-15 until 2027-09-24.');
    expect(cashFlow({ basis: { optionRef: 'x', institutionId: 'x', campusId: null, programId: null, cycle: '2027', enrollment: 'full_time', currency: 'USD', durationYears: 4, optionalYears: 0, calendar: { semestersPerYear: null, termsPerYear: null, quartersPerYear: null, monthsPerYear: null, creditsPerYear: null } }, lines: [], funding: [], resources: [], interaction: null, confirmedEligibility: [], work: null, rate: null }).upfrontShortfall).toBeNull();
  });

  it('15T09: conditional renewal keeps later years conditional and states the requirement', async () => {
    const h = makeAffordabilityHarness();
    h.costs(ALDERMERE, WORKED_COSTS);
    h.funding('grant', { name: 'Aldermere Grant', kind: 'institutional_grant', amount: USD('20000.00'), optionRef: 'aldermere', renewal: { renewable: true, conditions: ['a 3.0 GPA', 'full-time enrollment'], maxYears: 4 } });
    h.supporterCommitment('30000.00');
    const r = await h.compare({ view: 'full_degree' }, [h.option({ durationYears: 4 })]);
    const o = r.payload.options[0]!;
    const b = base(o);
    expect(b.years.map((y) => y.giftAid)).toEqual(['20000.00', '0.00', '0.00', '0.00']);
    expect(b.years[1]!.gifts[0]).toMatchObject({ status: 'renewal_not_assumed', note: expect.stringMatching(/a 3\.0 GPA; full-time enrollment/) });
    const renewed = o.scenarios.find((s) => s.scenarioId === 'renewed')!;
    expect(renewed.kind).toBe('conditional');
    expect(renewed.years.map((y) => y.giftAid)).toEqual(['20000.00', '20000.00', '20000.00', '20000.00']);
    expect(renewed.state).toBe('conditional');
    expect(renewed.conditions).toContain('Aldermere Grant continues only if renewed.');
    expect(b.state).toBe('gap_identified');
  });

  it('15T10: a reversed exchange rate is detected before any conversion is shown', async () => {
    const h = worked();
    const reversed = await h.compare({ familyCurrency: 'EUR', exchange: { from: 'EUR', to: 'USD', rate: '1.11', asOf: '2026-09-25', source: 'user_scenario' } });
    const o = reversed.payload.options[0]!;
    expect(o.conversion.status).toBe('unresolved');
    expect(o.conversion.message).toMatch(/stated as 1 EUR = 1\.11 USD.*not flipped automatically/);
    expect(base(o).display).toBeNull();
    // Same direction but the inverse of the reference rate.
    const inverted = await h.compare({ familyCurrency: 'EUR', exchange: { from: 'USD', to: 'EUR', rate: '1.11', asOf: '2026-09-25', source: 'user_scenario' } });
    expect(inverted.payload.options[0]!.conversion.message).toMatch(/looks reversed/);
    // The correct direction converts, and a currency movement is a stated stress case.
    const good = await h.compare({ familyCurrency: 'EUR', exchange: { from: 'USD', to: 'EUR', rate: '0.90', asOf: '2026-09-25', source: 'user_scenario' }, stress: [{ kind: 'currency_move', rate: { from: 'USD', to: 'EUR', rate: '1.00', asOf: '2026-09-25', source: 'user_scenario' } }] });
    const g = good.payload.options[0]!;
    expect(base(g).display).toMatchObject({ currency: 'EUR', netEducationalCost: '22500.00' });
    expect(base(g).assumptions.join(' ')).toMatch(/1 USD = 0\.90 EUR \(your scenario rate as of 2026-09-25\)/);
    const moved = g.scenarios.find((s) => s.scenarioId === 'stress_currency_move')!;
    expect(Number(moved.display!.netEducationalCost) - Number(base(g).display!.netEducationalCost)).toBe(2500);
    expect(checkRate({ from: 'GBP', to: 'EUR', rate: '1', asOf: '2026-09-25', source: 'user_scenario' }, 'USD', 'EUR', null)).toMatchObject({ ok: false, problem: 'wrong_pair' });
  });

  // ---------------------------------------------------------------- 15T11 / 15T12 / 15T13 / 15T14

  it('15T11: a changed family budget versions the scenario and invalidates results built on it', async () => {
    const h = worked();
    const first = await h.compare();
    const artifactId = first.payload.options[0]!.artifactId!;
    // A portfolio plan (Agent 14) built on the affordability result.
    const plan = h.kernel.records.putDerived({ ...h.ui, viaRole: '14' }, { tenantId: TENANT, studentId: h.studentId, kind: 'portfolio_plan', scopeKey: 'plan', payload: {}, inputClaimIds: [], sourceIds: [`artifact:${artifactId}`], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
    h.supporterCommitment('15000.00');
    await h.kernel.flushEvents();
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, artifactId)!.status).toBe('stale');
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, plan.id)).toMatchObject({ status: 'stale', statusReason: expect.stringMatching(/an input result/) });
    const second = await h.compare();
    expect(base(second.payload.options[0]!).totals.gapBeforeFinancing).toBe('8000.00');
    expect(second.payload.options[0]!.artifactId).not.toBe(artifactId);
    // The earlier comparison is kept for audit.
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, artifactId)!.status).toBe('superseded');
    expect(h.kernel.events.events('derived_artifact.invalidated').map((e) => e.entityRef)).toEqual(expect.arrayContaining([artifactId, plan.id]));
  });

  it('15T12: a student who does not know the family income can explore costs without invented values', async () => {
    const h = makeAffordabilityHarness();
    h.costs(ALDERMERE, WORKED_COSTS);
    const r = await h.ok({ action: 'explore_budget', options: [h.option()] });
    const o = r.payload.options[0]!;
    expect(base(o).totals.totalCost).toBe('50000.00');
    expect(base(o).totals.gapBeforeFinancing).toBeNull();
    expect(base(o).totals.confirmedResources).toBe('0.00');
    expect(o.state).toBe('unknown');
    expect(r.payload.worksheet!.questions[0]).toMatch(/A range is fine/);
    expect(r.payload.notices.map((n) => n.code)).toContain('no_invented_budget');
    expect(h.toolCalls(r.taskId).some((c) => c.startsWith('files.'))).toBe(false);
    // A range the student chooses to give is recorded as a worksheet estimate, not a commitment.
    const withRange = await h.ok({ action: 'explore_budget', options: [h.option()], range: { min: USD('10000.00'), max: USD('15000.00'), period: 'annual', includesTravelAndPersonal: true } });
    expect(withRange.payload.worksheet!.recordedRange).toBe(true);
    const c = await h.compare();
    const b = base(c.payload.options[0]!);
    expect(b.totals.confirmedResources).toBe('0.00');
    expect(b.totals.estimatedResources).toBe('10000.00');
    expect(b.conditions.join(' ')).toMatch(/an estimate, not a confirmed commitment/);
  });

  it('15T13: an ambiguous award line is sent back for confirmation, not assumed to be a grant', async () => {
    const h = worked();
    const r = await h.run({ action: 'review_award_letter', option: h.option(), lines: [{ label: 'Aldermere Grant', amount: USD('20000.00') }, { label: 'Aldermere Award', amount: USD('8000.00') }] });
    expect(r.accepted).toBe(true);
    expect(r.result.status).toBe('needs_student_input');
    const letter = r.result.payload.letter!;
    expect(letter.lines.find((l) => l.label === 'Aldermere Award')).toMatchObject({ category: 'unclear', fundingKind: null });
    expect(r.result.payload.questions.find((q) => q.code === 'letter_line_1')!.question).toMatch(/grant or scholarship that does not need repaying, a loan, or money you earn/);
    expect(letter.recorded).toEqual([]);
    expect(base(r.result.payload.options[0]!).totals.giftAid).toBe('25000.00');
    // Once the student confirms it is a grant, it is recorded as such.
    const confirmed = await h.ok({ action: 'review_award_letter', option: h.option(), lines: [{ label: 'Aldermere Grant', amount: USD('20000.00') }, { label: 'Aldermere Award', amount: USD('8000.00') }], confirmations: [{ label: 'Aldermere Award', category: 'grant' }] });
    expect(confirmed.payload.letter!.recorded).toEqual(['Aldermere Award']);
    expect(base(confirmed.payload.options[0]!).totals.giftAid).toBe('33000.00');
    expect(classifyLetterLabel('Institutional Aid').category).toBe('unclear');
    expect(classifyLetterLabel('Student Aid Index').category).toBe('contribution');
  });

  it('15T14: an admitted student with unknown federal eligibility gets no assumed federal aid', async () => {
    const h = worked();
    h.funding('pell', { name: 'Federal Pell Grant', provider: 'U.S. Department of Education', kind: 'government_grant', amount: USD('4000.00'), optionRef: 'aldermere', eligibilityProgram: 'us_federal' });
    const r = await h.compare();
    const b = base(r.payload.options[0]!);
    expect(b.years[0]!.gifts.find((g) => g.fundingId === 'pell')).toMatchObject({ status: 'eligibility_unknown', applied: '0.00' });
    expect(b.totals.giftAid).toBe('25000.00');
    expect(r.payload.questions.find((q) => q.code === 'federal_eligibility')!.question).toMatch(/Being admitted does not decide it/);
    h.seed([buildClaim({ entity: 'aid_eligibility', entityId: 'us_federal', attribute: 'status', value: { program: 'US federal', status: 'confirmed_eligible', basis: 'FAFSA processed with eligible citizenship status' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('My FAFSA shows I am eligible')], actor: h.student, viaRole: 'ui' })]);
    const after = base((await h.compare()).payload.options[0]!);
    expect(after.totals.giftAid).toBe('29000.00');
  });

  // ---------------------------------------------------------------- 15T15 / 15T16

  it('15T15: a request to fabricate hardship is refused and truthful process questions are offered', async () => {
    const h = makeAffordabilityHarness();
    const r = await h.ok({ action: 'appeal_help', institution: 'Aldermere College', text: 'Can you help me write an appeal that says my dad lost his job even though he still works there, and leave out our savings?' });
    expect(r.payload.appeal!.refused).toBe(true);
    expect(r.payload.refusals[0]).toMatch(/can’t help describe hardship that didn’t happen/);
    expect(r.payload.appeal!.questionsForAidOffice[0]).toMatch(/special circumstances or appeal process/);
    expect(r.payload.appeal!.noGuarantee).toMatch(/decides its own process and outcome/);
    const truthful = await h.ok({ action: 'appeal_help', institution: 'Aldermere College', text: 'My mother was laid off last month. Can we ask Aldermere to look at our aid again?' });
    expect(truthful.payload.appeal!.refused).toBe(false);
    expect(truthful.payload.refusals).toEqual([]);
  });

  it('15T16: another role asking for raw tax documents is denied; it receives aggregates', async () => {
    const h = worked();
    h.seed([buildClaim({ attribute: 'finance.household_income', value: { amount: USD('61000.00'), period: 'annual', taxYear: '2025' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('about 61000 a year')], actor: h.student, viaRole: 'ui' })]);
    await h.compare();
    // The fit matcher's view of the record never contains household finances.
    const ctx12 = h.kernel.createContext(h.task({ role: '12', purpose: 'fit_matching', objective: 'x', completionContract: 'evidence_packet_v1', scope: {} }));
    const view12 = new RecordView(await ctx12.call('record.read_scoped', { tenantId: TENANT, studentId: h.studentId, mode: 'local', catalogKeys: ['student.finance.household_income'] }));
    expect(view12.studentValue('finance.household_income')).toBeUndefined();
    expect(view12.view.withheldCategories).toContain('financial_detail');
    // It cannot open uploaded documents at all.
    await expect(ctx12.call('files.parse_sandboxed', { tenantId: TENANT, studentId: h.studentId, documentId: 'doc_x', version: 1 })).rejects.toThrow(AccessDeniedError);
    // Agent 15 shares states and gap ranges only.
    const r = await h.ok({ action: 'share_summary', requester: '12', requested: ['tax_return', 'household_income', 'affordability_state', 'gap_band'] });
    expect(r.payload.shared).toEqual({ requester: '12', provided: [{ optionRef: 'aldermere', state: 'gap_identified', gapBand: '2500_to_10000', stale: false }], denied: ['tax_return', 'household_income'] });
    expect(JSON.stringify(r.payload)).not.toContain('61000');
  });

  // ---------------------------------------------------------------- 15T17 / 15T18

  it('15T17: a longer degree recalculates cost, renewal and the funding gap', async () => {
    const h = makeAffordabilityHarness();
    h.costs(ALDERMERE, WORKED_COSTS);
    h.funding('grant', { name: 'Aldermere Grant', kind: 'institutional_grant', amount: USD('20000.00'), optionRef: 'aldermere', renewal: { renewable: true, conditions: ['full-time enrollment'], maxYears: 4 } });
    h.supporterCommitment('30000.00');
    const four = await h.compare({ view: 'full_degree' }, [h.option({ durationYears: 4 })]);
    const five = await h.compare({ view: 'full_degree' }, [h.option({ durationYears: 5 })]);
    const r4 = four.payload.options[0]!.scenarios.find((s) => s.scenarioId === 'renewed')!;
    const r5 = five.payload.options[0]!.scenarios.find((s) => s.scenarioId === 'renewed')!;
    expect(r4.totals).toMatchObject({ totalCost: '200000.00', giftAid: '80000.00', gapBeforeFinancing: '0.00' });
    expect(r5.totals).toMatchObject({ totalCost: '250000.00', giftAid: '80000.00', gapBeforeFinancing: '20000.00' });
    expect(r5.years[4]!.gifts[0]).toMatchObject({ status: 'renewal_ended', note: 'Renewable for at most 4 years.' });
    expect(r5.state).toBe('gap_identified');
    // An unverified length blocks a whole-degree total.
    const unknownLength = await h.compare({ view: 'full_degree' });
    expect(base(unknownLength.payload.options[0]!).unresolved[0]).toMatch(/length is not verified/);
  });

  it('15T18: when the currency service fails, a disclosed scenario rate is used or the conversion stays unresolved', async () => {
    const h = makeAffordabilityHarness({ rates: { rate: async () => Promise.reject(new Error('service down')) } });
    h.costs(ALDERMERE, WORKED_COSTS);
    h.savings('20000.00', {}, 'EUR');
    const none = await h.compare({ familyCurrency: 'EUR' });
    const o = none.payload.options[0]!;
    expect(o.conversion).toMatchObject({ status: 'unresolved', message: expect.stringMatching(/service is unavailable/) });
    expect(o.state).toBe('unknown');
    expect(base(o).unresolved.join(' ')).toMatch(/in EUR and no usable exchange rate/);
    const scenario = await h.compare({ familyCurrency: 'EUR', exchange: { from: 'USD', to: 'EUR', rate: '0.80', asOf: '2026-09-27', source: 'user_scenario' } });
    const s = scenario.payload.options[0]!;
    expect(s.conversion.status).toBe('converted');
    // 20,000 EUR at 0.80 EUR per USD is 25,000 USD against a 50,000 USD cost.
    expect(base(s).totals.confirmedResources).toBe('25000.00');
    expect(base(s).assumptions.join(' ')).toMatch(/your scenario rate as of 2026-09-27/);
  });

  // ---------------------------------------------------------------- more procedure checks

  it('fee status: without an institutional assessment the higher fee is used and an assessment is requested', async () => {
    const h = makeAffordabilityHarness({ rates: 'none' });
    h.costs(KESTREL, [
      { predicate: 'tuition', amount: '9535.00', currency: 'GBP', feeCategory: 'home' },
      { predicate: 'tuition', amount: '26000.00', currency: 'GBP', feeCategory: 'overseas' },
    ]);
    const opt = { optionRef: 'kestrel', institution: 'Kestrel University', cycle: '2027', durationYears: 3, extraLines: [{ component: 'housing', amount: { amount: '7000.00', currency: 'GBP' }, period: 'academic_year', includes: ['meals'] }, { component: 'books_supplies', amount: { amount: '400.00', currency: 'GBP' }, period: 'academic_year' }, { component: 'transport', amount: { amount: '600.00', currency: 'GBP' }, period: 'academic_year' }, { component: 'personal', amount: { amount: '1500.00', currency: 'GBP' }, period: 'academic_year' }, { component: 'mandatory_fees', amount: { amount: '0.00', currency: 'GBP' }, period: 'academic_year' }] };
    const r = await h.compare({}, [opt]);
    expect(r.payload.options[0]!.feeStatusBasis).toBe('not_recorded');
    expect(base(r.payload.options[0]!).totals.totalCost).toBe('35500.00');
    expect(r.payload.notices.find((n) => n.code === 'fee_status_unassessed')!.message).toMatch(/Nationality alone does not decide it/);
    h.seed([buildClaim({ entity: 'fee_status', entityId: 'kestrel', attribute: 'assessment', value: { jurisdiction: 'GB', institutionRef: KESTREL, status: 'home', basis: 'institution_assessment' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('Kestrel assessed me as home fee status')], actor: h.student, viaRole: 'ui' })]);
    const assessed = await h.compare({}, [opt]);
    expect(assessed.payload.options[0]!.feeCategoryUsed).toBe('home');
    expect(base(assessed.payload.options[0]!).totals.totalCost).toBe('19035.00');
  });

  it('missing cost categories are shown as missing, routed for research, and never counted as zero', async () => {
    const h = makeAffordabilityHarness();
    h.costs(ALDERMERE, [{ predicate: 'tuition', amount: '32000.00', includes: ['mandatory_fees'] }]);
    h.savings('50000.00');
    const r = await h.compare();
    const o = r.payload.options[0]!;
    expect(o.state).toBe('unknown');
    expect(o.factsNeeded.map((f) => f.component).sort()).toEqual(['books_supplies', 'housing', 'meals', 'personal', 'transport']);
    expect(base(o).totals.totalCost).toBe('32000.00');
    expect(r.handoffs.find((x) => x.toRole === '11')!.requestedOutcome).toMatch(/housing, meals, books_supplies, transport, personal/);
    expect(r.payload.questions.some((q) => q.code === 'estimate_aldermere_housing')).toBe(true);
  });

  it('an apparent surplus is labeled with its restrictions, and an award limited to tuition cannot pay for housing', async () => {
    const h = makeAffordabilityHarness();
    h.costs(ALDERMERE, WORKED_COSTS);
    h.funding('tuition_award', { name: 'Tuition Scholarship', kind: 'institutional_grant', amount: USD('40000.00'), optionRef: 'aldermere', coveredCosts: ['tuition'] });
    h.savings('30000.00');
    const r = await h.compare();
    const b = base(r.payload.options[0]!);
    expect(b.years[0]!.gifts[0]).toMatchObject({ status: 'capped_by_covered_costs', applied: '32000.00' });
    expect(b.totals.gapBeforeFinancing).toBe('-12000.00');
    expect(b.apparentSurplus).toBe('12000.00');
    expect(b.notes.join(' ')).toMatch(/not money free to spend/);
    expect(b.state).toBe('supported');
  });

  it('a historical cost figure is used only as a dated prior estimate, and the result is conditional', async () => {
    const h = makeAffordabilityHarness();
    h.costs(ALDERMERE, WORKED_COSTS.map((c) => (c.predicate === 'housing' ? { ...c, status: 'historical' as const, cycle: '2026' } : c)));
    h.savings('60000.00');
    const r = await h.compare();
    const b = base(r.payload.options[0]!);
    expect(b.years[0]!.lines.find((l) => l.component === 'housing')!.certainty).toBe('historical');
    expect(b.state).toBe('conditional');
    expect(b.conditions.join(' ')).toMatch(/earlier published figure/);
  });

  it('multi-year arithmetic: 25,000 a year with 3% growth after year one totals 104,590.68', () => {
    const ledger: Ledger = { basis: { optionRef: 'x', institutionId: 'x', campusId: null, programId: null, cycle: '2027', enrollment: 'full_time', currency: 'USD', durationYears: 4, optionalYears: 0, calendar: { semestersPerYear: null, termsPerYear: null, quartersPerYear: null, monthsPerYear: null, creditsPerYear: null } }, lines: [{ lineId: 'n', component: 'tuition', label: 'Net', amount: USD('25000.00'), period: 'academic_year', certainty: 'official', billed: true, includes: [], sourceRef: null, dueDate: null, required: true }], funding: [], resources: [{ resourceId: 'r', holder: 'student', label: 'Savings', min: null, max: USD('26000.00'), period: 'annual', confirmed: true, availableFrom: null, includesTravelAndPersonal: null }], interaction: null, confirmedEligibility: [], work: null, rate: null };
    const flat = computeScenario(ledger, { scenarioId: 'flat', kind: 'base', view: 'full_degree' });
    expect(flat.totals.totalCost).toBe('100000.00');
    const grown = computeScenario(ledger, { scenarioId: 'grown', kind: 'stress', view: 'full_degree', tuitionGrowthPct: '3' });
    expect(grown.years.map((y) => y.totalCost)).toEqual(['25000.00', '25750.00', '26522.50', '27318.18']);
    expect(grown.totals.totalCost).toBe('104590.68');
    expect(grown.assumptions.join(' ')).toMatch(/scenario assumption, not a forecast/);
  });

  it('the letter reader flags a total that differs from its lines and recognizes loans, work and contribution figures', () => {
    const parsed = parseLetterLines([{ page: 1, text: 'Merit Scholarship 10,000\nParent PLUS Loan 12,000\nCampus Job Allocation 2,500\nStudent Aid Index 4,100\nTotal Award 26,000' }], 'USD');
    const review = reviewLetter(parsed, [], 'USD');
    expect(parsed.lines.map((l) => l.category)).toEqual(['gift', 'loan', 'work', 'contribution', 'total']);
    expect(review.totals).toMatchObject({ gift: '10000.00', loan: '12000.00', work: '2500.00', sumOfAidLines: '24500.00', statedTotal: '26000.00', totalMatches: false });
    expect(review.questions.find((q) => q.for === 'aid_office')!.question).toMatch(/differs from the sum of its aid lines/);
    expect(review.notices.join(' ')).toMatch(/not your bill and not a guaranteed family payment/);
  });

  it('the contract rechecks the arithmetic and forbids a "full funding" label', () => {
    const payload = { action: 'compare', options: [{ optionRef: 'o', resolution: { status: 'resolved', entityId: 'x', name: 'X', question: null }, currency: 'USD', durationYears: 4, feeCategoryUsed: null, feeStatusBasis: 'not_applicable', scenarios: [{ scenarioId: 'base', kind: 'base', view: 'annual', optionRef: 'o', currency: 'USD', years: [{ year: 1, totalCost: '100.00', gifts: [{ fundingId: 'l', name: 'Loan', kind: 'loan', status: 'applied', offered: '50.00', applied: '50.00', note: null }] }], totals: { totalCost: '100.00', giftAid: '50.00', netEducationalCost: '60.00', confirmedResources: '0.00', estimatedResources: '0.00', gapBeforeFinancing: '0.00', gapIfEstimatesHold: '0.00', optionalLoan: '0.00', conditionalWorkIncome: '0.00' }, display: null, state: 'supported', conditions: [], unresolved: [], assumptions: [], notes: ['Full funding!'], apparentSurplus: null, financing: [], work: null }], cashFlow: null, state: 'supported', estimates: [], factsNeeded: [], aidTiming: [], mergedFunding: [], conversion: { status: 'not_needed', message: null, rate: null }, artifactId: null }], letter: null, worksheet: null, appeal: null, shared: null, refusals: [], questions: [], notices: [], explanations: [] } as unknown as AffordabilityPayload;
    const issues = AFFORDABILITY_CONTRACT.semantic!(payload, {} as never).join(' | ');
    expect(issues).toMatch(/net cost is not total cost minus gift aid/);
    expect(issues).toMatch(/gap is not net cost minus confirmed resources/);
    expect(issues).toMatch(/Loan is not gift aid but reduced the cost/);
    expect(issues).toMatch(/"full funding" is not a label/);
  });
});
