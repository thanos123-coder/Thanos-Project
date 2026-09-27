import { describe, expect, it } from 'vitest';
import type { ExperimentTemplate } from '../../src/agents/a05-goals/knowledge.js';
import { BUILTIN_EXPERIMENTS } from '../../src/agents/a05-goals/content.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import { ScriptedModelGateway } from '../../src/model/scripted.js';
import type { Actor } from '../../src/shared/permissions.js';
import { LABOR_SOURCE, makeGoalsHarness } from '../helpers/goals.js';
import { extracted, said, stated } from '../helpers/kernel.js';

type H = ReturnType<typeof makeGoalsHarness>;

let n = 0;
const interest = (actor: Actor, text: string) => buildClaim({ entity: 'interest', entityId: `i${++n}`, attribute: 'description', value: { text, lens: 'interest' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(text)], actor, viaRole: 'ui' });
const parentsWant = (actor: Actor, text: string) => buildClaim({ entity: 'preference', entityId: `p${++n}`, attribute: 'statement', value: { text, topic: 'major', normalized: [] }, origin: 'student_statement', confirmation: 'student_confirmed', holder: { kind: 'reported_other', label: 'parents' }, evidence: [said(text)], actor, viaRole: 'ui' });
const ownPreference = (actor: Actor, text: string) => buildClaim({ entity: 'preference', entityId: `p${++n}`, attribute: 'statement', value: { text, topic: 'learning_conditions', normalized: [] }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(text)], actor, viaRole: 'ui' });

function keysOf(h: Awaited<ReturnType<H['ok']>>): string[] {
  return h.payload.hypotheses.map((x) => x.subjectKeys.join('+'));
}

