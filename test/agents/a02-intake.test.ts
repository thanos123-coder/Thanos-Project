import { describe, expect, it } from 'vitest';
import { INTAKE_CONTRACT, type IntakePayload } from '../../src/agents/a02-intake/agent.js';
import { QUESTION_BANK, questionIsPermitted } from '../../src/agents/a02-intake/question-bank.js';
import { roleMayWrite } from '../../src/agents/a04-record-steward/validation.js';
import { ScriptedModelGateway } from '../../src/model/scripted.js';
import { FIELD_CATALOG } from '../../src/shared/fields.js';
import type { Actor } from '../../src/shared/permissions.js';
import { makeIntakeHarness } from '../helpers/intake.js';
import { extracted, ibCourse, stated, TENANT } from '../helpers/kernel.js';

type H = ReturnType<typeof makeIntakeHarness>;

function fieldOf(h: H, key: string) {
  return h.record().fields.find((f) => f.fieldKey === key);
}

function allClaimsFor(h: H, key: string) {
  return h.kernel.records.history(h.ui, TENANT, h.studentId, key);
}

function questionIds(p: IntakePayload): string[] {
  return [p.nextQuestion, ...p.additionalQuestions].filter((q): q is NonNullable<typeof q> => !!q).map((q) => q.questionId);
}

