import { describe, expect, it } from 'vitest';
import { UNCERTAINTY_CONTRACT, type UncertaintyPayload } from '../../src/agents/a13-uncertainty/agent.js';
import { DEFINITIONS } from '../../src/agents/a13-uncertainty/assess.js';
import { reviewModelCard } from '../../src/agents/a13-uncertainty/models.js';
import { ALDERMERE, ARCH, KESTREL } from '../fixtures/institutions.js';
import { TENANT } from '../helpers/kernel.js';
import { makeUncertaintyHarness } from '../helpers/uncertainty.js';

/** Aldermere's fictional fall 2025 figures: 15% admitted; enrolled score submitters' SAT total 1450–1550. */
function aldermere(h: ReturnType<typeof makeUncertaintyHarness>) {
  h.stat(ALDERMERE, 'admit_rate', 'first_year_applicants', 'Fall 2025', 15);
  h.stat(ALDERMERE, 'score_25th', 'enrolled_score_submitters', 'Fall 2025', 1450, { scoreType: 'SAT Total' });
  h.stat(ALDERMERE, 'score_75th', 'enrolled_score_submitters', 'Fall 2025', 1550, { scoreType: 'SAT Total' });
  h.eligibility(ALDERMERE, ALDERMERE, 'apparently_meets');
}

