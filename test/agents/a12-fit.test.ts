import { describe, expect, it } from 'vitest';
import { FIT_CONTRACT, type FitPayload } from '../../src/agents/a12-fit/agent.js';
import { normalizePriorities, order, scoreCandidate, type Candidate, type Priority } from '../../src/agents/a12-fit/fit.js';
import { RecordView } from '../../src/agents/a04-record-steward/view-reader.js';
import { TENANT } from '../helpers/kernel.js';
import { A, B, C, makeFitHarness } from '../helpers/fit.js';

function workedHarness() {
  const h = makeFitHarness();
  h.worked();
  h.affordability(A, 'conditional', ['Affordable only if the Coralwood Merit Scholarship, which is not yet awarded, is won.']);
  h.affordability(B, 'supported');
  h.affordability(C, 'supported');
  h.priority({ dimension: 'academic_interest', statement: 'I want to study marine biology', value: ['marine_biology'], weight: 5 });
  h.priority({ dimension: 'max_annual_cost', statement: 'It has to fit what my family can pay', weight: 4 });
  h.priority({ dimension: 'location_countries', statement: 'I would rather not be too far from home in the US', value: ['US'], weight: 3 });
  return h;
}

describe('Agent 12 — College and program fit matcher', () => {
  it('worked comparison: A is funding conditional, B program-access conditional, C a practical tradeoff; no single match percentage', async () => {
    const h = workedHarness();
    const r = await h.match();
    const a = h.card(r, A)!;
    const b = h.card(r, B)!;
    const c = h.card(r, C)!;
    expect(a.affordability).toBe('conditional');
    expect(a.conditions[0]).toMatch(/^Funding conditional: Affordable only if the Coralwood Merit Scholarship/);
    expect(b.programAccess).toEqual({ route: 'later_competitive_selection', condition: expect.stringMatching(/does not guarantee the subject/) });
    expect(b.conditions).toContain('Entry to the subject is a later competitive selection after admission.');
    expect(c.dimensions.find((d) => d.dimension === 'location_countries')).toMatchObject({ match: 'weak' });
    expect(c.drawback).toMatch(/Located in CA/);
    for (const card of [a, b, c]) {
      expect(card.state).toBe('feasible');
      expect(card.reasons.length).toBeLessThanOrEqual(2);
      expect(card.score).toEqual({ min: expect.any(Number), max: expect.any(Number), possible: 24 });
    }
    expect(r.payload.admissionProbability).toBeNull();
    expect(JSON.stringify(r.payload)).not.toMatch(/\d+\s?% (match|fit)/i);
    expect(h.rankOf(r)).toEqual([B, A, C]);
    // An unrelated program is not part of a marine-biology list, and nothing is ranked by fame.
    expect(h.card(r, 'quillon_history')).toBeUndefined();
  });

  it('worked comparison: making direct access non-negotiable moves B out of the active list, with its reason kept', async () => {
    const h = workedHarness();
    h.priority({ dimension: 'direct_program_access', kind: 'hard_constraint', statement: 'I must be admitted directly to marine biology', value: true, weight: null });
    const r = await h.match();
    expect(h.rankOf(r)).not.toContain(B);
    expect(h.card(r, B)).toMatchObject({ state: 'excluded', rank: null });
    expect(h.card(r, B)!.drawback).toMatch(/^Fails your non-negotiable “I must be admitted directly to marine biology”: Entry to the subject is a later competitive selection/);
    // A and C have no verified access claim of their own, but their programs are registered as direct entry.
    expect(h.card(r, A)!.hardConstraints[0]!.result).toBe('pass');
  });

  // ---------------------------------------------------------------- 12T01 / 12T02 / 12T03

  it('12T01: an undecided student sees options for both fields and questions, not a career identity', async () => {
    const h = makeFitHarness();
    h.worked();
    h.priority({ dimension: 'academic_interest', statement: 'I am torn between marine biology and history', value: ['marine_biology', 'history'], weight: 4 });
    const r = await h.match();
    expect(h.rankOf(r)).toEqual(expect.arrayContaining([A, B, C, 'quillon_history']));
    expect(r.payload.notices.find((n) => n.code === 'undecided')!.message).toMatch(/Nothing here decides a future career/);
    expect(r.payload.questions.find((q) => q.code === 'interests')!.question).toMatch(/What draws you to marine biology and to history/);
    expect(JSON.stringify(r.payload)).not.toMatch(/you are (a|an) \w+ person|career identity|personality/i);
    expect(h.card(r, A)!.dimensions[0]).toMatchObject({ match: 'mixed', why: 'Offers marine biology.' });
  });

  it('12T02: a preferred school that fails a confirmed hard constraint is shown with the failure and kept out of the feasible set', async () => {
    const h = workedHarness();
    h.priority({ dimension: 'location_countries', kind: 'hard_constraint', statement: 'I can only study in the US', value: ['US'], weight: null });
    const r = await h.match();
    expect(h.rankOf(r)).toEqual([B, A]);
    const c = h.card(r, C)!;
    expect(c.state).toBe('excluded');
    expect(c.hardConstraints).toEqual([{ dimension: 'location_countries', statement: 'I can only study in the US', result: 'fail', why: 'Located in CA.' }]);
  });

  it('12T03: an unknown requirement keeps the option in exploration instead of passing it', async () => {
    const h = workedHarness();
    h.priority({ dimension: 'housing_guarantee', kind: 'hard_constraint', statement: 'I need guaranteed housing', value: true, weight: null });
    h.attribute(B, 'housing_guarantee', true, 'All first-year students are guaranteed campus housing.');
    const r = await h.match();
    expect(h.rankOf(r)).toEqual([B]);
    for (const ref of [A, C]) {
      expect(h.card(r, ref)).toMatchObject({ state: 'exploration', rank: null });
      expect(h.card(r, ref)!.hardConstraints[0]!.result).toBe('unknown');
    }
    expect(r.payload.research.filter((x) => x.dimension === 'housing_guarantee').map((x) => x.optionRef).sort()).toEqual([A, C]);
    expect(r.handoffs.find((x) => x.toRole === '11')!.requestedOutcome).toMatch(/housing_guarantee/);
    expect(r.status).toBe('partial');
  });

  // ---------------------------------------------------------------- 12T04 / 12T05 / 12T06

  it('12T04: changing a weight recomputes the comparison and explains the change by that weight', async () => {
    const h = workedHarness();
    const first = await h.match();
    expect(h.rankOf(first)).toEqual([B, A, C]);
    // Travel home matters less now.
    h.priority({ dimension: 'location_countries', statement: 'Distance matters less to me now', value: ['US'], weight: 0 });
    h.priority({ dimension: 'subject_flexibility', statement: 'I would like room to explore', value: 'high', weight: 3 });
    const second = await h.match();
    expect(second.payload.version).toBe(2);
    expect(h.rankOf(second)[0]).toBe(C);
    const cChange = second.payload.changes.find((x) => x.optionRef === C)!;
    expect(cChange).toMatchObject({ beforeRank: 3, afterRank: 1 });
    expect(cChange.because).toEqual(expect.arrayContaining(['you changed the weight on location from 3 to 0', 'you changed the weight on flexibility across subjects from none to 3']));
    expect(JSON.stringify(second.payload.changes)).not.toMatch(/personality|deeper/i);
  });

  it('12T05: when small weight changes reverse the order, the ranking is shown as sensitive', async () => {
    const h = makeFitHarness();
    h.worked();
    h.affordability(A, 'supported');
    h.affordability(B, 'conditional', ['Depends on an outside scholarship not yet awarded.']);
    h.affordability(C, 'supported');
    h.priority({ dimension: 'academic_interest', statement: 'marine biology', value: ['marine_biology'], weight: 3 });
    h.priority({ dimension: 'max_annual_cost', statement: 'affordable', weight: 3 });
    h.priority({ dimension: 'location_countries', statement: 'US', value: ['US'], weight: 3 });
    h.priority({ dimension: 'subject_flexibility', statement: 'flexible', value: 'high', weight: 3 });
    const r = await h.match();
    expect(r.payload.cards.map((c) => c.score!.min)).toEqual([18, 18, 18]);
    expect(r.payload.sensitivity).toMatchObject({ fragile: true, close: true });
    expect(r.payload.sensitivity!.notes[0]).toMatch(/^Changing the weight on .* changes the leading options from/);
    expect(r.payload.notices.find((n) => n.code === 'close_ranking')!.message).toMatch(/not a verdict/);
  });

  it('12T06: a commercial relationship never changes the organic ranking; sponsored content is kept apart and labeled', async () => {
    const plain = workedHarness();
    const base = await plain.match();
    const h = workedHarness();
    const r = await h.match({ commercial: { [C]: { partner: true, sponsored: false }, quillon_history: { partner: false, sponsored: true } } });
    expect(h.rankOf(r)).toEqual(h.rankOf(base));
    expect(h.card(r, C)!.score).toEqual(plain.card(base, C)!.score);
    expect(h.card(r, C)!.disclosure).toMatch(/does not affect the order/);
    // A sponsored listing never enters the organic list, even when it is otherwise irrelevant.
    const s = await h.match({ commercial: { [A]: { partner: false, sponsored: true } } });
    expect(h.rankOf(s)).not.toContain(A);
    expect(s.payload.sponsored).toEqual([{ optionRef: A, name: 'Marine Biology at Coralwood University', label: 'sponsored' }]);
  });

  // ---------------------------------------------------------------- 12T07 / 12T08 / 12T09 / 12T10

  it('12T07: later competitive access to the subject is displayed beside the recommendation', async () => {
    const h = workedHarness();
    const r = await h.match();
    const b = h.card(r, B)!;
    expect(b.rank).toBe(1);
    expect(b.programAccess!.condition).toBe('Admission to the university does not guarantee the subject: students apply to it later, competitively.');
    expect(b.drawback).toBe('Entry to the subject is a later competitive selection after admission.');
  });

  it('12T08: an option affordable only with an unawarded scholarship stays funding conditional', async () => {
    const h = workedHarness();
    const r = await h.match();
    const a = h.card(r, A)!;
    expect(a.affordability).toBe('conditional');
    expect(a.dimensions.find((d) => d.dimension === 'max_annual_cost')).toMatchObject({ match: 'mixed', why: expect.stringMatching(/^Affordable only if: Affordable only if the Coralwood Merit Scholarship/) });
    // A stale affordability result is not reused as if it were current.
    h.affordability(A, 'conditional', ['x']);
    const artifacts = h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'affordability_scenario' });
    expect(artifacts.filter((x) => x.scopeKey === A && x.status === 'current')).toHaveLength(1);
  });

  it('12T09: parent and student preferences that differ are both kept, and the student is asked to decide', async () => {
    const h = workedHarness();
    h.grantParent();
    h.priority({ dimension: 'location_countries', kind: 'hard_constraint', statement: 'We want you to stay in the US', value: ['US'], weight: null }, h.parent);
    h.priority({ dimension: 'setting', statement: 'A big city would be good for you', value: 'urban', weight: 5 }, h.parent);
    const r = await h.match();
    // The student's priorities rule the list: C is still feasible.
    expect(h.card(r, C)!.state).toBe('feasible');
    expect(r.payload.preferenceConflicts).toEqual([
      { dimension: 'location_countries', student: 'I would rather not be too far from home in the US', supporter: 'We want you to stay in the US', question: expect.stringMatching(/Which should the list follow\? It follows yours until you decide/) },
      { dimension: 'setting', student: null, supporter: 'A big city would be good for you', question: expect.stringMatching(/not applied unless you say so/) },
    ]);
    expect(r.payload.weights).not.toHaveProperty('setting');
  });

  it('12T10: a functional support need is researched in the student’s words, without asking for a diagnosis', async () => {
    const h = workedHarness();
    h.priority({ dimension: 'support_service', statement: 'I need a quiet room and extra time for exams', value: 'quiet room and extra time for exams', weight: 4 });
    h.attribute(C, 'support_service', ['Extended exam time', 'Quiet testing rooms through the Learning Access Office'], 'The Learning Access Office arranges extended exam time and quiet testing rooms.');
    const r = await h.match();
    expect(h.card(r, C)!.dimensions.find((d) => d.dimension === 'support_service')).toMatchObject({ match: 'mixed', why: expect.stringMatching(/confirm directly/) });
    for (const ref of [A, B]) {
      const d = h.card(r, ref)!.dimensions.find((x) => x.dimension === 'support_service')!;
      expect(d.match).toBe('unknown');
      expect(d.why).toMatch(/needs a direct question to the institution, in your own words/);
      expect(h.card(r, ref)!.state).toBe('feasible');
    }
    expect(r.payload.notices.find((n) => n.code === 'support_need')!.message).toMatch(/No diagnosis or documentation is needed/);
    expect(JSON.stringify(r.payload.questions)).not.toMatch(/diagnos/i);
  });

  // ---------------------------------------------------------------- 12T11 / 12T12 / 12T13 / 12T14

  it('12T11: when every candidate fails, the gap is reported with explicit alternatives and nothing is relaxed', async () => {
    const h = workedHarness();
    h.priority({ dimension: 'location_countries', kind: 'hard_constraint', statement: 'Only in the UK', value: ['GB'], weight: null });
    const r = await h.match();
    expect(r.payload.cards).toEqual([]);
    expect(r.payload.gap!.constraints).toEqual([{ statement: 'Only in the UK', source: 'your_choice', excluded: 3 }]);
    expect(r.payload.gap!.alternatives).toEqual(['Look at a wider set of locations.']);
    expect(r.payload.notices.find((n) => n.code === 'no_feasible')!.message).toMatch(/Nothing has been relaxed/);
    expect(r.completionReason).toBe('no_feasible_option');
  });

  it('12T12: a student-supplied unfamiliar institution is held to the same evidence requirements', async () => {
    const h = workedHarness();
    const r = await h.match({ candidates: [{ institution: 'Harbourlight Institute', program: 'Ocean Science' }, { institution: 'Tidewater College', program: 'Liberal Arts and Sciences', suppliedBy: 'counselor' }] });
    const x = h.card(r, 'harbourlight_institute')!;
    expect(x).toMatchObject({ state: 'exploration', suppliedBy: 'student', unit: { entityId: null } });
    expect(x.dimensions.every((d) => d.match === 'unknown')).toBe(true);
    expect(r.payload.research).toEqual(expect.arrayContaining([{ optionRef: 'harbourlight_institute', dimension: 'catalog', why: expect.stringMatching(/same evidence as every other option/) }]));
    // A counselor's suggestion is scored exactly as the catalog scores it: no bonus, no penalty.
    const plain = await workedHarness().match();
    expect(h.card(r, C)!.suppliedBy).toBe('counselor');
    expect(h.card(r, C)!.score).toEqual(plain.payload.cards.find((c) => c.optionRef === C)!.score);
  });

  it('12T13: prestige proxies that measure one thing are merged into one bounded weight', async () => {
    const h = workedHarness();
    h.priority({ dimension: 'ranking', statement: 'Top-ranked schools', weight: 5 });
    h.priority({ dimension: 'selectivity', statement: 'Hard to get into', weight: 5 });
    const r = await h.match();
    expect(r.payload.weights).toMatchObject({ reputation: 2 });
    expect(r.payload.weights).not.toHaveProperty('ranking');
    expect(r.payload.weights).not.toHaveProperty('selectivity');
    expect(r.payload.notices.find((n) => n.code === 'prestige_merged')!.message).toMatch(/ranking, selectivity all measure reputation; they count once, with a weight of at most 2/);
    const merged = normalizePriorities([{ dimension: 'ranking' as never, kind: 'preference', statement: 'a', value: null, weight: 5, provisional: false, holder: 'student', claimId: 'x' }, { dimension: 'famous_alumni' as never, kind: 'preference', statement: 'b', value: null, weight: 4, provisional: false, holder: 'student', claimId: 'y' }]);
    expect(merged.priorities).toEqual([expect.objectContaining({ dimension: 'reputation', weight: 2 })]);
  });

  it('12T14: missing evidence that could change the order is shown and targeted research is proposed', async () => {
    const h = workedHarness();
    h.priority({ dimension: 'undergraduate_research', statement: 'I want to do research early', value: true, weight: 5 });
    h.attribute(B, 'undergraduate_research', true, 'First-year students can join faculty research labs.');
    const r = await h.match();
    // B: 10 + 8 + 6 + 10 = 34. A: 10 + 4 + 6 = 20 (up to 30). C: 10 + 8 + 0 = 18 (up to 28).
    expect(r.payload.cards.map((c) => [c.optionRef, c.score!.min, c.score!.max])).toEqual([[B, 34, 34], [A, 20, 30], [C, 18, 28]]);
    for (const o of r.payload.cards.slice(1)) expect(o.openQuestion).toMatch(/Whether it offers undergraduate research is not verified/);
    // A cannot overtake B whatever the answer; C could overtake A, so C's missing fact is worth researching.
    expect(r.payload.research).toEqual([{ optionRef: C, dimension: 'undergraduate_research', why: 'If undergraduate research turns out well, Liberal Arts and Sciences at Tidewater College could move ahead of Marine Biology at Coralwood University.' }]);
    expect(r.handoffs.find((x) => x.toRole === '11')!.inputRefs).toEqual([C]);
  });

  // ---------------------------------------------------------------- 12T15 / 12T16 / 12T17 / 12T18

  it('12T15: repeated clicks on a school do not rewrite the stated preferences', async () => {
    const h = workedHarness();
    const before = await h.match();
    const r = await h.match({ interactionSignals: [{ optionRef: 'quillon_history', kind: 'click', count: 14 }, { optionRef: C, kind: 'view', count: 30 }] });
    expect(h.rankOf(r)).toEqual(h.rankOf(before));
    expect(r.payload.weights).toEqual(before.payload.weights);
    expect(r.payload.notices.find((n) => n.code === 'behaviour_not_preference')!.message).toMatch(/only what you tell me does/);
    const v = new RecordView(h.kernel.records.readScoped(h.ui, { tenantId: TENANT, studentId: h.studentId, role: '12', mode: 'local' }));
    expect(v.entityIds('fit_priority').sort()).toEqual(['academic_interest', 'location_countries', 'max_annual_cost']);
  });

  it('12T16: a source correction versions the shortlist and names the rationale it changed', async () => {
    const h = workedHarness();
    h.priority({ dimension: 'setting', statement: 'I would like a city campus', value: 'urban', weight: 3 });
    const first = await h.match();
    expect(h.card(first, A)!.dimensions.find((d) => d.dimension === 'setting')!.match).toBe('strong');
    const saved = h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'fit_shortlist' })[0]!;
    // The institution corrects its page: the campus is suburban. The claim gets a new version and the saved shortlist goes stale.
    const o = h.correct(h.claims.aSetting!, 'suburban', 'setting: "suburban" (corrected)');
    expect(o.status).toBe('new_version');
    await h.kernel.flushEvents();
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, saved.id)!.status).toBe('stale');
    const second = await h.match();
    expect(second.payload.version).toBe(2);
    const change = second.payload.changes.find((x) => x.optionRef === A)!;
    expect(change.because.join(' ')).toMatch(/the evidence for setting changed \(strong → weak\): The setting is suburban/);
  });

  it('12T17: without a usable ranking, a factual comparison is returned with no invented scores', async () => {
    const h = makeFitHarness();
    h.worked();
    const r = await h.match();
    expect(r.payload.tableOnly).toBe(true);
    for (const c of [...r.payload.cards, ...r.payload.more]) {
      expect(c.score).toBeNull();
      expect(c.rank).toBeNull();
      expect(c.fitBand).toBeNull();
    }
    expect(r.payload.notices.find((n) => n.code === 'table_only')!.message).toMatch(/no order is suggested; this is a factual comparison/);
    expect(r.completionReason).toBe('comparison_table');
  });

  it('12T18: a request for an admission chance is routed to the uncertainty advisor and kept distinct from fit', async () => {
    const h = workedHarness();
    const r = await h.match({ asks: ['admission_chance'] });
    expect(r.payload.admissionProbability).toBeNull();
    expect(r.handoffs.find((x) => x.toRole === '13')).toMatchObject({ requestedOutcome: expect.stringMatching(/without a personal probability/) });
    expect(r.payload.notices.find((n) => n.code === 'fit_is_not_chance')!.message).toMatch(/says nothing about whether you would be admitted/);
  });

  // ---------------------------------------------------------------- decisions, priorities and the contract

  it('a priority is saved only when the student confirms it, and decisions keep rejected options with their reasons', async () => {
    const h = workedHarness();
    const unconfirmed = await h.ok({ action: 'set_priority', priority: { dimension: 'setting', kind: 'preference', statement: 'maybe a city', value: 'urban', weight: 2, provisional: false }, confirmedByStudent: false });
    expect(unconfirmed.status).toBe('needs_student_input');
    const confirmed = await h.ok({ action: 'set_priority', priority: { dimension: 'setting', kind: 'preference', statement: 'I want a city campus', value: 'urban', weight: 2, provisional: false }, confirmedByStudent: true });
    expect(confirmed.payload.recorded).toEqual(['setting']);
    await h.ok({ action: 'decide', decisions: [{ optionRef: C, decision: 'reject', reason: 'Too far from home for now' }, { optionRef: B, decision: 'retain', reason: null }] });
    const r = await h.match();
    expect(h.card(r, C)!.studentDecision).toEqual({ decision: 'reject', reason: 'Too far from home for now' });
    expect(r.handoffs.find((x) => x.toRole === '14')!.requestedOutcome).toMatch(/Build the application portfolio from the retained options/);
  });

  it('scoring is conservative: unknown dimensions widen the range but never raise the order', () => {
    const cand = (ref: string, attrs: Candidate['attributes']): Candidate => ({ optionRef: ref, entityId: ref, name: ref, institutionName: ref, country: 'US', programName: 'Biology', aliases: [], suppliedBy: 'catalog', attributes: attrs, access: null, affordability: null, eligibility: { state: 'unknown', ref: null }, commercial: { partner: false, sponsored: false } });
    const prefs: Priority[] = [{ dimension: 'setting', kind: 'preference', statement: 'urban', value: 'urban', weight: 3, provisional: false, holder: 'student', claimId: 'x' }];
    const known = scoreCandidate(cand('known_mixed', { setting: { value: 'suburban', sourceRef: 's', text: null } }), prefs);
    const missing = scoreCandidate(cand('missing', {}), prefs);
    expect(known).toMatchObject({ min: 0, max: 0, possible: 6, completeness: 1 });
    expect(missing).toMatchObject({ min: 0, max: 6, possible: 6, completeness: 0 });
    const strong = scoreCandidate(cand('strong', { setting: { value: 'urban', sourceRef: 's', text: null } }), prefs);
    expect(order([missing, strong, known]).map((s) => s.candidate.optionRef)).toEqual(['strong', 'missing', 'known_mixed']);
  });

  it('the contract rejects ranked infeasible options, sponsored results in the organic list and match percentages', () => {
    const card = { optionRef: 'x', name: 'X', unit: { institution: 'X', campus: null, program: null, entityId: 'x' }, suppliedBy: 'catalog', rank: 1, state: 'excluded', eligibility: 'unknown', affordability: 'unknown', programAccess: null, hardConstraints: [{ dimension: 'setting', statement: 's', result: 'fail', why: 'w' }], dimensions: [], reasons: [], drawback: null, openQuestion: null, conditions: [], score: { min: 1, max: 2, possible: 4 }, fitBand: 'weak', completeness: 1, notDominated: true, disclosure: null, studentDecision: null };
    const p = { action: 'match', goal: null, version: 1, cards: [card], more: [], exploration: [], excluded: [], sponsored: [{ optionRef: 'x', name: 'X', label: 'sponsored' }], weights: {}, views: [], sensitivity: null, changes: [], preferenceConflicts: [], gap: null, research: [], tableOnly: false, questions: [], notices: [{ code: 'n', message: 'A 92% match for you!' }], recorded: [], admissionProbability: null } as unknown as FitPayload;
    const issues = FIT_CONTRACT.semantic!(p, {} as never).join(' | ');
    expect(issues).toMatch(/only feasible options are ranked/);
    expect(issues).toMatch(/fails a hard constraint but is listed as feasible/);
    expect(issues).toMatch(/sponsored content inside the organic ranking/);
    expect(issues).toMatch(/no match percentage/);
  });
});