describe('Agent 02 intake interviewer', () => {
  it('02T01 exploration starts with only relevant intake, even with an empty profile', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'explore_majors' });
    expect(r.status).toBe('needs_student_input');
    const allowed = ['goals.decision_horizon', 'interests.main'];
    expect(questionIds(r.payload).every((id) => allowed.includes(id))).toBe(true);
    r = await h.answer(r.payload, 'Exploring broadly for now');
    expect(questionIds(r.payload).every((id) => allowed.includes(id))).toBe(true);
    r = await h.answer(r.payload, 'I keep coming back to biology and drawing');
    expect(r.payload.enoughForObjective).toBe(true);
    expect(r.payload.nextQuestion).toBeNull();
    expect(r.handoffs.some((x) => x.toRole === '05')).toBe(true);
    // No budget, citizenship, grade or test questions were needed to begin.
    const asked = h.sessions.get(TENANT, h.studentId, r.payload.sessionId)!.askedQuestionIds;
    expect(asked.every((id) => allowed.includes(id))).toBe(true);

    // Skipping both still lets exploration begin: a partial profile is normal (02R10).
    const h2 = makeIntakeHarness();
    let s = await h2.start({ objective: 'explore_majors' });
    s = await h2.answer(s.payload, 'skip');
    s = await h2.answer(s.payload, 'skip');
    expect(s.payload.enoughForObjective).toBe(true);
    expect(s.handoffs.some((x) => x.toRole === '05')).toBe(true);
  });

  it('02T02 reuses a graduation date already on a transcript instead of asking again', async () => {
    const h = makeIntakeHarness();
    h.seed([extracted(h.student, 'student', 'self', 'education.expected_graduation', '2027-06', 'Expected completion: June 2027')]);
    const r = await h.start({ objective: 'onboarding' });
    expect(r.payload.skipped).toContainEqual({ questionId: 'education.graduation_timing', reason: 'already_known' });
    let p = r.payload;
    const seen = new Set<string>();
    for (let i = 0; i < 8 && p.nextQuestion; i += 1) {
      questionIds(p).forEach((id) => seen.add(id));
      p = (await h.answer(p, 'skip')).payload;
    }
    expect(seen.has('education.graduation_timing')).toBe(false);

    // An imported value that still needs confirmation is shown for confirmation, not asked from scratch.
    const h2 = makeIntakeHarness();
    h2.seed([extracted(h2.student, 'student', 'self', 'education.expected_graduation', '2027-06', 'Expected completion: June 2027', { extractionReview: { state: 'needs_confirmation', candidates: [] } })]);
    const s = await h2.start({ objective: 'fill_gaps', targetFields: ['student:self.education.expected_graduation'] });
    expect(s.payload.nextQuestion?.kind).toBe('confirm_imported');
    expect(s.payload.nextQuestion?.text).toContain('June 2027');
    const c = await h2.answer(s.payload, 'Yes');
    expect(c.payload.recorded[0]).toMatchObject({ fieldKey: 'student:self.education.expected_graduation', confirmation: 'student_confirmed' });
    const fv = fieldOf(h2, 'student:self.education.expected_graduation')!;
    expect(fv.current?.value).toBe('2027-06');
    expect(fv.needsConfirmation).toBe(false);
    const again = await h2.start({ objective: 'fill_gaps', targetFields: ['student:self.education.expected_graduation'] });
    expect(again.payload.nextQuestion).toBeNull();
  });

  it('02T03 confirms an ambiguous spoken amount and currency before use', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', mode: 'voice', targetFields: ['student:self.constraints.opportunity_budget'] });
    expect(r.payload.nextQuestion?.questionId).toBe('constraints.budget');
    r = await h.answer(r.payload, 'one thousand fifty euros including travel', {
      modality: 'voice',
      segments: [{ text: 'one thousand fifty euros', confidence: 0.52, alternatives: ['one hundred and fifty euros'] }],
    });
    expect(r.payload.recorded).toHaveLength(0);
    expect(r.payload.nextQuestion?.kind).toBe('confirm_pending');
    expect(r.payload.nextQuestion?.text).toBe('Did you mean €150 or €1,050?');
    expect(fieldOf(h, 'student:self.constraints.opportunity_budget')).toBeUndefined();
    r = await h.answer(r.payload, 'One hundred and fifty.', { modality: 'voice' });
    expect(r.payload.recorded).toHaveLength(1);
    const fv = fieldOf(h, 'student:self.constraints.opportunity_budget')!;
    expect(fv.current?.value).toMatchObject({ amount: { amount: '150.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all' });
    expect(fv.current?.confirmation).toBe('student_confirmed');
    // The rejected larger reading was never stored as a fact.
    expect(allClaimsFor(h, 'student:self.constraints.opportunity_budget').some((c) => JSON.stringify(c.value).includes('1050'))).toBe(false);
  });

  it('02T04 keeps "Year 12" in the school’s own terms and asks for the system', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'onboarding' });
    expect(r.payload.nextQuestion?.questionId).toBe('goal.current_objective');
    r = await h.answer(r.payload, "I'm in Year 12 and might apply abroad");
    const year = fieldOf(h, 'student:self.education.current_year_label')!;
    expect(year.current?.value).toEqual({ label: 'Year 12', systemContext: null });
    expect(fieldOf(h, 'student:self.education.expected_graduation')).toBeUndefined();
    expect(fieldOf(h, 'student:self.education.qualification_system')).toBeUndefined();
    expect(fieldOf(h, 'student:self.application.destination_countries')).toBeUndefined();
    expect(questionIds(r.payload)).toContain('education.system');
    expect(JSON.stringify(r.payload)).not.toMatch(/senior|grade 12/i);
  });

  it('02T05 attributes a parent’s preference to the parent, not the student', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'explore_majors' });
    r = await h.answer(r.payload, 'Exploring broadly');
    expect(r.payload.nextQuestion?.questionId).toBe('interests.main');
    r = await h.answer(r.payload, 'My parents want me to do medicine, but I want design');
    const parents = r.payload.recorded.find((x) => x.attributedTo === 'parents')!;
    expect(parents.statement).toContain('medicine');
    const own = r.payload.recorded.filter((x) => x.attributedTo === null);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((x) => !x.statement.includes('medicine'))).toBe(true);
    expect(own.some((x) => x.statement.includes('design'))).toBe(true);
    expect(r.handoffs.some((x) => x.toRole === '05' && /tradeoff/.test(x.requestedOutcome))).toBe(true);
    const pref = h.record().fields.find((f) => f.field.entity === 'preference')!;
    expect(pref.holder).toEqual({ kind: 'reported_other', label: 'parents' });

    // When only the parent's wish is mentioned, the student is asked about their own view.
    const h2 = makeIntakeHarness();
    let s = await h2.start({ objective: 'explore_majors' });
    s = await h2.answer(s.payload, 'skip');
    s = await h2.answer(s.payload, 'My parents want me to study medicine');
    expect(s.payload.recorded.every((x) => x.attributedTo === 'parents')).toBe(true);
    expect(s.payload.nextQuestion?.text).toMatch(/your parents's view|What interests you yourself/);
    expect(h2.record().fields.some((f) => f.field.entity === 'interest')).toBe(false);
  });

  it('02T06 a declined sensitive question leads to a conditional result, not a block', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.identity.citizenships'] });
    expect(r.payload.nextQuestion?.sensitivity).toBe('sensitive');
    expect(r.payload.nextQuestion?.purpose).toMatch(/eligibility/);
    expect(r.payload.nextQuestion?.allowSkip).toBe(true);
    r = await h.answer(r.payload, 'prefer not to say');
    expect(r.status).toBe('completed');
    expect(r.payload.enoughForObjective).toBe(true);
    expect(r.payload.unresolved).toContainEqual(expect.objectContaining({ field: 'student.identity.citizenships', reason: 'declined' }));
    expect(r.payload.canProceed[0]).toMatch(/go ahead/);
    const fv = fieldOf(h, 'student:self.identity.citizenships')!;
    expect(fv.current?.value).toMatchObject({ kind: 'absent', reason: 'declined' });
    // A later session does not ask again.
    const again = await h.start({ objective: 'check_eligibility' });
    expect(again.payload.skipped).toContainEqual({ questionId: 'identity.citizenship', reason: 'declined_earlier' });
  });

  it('02T07 a voice session switches to text, keeps confirmed answers and allows correcting the transcript', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', mode: 'voice', targetFields: ['student:self.education.expected_graduation', 'student:self.constraints.weekly_hours_available'] });
    expect(r.payload.additionalQuestions).toHaveLength(0);
    const firstQ = r.payload.nextQuestion!.questionId;
    expect(firstQ).toBe('education.graduation_timing');
    const voiceTurn = h.say(r.payload.conversationId, 'June 2027', { modality: 'voice' });
    r = await h.ok({ action: 'answer', sessionId: r.payload.sessionId, turnId: voiceTurn.turnId });
    expect(r.payload.nextQuestion?.text).toBe('I heard June 2027. Is that right?');
    r = await h.answer(r.payload, 'yes', { modality: 'voice' });
    expect(fieldOf(h, 'student:self.education.expected_graduation')!.current).toMatchObject({ value: '2027-06', confirmation: 'student_confirmed' });

    r = await h.ok({ action: 'switch_mode', sessionId: r.payload.sessionId, mode: 'text' });
    expect(r.payload.mode).toBe('text');
    expect(questionIds(r.payload)).not.toContain('education.graduation_timing');
    expect(r.payload.nextQuestion?.questionId).toBe('constraints.weekly_time');

    // The student corrects the recognized transcript by typing; the answer is re-read and versioned.
    h.conversations.correct(TENANT, h.studentId, voiceTurn.turnId, 'June 2028');
    r = await h.ok({ action: 'reinterpret', sessionId: r.payload.sessionId, turnId: voiceTurn.turnId });
    const fv = fieldOf(h, 'student:self.education.expected_graduation')!;
    expect(fv.current?.value).toBe('2028-06');
    expect(r.payload.recorded[0]!.supersededClaimIds.length).toBeGreaterThan(0);
    expect(r.payload.notices.some((n) => n.code === 'correction_recorded')).toBe(true);
    expect(h.conversations.get(TENANT, h.studentId, voiceTurn.turnId)!.originalRecognition).toBe('June 2027');
  });

  it('02T08 a second speaker is not identified by voice; nothing is recorded until the student confirms', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', mode: 'voice', targetFields: ['student:self.education.expected_graduation'] });
    r = await h.answer(r.payload, 'She finishes in June 2028', { modality: 'voice', speakerLabel: 'other' });
    expect(r.payload.recorded).toHaveLength(0);
    expect(r.payload.notices.some((n) => n.code === 'speaker_unassigned')).toBe(true);
    expect(r.payload.nextQuestion?.text).toMatch(/your own answer/);
    expect(r.payload.nextQuestion?.text).toMatch(/never identify people by their voice/);
    expect(fieldOf(h, 'student:self.education.expected_graduation')).toBeUndefined();
    r = await h.answer(r.payload, 'No, someone else said it', { modality: 'voice' });
    expect(r.payload.recorded).toHaveLength(0);
    expect(r.payload.nextQuestion?.text).toMatch(/When do you expect to finish/);
    r = await h.answer(r.payload, 'June 2027', { modality: 'voice' });
    r = await h.answer(r.payload, 'yes', { modality: 'voice' });
    expect(fieldOf(h, 'student:self.education.expected_graduation')!.current?.value).toBe('2027-06');
    expect(allClaimsFor(h, 'student:self.education.expected_graduation').some((c) => c.value === '2028-06')).toBe(false);
  });

  it('02T09 a changed answer is a versioned correction that invalidates dependent work', async () => {
    const h = makeIntakeHarness();
    const seeded = h.seed([stated(h.student, 'education.expected_graduation', '2027-06', { lifecycle: 'planned' })]);
    const oldClaim = seeded.createdClaimIds[0]!;
    const artifact = h.kernel.records.putDerived({ ...h.ui, viaRole: '07' }, { tenantId: TENANT, studentId: h.studentId, kind: 'academic_plan', scopeKey: 'plan', payload: { ok: true }, inputClaimIds: [oldClaim], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
    const r0 = await h.start({ objective: 'onboarding' });
    const t = h.say(r0.payload.conversationId, 'Actually I will graduate in June 2028');
    const r = await h.ok({ action: 'correct', sessionId: r0.payload.sessionId, fieldKey: 'student:self.education.expected_graduation', turnId: t.turnId });
    expect(r.payload.recorded[0]).toMatchObject({ fieldKey: 'student:self.education.expected_graduation' });
    expect(r.payload.recorded[0]!.supersededClaimIds).toContain(oldClaim);
    expect(r.payload.invalidatedArtifacts).toBe(1);
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, artifact.id)?.status).toBe('stale');
    const history = allClaimsFor(h, 'student:self.education.expected_graduation');
    expect(history.find((c) => c.id === oldClaim)?.status).toBe('superseded');
    expect(fieldOf(h, 'student:self.education.expected_graduation')!.current?.value).toBe('2028-06');
  });

  it('02T10 an unknown course level after one clarification is recorded as a gap with another evidence route', async () => {
    const h = makeIntakeHarness();
    h.seed(ibCourse(h.student, 'c1', { subject: 'mathematics', name: 'Mathematics' }));
    let r = await h.start({ objective: 'fill_gaps', targetFields: ['course:c1.level'] });
    expect(r.payload.nextQuestion?.kind).toBe('targeted');
    expect(r.payload.nextQuestion?.text).toContain('Mathematics');
    r = await h.answer(r.payload, "I'm not sure");
    expect(r.payload.nextQuestion?.kind).toBe('clarify');
    expect(r.payload.nextQuestion?.text).toMatch(/HL, SL or Honors/);
    r = await h.answer(r.payload, "I don't know");
    expect(r.payload.nextQuestion).toBeNull();
    const fv = fieldOf(h, 'course:c1.level')!;
    expect(fv.current?.value).toMatchObject({ kind: 'absent', reason: 'unknown_to_student' });
    expect(r.payload.unresolved).toContainEqual(expect.objectContaining({ field: 'course.level', reason: 'unknown_to_student' }));
    expect(r.payload.unresolved[0]!.evidenceRoute).toMatch(/transcript|counselor/);
    expect(r.payload.nextAction).toBe('offer_document_import');
    expect(r.handoffs.some((x) => x.toRole === '03')).toBe(true);
    // The same question is not asked a third time in this session.
    const again = await h.ok({ action: 'review', sessionId: r.payload.sessionId });
    expect(questionIds(again.payload)).not.toContain('targeted:course:c1.level');

    // The same limit applies to template questions: one follow-up, then the gap is recorded.
    const g = makeIntakeHarness();
    let q = await g.start({ objective: 'fill_gaps', targetFields: ['student:self.education.expected_graduation'] });
    q = await g.answer(q.payload, "I don't know");
    expect(q.payload.nextQuestion?.kind).toBe('clarify');
    q = await g.answer(q.payload, "I don't know");
    expect(q.payload.nextQuestion).toBeNull();
    expect(fieldOf(g, 'student:self.education.expected_graduation')!.current?.value).toMatchObject({ kind: 'absent', reason: 'unknown_to_student' });
    expect(q.payload.unresolved[0]!.evidenceRoute).toMatch(/school calendar|transcript|counselor/);
  });

  it('02T11 a hypothetical future activity is recorded as considering, never completed', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'experience_review' });
    expect(r.payload.nextQuestion?.questionId).toBe('experiences.overview');
    r = await h.answer(r.payload, "I'm thinking about joining the robotics team next year, and I volunteered at the animal shelter last summer");
    const exps = h.record().fields.filter((f) => f.field.entity === 'experience');
    const robotics = exps.find((f) => JSON.stringify(f.current?.value).includes('robotics'))!;
    const shelter = exps.find((f) => JSON.stringify(f.current?.value).includes('shelter'))!;
    expect(robotics.current?.lifecycle).toBe('considering');
    expect(shelter.current?.lifecycle).toBe('completed');
    expect(r.handoffs.some((x) => x.toRole === '08')).toBe(true);
  });

  it('02T12 the review restates meaning explicitly so a dropped negation is exposed and correctable', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', mode: 'voice', targetFields: ['student:self.constraints.travel'] });
    // The student said "I can't travel overnight"; the recognizer dropped the negation.
    r = await h.answer(r.payload, 'I can travel overnight', { modality: 'voice' });
    expect(r.payload.nextAction).toBe('review');
    const item = r.payload.review!.items.find((i) => i.fieldKey === 'student:self.constraints.travel')!;
    expect(item.statement).toMatch(/you CAN travel and stay away overnight/);
    expect(item.heard).toBe('I can travel overnight');
    expect(item.modality).toBe('voice');
    const fix = h.say(r.payload.conversationId, "No, I can't travel overnight");
    r = await h.ok({ action: 'confirm_review', sessionId: r.payload.sessionId, decisions: [{ claimId: item.claimId, decision: 'edit', turnId: fix.turnId }] });
    const fv = fieldOf(h, 'student:self.constraints.travel')!;
    expect(fv.current?.value).toMatchObject({ overnightTravelPossible: false });
    expect(fv.current?.confirmation).toBe('student_confirmed');
    expect(r.payload.review!.items.find((i) => i.fieldKey === 'student:self.constraints.travel')!.statement).toMatch(/can NOT stay away overnight/);
  });

  it('02T13 stopping midway keeps confirmed work and does not force completion', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'onboarding' });
    r = await h.answer(r.payload, 'Help choosing universities abroad');
    r = await h.answer(r.payload, 'Secondary school, IB, in Greece');
    const before = h.record().fields.length;
    expect(before).toBeGreaterThan(2);
    const stop = await h.ok({ action: 'stop', sessionId: r.payload.sessionId });
    expect(stop.status).toBe('partial');
    expect(stop.payload.sessionStatus).toBe('paused');
    expect(stop.payload.nextQuestion).toBeNull();
    expect(stop.payload.nextAction).toBe('paused');
    expect(stop.payload.waitingOn.some((w) => /Not asked yet/.test(w))).toBe(true);
    expect(h.record().fields.length).toBe(before);
    expect(stop.payload.review?.items.length).toBeGreaterThan(0);

    // An unconfirmed voice value is not saved when the student stops before confirming it.
    const h2 = makeIntakeHarness();
    let v = await h2.start({ objective: 'fill_gaps', mode: 'voice', targetFields: ['student:self.constraints.weekly_hours_available'] });
    v = await h2.answer(v.payload, 'fifteen hours a week', { modality: 'voice' });
    expect(v.payload.nextQuestion?.kind).toBe('confirm_pending');
    const s2 = await h2.ok({ action: 'stop', sessionId: v.payload.sessionId });
    expect(s2.payload.waitingOn.some((w) => /Waiting for your confirmation/.test(w))).toBe(true);
    expect(fieldOf(h2, 'student:self.constraints.weekly_hours_available')).toBeUndefined();
  });

  it('02T14 a generated follow-up asking for private details is rejected and a relevant question is used', async () => {
    const model = new ScriptedModelGateway().always('intake.interpret_answer', {
      items: [],
      followUpQuestion: "What is your family's income, and what religion are you?",
      answersTheQuestion: false,
    });
    const h = makeIntakeHarness({ model });
    let r = await h.start({ objective: 'explore_majors' });
    r = await h.answer(r.payload, 'skip');
    r = await h.answer(r.payload, 'honestly just stuff I guess, whatever really');
    expect(model.calls.some((c) => c.purpose === 'intake.interpret_answer')).toBe(true);
    expect(r.payload.notices.some((n) => n.code === 'generated_question_rejected')).toBe(true);
    expect(r.payload.nextQuestion?.text).toBe('Is there a class, topic or activity you would happily spend more time on?');
    expect(r.payload.nextQuestion!.text).not.toMatch(/income|religion/i);
    // The contract validator also rejects such a question if any path produced it.
    const bad = { ...r.payload, nextQuestion: { ...r.payload.nextQuestion!, text: 'What is your home address and your family income?' } };
    expect(INTAKE_CONTRACT.semantic!(bad, {} as never)).toContain(`question ${bad.nextQuestion.questionId} asks about a prohibited private topic`);
    // Suggested wording from another specialist is validated the same way.
    const s = await h.start({ objective: 'fill_gaps', targetFields: ['course:c9.level'], handoffQuestions: { 'course:c9.level': 'Do you have a diagnosis that affects your course level?' } });
    expect(s.payload.notices.some((n) => n.code === 'generated_question_rejected')).toBe(true);
    expect(s.payload.nextQuestion?.text).not.toMatch(/diagnosis/);
  });

  it('02T15 states the limitation for unsupported language or curriculum terms and offers a safe fallback', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', locale: 'el-GR', targetFields: ['student:self.education.qualification_system'] });
    expect(r.payload.localeFallback).toBe(true);
    expect(r.payload.notices.some((n) => n.code === 'locale_fallback')).toBe(true);
    r = await h.answer(r.payload, 'Είμαι στο λύκειο, στο εθνικό σύστημα');
    expect(r.payload.recorded).toHaveLength(0);
    expect(r.payload.notices.find((n) => n.code === 'unsupported_language')?.message).toMatch(/only reliably read answers in English/);
    expect(r.payload.nextQuestion).not.toBeNull();
    r = await h.answer(r.payload, 'Matura');
    expect(r.payload.notices.some((n) => n.code === 'unrecognized_curriculum')).toBe(true);
    expect(r.payload.nextQuestion?.text).toContain('Matura');
    r = await h.answer(r.payload, 'yes');
    expect(fieldOf(h, 'student:self.education.qualification_system')!.current?.value).toEqual({ id: 'UNRECOGNIZED', label: 'Matura' });
  });

  it('02T16 a mock-interview request gets an explicit mode handoff with no covert scoring', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'onboarding' });
    const q = r.payload.nextQuestion!.questionId;
    r = await h.answer(r.payload, 'Can we do a mock interview instead?');
    expect(r.payload.modeHandoff).toMatchObject({ mode: 'interview_practice', requiresExplicitChoice: true, scoring: 'none_during_intake' });
    expect(r.payload.nextAction).toBe('mode_handoff');
    expect(r.payload.recorded).toHaveLength(0);
    expect(r.payload.nextQuestion?.questionId).toBe(q);
    expect(r.handoffs.some((x) => x.toRole === '29' && /explicitly/.test(x.requestedOutcome))).toBe(true);
    expect(JSON.stringify(r.payload)).not.toMatch(/"score"|rating/i);
  });

  it('keeps a street address out of the record and the stored transcript', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.constraints.location_broad'] });
    const t = h.say(r.payload.conversationId, 'I live at 12 Ermou Street, Athens 10563');
    r = await h.ok({ action: 'answer', sessionId: r.payload.sessionId, turnId: t.turnId });
    expect(fieldOf(h, 'student:self.constraints.location_broad')!.current?.value).toEqual({ country: 'GR', region: 'Attica', city: 'Athens' });
    expect(r.payload.notices.some((n) => n.code === 'address_not_stored')).toBe(true);
    const stored = h.conversations.get(TENANT, h.studentId, t.turnId)!;
    expect(stored.text).not.toMatch(/Ermou|10563/);
    const claims = allClaimsFor(h, 'student:self.constraints.location_broad');
    expect(JSON.stringify(claims)).not.toMatch(/Ermou|10563/);
  });

  it('reads recognizer alternatives for hours ("fifteen" vs "fifty") and asks instead of guessing', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', mode: 'voice', targetFields: ['student:self.constraints.weekly_hours_available'] });
    r = await h.answer(r.payload, 'fifty hours a week', { modality: 'voice', segments: [{ text: 'fifty hours', confidence: 0.6, alternatives: ['fifteen hours'] }] });
    expect(r.payload.nextQuestion?.text).toBe('Did you mean about 15 hours a week or about 50 hours a week?');
    r = await h.answer(r.payload, 'fifteen', { modality: 'voice' });
    expect(fieldOf(h, 'student:self.constraints.weekly_hours_available')!.current?.value).toEqual({ min: 15, max: 15 });
  });

  it('asks rather than guesses for "2 hours a day", a missing currency or a missing travel scope', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.constraints.weekly_hours_available'] });
    r = await h.answer(r.payload, 'about 2 hours a day');
    expect(r.payload.nextQuestion?.text).toMatch(/weekdays only \(10 hours a week\) or every day \(14 hours a week\)/);
    r = await h.answer(r.payload, 'weekdays only');
    expect(fieldOf(h, 'student:self.constraints.weekly_hours_available')!.current?.value).toEqual({ min: 10, max: 10 });

    const b = makeIntakeHarness();
    let s = await b.start({ objective: 'fill_gaps', targetFields: ['student:self.constraints.opportunity_budget'] });
    s = await b.answer(s.payload, 'up to 300');
    expect(s.payload.nextQuestion?.text).toBe('Which currency is that in?');
    s = await b.answer(s.payload, 'euros');
    expect(s.payload.nextQuestion?.text).toMatch(/include travel/);
    s = await b.answer(s.payload, 'Including travel');
    expect(fieldOf(b, 'student:self.constraints.opportunity_budget')!.current?.value).toMatchObject({ amount: { amount: '300.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all' });
  });

  it('records a value given with "not sure" only as a tentative value the student confirms', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.education.expected_graduation'] });
    r = await h.answer(r.payload, "I'm not sure, probably June 2027");
    expect(r.payload.recorded).toHaveLength(0);
    expect(r.payload.nextQuestion?.text).toMatch(/not sure.*June 2027/);
    r = await h.answer(r.payload, 'yes');
    const fv = fieldOf(h, 'student:self.education.expected_graduation')!;
    expect(fv.current).toMatchObject({ value: '2027-06', lifecycle: 'considering' });
  });

  it('responds supportively to ordinary stress without recording it, and pauses for anything more serious', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.education.expected_graduation'] });
    r = await h.answer(r.payload, "I'm so stressed about all of this, I don't know");
    expect(r.payload.notices.some((n) => n.code === 'stress_support')).toBe(true);
    expect(JSON.stringify(h.record().fields)).not.toMatch(/stress|anxi/i);

    const h2 = makeIntakeHarness();
    const s = await h2.start({ objective: 'onboarding' });
    const crisis = await h2.answer(s.payload, 'honestly I want to hurt myself');
    expect(crisis.status).toBe('needs_human_review');
    expect(crisis.payload.nextAction).toBe('support_referral');
    expect(crisis.payload.nextQuestion).toBeNull();
    expect(crisis.handoffs.some((x) => x.toRole === '34')).toBe(true);
    expect(crisis.payload.recorded).toHaveLength(0);
  });

  it('never records a turn written from another account, and records a supporter’s answer as the supporter’s', async () => {
    const h = makeIntakeHarness();
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    h.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['intake', 'counseling'], categories: ['education_context', 'goals_preferences', 'conversation_transcripts'], access: ['read', 'write'], policyBasis: 'student_invitation' });
    const r = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.education.expected_graduation'] });
    const foreign = h.say(r.payload.conversationId, 'June 2029', { actor: parent });
    const denied = await h.run({ action: 'answer', sessionId: r.payload.sessionId, turnId: foreign.turnId });
    expect(denied.result.status).toBe('blocked');
    expect(fieldOf(h, 'student:self.education.expected_graduation')).toBeUndefined();

    const ps = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.education.expected_graduation'] }, parent);
    const pr = await h.answer(ps.payload, 'June 2028', {}, parent);
    expect(pr.payload.recorded[0]).toMatchObject({ confirmation: 'unreviewed' });
    const fv = fieldOf(h, 'student:self.education.expected_graduation')!;
    expect(fv.current?.origin).toBe('supporter_statement');
  });

  it('round-trips critical facts from answer to record to review without a change in meaning', async () => {
    const h = makeIntakeHarness();
    let r = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.education.postsecondary_enrollment', 'student:self.constraints.opportunity_budget'] });
    const answers: Record<string, string> = { 'application.prior_college': 'No, none', 'constraints.budget': 'at most £400 including travel' };
    for (let i = 0; i < 4 && r.payload.nextQuestion; i += 1) r = await h.answer(r.payload, answers[r.payload.nextQuestion.questionId] ?? 'skip');
    const review = await h.ok({ action: 'review', sessionId: r.payload.sessionId });
    const statements = review.payload.review!.items.map((i) => i.statement);
    expect(statements).toContain('You have NOT taken any college or university courses');
    expect(statements).toContain('Budget for opportunities: up to £400 per opportunity, including travel and other costs (a firm limit)');
    const approve = await h.ok({ action: 'confirm_review', sessionId: r.payload.sessionId, decisions: review.payload.review!.items.map((i) => ({ claimId: i.claimId, decision: 'approve' as const })) });
    expect(approve.payload.review!.items.every((i) => i.confirmation === 'student_confirmed')).toBe(true);
    expect(fieldOf(h, 'student:self.education.postsecondary_enrollment')!.current?.value).toBe('none');
  });

  it('question bank: every template is permitted, neutral, writable by intake and explains sensitive fields', () => {
    for (const t of QUESTION_BANK) {
      expect(questionIsPermitted(t.text), t.id).toBe(true);
      expect(t.text, t.id).not.toMatch(/\b(you must|surely|don'?t you|right\?)/i);
      const [entity, ...rest] = t.field.split('.');
      expect(FIELD_CATALOG.has(t.field), t.id).toBe(true);
      expect(roleMayWrite('02', entity!, rest.join('.')), t.id).toBe(true);
      expect(t.purpose.length, t.id).toBeGreaterThan(10);
      if (t.sensitivity === 'sensitive') expect(t.skippable, t.id).toBe(true);
    }
  });
});

describe('Agent 02 idempotency', () => {
  it('processing the same turn twice changes nothing the second time', async () => {
    const h = makeIntakeHarness();
    const r = await h.start({ objective: 'fill_gaps', targetFields: ['student:self.application.entry_cycle'] });
    const t = h.say(r.payload.conversationId, '2027');
    const first = await h.ok({ action: 'answer', sessionId: r.payload.sessionId, turnId: t.turnId });
    expect(first.payload.recorded).toHaveLength(1);
    const version = h.kernel.records.recordVersion(TENANT, h.studentId);
    const second = await h.ok({ action: 'answer', sessionId: r.payload.sessionId, turnId: t.turnId });
    expect(second.payload.recorded).toHaveLength(0);
    expect(h.kernel.records.recordVersion(TENANT, h.studentId)).toBe(version);
  });
});