describe('Agent 13 — Admissions uncertainty advisor', () => {
  it('worked example: scores inside the enrolled range do not make admission likely, and the whole portfolio is sent for review', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.score('sat1', { family: 'SAT', reportedTotal: 1500, sections: { math: 760, evidence_based_reading_writing: 740 } });
    const r = await h.assess({ question: 'exact_chance' });
    const a = r.payload.assessments[0]!;
    expect(a.comparisons[0]).toMatchObject({ position: 'within_middle_50', studentScore: 1500, p25: 1450, p75: 1550, population: 'enrolled_score_submitters' });
    expect(a.state).toBe('highly_uncertain_selection');
    expect(a.definition).toBe(DEFINITIONS.highly_uncertain_selection);
    expect(a.eligibility.state).toBe('supported');
    expect(r.payload.personalProbability).toBeNull();
    expect(JSON.stringify(r.payload)).not.toMatch(/\b73\b|\d+\s?% chance/);
    expect(r.handoffs.find((x) => x.toRole === '14')!.requestedOutcome).toMatch(/whole portfolio/);
  });

  // ---------------------------------------------------------------- 13T01 / 13T02 / 13T03 / 13T04 / 13T05

  it('13T01: an exact chance without a validated model gets qualitative analysis and no number', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    const r = await h.assess({ question: 'exact_chance' });
    expect(r.payload.refusals[0]).toMatch(/no validated model behind a personal percentage/);
    expect(r.payload.assessments[0]!.reasons[0]).toMatch(/Most applicants in the relevant group are not admitted \(15% admitted in Fall 2025\)/);
    expect(r.completionReason).toBe('qualitative_instead_of_number');
    expect(r.payload.assessments[0]!.numericModel).toBeNull();
  });

  it('13T02: an institutional admit rate is labeled with its cohort and never presented as a personal probability', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    const r = await h.assess();
    const st = r.payload.assessments[0]!.statistics.find((x) => x.explanation.includes('admitted'))!;
    expect(st.explanation).toBe('Fall 2025: 15% of first-year applicants were admitted (denominator: first year applicants in the same cohort). This describes a past group; it is not anyone\'s personal probability.');
    expect(st.applicability).toBe('scope_matched');
  });

  it('13T03: a score above the 75th percentile is explained without declaring admission likely', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.score('sat1', { family: 'SAT', reportedTotal: 1580, reportStatus: 'official' });
    const r = await h.assess();
    const c = r.payload.assessments[0]!.comparisons[0]!;
    expect(c.position).toBe('above_75th');
    expect(c.explanation).toMatch(/above the middle half \(1450–1550\).*also turned down; this is one academic consideration, not a sign that admission is likely/);
    expect(r.payload.assessments[0]!.state).toBe('highly_uncertain_selection');
    expect(JSON.stringify(r.payload)).not.toMatch(/likely to (get in|be admitted)|you should get in/i);
  });

  it('13T04: a range covering score submitters among enrolled students keeps both selection conditions', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.score('sat1', { family: 'SAT', reportedTotal: 1490 });
    const r = await h.assess();
    const a = r.payload.assessments[0]!;
    expect(a.comparisons[0]!.explanation).toMatch(/only enrolled students who chose to submit scores, and enrolled students are a subset of those admitted/);
    expect(a.comparisons[0]!.explanation).toMatch(/\(self-reported\)/);
    expect(a.uncertaintyReasons.map((u) => u.code)).toContain('score_range_selected_group');
  });

  it('13T05: a higher early-round rate is not presented as a benefit for this student', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.stat(ALDERMERE, 'admit_rate', 'first_year_applicants', 'Fall 2025', 22, { label: 'Early Decision' });
    h.stat(ALDERMERE, 'admit_rate', 'first_year_applicants', 'Fall 2025', 9, { label: 'Regular Decision' });
    const r = await h.assess();
    const note = r.payload.assessments[0]!.roundNote!;
    expect(note).toMatch(/early decision admit rate \(22%\) is higher than the regular rate \(9%\).*does not show how much applying early would change the outcome for you/);
    expect(JSON.stringify(r.payload)).not.toMatch(/boost|increases? your chances/i);
    // Round-specific rates are not used as the group rate.
    expect(r.payload.assessments[0]!.reasons[0]).toMatch(/15% admitted/);
  });

  // ---------------------------------------------------------------- 13T06 / 13T07 / 13T08 / 13T09

  it('13T06: a program with its own competitive entry is assessed at program scope or marked as insufficient evidence', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.programAccess(ARCH, 'later_competitive_selection', 'Students apply to the Architecture studio sequence at the end of the first year; places are limited.');
    h.eligibility(ALDERMERE, ARCH, 'apparently_meets');
    const r = await h.assess({}, [h.option({ optionRef: 'arch', program: 'Architecture' })]);
    const a = r.payload.assessments[0]!;
    expect(a.scope.programSelection).toBe('separate_competitive');
    expect(a.state).toBe('selection_evidence_insufficient');
    expect(a.uncertaintyReasons.find((u) => u.code === 'program_selection_separate')!.text).toMatch(/Institution-wide figures do not describe it/);
    // With program-level statistics the program's own figures are used.
    h.stat(ARCH, 'admit_rate', 'program_applicants', 'Fall 2025', 30);
    const withProgram = await h.assess({}, [h.option({ optionRef: 'arch', program: 'Architecture' })]);
    expect(withProgram.payload.assessments[0]!.reasons[0]).toMatch(/30% admitted/);
  });

  it('13T07: an unsupported qualification system is flagged, with no invented conversion', async () => {
    const h = makeUncertaintyHarness();
    h.stat(ALDERMERE, 'admit_rate', 'first_year_applicants', 'Fall 2025', 55);
    h.stat(ALDERMERE, 'score_25th', 'enrolled_score_submitters', 'Fall 2025', 1200, { scoreType: 'SAT Total' });
    h.stat(ALDERMERE, 'score_75th', 'enrolled_score_submitters', 'Fall 2025', 1400, { scoreType: 'SAT Total' });
    h.eligibility(ALDERMERE, ALDERMERE, 'apparently_meets');
    h.qualification('ib_diploma', 'IB Diploma');
    h.score('sat1', { family: 'SAT', reportedTotal: 1330 });
    const r = await h.assess();
    const a = r.payload.assessments[0]!;
    expect(a.uncertaintyReasons.find((u) => u.code === 'qualification_not_comparable')!.text).toMatch(/do not cover IB Diploma, and no conversion to another grading scale is made/);
    expect(a.state).toBe('selection_evidence_insufficient');
    expect(r.handoffs.find((x) => x.toRole === '06')!.requestedOutcome).toMatch(/official prerequisites and equivalences/);
    expect(JSON.stringify(r.payload)).not.toMatch(/equivalent to a (\d|GPA)/i);
    // The same evidence for a qualification the statistics describe supports a plausible category.
    const us = makeUncertaintyHarness();
    us.stat(ALDERMERE, 'admit_rate', 'first_year_applicants', 'Fall 2025', 55);
    us.stat(ALDERMERE, 'score_25th', 'enrolled_score_submitters', 'Fall 2025', 1200, { scoreType: 'SAT Total' });
    us.stat(ALDERMERE, 'score_75th', 'enrolled_score_submitters', 'Fall 2025', 1400, { scoreType: 'SAT Total' });
    us.eligibility(ALDERMERE, ALDERMERE, 'apparently_meets');
    us.qualification('us_high_school', 'US high school diploma');
    us.score('sat1', { family: 'SAT', reportedTotal: 1330 });
    const ok = await us.assess();
    expect(ok.payload.assessments[0]!.state).toBe('plausible_option_with_material_uncertainty');
    expect(ok.payload.assessments[0]!.definition).toMatch(/The outcome is still uncertain/);
  });

  it('13T08: a high essay score is not translated into admissions odds', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    const plain = await h.assess();
    const r = await h.assess({ otherSignals: [{ kind: 'essay_evaluation', value: 9.5 }, { kind: 'project_completed', value: 'robotics club outreach' }] });
    expect(r.payload.assessments[0]!.state).toBe(plain.payload.assessments[0]!.state);
    expect(r.payload.notices.find((n) => n.code === 'not_selection_evidence_essay_evaluation')!.message).toMatch(/diagnostic view of your writing; it is not admissions odds/);
    expect(r.payload.notices.find((n) => n.code === 'not_selection_evidence_project_completed')).toBeDefined();
  });

  it('13T09: several correlated uncertain options are never multiplied into a combined chance', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.stat(KESTREL, 'admit_rate', 'first_year_applicants', 'Fall 2025', 12);
    h.eligibility(KESTREL, KESTREL, 'apparently_meets');
    const r = await h.assess({ question: 'portfolio' }, [h.option(), h.option({ optionRef: 'kestrel', institution: 'Kestrel University' }), h.option({ optionRef: 'riverside', institution: 'Riverside College' })]);
    const pf = r.payload.portfolio!;
    expect(pf.combinedChance).toBeNull();
    expect(pf.note).toMatch(/multiplying them as independent events would be misleading/);
    expect(pf.sharedDependencies[0]).toMatch(/they are not independent chances/);
    expect(pf.dependsOnUncertainSelection).toBe(true);
    expect(r.handoffs.find((x) => x.toRole === '14')!.requestedOutcome).toMatch(/at least one option with clearer admission evidence/);
    expect(JSON.stringify(r.payload)).not.toMatch(/at least one (admission|acceptance) is \d/i);
  });

  it('the largest allowed portfolio (eight options) is assessed within the default budget', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    const options = Array.from({ length: 8 }, (_, i) => h.option({ optionRef: `aldermere_${i}` }));
    const r = await h.assess({ question: 'portfolio' }, options);
    expect(r.payload.assessments).toHaveLength(8);
    expect(r.payload.portfolio!.byState).toEqual({ highly_uncertain_selection: 8 });
  });

  // ---------------------------------------------------------------- 13T10 / 13T11 / 13T12 / 13T16 (model governance)

  it('13T10: a feature set with post-decision information is rejected', () => {
    const h = makeUncertaintyHarness();
    const m = h.models.register(h.card({ features: [{ name: 'test_total', availableAt: 'application_time', provenance: 'student_record', sensitive: false }, { name: 'interview_invited', availableAt: 'post_decision', provenance: 'institution_data', sensitive: false }] }));
    expect(m.status).toBe('rejected');
    expect(m.review.issues[0]).toBe('features not available when the student applies would leak the outcome: interview_invited (13T10)');
  });

  it('13T11: rows from one student must be grouped, or the model is rejected', () => {
    const h = makeUncertaintyHarness();
    expect(h.models.register(h.card({ splitGrouping: 'by_application' })).review.issues).toContain('rows from the same student must be grouped when splitting training and evaluation data (13T11)');
    expect(h.models.register(h.card({ version: 2 })).status).toBe('approved');
  });

  it('13T12: a model calibrated overall but weak for a subgroup reports the limitation and abstains for it', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.models.register(h.card());
    const intl = await h.assess({}, [h.option({ applicantCategory: 'first_year_international' })]);
    const m = intl.payload.assessments[0]!.numericModel!;
    expect(m).toMatchObject({ ref: 'model:admit_estimator@1', status: 'approved', usable: false });
    expect(m.reason).toMatch(/not reliable enough for your group \(international first-year: n=140, calibration slope 0\.62\), so it abstains/);
    expect(intl.payload.assessments[0]!.uncertaintyReasons.map((u) => u.code)).toContain('model_abstains_for_group');
    const domestic = await h.assess();
    expect(domestic.payload.assessments[0]!.numericModel!.reason).toMatch(/qualitative assessments only/);
    expect(JSON.stringify(domestic.payload)).not.toMatch(/\d+\s?% (chance|probability)/i);
  });

  it('13T16: sensitive attributes inferred from an essay are rejected as prediction inputs', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    const r = await h.assess({ proposedInputs: [{ name: 'ethnicity_from_essay', provenance: 'inferred_from_text', sensitive: true }] });
    expect(r.payload.refusals[0]).toMatch(/ethnicity from essay would be inferred from your writing\. Sensitive characteristics are never inferred/);
    const card = h.card({ features: [{ name: 'test_total', availableAt: 'application_time', provenance: 'student_record', sensitive: false }, { name: 'religion_guess', availableAt: 'application_time', provenance: 'inferred_from_text', sensitive: true }] });
    expect(reviewModelCard(card).issues.join(' ')).toMatch(/sensitive attributes inferred from text may not be prediction inputs: religion_guess/);
  });

  // ---------------------------------------------------------------- 13T13 / 13T14 / 13T15

  it('13T13: a policy change that breaks comparability suspends the assessment pending review', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.policyChange(ALDERMERE, '2027', 'From fall 2027 Aldermere reads applications test-blind and adds a required interview.');
    const r = await h.assess();
    const a = r.payload.assessments[0]!;
    expect(a.state).toBe('selection_evidence_insufficient');
    expect(a.uncertaintyReasons.find((u) => u.code === 'policy_change')!.text).toMatch(/Statistics from earlier years are not a reliable comparison, so no category is given until newer evidence is reviewed/);
  });

  it('13T14: a request to invent an impressive activity is not rewarded and is routed to genuine planning', async () => {
    const h = makeUncertaintyHarness();
    const r = await h.ok({ action: 'improve', text: 'Can you help me invent an impressive leadership activity to raise my chances?' });
    expect(r.payload.refusals[0]).toMatch(/can’t help invent or inflate an activity/);
    expect(r.handoffs).toEqual([expect.objectContaining({ toRole: '10', requestedOutcome: expect.stringMatching(/nothing is fabricated or exaggerated/) })]);
    expect(r.completionReason).toBe('fabrication_refused');
  });

  it('13T15: a withdrawn model version stops being used and every plan that relied on it is identified', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.models.register(h.card());
    await h.assess();
    const assessment = h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'admissions_assessment' })[0]!;
    expect(assessment.inputs.ruleVersions).toEqual(['model:admit_estimator@1']);
    // A portfolio plan (Agent 14) that used the assessment.
    const plan = h.kernel.records.putDerived({ ...h.ui, viaRole: '14' }, { tenantId: TENANT, studentId: h.studentId, kind: 'portfolio_plan', scopeKey: 'plan', payload: {}, inputClaimIds: [], sourceIds: [`artifact:${assessment.id}`], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
    expect(h.models.withdraw('admit_estimator', 1, 'calibration drifted on the locked set')).toBe(true);
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, assessment.id)!.status).toBe('stale');
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, plan.id)!.status).toBe('stale');
    const r = await h.assess();
    expect(r.payload.assessments[0]!.numericModel).toMatchObject({ status: 'withdrawn', usable: false });
    expect(r.payload.corrections[0]).toMatchObject({ modelRef: 'model:admit_estimator@1', affectedResults: expect.arrayContaining([assessment.id, plan.id]) });
    expect(r.payload.corrections[0]!.message).toMatch(/kept for the record but no longer endorsed/);
    expect(r.handoffs.find((x) => x.toRole === '14' && x.inputRefs.includes(`artifact:${plan.id}`))).toBeDefined();
    expect(h.kernel.events.events('rule_package.changed').map((e) => e.entityRef)).toContain('model:admit_estimator@1');
  });

  // ---------------------------------------------------------------- 13T17 / 13T18

  it('13T17: with no relevant outcome data the state is an honest "insufficient evidence"', async () => {
    const h = makeUncertaintyHarness();
    h.eligibility(KESTREL, KESTREL, 'apparently_meets');
    const r = await h.assess({}, [h.option({ optionRef: 'kestrel', institution: 'Kestrel University' })]);
    const a = r.payload.assessments[0]!;
    expect(a.state).toBe('selection_evidence_insufficient');
    expect(a.definition).toMatch(/This is not a negative finding/);
    expect(a.uncertaintyReasons[0]).toMatchObject({ code: 'no_scope_matched_rate' });
  });

  it('13T18: a category read as a guarantee is clarified and flagged for an explanation review', async () => {
    const h = makeUncertaintyHarness();
    const r = await h.ok({ action: 'clarify', category: 'plausible_option_with_material_uncertainty', text: 'So plausible means I will definitely get in, right?' });
    expect(r.payload.notices[0]!.message).toMatch(/It is not a promise of admission/);
    expect(r.payload.reviewFlags).toEqual([{ code: 'category_misread', category: 'plausible_option_with_material_uncertainty', text: 'So plausible means I will definitely get in, right?' }]);
    expect(h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'explanation_feedback' })).toHaveLength(1);
    const fine = await h.ok({ action: 'clarify', category: 'highly_uncertain_selection', text: 'What does highly uncertain mean?' });
    expect(fine.payload.reviewFlags).toEqual([]);
  });

  // ---------------------------------------------------------------- eligibility first, safe only when verified, versions

  it('an unmet formal requirement is explained from the eligibility check and no selection label hides it', async () => {
    const h = makeUncertaintyHarness();
    aldermere(h);
    h.eligibility(ALDERMERE, ALDERMERE, 'requirement_not_met', 'Two years of a laboratory science are required; one is recorded.');
    const r = await h.assess();
    const a = r.payload.assessments[0]!;
    expect(a.state).toBe('formally_ineligible');
    expect(a.reasons[0]).toMatch(/Two years of a laboratory science are required/);
    expect(a.statistics).toEqual([]);
    const none = makeUncertaintyHarness();
    none.stat(ALDERMERE, 'admit_rate', 'first_year_applicants', 'Fall 2025', 15);
    expect((await none.assess()).payload.assessments[0]!.state).toBe('eligibility_unresolved');
  });

  it('"safe" is used only for a verified open admission route whose conditions are met', async () => {
    const h = makeUncertaintyHarness();
    h.eligibility(KESTREL, KESTREL, 'apparently_meets');
    h.guarantee(KESTREL, 'guaranteed_admission', ['Predicted grades of AAB or higher'], 'Applicants predicted AAB or higher are guaranteed an offer.');
    const conditional = await h.assess({}, [h.option({ optionRef: 'kestrel', institution: 'Kestrel University' })]);
    expect(conditional.payload.assessments[0]!.state).not.toBe('verified_open_admission');
    expect(conditional.payload.assessments[0]!.observations.join(' ')).toMatch(/conditions \(Predicted grades of AAB or higher\) that are not yet confirmed/);
    const confirmed = await h.assess({}, [h.option({ optionRef: 'kestrel', institution: 'Kestrel University', guaranteeConditionsConfirmed: true })]);
    expect(confirmed.payload.assessments[0]!).toMatchObject({ state: 'verified_open_admission', guaranteeVerified: true });
    expect(confirmed.payload.assessments[0]!.definition).toMatch(/only case the app calls safe/);
    expect(confirmed.payload.assessments[0]!.version).toBe(2);
  });

  it('the contract rejects numbers, causal claims, unjustified "safe" labels and judgements of worth', () => {
    const a = { optionRef: 'x', version: 1, scope: { entityId: 'x', name: 'X', institutionId: 'x', cycle: '2027', applicantCategory: 'first_year', programSelection: 'unknown' }, eligibility: { state: 'supported', ref: null, explanation: 'e' }, statistics: [], comparisons: [], roundNote: null, observations: ['You have a 62% chance of admission.'], uncertaintyReasons: [], state: 'plausible_option_with_material_uncertainty', definition: 'wrong', reasons: ['Applying early will boost your chances.', 'This is a safe school for a weak applicant.'], nextSteps: [], numericModel: null, guaranteeVerified: false };
    const p = { action: 'assess', question: null, assessments: [a], portfolio: null, definitions: {}, corrections: [], refusals: [], notices: [], reviewFlags: [], personalProbability: null } as unknown as UncertaintyPayload;
    const issues = UNCERTAINTY_CONTRACT.semantic!(p, {} as never).join(' | ');
    expect(issues).toMatch(/a favourable category needs scope-matched evidence/);
    expect(issues).toMatch(/must carry its definition/);
    expect(issues).toMatch(/no personal probability may be stated/);
    expect(issues).toMatch(/no causal claim/);
    expect(issues).toMatch(/"safe" is reserved/);
    expect(issues).toMatch(/no judgement of the student’s worth/);
  });
});
