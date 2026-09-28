import { describe, expect, it } from 'vitest';
import { SCHOLARSHIP_CONTRACT, type ScholarshipPayload } from '../../src/agents/a16-scholarships/agent.js';
import { screenListing } from '../../src/agents/a16-scholarships/catalog.js';
import { evaluateRule, type Clause, type EligibilityFacts } from '../../src/agents/a16-scholarships/rules.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import { RecordView } from '../../src/agents/a04-record-steward/view-reader.js';
import { ScriptedModelGateway } from '../../src/model/scripted.js';
import { ALDERMERE_PRESIDENTIAL, HARBOR_ROTARY } from '../fixtures/scholarships.js';
import { said, TENANT } from '../helpers/kernel.js';
import { makeScholarshipHarness } from '../helpers/scholarships.js';

const presidentialPolicy = (decisions: Record<string, string>) => ({
  id: 'pol_aldermere_presidential',
  version: '1',
  destination: { kind: 'scholarship' as const, ref: 'aldermere_presidential', cycle: '2027' },
  decisions,
  source: { sourceId: 'polsrc_presidential', url: 'https://scholarships.aldermere.example.edu/presidential/integrity', quote: 'Generative AI may not be used to create any content for Presidential Scholarship applications.' },
  reviewStatus: 'reviewed' as const,
  reviewedBy: 'policy_reviewer',
  reviewedAt: '2026-09-01T00:00:00Z',
});

function record(h: ReturnType<typeof makeScholarshipHarness>) {
  return new RecordView(h.kernel.records.readScoped(h.ui, { tenantId: TENANT, studentId: h.studentId, role: '16', mode: 'local' }));
}

