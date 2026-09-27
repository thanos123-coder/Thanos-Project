import { describe, expect, it } from 'vitest';
import { ScriptedModelGateway } from '../../src/model/scripted.js';
import { makeActivitiesHarness } from '../helpers/activities.js';
import { stated } from '../helpers/kernel.js';

const ep = (over: Record<string, unknown> = {}) => ({
  period: { start: '2025-09', ongoing: true },
  lifecycle: 'in_progress',
  time: { hoursPerWeek: { min: 4, max: 6 }, pattern: 'school_term', basis: 'student_estimate' },
  personalTasks: [],
  ...over,
});

describe('Agent 08 activities and experience assessor', () => {
  it('08T01 recognizes paid work and caregiving as meaningful experience without clubs', async () => {
    const h = makeActivitiesHarness();
    await h.submit({ title: 'Weekend shop work', category: 'paid_work', organizationKind: 'family', episodes: [ep({ personalTasks: ['stock checks', 'customer assistance'] })] });
    await h.submit({ title: 'Looking after my younger sister after school', category: 'caregiving', organizationKind: 'family', episodes: [ep({ time: { hoursPerWeek: { min: 8, max: 10 }, pattern: 'school_term', basis: 'student_estimate' }, personalTasks: ['pick her up from school', 'help with homework'] })] });
    const r = await h.ok({ action: 'review' });
    expect(r.payload.experiences).toHaveLength(2);
    for (const x of r.payload.experiences) {
      expect(x.supported.map((s) => s.quality)).toContain('responsibility');
      expect(x.admissionsImpactScore).toBeNull();
    }
    expect(JSON.stringify(r.payload)).not.toMatch(/no extracurricular|not (a )?real activit/i);
  });

  it('08T02 a future program acceptance is recorded as a selection with planned participation', async () => {
    const h = makeActivitiesHarness();
    const r = await h.submit({ title: 'Summer Marine Biology Program', category: 'program_or_course', organization: 'Example Institute', episodes: [ep({ period: { start: '2027-07', end: '2027-08', ongoing: false }, lifecycle: 'completed', time: null, selection: 'applied_and_accepted' })] });
    expect(r.payload.notices.some((n) => n.code === 'lifecycle_corrected')).toBe(true);
    const episode = h.record().fields.find((f) => f.field.entity === 'episode' && f.field.attribute === 'definition')!;
    expect(episode.current?.lifecycle).toBe('planned');
    const award = h.record().fields.find((f) => f.field.entity === 'award')!;
    expect(award.current?.value).toMatchObject({ stage: 'selected', selectionNote: expect.stringMatching(/planned, not completed/) });
    expect(r.payload.recorded.every((x) => !(x.fieldKey.startsWith('episode') && x.lifecycle === 'completed'))).toBe(true);
  });

  it('08T03 separates a team result from the student’s personal contribution', async () => {
    const h = makeActivitiesHarness();
    const r = await h.submit({ title: 'Charity bake sale', category: 'volunteering', episodes: [ep({ period: { start: '2025-11', end: '2025-11', ongoing: false }, lifecycle: 'completed', time: null, personalOutcomes: [{ description: 'We raised €2,000 for the animal shelter', attribution: 'individual' }] })] });
    const contribution = h.record().fields.find((f) => f.field.attribute === 'contribution')!;
    const v = contribution.current?.value as { personalOutcomes: unknown[]; teamOutcomes: Array<{ description: string; attribution: string }> };
    expect(v.personalOutcomes).toHaveLength(0);
    expect(v.teamOutcomes[0]).toMatchObject({ description: 'We raised €2,000 for the animal shelter', attribution: 'team' });
    expect(r.payload.clarifications.some((c) => c.kind === 'personal_contribution' && /personally/.test(c.question))).toBe(true);
  });

  it('08T04 keeps seasonal hours as separate episodes instead of a fabricated average', async () => {
    const h = makeActivitiesHarness();
    const r = await h.submit({
      title: 'Lifeguard at the local pool',
      category: 'paid_work',
      organization: 'Town pool',
      organizationKind: 'employer',
      episodes: [
        ep({ period: { start: '2025-09', ongoing: true }, time: { hoursPerWeek: { min: 5, max: 6 }, pattern: 'school_term', basis: 'student_estimate' }, personalTasks: ['watch the pool during evening sessions'] }),
        ep({ period: { start: '2025-06', end: '2025-08', ongoing: false }, lifecycle: 'completed', time: { hoursPerWeek: { min: 25, max: 30 }, pattern: 'holidays', basis: 'records' }, personalTasks: ['full-day shifts'] }),
      ],
    });
    const x = r.payload.experiences[0]!;
    expect(x.episodes.map((e) => e.time)).toEqual(['25-30 hours a week in the holidays', '5-6 hours a week during term (your estimate)']);
    expect(JSON.stringify(r.payload)).not.toMatch(/hours a year|annual total|per year total/i);
  });

  it('08T05 asks a neutral question when combined hours look implausible', async () => {
    const h = makeActivitiesHarness();
    await h.submit({ title: 'Café job', category: 'paid_work', episodes: [ep({ time: { hoursPerWeek: { min: 30, max: 30 }, pattern: 'year_round', basis: 'student_estimate' } })] });
    await h.submit({ title: 'Football team', category: 'sport', episodes: [ep({ time: { hoursPerWeek: { min: 25, max: 25 }, pattern: 'seasonal', basis: 'student_estimate' } })] });
    const r = await h.submit({ title: 'Tutoring', category: 'volunteering', episodes: [ep({ time: { hoursPerWeek: { min: 20, max: 20 }, pattern: 'school_term', basis: 'student_estimate' } })] });
    const q = r.payload.clarifications.find((c) => c.kind === 'overlap')!;
    expect(q.question).toMatch(/about 75 hours a week/);
    expect(q.question).toMatch(/counted in more than one activity|certain weeks/);
    expect(q.question).not.toMatch(/false|lie|dishonest|exaggerat|inaccurate/i);
  });

  it('08T06 an invitation count is not stored as people helped; the clarified measures are', async () => {
    const h = makeActivitiesHarness();
    const r = await h.submit({ title: 'School study club', category: 'club', episodes: [ep({ personalTasks: ['organized a revision event'], personalOutcomes: [{ description: 'helped 200 students', attribution: 'individual', measure: { value: 200, unit: 'students', kind: 'people_served', method: 'unknown' } }] })] });
    const q = r.payload.clarifications.find((c) => c.kind === 'measure')!;
    expect(q.question).toMatch(/invited, the number who took part/);
    const contribution = () => h.record().fields.find((f) => f.field.attribute === 'contribution')!.current?.value as { personalOutcomes: Array<{ measure: unknown }> };
    expect(contribution().personalOutcomes[0]!.measure).toBeNull();
    const episodeId = h.record().fields.find((f) => f.field.attribute === 'contribution')!.field.entityId;
    const t = h.say('200 got the invitation and 35 came');
    await h.ok({ action: 'clarify_measure', turnId: t.turnId, episodeId, outcomeDescription: 'helped 200 students', measures: [{ value: 200, unit: 'students', kind: 'invited', method: 'counted' }, { value: 35, unit: 'students', kind: 'attended', method: 'counted' }] });
    const outcomes = contribution().personalOutcomes as Array<{ measure: { kind: string; value: number } }>;
    expect(outcomes.map((o) => [o.measure.kind, o.measure.value])).toEqual([['invited', 200], ['attended', 35]]);
  });

  it('08T07 an informal hobby without a certificate is still recognized', async () => {
    const h = makeActivitiesHarness();
    await h.submit({ title: 'Composing music at home', category: 'creative_practice', organizationKind: 'self_directed', episodes: [ep({ period: { start: '2023-01', ongoing: true }, personalTasks: ['write short piano pieces', 'record them on my phone'] })] });
    const r = await h.ok({ action: 'review' });
    const x = r.payload.experiences[0]!;
    expect(x.evidenceStatus).toBe('self_reported');
    expect(x.supported.map((s) => s.quality)).toEqual(expect.arrayContaining(['sustained_involvement', 'craft']));
    expect(x.notes).toContain('Described in your own words; no document is needed for this to count.');
    expect(x.missing.join(' ')).not.toMatch(/certificate|proof|document/i);
  });

  it('08T08 does not infer national scope from an award title', async () => {
    const h = makeActivitiesHarness();
    const r = await h.submit({ title: 'Science fair project', category: 'research', episodes: [ep({ period: { start: '2025-02', end: '2025-04', ongoing: false }, lifecycle: 'completed', time: null })], awards: [{ title: 'National Young Innovators Prize', stage: 'finalist', attribution: 'individual', scope: 'national', scopeBasis: 'inferred_from_title' }] });
    const award = h.record().fields.find((f) => f.field.entity === 'award')!;
    expect((award.current?.value as { scope: string }).scope).toBe('unknown');
    expect(r.payload.experiences[0]!.notes).toContain('“National Young Innovators Prize”: finalist; scope not known.');
  });

  it('08T09 keeps a submitted manuscript as submitted, not published', async () => {
    const h = makeActivitiesHarness();
    await h.submit({ title: 'Soil microbiology project', category: 'research', episodes: [ep({ personalTasks: ['ran the soil sampling', 'analyzed the data'] })], research: [{ status: 'submitted_manuscript', studentTasks: ['data analysis'], supervision: 'supervised', approvalStatus: 'not_required', authorship: 'second author on the submitted draft' }] });
    const r = await h.ok({ action: 'review' });
    const notes = r.payload.experiences[0]!.notes.join(' ');
    expect(notes).toContain('manuscript submitted, not yet accepted');
    expect(notes).not.toMatch(/\bpublished\b/);
    expect((h.record().fields.find((f) => f.field.entity === 'research_output')!.current?.value as { status: string }).status).toBe('submitted_manuscript');
  });

  it('08T10 offers a faithful account instead of inflated leadership wording', async () => {
    const h = makeActivitiesHarness();
    const r0 = await h.submit({ title: 'Robotics club', category: 'club', episodes: [ep({ roleTitle: 'helped run meetings', titleIsOfficial: false, personalTasks: ['organized weekly practice schedules', 'kept the parts inventory'] })] });
    const id = r0.payload.experiences[0]!.experienceId;
    const r = await h.ok({ action: 'describe', experienceId: id, request: 'inflated_title', requestedWording: 'President of the robotics club' });
    expect(r.payload.faithfulDescription).toBe('Robotics club: organized weekly practice schedules; kept the parts inventory.');
    expect(r.payload.faithfulDescription).not.toMatch(/President/);
    expect(r.payload.declinedWording).toBe('President of the robotics club');
    expect(r.payload.notices[0]!.message).toMatch(/isn’t a title you held/);
  });

  it('08T11 minimizes private third-party details in family responsibilities', async () => {
    const h = makeActivitiesHarness();
    const r = await h.submit({ title: 'Caring for my brother Nikos', category: 'caregiving', organizationKind: 'family', episodes: [ep({ personalTasks: ['look after my brother Nikos who has autism after school', 'cook dinner'] })] });
    const all = JSON.stringify(h.record().fields);
    expect(all).not.toMatch(/Nikos|autism/);
    expect(r.payload.notices.some((n) => n.code === 'private_detail_omitted')).toBe(true);
    const fields = h.record().fields.filter((f) => ['experience', 'episode'].includes(f.field.entity));
    expect(fields.every((f) => f.category === 'family_context')).toBe(true);
  });

  it('08T12 stores changed roles over several years as separate episodes', async () => {
    const h = makeActivitiesHarness();
    const r = await h.submit({
      title: 'Debate society',
      category: 'club',
      organizationKind: 'school',
      episodes: [
        ep({ roleTitle: 'Member', titleIsOfficial: true, period: { start: '2023-09', end: '2024-06', ongoing: false }, lifecycle: 'completed', personalTasks: ['competed in two tournaments'] }),
        ep({ roleTitle: 'Treasurer', titleIsOfficial: true, period: { start: '2024-09', ongoing: true }, personalTasks: ['managed the travel budget'] }),
      ],
    });
    const x = r.payload.experiences[0]!;
    expect(x.episodes).toHaveLength(2);
    expect(x.progression).toBe('Your role changed over time: Member → Treasurer.');
    expect(x.supported.map((s) => s.quality)).toContain('sustained_involvement');
  });

  it('08T13 gives descriptive feedback, never an admission-value score', async () => {
    const h = makeActivitiesHarness();
    const r0 = await h.submit({ title: 'Chess club', category: 'club', episodes: [ep({ personalTasks: ['taught beginners on Fridays'] })] });
    const r = await h.ok({ action: 'describe', experienceId: r0.payload.experiences[0]!.experienceId, request: 'admission_value' });
    expect(r.payload.experiences[0]!.admissionsImpactScore).toBeNull();
    expect(r.payload.notices.find((n) => n.code === 'no_admission_score')?.message).toMatch(/no reliable way to score/);
    expect(JSON.stringify(r.payload)).not.toMatch(/\d+ ?%|percentile|tier [1-9]/i);
  });

  it('08T14 an essay handoff carries approved facts only, never a written story', async () => {
    const model = new ScriptedModelGateway().always('activities.structure_experience', { experiences: [{ title: 'reading to kids at the library', quote: 'I read to kids at the library on Saturdays', category: 'volunteering', timing: 'current', whenQuote: null, hoursQuote: null, personalTaskQuotes: ['I read to kids at the library on Saturdays'] }] });
    const h = makeActivitiesHarness({ model });
    const typed = await h.submit({ title: 'Debate society', category: 'club', episodes: [ep({ personalTasks: ['researched cases'], learning: 'I got better at listening before answering.' })] });
    const t = h.say('I read to kids at the library on Saturdays');
    const fromText = await h.ok({ action: 'record_text', turnId: t.turnId });
    const ids = [typed.payload.experiences[0]!.experienceId, fromText.payload.experiences[0]!.experienceId];
    const r = await h.ok({ action: 'essay_handoff', experienceIds: ids });
    const facts = r.payload.essayFacts!;
    expect(facts.approved.some((a) => /Debate society/.test(a.statement))).toBe(true);
    expect(facts.approved.some((a) => /listening before answering/.test(a.statement))).toBe(true);
    expect(facts.toConfirm.some((a) => /library/.test(a.statement))).toBe(true);
    expect(facts.approved.some((a) => /library/.test(a.statement))).toBe(false);
    const handoff = r.handoffs.find((x) => x.toRole === '17')!;
    expect(handoff.inputRefs).toEqual(facts.approved.map((a) => a.claimId));
    expect(handoff.requestedOutcome).toMatch(/do not write the essay/);
    expect(facts.reflectionQuestions.every((q) => q.endsWith('?'))).toBe(true);
  });

  it('08T15 suggests continuing or a smaller step when a new commitment would overload the week', async () => {
    const h = makeActivitiesHarness();
    h.seed([stated(h.student, 'constraints.weekly_hours_available', { min: 5, max: 6 })]);
    await h.submit({ title: 'Robotics club', category: 'club', episodes: [ep({ time: { hoursPerWeek: { min: 5, max: 5 }, pattern: 'school_term', basis: 'student_estimate' }, personalTasks: ['build the drivetrain'] })] });
    const r = await h.ok({ action: 'next_step', proposedHoursPerWeek: 4, interest: 'engineering' });
    expect(r.payload.nextStep!.kind).toBe('continue_current');
    expect(r.payload.nextStep!.text).toMatch(/Keep going with “Robotics club”/);
    expect(r.payload.nextStep!.hoursPerWeek.max).toBeLessThanOrEqual(2);
    expect(r.handoffs.some((x) => x.toRole === '09')).toBe(false);
  });

  it('08T16 does not recommend bypassing approval for work with people', async () => {
    const h = makeActivitiesHarness();
    const r = await h.submit({ title: 'Sleep habits survey', category: 'research', episodes: [ep({ lifecycle: 'planned', period: { start: '2026-11', ongoing: false }, time: null })], research: [{ status: 'in_progress', questionSummary: 'How screen time relates to sleep', oversight: ['human_participants'], approvalStatus: 'pending', workStarted: false }] });
    expect(r.payload.clarifications.some((c) => c.kind === 'approval')).toBe(true);
    expect(r.payload.notices.find((n) => n.code === 'approval_needed')?.message).toMatch(/before it starts/);
    expect(JSON.stringify(r.payload)).not.toMatch(/start (collecting|the survey) now|skip the approval|without approval/i);

    const h2 = makeActivitiesHarness();
    const r2 = await h2.submit({ title: 'Classmate interviews', category: 'research', episodes: [ep()], research: [{ status: 'in_progress', oversight: ['human_participants'], approvalStatus: 'unknown', workStarted: true }] });
    expect(r2.payload.humanReviewSuggested).toBe(true);
    expect(r2.handoffs.find((x) => x.toRole === '34')?.requestedOutcome).toMatch(/not a misconduct finding/);
  });

  it('reads a free-text description without inventing details and never records a hypothetical as done', async () => {
    // Deterministic reading.
    const h = makeActivitiesHarness();
    const t = h.say("I'm thinking about joining the robotics team next year");
    const r = await h.ok({ action: 'record_text', turnId: t.turnId });
    const ident = h.record().fields.find((f) => f.field.entity === 'experience')!;
    expect(ident.current?.lifecycle).toBe('considering');
    expect(ident.current?.confirmation).toBe('unreviewed');
    expect(r.payload.clarifications.some((c) => c.kind === 'dates')).toBe(true);
    expect(h.record().fields.some((f) => f.field.entity === 'episode')).toBe(false);

    // A model that calls the hypothetical "past" is overruled by the student's own wording; invented quotes are dropped.
    const model = new ScriptedModelGateway().always('activities.structure_experience', {
      experiences: [
        { title: 'robotics team', quote: "I'm thinking about joining the robotics team", category: 'club', timing: 'past', whenQuote: null, hoursQuote: null, personalTaskQuotes: ['led the team to victory'] },
        { title: 'Founder of a startup', quote: 'I founded a startup with 5,000 users', category: 'independent_project', timing: 'past', whenQuote: null, hoursQuote: null, personalTaskQuotes: [] },
      ],
    });
    const m = makeActivitiesHarness({ model });
    const t2 = m.say("I'm thinking about joining the robotics team next year");
    await m.ok({ action: 'record_text', turnId: t2.turnId });
    const exps = m.record().fields.filter((f) => f.field.entity === 'experience');
    expect(exps).toHaveLength(1);
    expect(exps[0]!.current?.lifecycle).toBe('considering');
    expect(JSON.stringify(m.record().fields)).not.toMatch(/victory|startup|5,000/);
  });
});