describe('Agent 05 goals and major exploration advisor', () => {
  it('05T01 an undecided early student gets exploration without being pushed to a major', async () => {
    const h = makeGoalsHarness();
    h.seed([stated(h.student, 'goals.decision_horizon', 'broad_exploration'), stated(h.student, 'education.stage', 'secondary')]);
    const r = await h.ok({ action: 'goal_map' });
    expect(r.payload.hypotheses).toHaveLength(0);
    expect(r.payload.goalState).toBe('exploring');
    expect(r.payload.notices.find((x) => x.code === 'no_rush')?.message).toMatch(/no need to choose a major now/);
    expect(r.payload.experiments.length).toBeGreaterThan(0);
    expect(r.payload.questions[0]!.text).toMatch(/which part of it you enjoyed/);
    expect(r.status).toBe('needs_student_input');
  });

  it('05T02 a parent’s preferred profession stays attributed; the student’s interest stays theirs', async () => {
    const h = makeGoalsHarness();
    h.seed([interest(h.student, 'I love drawing and graphic design'), parentsWant(h.student, 'my parents want me to study medicine')]);
    const r = await h.ok({ action: 'goal_map' });
    expect(keysOf(r)).toContain('visual_communication_design');
    expect(keysOf(r)).not.toContain('medicine');
    expect(r.payload.attributedViews).toEqual([expect.objectContaining({ holderLabel: 'parents', text: 'my parents want me to study medicine' })]);
    expect(r.payload.notices.some((x) => x.code === 'attributed_views')).toBe(true);
  });

  it('05T03 a low grade after limited teaching is not treated as a ceiling', async () => {
    const withGrade = makeGoalsHarness();
    const seedCommon = (h: H) => h.seed([interest(h.student, 'I enjoy solving maths puzzles')]);
    seedCommon(withGrade);
    withGrade.seed([
      extracted(withGrade.student, 'course', 'c1', 'name_original', 'Mathematics', 'Mathematics'),
      extracted(withGrade.student, 'course', 'c1', 'subject_mapping', { key: 'mathematics', basis: 'broad_taxonomy' }, 'Mathematics'),
      extracted(withGrade.student, 'course', 'c1', 'grade', { original: '3', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null }, '3'),
      extracted(withGrade.student, 'school_context', 'sc1', 'note', { topic: 'staffing', text: 'No mathematics teacher for half of the year' }, 'No mathematics teacher for half of the year'),
    ]);
    const without = makeGoalsHarness();
    seedCommon(without);
    const a = await withGrade.ok({ action: 'goal_map' });
    const b = await without.ok({ action: 'goal_map' });
    expect(keysOf(a)).toEqual(keysOf(b));
    expect(keysOf(a)).toContain('mathematics');
    const math = a.payload.hypotheses.find((x) => x.subjectKeys.includes('mathematics'))!;
    expect(math.preparation).toMatch(/not a limit on what you can develop/);
    expect(JSON.stringify(a.payload)).not.toMatch(/not suited|lack(s)? (the )?ability|not good enough/i);
  });

  it('05T04 enjoying one task in an activity is explored as that task, not the whole field', async () => {
    const h = makeGoalsHarness();
    const t = h.say('I liked debugging the program but hated designing the interface');
    const r = await h.ok({ action: 'record_reflection', turnId: t.turnId, about: 'exp_debugging' });
    const cs = r.payload.hypotheses.find((x) => x.subjectKeys.includes('computer_science'))!;
    expect(cs.statement).toMatch(/You enjoyed debugging the program/);
    expect(cs.taskFocus).toEqual(['debugging the program']);
    expect(cs.statement).not.toMatch(/you are|is right for you|your calling/i);
    expect(r.payload.experiments[0]!.experimentId).toBe('exp_debugging');
  });

  it('05T05 a modified questionnaire is never presented as the validated instrument', async () => {
    const h = makeGoalsHarness();
    const t = h.say('Here are my results');
    const r = await h.ok({ action: 'record_assessment', turnId: t.turnId, instrument: { name: 'Example Interest Profiler', version: '2.0', language: 'el', administeredOn: '2026-09-20', scoringMethod: 'sum of item ratings', form: 'modified_from_published', licensed: true, languageValidated: false, consentContext: 'student chose to take it' }, results: [{ scale: 'Investigative', value: 31 }, { scale: 'Artistic', value: 28 }] });
    expect(r.payload.notices[0]).toMatchObject({ code: 'assessment_not_validated' });
    expect(r.payload.notices[0]!.message).toMatch(/not as the validated Example Interest Profiler/);
    const stored = h.record().fields.find((f) => f.field.entity === 'assessment')!;
    expect((stored.current?.value as { validationStatus: string }).validationStatus).toBe('modified_not_validated');
    expect(JSON.stringify(r.payload)).not.toMatch(/\d+ ?% (suited|match)/i);
  });

  it('05T06 a salary guarantee request gets scoped data and no certainty', async () => {
    const h = makeGoalsHarness({
      registry: (reg) => {
        reg.addSource(LABOR_SOURCE);
        reg.addLaborRecord({ id: 'lab1', occupationKey: 'software_developer', occupationDefinition: 'Software developers (synthetic definition)', geography: 'US', dataYear: 2025, measure: 'median_annual_wage', value: { amount: '100000.00', currency: 'USD' }, sourceId: LABOR_SOURCE.id });
      },
    });
    h.seed([stated(h.student, 'application.destination_countries', ['GR'])]);
    const r = await h.ok({ action: 'explain_option', subjectKey: 'computer_science', topic: 'earnings', question: 'Can you guarantee I will earn a lot if I study this?' });
    const e = r.payload.explanation!;
    expect(e.earnings).toEqual([expect.objectContaining({ geography: 'US', dataYear: 2025, measure: 'median annual wage', value: '$100,000', sourceId: LABOR_SOURCE.id })]);
    expect(e.earningsNotes.join(' ')).toMatch(/No one can guarantee a salary/);
    expect(e.earningsNotes.join(' ')).toMatch(/not a starting salary and not a prediction for you/);
    expect(e.earningsNotes.join(' ')).toMatch(/may not apply to Greece/);
    expect(r.sourceRefs).toEqual([LABOR_SOURCE.id]);
    // Without verified data, no number is offered.
    const none = await h.ok({ action: 'explain_option', subjectKey: 'history', topic: 'earnings' });
    expect(none.status).toBe('needs_source');
    expect(none.payload.explanation!.earnings).toHaveLength(0);
  });

  it('05T07 a field mapped to several occupations does not imply qualification for each', async () => {
    const h = makeGoalsHarness();
    const r = await h.ok({ action: 'explain_option', subjectKey: 'biology', topic: 'occupations' });
    const e = r.payload.explanation!;
    expect(e.occupations.length).toBeGreaterThan(2);
    expect(e.occupationNote).toMatch(/does not by itself qualify you for every role/);
    expect(e.occupations.find((o) => o.label === 'Science teacher')!.additionalRequirements[0]).toMatch(/teaching qualification/);
  });

  it('05T08 profiles that differ only in a demographic cue get the same suggestions', async () => {
    const run = async (name: string) => {
      const model = new ScriptedModelGateway().always('goals.discriminating_questions', { questions: [] });
      const h = makeGoalsHarness({ model });
      h.seed([stated(h.student, 'identity.preferred_name', name), interest(h.student, 'I like building robots'), interest(h.student, 'I enjoy biology class')]);
      const r = await h.ok({ action: 'goal_map', record: false });
      return { r, prompts: model.allPromptText() };
    };
    const a = await run('Maria');
    const b = await run('Nikos');
    const strip = (x: typeof a.r) => ({ h: x.payload.hypotheses.map((y) => [y.subjectKeys, y.statement, y.support]), e: x.payload.experiments.map((y) => y.experimentId) });
    expect(strip(a.r)).toEqual(strip(b.r));
    expect(a.prompts).not.toMatch(/Maria/);
    expect(b.prompts).not.toMatch(/Nikos/);
  });

  it('05T09 without a budget for paid exploration, only free options are suggested', async () => {
    const paid: ExperimentTemplate = { ...BUILTIN_EXPERIMENTS.find((e) => e.id === 'exp_debugging')!, id: 'exp_paid_bootcamp', cost: { kind: 'paid', amount: { amount: '300.00', currency: 'EUR' } }, taskFocus: ['debugging'] };
    const h = makeGoalsHarness({ registry: (reg) => reg.addExperiment(paid) });
    h.seed([interest(h.student, 'I like coding and building things'), stated(h.student, 'constraints.opportunity_budget', { amount: { amount: '0.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all', appliesTo: 'per_opportunity' })]);
    const r = await h.ok({ action: 'goal_map', record: false });
    expect(r.payload.experiments.length).toBeGreaterThan(0);
    expect(r.payload.experiments.every((e) => e.cost === 'free')).toBe(true);
    expect(r.payload.experiments.some((e) => e.experimentId === 'exp_paid_bootcamp')).toBe(false);
  });

  it('05T10 disliking a suggested experiment updates the hypothesis without judging motivation', async () => {
    const h = makeGoalsHarness();
    h.seed([interest(h.student, 'I think coding might be fun')]);
    const before = await h.ok({ action: 'goal_map' });
    expect(before.payload.hypotheses.find((x) => x.subjectKeys.includes('computer_science'))!.support).toBe('emerging');
    const t = h.say("I didn't enjoy the debugging at all, it was frustrating");
    const r = await h.ok({ action: 'record_reflection', turnId: t.turnId, about: 'computer_science' });
    const cs = r.payload.hypotheses.find((x) => x.subjectKeys.includes('computer_science'))!;
    expect(cs.support).toBe('less_supported');
    expect(r.payload.hypothesisUpdates).toContainEqual(expect.objectContaining({ hypothesisId: 'hyp_computer_science', before: 'emerging', after: 'less_supported' }));
    expect(r.payload.notices.map((x) => x.message).join(' ')).toMatch(/useful information/);
    expect(JSON.stringify(r.payload)).not.toMatch(/unmotivated|lazy|try harder|lack of effort/i);
  });

  it('05T11 a professional route that differs by country is flagged for verification', async () => {
    const h = makeGoalsHarness({
      registry: (reg) => {
        reg.addSource({ ...LABOR_SOURCE, id: 'src_route_gb', canonicalUrl: 'https://example.org/regulator/gb', title: 'Regulator route page (synthetic)', scope: { geography: 'GB' } });
        reg.addRouteNote({ id: 'route_gb', subjectKey: 'medicine', profession: 'doctor', country: 'GB', summary: 'Synthetic fixture: route summary from the regulator.', sourceId: 'src_route_gb' });
      },
    });
    h.seed([stated(h.student, 'application.destination_countries', ['GB', 'US'])]);
    const r = await h.ok({ action: 'explain_option', subjectKey: 'medicine', topic: 'routes' });
    expect(r.payload.explanation!.routes).toEqual([expect.objectContaining({ country: 'GB', profession: 'doctor' })]);
    expect(r.payload.explanation!.routesNeedingVerification).toEqual([{ country: 'US', profession: 'doctor' }]);
    expect(r.handoffs.some((x) => x.toRole === '11' && /US/.test(x.requestedOutcome))).toBe(true);
    expect(r.uncertainties.some((u) => u.affects === 'route:medicine:US')).toBe(true);
    expect(JSON.stringify(r.payload)).not.toMatch(/qualifies you to practi[cs]e|will qualify you/i);
  });

  it('05T12 a rejected interpretation is removed without argument and not proposed again', async () => {
    const h = makeGoalsHarness();
    h.seed([interest(h.student, 'I like drawing'), interest(h.student, 'I enjoy biology')]);
    const r1 = await h.ok({ action: 'goal_map' });
    const visual = r1.payload.hypotheses.find((x) => x.subjectKeys.includes('visual_communication_design'))!;
    expect(visual.existingEntityId).toBeTruthy();
    const t = h.say('No, that is not me at all');
    const r2 = await h.ok({ action: 'respond_to_hypothesis', hypothesisId: visual.existingEntityId!, response: 'rejected', turnId: t.turnId });
    expect(r2.payload.notices[0]!.message).toMatch(/^Removed\./);
    expect(keysOf(r2)).not.toContain('visual_communication_design');
    const r3 = await h.ok({ action: 'goal_map' });
    expect(keysOf(r3)).not.toContain('visual_communication_design');
    expect(JSON.stringify(r2.payload)).not.toMatch(/are you sure|reconsider|but you said/i);
  });

  it('05T13 sponsorship never changes which experiments are suggested or their order', async () => {
    const seedBoth = (h: H) => h.seed([interest(h.student, 'I like coding'), interest(h.student, 'I like physics')]);
    const plain = makeGoalsHarness();
    seedBoth(plain);
    const a = await plain.ok({ action: 'goal_map', record: false });
    const order = a.payload.experiments.map((e) => e.experimentId);
    expect(order.length).toBeGreaterThan(1);
    // Sponsor everything except the first choice, including templates that were not picked at all.
    const sponsoredCopy = (e: ExperimentTemplate): ExperimentTemplate => ({ ...e, sponsorship: { sponsor: 'Example Coding Academy', paidReferral: true } });
    const sponsored = makeGoalsHarness({ registry: (reg) => BUILTIN_EXPERIMENTS.filter((e) => e.id !== order[0]).forEach((e) => reg.addExperiment(sponsoredCopy(e))) });
    seedBoth(sponsored);
    const b = await sponsored.ok({ action: 'goal_map', record: false });
    expect(b.payload.experiments.map((e) => e.experimentId)).toEqual(order);
    expect(b.payload.hypotheses.map((x) => x.subjectKeys)).toEqual(a.payload.hypotheses.map((x) => x.subjectKeys));
    const disclosed = b.payload.experiments.find((e) => e.sponsorDisclosure);
    expect(disclosed?.sponsorDisclosure).toMatch(/pays for referrals, which did not affect this suggestion/);
  });

  it('05T14 an experiment that needs outside contact is prepared, never sent', async () => {
    const h = makeGoalsHarness();
    const r = await h.ok({ action: 'prepare_contact', experimentId: 'exp_informational_conversation', contactDescription: 'a nurse my aunt knows' });
    expect(r.externalActions).toHaveLength(1);
    expect(r.externalActions[0]).toMatchObject({ kind: 'send_message', authorizationState: 'proposed' });
    expect(r.externalActions[0]!.exactContent).toMatch(/What does a typical week look like/);
    expect(r.payload.experiments[0]!.externalContact).toEqual(expect.objectContaining({ needed: true, sent: false }));
    expect(r.payload.notices[0]!.message).toMatch(/Nothing has been sent/);
    expect(h.kernel.actions.list(h.studentId).every((a) => a.state === 'proposed')).toBe(true);
  });

  it('05T15 a near-term subject decision separates reversible from less reversible parts', async () => {
    const h = makeGoalsHarness();
    const r = await h.ok({ action: 'decision_aid', subjectKeys: ['biology', 'visual_communication_design'], decisionKind: 'school_course_choice', deadline: '2026-10-15' });
    const d = r.payload.decisionAid!;
    expect(d.daysUntilDeadline).toBe(18);
    expect(d.recommendedOption).toBeNull();
    expect(d.options.find((o) => o.key === 'biology')!.lessReversible[0]).toMatch(/Dropping biology or chemistry or mathematics now/);
    expect(d.keepOptionsOpen[0]).toMatch(/keeping biology, chemistry, mathematics, visual arts/);
    expect(r.handoffs.some((x) => x.toRole === '06')).toBe(true);
    expect(r.payload.notices[0]!.message).toMatch(/You make this choice/);
  });

  it('05T16 a changed interest after a new experience is recorded as a revisable update with evidence', async () => {
    const h = makeGoalsHarness();
    h.seed([interest(h.student, 'I enjoy biology')]);
    const r1 = await h.ok({ action: 'goal_map' });
    expect(keysOf(r1)).toContain('biology');
    const t = h.say('I enjoyed the explaining and drawing much more than the biology part');
    const r2 = await h.ok({ action: 'record_reflection', turnId: t.turnId, about: 'exp_visual_explanation' });
    const reflectionClaim = r2.payload.recorded.find((x) => x.fieldKey.startsWith('reflection:'))!.claimId;
    const added = r2.payload.hypothesisUpdates.filter((u) => u.before === null);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((u) => u.evidenceAdded === reflectionClaim)).toBe(true);
    expect(keysOf(r2)).toEqual(expect.arrayContaining(['biology', 'science_communication']));
    const stored = h.record().fields.find((f) => f.fieldKey === 'hypothesis:hypothesis_science_communication.statement')!;
    expect((stored.current?.value as { evidenceClaimIds: string[] }).evidenceClaimIds).toContain(reflectionClaim);
    expect(stored.current?.origin).toBe('model_interpretation');
  });

  it('compares options on student-relevant dimensions, unpacks reputation, and labels weighted totals', async () => {
    const h = makeGoalsHarness();
    h.seed([interest(h.student, 'I enjoy biology'), ownPreference(h.student, 'I like hands-on work in a team')]);
    const r = await h.ok({ action: 'compare_options', subjectKeys: ['biology', 'architecture'], dimensions: [{ key: 'subject_interest', label: 'Interest', weight: 3 }, { key: 'preferred_methods', label: 'How I like to work', weight: 2 }, { key: 'reputation', label: 'Reputation', weight: 1 }] });
    const c = r.payload.comparison!;
    expect(c.cells.find((x) => x.optionKey === 'biology' && x.dimensionKey === 'preferred_methods')!.rating).toBe('strong');
    expect(c.reputationNote).toMatch(/what you mean by it/);
    expect(c.totalsNote).toMatch(/not an objective answer/);
    expect(c.hardConstraints).toContainEqual({ optionKey: 'architecture', issue: expect.stringMatching(/portfolio/) });
    expect(c.totals!.find((t) => t.optionKey === 'biology')!.weightedTotal).toBeGreaterThan(0);
  });

  it('rejects model follow-up questions that label personality or ask private details', async () => {
    const model = new ScriptedModelGateway().always('goals.discriminating_questions', {
      questions: [
        { text: 'You are a natural creative person, right?', hypothesisIds: ['hyp_visual_communication_design'] },
        { text: 'What is your family income?', hypothesisIds: [] },
      ],
    });
    const h = makeGoalsHarness({ model });
    h.seed([interest(h.student, 'I like drawing'), interest(h.student, 'I like physics')]);
    const r = await h.ok({ action: 'goal_map', record: false });
    expect(r.payload.questions.map((q) => q.text).join(' ')).not.toMatch(/natural creative|income/);
    expect(r.payload.questions.length).toBeGreaterThan(0);
  });
});