describe('Agent 16 — Scholarship eligibility and matching advisor', () => {
  it('worked case: a tuition award that needs a nomination is potentially eligible, not funded', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    h.applying('app_ald', 'aldermere_c', null, 1);
    const r = await h.ok({ action: 'check', scholarshipId: 'aldermere_presidential' });
    const o = r.payload.opportunities[0]!;
    expect(o.eligibility.status).toBe('potentially_eligible');
    expect(o.eligibility.unknown.map((u) => u.clauseId)).toEqual(['nomination_available']);
    expect(o.eligibility.satisfied.map((x) => x.clauseId)).toEqual(['ap_apply', 'ap_grad']);
    expect(o.affordabilityCredit).toBe('zero_in_confirmed_funding_scenario');
    expect(o.award).toMatchObject({ kind: 'tuition_waiver', guaranteedAmount: null, display: expect.stringMatching(/tuition only; living costs, travel and insurance are not covered/) });
    expect(o.award.restrictions).toEqual(['only at aldermere_c']);
    expect(JSON.stringify(r.payload)).not.toMatch(/chance|likely to win|probability/i);
  });

  // ---------------------------------------------------------------- 16T01 / 16T02

  it('16T01: one missing eligibility fact gives "potentially eligible" with that specific unknown', async () => {
    const h = makeScholarshipHarness();
    h.senior({ graduation: null });
    const r = await h.shortlist();
    const hr = h.opp(r, 'harbor_rotary')!;
    expect(hr.eligibility.status).toBe('potentially_eligible');
    expect(hr.eligibility.unknown).toEqual([expect.objectContaining({ clauseId: 'hr_grad', fact: 'education.expected_graduation', reason: 'Your expected graduation date is not recorded.' })]);
    expect(hr.eligibility.satisfied.map((x) => x.clauseId)).toEqual(['hr_school']);
    expect(r.payload.questions.find((q) => q.code === 'clause_harbor_rotary_hr_grad')!.canSkip).toBe(true);
    expect(hr.ranking).not.toBeNull();
  });

  it('16T02: citizenship fits but school location does not; both clauses apply and the failure is explained', async () => {
    const h = makeScholarshipHarness();
    h.senior({ school: 'GR' });
    const r = await h.shortlist();
    const b = h.opp(r, 'beacon_scholars')!;
    expect(b.eligibility.status).toBe('ineligible');
    expect(b.eligibility.satisfied.map((x) => x.clauseId)).toContain('bs_citizen');
    expect(b.eligibility.failed).toEqual([expect.objectContaining({ clauseId: 'bs_school', reason: 'The award requires attending school in US; your school is in GR. Citizenship alone does not satisfy this.', sourceRef: 'ssrc_beacon_scholars' })]);
    expect(b.ranking).toBeNull();
    expect(b.eligibility.evaluatedOn).toBe('2026-09-27');
  });

  // ---------------------------------------------------------------- 16T03 / 16T04

  it('16T03: a school nomination is a dependency before any application path is promised', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    h.applying('app_ald', 'aldermere_c', null, 1);
    const r = await h.ok({ action: 'check', scholarshipId: 'aldermere_presidential' });
    const o = r.payload.opportunities[0]!;
    expect(o.dependencies.applicationPath).toBe('requires_nomination_first');
    expect(o.dependencies.earliest).toMatchObject({ stageId: 'nomination', note: expect.stringMatching(/internal deadline is unknown/) });
    const packet = r.payload.packet!;
    expect(packet.preparedRequests).toEqual([expect.objectContaining({ purpose: 'nomination', sent: false })]);
    expect(r.externalActions).toEqual([]);
    expect(h.kernel.actions.countByState('proposed')).toBe(0);
    expect(r.payload.notices.map((n) => n.code)).toEqual(expect.arrayContaining(['nomination_limit', 'referee_differs', 'assessed_interview']));
    expect(r.payload.notices.find((n) => n.code === 'nomination_limit')!.message).toMatch(/The school decides who; the app does not/);
  });

  it('16T04: nomination and application deadlines are both kept and the earlier dependency is scheduled first', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    h.applying('app_ald', 'aldermere_c', null, 1);
    const r = await h.ok({ action: 'check', scholarshipId: 'aldermere_presidential' });
    const stages = r.payload.opportunities[0]!.dependencies.stages;
    expect(stages.find((s) => s.stageId === 'nomination')).toMatchObject({ deadline: '2026-11-01', internalDeadline: 'unknown' });
    expect(stages.find((s) => s.stageId === 'application')).toMatchObject({ deadline: '2026-12-01', time: '23:59', timezone: 'America/New_York', dependsOn: ['nomination', 'admission'] });
    expect(r.payload.packet!.checklist.map((c) => c.stageId)).toEqual(['nomination', 'admission', 'reference', 'application', 'interview']);
    expect(r.payload.packet!.checklist[0]!.due).toBe('school deadline unknown (sponsor: 2026-11-01)');
    expect(r.payload.questions.find((q) => q.code === 'internal_deadline_aldermere_presidential_nomination')!.question).toMatch(/earlier deadline for school nomination/);
    const toPlanner = r.handoffs.find((x) => x.toRole === '14')!;
    expect(toPlanner.requestedOutcome).toMatch(/^Schedule School nomination first, including a check of the school’s internal nomination deadline/);
  });

  // ---------------------------------------------------------------- 16T05 / 16T06 / 16T07

  it('16T05: a graduate listing is excluded from an undergraduate shortlist', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    const r = await h.shortlist();
    expect(h.opp(r, 'lumen_graduate_fellowship')).toBeUndefined();
    expect(r.payload.excluded).toEqual(expect.arrayContaining([{ scholarshipId: 'lumen_graduate_fellowship', name: 'Lumen Graduate Fellowship', reason: 'This award is for graduate applicants, not your level.' }]));
  });

  it('16T06: an "up to" award is not treated as guaranteed funding', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    const r = await h.shortlist();
    const b = h.opp(r, 'beacon_scholars')!;
    expect(b.award).toMatchObject({ kind: 'up_to', guaranteedAmount: null, maximum: { amount: '20000.00', currency: 'USD' }, display: 'up to $20,000; not every recipient receives the maximum' });
    expect(b.affordabilityCredit).toBe('zero_in_confirmed_funding_scenario');
    expect(b.ranking!.dimensions['value_clarity']).toEqual({ value: 1, why: 'up to $20,000; not every recipient receives the maximum' });
    expect(r.handoffs.find((x) => x.toRole === '15')!.requestedOutcome).toMatch(/zero in the confirmed funding scenario/);
    expect(r.payload.notices.find((n) => n.code === 'not_funding')).toBeDefined();
  });

  it('16T07: mutually exclusive award routes are shown as a choice, never as simultaneous funding', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    h.applying('app_ald', 'aldermere_c', null, 1);
    const r = await h.shortlist();
    expect(r.payload.choices).toEqual([{ scholarshipIds: ['aldermere_merit', 'aldermere_presidential'], text: expect.stringMatching(/only one of these.*never counted together/) }]);
    expect(h.opp(r, 'aldermere_merit')!.exclusiveWith[0]!.scholarshipId).toBe('aldermere_presidential');
  });

  // ---------------------------------------------------------------- 16T08

  it('16T08: a scholarship policy that prohibits generated content gates tailored help, and nothing is produced', async () => {
    const model = new ScriptedModelGateway();
    const h = makeScholarshipHarness({ model });
    h.kernel.policies.add(presidentialPolicy({ tailored_brainstorming: 'prohibited', outline: 'prohibited', editing: 'prohibited', prose_generation: 'prohibited', interview_preparation: 'allowed' }));
    h.senior();
    const check = await h.ok({ action: 'check', scholarshipId: 'aldermere_presidential' });
    expect(check.payload.packet!.assistance.map((a) => [a.operation, a.decision])).toEqual([
      ['tailored_brainstorming', 'prohibited'],
      ['editing', 'prohibited'],
      ['prose_generation', 'prohibited'],
      ['interview_preparation', 'allowed'],
    ]);
    expect(check.sourceRefs).toContain('polsrc_presidential');
    const r = await h.ok({ action: 'assist', scholarshipId: 'aldermere_presidential', operation: 'tailored_brainstorming' });
    expect(r.payload.assistance).toMatchObject({ decision: 'prohibited', contentProduced: false });
    expect(r.payload.refusals[0]).toMatch(/not permitted for Aldermere Presidential Scholarship/);
    expect(r.handoffs.some((x) => x.toRole === '17')).toBe(false);
    expect(model.calls).toEqual([]);
  });

  // ---------------------------------------------------------------- 16T09 / 16T10

  it('16T09: a fee to release a "guaranteed" award is flagged; nothing is paid or disclosed', async () => {
    const h = makeScholarshipHarness();
    const r = await h.ok({ action: 'submit_lead', name: 'National Achievers Grant', providerName: 'Achievers Grant Center', url: 'https://bit.ly/achievers-grant', listingText: 'Congratulations! You have been selected for a guaranteed $10,000 scholarship for 2027. Pay a $49 processing fee to release your award. Reply with your bank account number and date of birth.' });
    const lead = r.payload.leads[0]!;
    expect(lead.trust).toBe('suspicious');
    expect(lead.signals.map((s) => s.code)).toEqual(expect.arrayContaining(['guarantee', 'upfront_fee', 'fee_to_release', 'sensitive_request', 'short_link']));
    expect(lead.message).toMatch(/Do not pay anything or share those details/);
    expect(r.payload.refusals[0]).toMatch(/will not help pay a fee/);
    expect(h.kernel.actions.countByState('proposed')).toBe(0);
    expect(h.catalog.list().some((s) => s.name === 'National Achievers Grant')).toBe(false);
    expect(h.catalog.leadsAwaitingReview()).toHaveLength(1);
    expect(r.summary).toMatch(/shows warning signs and was not added/);
  });

  it('16T10: a small local provider with little public evidence stays unresolved, with no accusation', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    const r = await h.shortlist();
    expect(h.opp(r, 'millbrook_library')).toBeUndefined();
    expect(r.payload.leads.find((l) => l.scholarshipId === 'millbrook_library')).toMatchObject({ trust: 'unresolved', message: expect.stringMatching(/kept apart from your actionable list/) });
    h.pages.set('https://millbrookfriends.example.org/award', { text: 'Friends of Millbrook Library award for local students. Applications for 2027 are due March 1. Contact us at the circulation desk.' });
    const lead = await h.ok({ action: 'submit_lead', name: 'Millbrook Library Friends Award', providerName: 'Friends of Millbrook Library', url: 'https://millbrookfriends.example.org/award' });
    const l = lead.payload.leads[0]!;
    expect(l.trust).toBe('unresolved');
    expect(l.message).toMatch(/not a finding of wrongdoing/);
    expect(l.missing[0]).toMatch(/through a contact you already know/);
    expect(JSON.stringify(lead.payload)).not.toMatch(/\b(scam|fraud|fake)\b/i);
    expect(h.fetches).toEqual(['https://millbrookfriends.example.org/award']);
  });

  // ---------------------------------------------------------------- 16T11 / 16T12 / 16T13

  it('16T11: reaching the finalist stage does not record the award as won', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    const r = await h.ok({ action: 'track', scholarshipId: 'beacon_scholars', stage: 'finalist', evidence: { kind: 'provider_message', quote: 'You have been named a Beacon Scholars finalist.' } });
    expect(r.payload.tracking).toMatchObject({ stage: 'finalist', fundingRecorded: false });
    expect(r.payload.tracking!.note).toMatch(/progress, not an award/);
    const v = record(h);
    expect(v.entityIds('funding_award')).toEqual([]);
    expect(v.value('scholarship_application', 'beacon_scholars', 'status')).toEqual({ opportunityRef: 'beacon_scholars', stage: 'finalist' });
    expect(h.opp(await h.shortlist(), 'beacon_scholars')!.affordabilityCredit).toBe('zero_in_confirmed_funding_scenario');
    // "Offered" from a message alone is not funding either.
    const msg = await h.ok({ action: 'track', scholarshipId: 'beacon_scholars', stage: 'offered', evidence: { kind: 'provider_message', quote: 'Congratulations, you are a Beacon Scholar!' } });
    expect(msg.payload.tracking!.fundingRecorded).toBe(false);
    expect(msg.payload.questions[0]!.code).toBe('award_letter');
  });

  it('16T12: an award letter records the offer and its terms and sends them to affordability for reconciliation', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    const r = await h.ok({ action: 'track', scholarshipId: 'harbor_rotary', stage: 'offered', evidence: { kind: 'award_letter', quote: 'We are pleased to award you the Harbor Rotary Scholarship of $5,000 for the 2027-28 academic year.' }, award: { amount: { amount: '5000.00', currency: 'USD' }, period: 'one_academic_year', coveredCosts: ['tuition'] } });
    expect(r.payload.tracking).toMatchObject({ fundingRecorded: true, duplicateOf: null });
    const f = record(h).value('funding_award', 'scholarship_harbor_rotary', 'definition');
    expect(f).toMatchObject({ kind: 'external_scholarship', stage: 'offered', amount: { amount: '5000.00' }, coveredCosts: ['tuition'], externalRefs: ['scholarship:harbor_rotary'] });
    expect(r.handoffs.find((x) => x.toRole === '15')!.requestedOutcome).toMatch(/displacement of institutional aid/);
    expect(h.opp(await h.shortlist(), 'harbor_rotary')!.affordabilityCredit).toBe('offered_pending_reconciliation');
  });

  it('16T13: a scholarship already included in institutional aid is not credited twice', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    h.seed([buildClaim({ entity: 'funding_award', entityId: 'letter_outside', attribute: 'definition', value: { provider: 'Aldermere College', name: 'Harbor Rotary Scholarship (outside award)', kind: 'external_scholarship', amount: { amount: '5000.00', currency: 'USD' }, period: 'one_academic_year', coveredCosts: null, stage: 'offered', optionRef: 'aldermere', renewal: null, basis: 'unknown', eligibilityProgram: null, disbursesOn: null, externalRefs: [] }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('outside award 5000 on the letter')], actor: h.student, viaRole: 'ui' })]);
    const r = await h.ok({ action: 'track', scholarshipId: 'harbor_rotary', stage: 'offered', evidence: { kind: 'award_letter', quote: 'Harbor Rotary Scholarship of $5,000' }, award: { amount: { amount: '5000.00', currency: 'USD' }, period: 'one_academic_year' } });
    expect(r.payload.tracking).toMatchObject({ fundingRecorded: false, duplicateOf: 'letter_outside' });
    expect(r.payload.tracking!.note).toMatch(/not added a second time/);
    expect(record(h).entityIds('funding_award')).toEqual(['letter_outside']);
  });

  // ---------------------------------------------------------------- 16T14 / 16T15 / 16T16

  it('16T14: a declined sensitive question leaves that clause unknown and the rest of the work continues', async () => {
    const h = makeScholarshipHarness();
    h.senior({ residence: null });
    const r = await h.shortlist({ declined: ['identity.residence_country'] });
    const pg = h.opp(r, 'pearlgate_access')!;
    expect(pg.eligibility.status).toBe('potentially_eligible');
    expect(pg.eligibility.unknown.find((u) => u.clauseId === 'pg_res')).toMatchObject({ declined: true, sensitive: true, reason: expect.stringMatching(/chose not to answer/) });
    expect(r.payload.questions.some((q) => q.code === 'clause_pearlgate_access_pg_res')).toBe(false);
    expect(r.payload.questions.find((q) => q.code === 'clause_pearlgate_access_pg_need')!.why).toMatch(/sensitive.*you can skip it/);
    expect(h.opp(r, 'harbor_rotary')!.eligibility.status).toBe('eligible_within_checked_scope');
    // Nothing about the student is inferred from anything else.
    expect(JSON.stringify(r.payload)).not.toMatch(/ethnic|religio|disabilit/i);
  });

  it('16T15: effort beyond the remaining capacity becomes a priority decision with the portfolio strategist', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    h.applying('app_ald', 'aldermere_c', null, 1);
    const r = await h.shortlist({ availableHours: 10 });
    expect(r.payload.capacity!.conflict).toBe(true);
    expect(r.payload.capacity!.requiredHours).toBeGreaterThan(10);
    const toPlanner = r.handoffs.find((x) => x.toRole === '14')!;
    expect(toPlanner.reason).toMatch(/exceeds the time available/);
    expect(toPlanner.requestedOutcome).toMatch(/choose which scholarships to pursue/);
    expect(r.payload.notices.find((n) => n.code === 'capacity')!.message).toMatch(/a decision for you and your plan/);
    const roomy = await h.shortlist({ availableHours: 200 });
    expect(roomy.payload.capacity!.conflict).toBe(false);
  });

  it('16T16: an award tied to a first-choice program keeps its restriction when the choice order changes', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    h.applying('app_kes', 'kestrel_u', 'kestrel_economics', 1);
    h.applying('app_ald', 'aldermere_c', null, 2);
    const first = await h.shortlist();
    expect(h.opp(first, 'kestrel_excellence')!.eligibility.status).toBe('eligible_within_checked_scope');
    expect(h.opp(first, 'kestrel_excellence')!.award.restrictions).toEqual(['only at kestrel_economics at kestrel_u']);
    // The student reorders their choices.
    h.seed([
      buildClaim({ entity: 'application', entityId: 'app_kes', attribute: 'choice_rank', value: { rank: 2, label: 'other' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('Kestrel is now my second choice')], actor: h.student, viaRole: 'ui' }),
      buildClaim({ entity: 'application', entityId: 'app_ald', attribute: 'choice_rank', value: { rank: 1, label: 'first_choice' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('Aldermere is my first choice')], actor: h.student, viaRole: 'ui' }),
    ]);
    await h.kernel.flushEvents();
    const artifact = h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'scholarship_shortlist' })[0]!;
    expect(artifact.status).toBe('stale');
    const after = await h.shortlist();
    const ke = h.opp(after, 'kestrel_excellence')!;
    expect(ke.eligibility.status).toBe('ineligible');
    expect(ke.eligibility.failed[0]!.reason).toMatch(/only when kestrel_economics at kestrel_u is your first choice; your first choice is aldermere_c/);
  });

  // ---------------------------------------------------------------- 16T17 / 16T18

  it('16T17: an assessed interview is never answered on the student’s behalf; permitted preparation goes to the interview studio', async () => {
    const h = makeScholarshipHarness();
    h.kernel.policies.add(presidentialPolicy({ interview_preparation: 'allowed' }));
    const refused = await h.ok({ action: 'assist', scholarshipId: 'aldermere_presidential', operation: 'answer_assessed_interview' });
    expect(refused.payload.assistance).toMatchObject({ decision: 'refused', contentProduced: false });
    expect(refused.payload.refusals).toEqual(['I won’t answer a selection interview on your behalf.']);
    const prep = await h.ok({ action: 'assist', scholarshipId: 'aldermere_presidential', operation: 'interview_preparation' });
    expect(prep.payload.assistance!.decision).toBe('allowed');
    expect(prep.handoffs).toEqual([expect.objectContaining({ toRole: '25', requestedOutcome: expect.stringMatching(/before the interview/) })]);
  });

  it('16T18: a stopped award leaves active planning and its reminders are removed', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    const r = await h.ok({ action: 'track', scholarshipId: 'harbor_rotary', stage: 'stopped', evidence: { kind: 'student_report', quote: 'I am not going to apply for the Rotary one.' } });
    expect(r.handoffs).toEqual([expect.objectContaining({ toRole: '14', requestedOutcome: 'Remove its tasks and reminders from the active plan.' })]);
    const s = await h.shortlist();
    expect(h.opp(s, 'harbor_rotary')).toBeUndefined();
    expect(s.payload.excluded).toEqual(expect.arrayContaining([{ scholarshipId: 'harbor_rotary', name: 'Harbor Rotary Scholarship', reason: 'You stopped pursuing this; it is no longer in your plan.' }]));
    expect(record(h).value('scholarship_application', 'harbor_rotary', 'status')).toEqual({ opportunityRef: 'harbor_rotary', stage: 'stopped' });
  });

  // ---------------------------------------------------------------- ranking, catalog and contract

  it('ranking uses practical factors the student can change, never a chance of winning', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    h.applying('app_ald', 'aldermere_c', null, 1);
    const r = await h.shortlist({ topics: ['community_service'] });
    const ranked = r.payload.opportunities.filter((o) => o.ranking).sort((a, b) => a.ranking!.rank - b.ranking!.rank);
    expect(ranked.map((o) => o.ranking!.rank)).toEqual(ranked.map((_, i) => i + 1));
    expect(Object.keys(ranked[0]!.ranking!.dimensions).sort()).toEqual(['deadline_feasibility', 'effort', 'eligibility', 'interest_fit', 'nomination_access', 'restrictions', 'value_clarity']);
    // Harbor (eligible, fixed $5,000, community service): 3×2 + 2×1 + 2×2 + 2×1 + 1×2 + 1×2 + 1×2 = 20.
    expect(ranked[0]!.scholarshipId).toBe('harbor_rotary');
    expect(ranked[0]!.ranking!.score).toBe(20);
    // A student who cares most about leadership opportunities reweights: Beacon (leadership, up to $20,000) comes first with 22.
    const reweighted = await h.shortlist({ topics: ['leadership'], weights: { interest_fit: 5 } });
    const top = reweighted.payload.opportunities.find((o) => o.ranking?.rank === 1)!;
    expect(top.scholarshipId).toBe('beacon_scholars');
    expect(top.ranking!.score).toBe(22);
    expect(JSON.stringify(r.payload)).not.toMatch(/expected value|chance of|probability/i);
  });

  it('the catalog rejects duplicate listings and a material change makes saved shortlists stale', async () => {
    const h = makeScholarshipHarness();
    h.senior();
    expect(() => h.catalog.curate({ ...HARBOR_ROTARY, scholarshipId: 'harbor_rotary_copy' })).toThrow(/Duplicate listing/);
    await h.shortlist();
    const saved = h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'scholarship_shortlist' })[0]!;
    h.catalog.curate({ ...ALDERMERE_PRESIDENTIAL, stages: ALDERMERE_PRESIDENTIAL.stages.map((s) => (s.stageId === 'nomination' ? { ...s, deadline: { ...s.deadline!, date: '2026-10-25' } } : s)) });
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, saved.id)!.status).toBe('stale');
    expect(h.kernel.events.events('source.changed')).toEqual([expect.objectContaining({ entityRef: 'scholarship:aldermere_presidential', oldVersion: 1, newVersion: 2, changedFields: ['stages'] })]);
    // A cosmetic re-curation is not a new version.
    expect(h.catalog.curate({ ...HARBOR_ROTARY }).version).toBe(1);
  });

  it('three-valued rules: AND fails on any false, OR passes on any true, exclusions report their reason', () => {
    const src = 's';
    const facts: EligibilityFacts = { applications: [], answers: { member: true }, declined: new Set(), recordedAbsent: new Set(), schoolCountry: 'US', citizenships: ['CA'] };
    const either: Clause = { any: [{ leaf: { clauseId: 'c', kind: 'citizenship_in', text: 'US citizen', sourceRef: src, params: { countries: ['US'] } } }, { leaf: { clauseId: 's', kind: 'school_country_in', text: 'US school', sourceRef: src, params: { countries: ['US'] } } }] };
    expect(evaluateRule(either, facts).truth).toBe('true');
    const both: Clause = { all: [either, { leaf: { clauseId: 'g', kind: 'graduation_between', text: 'class of 2027', sourceRef: src, params: { from: '2027-01', to: '2027-12' } } }] };
    expect(evaluateRule(both, facts).truth).toBe('unknown');
    const excluded: Clause = { all: [either, { not: { leaf: { clauseId: 'member', kind: 'custom', text: 'Children of club members are not eligible.', sourceRef: src, params: { question: 'Is a parent a club member?' } } } }] };
    const ev = evaluateRule(excluded, facts);
    expect(ev.truth).toBe('false');
    // Only the deciding clause is a reason: the false citizenship branch of the satisfied OR is not.
    expect(ev.failed).toEqual([expect.objectContaining({ clauseId: 'member', reason: 'An exclusion applies: Children of club members are not eligible.' })]);
    expect(evaluateRule(both, facts).unknown.map((u) => u.clauseId)).toEqual(['g']);
    const neither = evaluateRule(either, { ...facts, schoolCountry: 'GR' });
    expect(neither.truth).toBe('false');
    expect(neither.failed.map((x) => x.clauseId)).toEqual(['c', 's']);
    expect(evaluateRule({ not: { leaf: { clauseId: 'x', kind: 'custom', text: 't', sourceRef: src, params: {} } } }, facts).truth).toBe('unknown');
  });

  it('screening is proportionate: a fee alone on a verified-looking page is not an accusation', () => {
    const plain = screenListing({ url: 'https://harborrotary.example.org/scholarship', text: 'Applications for 2027 close on February 15. There is no application fee.', providerName: 'Harbor Rotary Club', officialDomains: ['harborrotary.example.org'], currentCycleStated: true });
    expect(plain.status).toBe('unresolved');
    expect(plain.signals).toEqual([]);
    const offDomain = screenListing({ url: 'https://harbor-rotary-awards.example.com/apply', text: 'Apply now for 2027.', providerName: 'Harbor Rotary Club', officialDomains: ['harborrotary.example.org'], currentCycleStated: true });
    expect(offDomain.signals.map((s) => s.code)).toEqual(['link_not_official']);
    expect(offDomain.status).toBe('unresolved');
  });

  it('the contract rejects inconsistent eligibility, ranked unverified listings and any chance of winning', () => {
    const base = { scholarshipId: 'x', version: 1, name: 'X', provider: 'P', applicationUrl: null, trust: { status: 'unresolved', evidence: [] }, eligibility: { status: 'eligible_within_checked_scope', failed: [], unknown: [{ clauseId: 'a', text: 't', reason: 'r', sourceRef: 's', fact: 'f', sensitive: false, declined: false }], satisfied: [], evaluatedOn: '2026-09-27' }, selectionCriteria: [], award: { kind: 'up_to', display: 'd', guaranteedAmount: { amount: '1.00', currency: 'USD' }, maximum: null, duration: null, renewal: null, coveredCosts: null, portability: 'portable', restrictions: [] }, affordabilityCredit: 'offered_pending_reconciliation', dependencies: { applicationPath: 'direct', stages: [], earliest: null }, deadlineStatus: 'open', effortHours: 1, trackingStage: null, exclusiveWith: [], ranking: { rank: 1, score: 1, dimensions: {} } };
    const p = { action: 'shortlist', opportunities: [base], excluded: [], leads: [], choices: [], capacity: null, packet: null, tracking: null, assistance: null, questions: [], notices: [{ code: 'x', message: 'Your chance of winning is high.' }], refusals: [] } as unknown as ScholarshipPayload;
    const issues = SCHOLARSHIP_CONTRACT.semantic!(p, {} as never).join(' | ');
    expect(issues).toMatch(/eligible despite open or failed clauses/);
    expect(issues).toMatch(/only verified, open, not-ineligible opportunities are ranked/);
    expect(issues).toMatch(/only a fixed award has a guaranteed amount/);
    expect(issues).toMatch(/funding credit without an offer/);
    expect(issues).toMatch(/no chance of winning may be stated/);
  });
});
