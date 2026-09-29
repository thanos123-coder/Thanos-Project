import { describe, expect, it } from 'vitest';
import { STORY_CONTRACT, type StoryPayload } from '../../src/agents/a17-stories/agent.js';
import { storyRef } from '../../src/agents/a17-stories/bank.js';
import { LEADING, LIBRARY, nextQuestionId, ORDINARY_ENTRY_POINTS, PROCESS_CHOICES } from '../../src/agents/a17-stories/questions.js';
import { candidateNotes, criticalAmbiguities, keyPhrase, listedInterests, readAnswer } from '../../src/agents/a17-stories/signals.js';
import { detectOutlineStructure } from '../../src/policy/assistance.js';
import { TENANT } from '../helpers/kernel.js';
import { ASHGROVE, BROOKFIELD, makeStoryHarness } from '../helpers/stories.js';

const appText = (p: StoryPayload) => [p.question?.text ?? '', ...p.guidance, ...p.choices, ...p.notices.map((n) => n.message)].join('\n');

describe('Agent 17 — questions and signals (unit)', () => {
  it('the question library has one question per item, no leading questions, and no prestige assumptions', () => {
    for (const q of LIBRARY) {
      expect((q.text.match(/\?/g) ?? []).length).toBe(1);
      expect(LEADING.test(q.text)).toBe(false);
      expect(q.text).not.toMatch(/\b(travel|abroad|internship|summer program|mentor|leadership|award|parents)\b/i);
    }
    expect(LEADING.test('How did this prove your exceptional leadership?')).toBe(true);
    expect(LEADING.test('What is the most painful thing that has happened to you?')).toBe(true);
  });

  it('moves from a moment to the student’s action, choice and view, skipping what the answer already covered', () => {
    expect(nextQuestionId([], new Set())).toBe('specific_moment');
    expect(nextQuestionId(['specific_moment'], new Set())).toBe('student_action');
    expect(nextQuestionId(['specific_moment'], new Set(['decision', 'choice']))).toBe('differently_now');
    expect(nextQuestionId(['specific_moment', 'student_action', 'why_that', 'differently_now', 'sounds_right'], new Set())).toBe('stay_or_switch');
  });

  it('reads the answers that change what the app may do next', () => {
    expect(readAnswer('Nothing interesting has happened to me.').nothingInteresting).toBe(true);
    expect(readAnswer('Can you write me an opening paragraph?').wantsWriting).toBe(true);
    expect(readAnswer('Could you just write the essay for me').wantsWriting).toBe(true);
    expect(readAnswer('I wrote a program to sort the club’s links.').wantsWriting).toBe(false);
    expect(readAnswer('Can you make up a hardship story?').wantsFabrication).toBe(true);
    expect(readAnswer('I don’t want to talk about that.'.replace('’', "'")).discomfort).toBe(true);
    expect(readAnswer('There was no real lesson.').noLesson).toBe(true);
    expect(readAnswer("I'm still figuring that out.").unresolved).toBe(true);
    expect(readAnswer("I can't remember exactly when.").forgot).toBe(true);
    expect(readAnswer('stop').stop).toBe(true);
  });

  it('lists several interests separately and keeps the student’s words', () => {
    expect(listedInterests('I like chess, cooking, and fixing bikes.')).toEqual(['chess', 'cooking', 'fixing bikes']);
    expect(listedInterests('I like chess.')).toEqual([]);
    expect(keyPhrase('New members kept opening old forms. It was annoying.')).toBe('New members kept opening old forms');
    const notes = candidateNotes('New members kept opening old forms. I first added more instructions.');
    expect(notes.map((n) => [n.kind, n.text])).toEqual([['context', 'New members kept opening old forms.'], ['action', 'I first added more instructions.']]);
    expect(notes[1]!.span).toEqual({ start: 36, end: 68 });
  });

  it('flags a recognized phrase whose meaning a negation would flip', () => {
    expect(criticalAmbiguities([{ text: 'I led the group', confidence: 0.9, alternatives: ['I did not lead the group'] }])).toEqual([{ heard: 'I led the group', alternative: 'I did not lead the group', reason: 'negation' }]);
    expect(criticalAmbiguities([{ text: 'I did not win', confidence: 0.4, alternatives: [] }])[0]!.reason).toBe('low_confidence');
    expect(criticalAmbiguities([{ text: 'I fixed the page', confidence: 0.95, alternatives: ['I fixed the pages'] }])).toEqual([]);
  });
});

describe('Agent 17 — personal essay brainstorming interviewer', () => {
  it('explains what is saved and checks policy before a session', async () => {
    const h = makeStoryHarness();
    const s = await h.start();
    expect(s.payload.disclosure[0]).toContain('Audio is not kept after it is turned into text.');
    expect(s.payload.disclosure.join(' ')).not.toMatch(/completely confidential|no one will ever/i);
    expect(s.payload.policy).toMatchObject({ operation: 'exploration_questions', decision: 'allowed', generalOnly: true });
    expect(s.payload.notices.find((n) => n.code === 'not_cleared')!.message).toContain('have not been checked against any particular application’s rules');
    expect(s.payload.question).toMatchObject({ id: 'open_ordinary' });
    expect(s.payload.generatedEssayText).toBeNull();
  });

  it('17T01 offers ordinary ways in without pressing for disclosure', async () => {
    const h = makeStoryHarness();
    const s = await h.start();
    const r = await h.answer(s.payload.sessionId!, 'Honestly, nothing interesting has happened to me.');
    expect(r.payload.notices[0]).toMatchObject({ code: 'ordinary_is_enough' });
    expect(ORDINARY_ENTRY_POINTS).toContain(r.payload.question!.id);
    expect(r.payload.choices).toEqual([...PROCESS_CHOICES]);
    expect(appText(r.payload)).not.toMatch(/hardship|struggle|trauma|overcome|difficult time|painful/i);
    // A second brief answer gets another everyday way in, not the same question.
    const r2 = await h.answer(s.payload.sessionId!, 'not really');
    expect(r2.payload.question!.id).not.toBe(r.payload.question!.id);
  });

  it('17T02 gives questions and factual notes, never a narrative sequence, where outlines are prohibited', async () => {
    const h = makeStoryHarness();
    h.policies();
    const s = await h.start({ purpose: { kind: 'prompt', destinations: [BROOKFIELD], promptRef: 'brookfield_personal_2027' } });
    expect(s.payload.policy).toMatchObject({ operation: 'tailored_brainstorming', decision: 'allowed', generalOnly: false, sourceIds: ['src_brookfield_ai'] });
    const sid = s.payload.sessionId!;
    await h.answer(sid, 'I help my grandmother with her pharmacy forms every month.');
    await h.answer(sid, 'I started a folder system so nothing gets lost.');
    const c = await h.ok({ action: 'close', sessionId: sid });
    expect(c.payload.summary!.options[0]!.notYetConfirmed).toEqual(['I help my grandmother with her pharmacy forms every month.', 'I started a folder system so nothing gets lost.']);
    expect(detectOutlineStructure(JSON.stringify(c.payload.summary)).outline).toBe(false);
    expect(JSON.stringify(c.payload)).not.toMatch(/\b(opening|turning point|conclusion|final lesson|paragraph 1)\b/i);
    expect(c.payload.handoffPacket!.generatedEssayText).toBeNull();
  });

  it('17T03 keeps the student as author when asked for an opening paragraph', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'the club resource page' });
    const r = await h.answer(s.payload.sessionId!, 'Can you write me an opening paragraph from this?');
    expect(r.payload.notices[0]!.message).toBe('I won’t write an opening or any part of the essay, because it needs to be yours. I can help you think it through.');
    expect(r.payload.guidance).toHaveLength(1);
    expect(r.payload.question!.purpose).toBe('factual');
    expect(r.payload.generatedEssayText).toBeNull();
    expect(r.completionReason).toBe('writing_declined');
  });

  it('17T04 preserves “no clear lesson” and does not impose growth', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'babysitting my cousins' });
    const sid = s.payload.sessionId!;
    await h.answer(sid, 'Every Saturday I watch my two cousins while my aunt works.');
    const r = await h.answer(sid, 'There was no real lesson. I just did it because someone had to.');
    expect(r.payload.story!.interpretation).toEqual({ status: 'none', studentWords: 'There was no real lesson. I just did it because someone had to.', sourceTurnId: expect.any(String) });
    expect(r.payload.notices.find((n) => n.code === 'no_lesson_needed')!.message).toBe('That’s a real answer. An experience doesn’t need a lesson to be worth thinking about.');
    expect(appText(r.payload)).not.toMatch(/\b(taught you|grew|growth|shaped who you are|made you (stronger|who))\b/i);
  });

  it('17T05 confirms a voice fact whose negation is uncertain before saving it', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ mode: 'voice', recordAudio: true, interest: 'the science club' });
    const sid = s.payload.sessionId!;
    const r = await h.answer(sid, 'I led the group project.', { modality: 'voice', segments: [{ text: 'I led the group project', confidence: 0.82, alternatives: ['I did not lead the group project'] }] });
    expect(r.payload.pending).toHaveLength(1);
    expect(r.payload.pending[0]!.options).toEqual(['I led the group project', 'I did not lead the group project']);
    expect(r.payload.story!.facts.some((f) => /led the group/i.test(f.text))).toBe(false);
    expect(r.payload.story!.phrases).toEqual([]);
    const storyId = r.payload.story!.storyId;
    const c = await h.ok({ action: 'confirm', storyId, sessionId: sid, resolvePending: [{ pendingId: r.payload.pending[0]!.id, chosen: 'I did not lead the group project' }] });
    expect(c.payload.pending).toEqual([]);
    expect(c.payload.story!.facts.find((f) => f.text === 'I did not lead the group project')).toMatchObject({ status: 'confirmed' });
  });

  it('17T06 stops playback when the student interrupts and follows the new instruction', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ mode: 'voice', recordAudio: true });
    expect(s.payload.playback).toBe('speaking');
    expect(s.payload.voiceDelivery).toMatchObject({ intent: 'open', permittedVariation: 'rephrase_only' });
    const skip = await h.ok({ action: 'control', sessionId: s.payload.sessionId!, event: 'interrupt', instruction: 'skip this one' });
    expect(skip.payload.playback).toBe('speaking');
    expect(skip.payload.question!.id).toBe('stay_or_switch');
    const stop = await h.ok({ action: 'control', sessionId: s.payload.sessionId!, event: 'interrupt', instruction: 'stop' });
    expect(stop.payload).toMatchObject({ playback: 'stopped', mode: 'stopped', recording: 'off' });
  });

  it('17T07 keeps confirmed context and stops audio capture when switching from voice to text', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ mode: 'voice', recordAudio: true, interest: 'fixing bikes' });
    const sid = s.payload.sessionId!;
    const a = await h.answer(sid, 'I fixed my neighbor’s bike chain last summer.', { modality: 'voice', segments: [{ text: 'I fixed my neighbor’s bike chain last summer', confidence: 0.95, alternatives: [] }] });
    const storyId = a.payload.story!.storyId;
    const sw = await h.ok({ action: 'control', sessionId: sid, event: 'switch_mode', mode: 'text' });
    expect(sw.payload).toMatchObject({ mode: 'text', recording: 'off', playback: 'stopped' });
    const next = await h.answer(sid, 'I watched a video first and then tried it myself.');
    expect(next.payload.story!.storyId).toBe(storyId);
    expect(next.payload.story!.facts.map((f) => f.text)).toContain('I fixed my neighbor’s bike chain last summer.');
    expect(next.payload.voiceDelivery).toBeNull();
  });

  it('17T08 keeps confirmed notes when the connection drops and never resumes recording silently', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ mode: 'voice', recordAudio: true, interest: 'the school garden' });
    const sid = s.payload.sessionId!;
    await h.answer(sid, 'I water the school garden before class.', { modality: 'voice', segments: [{ text: 'I water the school garden before class', confidence: 0.93, alternatives: [] }] });
    const d = await h.ok({ action: 'control', sessionId: sid, event: 'disconnect' });
    expect(d.payload).toMatchObject({ mode: 'text', recording: 'off' });
    const r = await h.ok({ action: 'control', sessionId: sid, event: 'reconnect' });
    expect(r.payload.recording).toBe('off');
    expect(r.payload.notices[0]!.message).toContain('The microphone is still off');
    const on = await h.ok({ action: 'control', sessionId: sid, event: 'reconnect', startRecording: true });
    expect(on.payload.recording).toBe('on');
    const stories = await h.ok({ action: 'review' });
    expect(stories.payload.stories[0]!.facts.map((f) => f.text)).toEqual(['I water the school garden before class.']);
  });

  it('17T09 excludes a story from future use and invalidates what was built on it', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'my first job' });
    const a = await h.answer(s.payload.sessionId!, 'I worked at the bakery counter on weekends.');
    const storyId = a.payload.story!.storyId;
    const map = h.kernel.records.putDerived({ ...h.ui, viaRole: '18' }, { tenantId: TENANT, studentId: h.studentId, kind: 'narrative_map', scopeKey: 'map_1', payload: {}, inputClaimIds: [], sourceIds: [storyRef(storyId)], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
    // A new story is private: nothing is available for writing work until the student allows it.
    expect(h.bank.permitted(TENANT, h.studentId)).toEqual([]);
    await h.ok({ action: 'set_use', storyId, state: 'discuss_only' });
    expect(h.bank.permitted(TENANT, h.studentId)).toEqual([]);
    await h.ok({ action: 'set_use', storyId, state: 'possible_writing_material' });
    expect(h.bank.permitted(TENANT, h.studentId).map((e) => e.storyId)).toEqual([storyId]);
    const r = await h.ok({ action: 'set_use', storyId, state: 'do_not_use' });
    expect(r.payload.story).toMatchObject({ privacy: 'do_not_use', status: 'excluded' });
    expect(h.bank.permitted(TENANT, h.studentId)).toEqual([]);
    expect(h.bank.list(TENANT, h.studentId)).toEqual([]);
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, map.id)!.status).toBe('stale');
    expect(h.kernel.records.history(h.ui, TENANT, h.studentId, `story_use:${storyId}.permission`).at(-1)!.value).toEqual({ sourceRef: storyRef(storyId), state: 'do_not_use' });
    // It does not come back in a later summary.
    const c = await h.ok({ action: 'close', sessionId: s.payload.sessionId! });
    expect(c.payload.summary!.options).toEqual([]);
  });

  it('17T10 enforces the actual permissions when a parent asks for private notes', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'drawing' });
    await h.answer(s.payload.sessionId!, 'I draw comics about my little brother’s cat.');
    // No grant for this purpose: nothing is opened.
    const none = await h.run({ action: 'review' }, { actor: h.parent });
    expect(none.result.status).toBe('blocked');
    // A grant that does not include the story bank still does not reach private notes.
    h.grantParent(['experiences']);
    const partial = await h.run({ action: 'review' }, { actor: h.parent });
    expect(partial.result.status).toBe('blocked');
    expect(JSON.stringify(partial.result.payload)).not.toContain('comics');
    // Only the student's explicit story-bank grant opens them.
    const h2 = makeStoryHarness();
    const s2 = await h2.start({ interest: 'drawing' });
    await h2.answer(s2.payload.sessionId!, 'I draw comics about my little brother’s cat.');
    h2.grantParent(['story_bank']);
    const allowed = await h2.ok({ action: 'review' }, { actor: h2.parent });
    expect(allowed.payload.stories).toHaveLength(1);
  });

  it('17T11 records a forgotten detail as unknown and does not invent it', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'the sign-up sheet' });
    const r = await h.answer(s.payload.sessionId!, "I can't remember exactly when it was, but I fixed the club's sign-up sheet.");
    expect(r.payload.story!.facts.every((f) => f.uncertain)).toBe(true);
    expect(r.payload.story!.unresolved).toContain('A detail you don’t remember; it stays unknown.');
    expect(r.payload.notices.find((n) => n.code === 'uncertainty_kept')!.message).toContain('nothing will be filled in for you');
    expect(r.payload.question!.purpose).not.toBe('factual');
  });

  it('17T12 explores several unrelated interests without forcing one theme', async () => {
    const h = makeStoryHarness();
    const s = await h.start();
    const r = await h.answer(s.payload.sessionId!, 'I like chess, cooking, and fixing bikes.');
    expect(r.payload.stories.map((x) => x.title)).toEqual(['About chess', 'About cooking', 'About fixing bikes']);
    expect(r.payload.choices).toEqual(['chess', 'cooking', 'fixing bikes']);
    expect(r.payload.question!.id).toBe('which_further');
    expect(r.payload.notices.find((n) => n.code === 'separate_threads')!.message).toBe('These are kept as separate possibilities. They don’t need to add up to one theme.');
    const pick = await h.answer(s.payload.sessionId!, 'cooking');
    expect(pick.payload.question!.text).toBe('You mentioned “cooking”. Can you think of one particular moment connected to that?');
    expect(pick.payload.story!.title).toBe('About cooking');
  });

  it('17T13 checks the operation-specific policy before any translation', async () => {
    const h = makeStoryHarness();
    h.policies();
    const s = await h.start({ purpose: { kind: 'prompt', destinations: [BROOKFIELD], promptRef: null }, language: 'Spanish' });
    expect(s.payload.notices.find((n) => n.code === 'language')!.message).toContain('translating it is not something this app does');
    const r = await h.answer(s.payload.sessionId!, 'Can you translate my essay into English?');
    expect(r.completionReason).toBe('translation_prohibited');
    expect(r.payload.notices[0]!.message).toContain('This app does not do that');
    expect(r.payload.generatedEssayText).toBeNull();
  });

  it('17T14 keeps an inferred emotion out of the factual and interpretation fields', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'the robotics team' });
    const r = await h.answer(s.payload.sessionId!, 'I rebuilt the arm after it broke at the meet.', { extractorNotes: [{ kind: 'action', text: 'I rebuilt the arm after it broke at the meet.' }, { kind: 'emotion', text: 'The student felt proud and determined.' }, { kind: 'trait', text: 'The student is resilient.' }] });
    expect(r.payload.story!.facts.map((f) => f.text)).toEqual(['I rebuilt the arm after it broke at the meet.']);
    expect(r.payload.story!.interpretation.status).toBe('not_discussed');
    expect(JSON.stringify(r.payload.story)).not.toMatch(/proud|determined|resilient/);
    expect(r.payload.notices.find((n) => n.code === 'inference_not_stored')).toBeDefined();
  });

  it('17T15 applies a student correction to dependent notes and keeps provenance', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'the debate club' });
    const sid = s.payload.sessionId!;
    const a = await h.answer(sid, 'Mr. Gray asked me to run the timer.');
    await h.answer(sid, 'I told Mr. Gray I would rather research the topics.');
    const storyId = a.payload.story!.storyId;
    const dep = h.kernel.records.putDerived({ ...h.ui, viaRole: '18' }, { tenantId: TENANT, studentId: h.studentId, kind: 'narrative_map', scopeKey: 'map_2', payload: {}, inputClaimIds: [], sourceIds: [storyRef(storyId)], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
    const c = await h.ok({ action: 'confirm', storyId, rename: { from: 'Mr. Gray', to: 'Mr. Grey' }, title: 'Debate club timer' });
    expect(c.payload.story!.facts.map((f) => f.text)).toEqual(['Mr. Grey asked me to run the timer.', 'I told Mr. Grey I would rather research the topics.']);
    expect(c.payload.story!.phrases.map((x) => x.text)).toEqual(['Mr. Grey asked me to run the timer', 'I told Mr. Grey I would rather research the topics']);
    expect(c.payload.story).toMatchObject({ title: 'Debate club timer', titleApproved: true });
    const stored = h.bank.getStory(TENANT, h.studentId, storyId)!;
    expect(stored.anchors[0]!.corrections[0]!.previous).toBe('Mr. Gray asked me to run the timer.');
    expect(stored.anchors[0]!.source.turnId).toBe(a.payload.story!.facts[0]!.sourceTurnId);
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, dep.id)!.status).toBe('stale');
  });

  it('17T16 closes with useful notes and no pressure when the student stops before choosing', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'my commute' });
    await h.answer(s.payload.sessionId!, 'I take two buses to school and read on the second one.');
    const c = await h.ok({ action: 'close', sessionId: s.payload.sessionId! });
    expect(c.status).toBe('completed');
    expect(c.payload.summary!.options).toHaveLength(1);
    expect(c.payload.notices.find((n) => n.code === 'no_topic_needed')!.message).toBe('You don’t need to pick a topic today. These notes will be here if you want them.');
    expect(c.payload.handoffPacket!.sharingForDrafting).toBe('not_yet_approved');
    expect(c.handoffs).toEqual([]);
    expect(c.payload).toMatchObject({ mode: 'stopped', recording: 'off' });
    expect(appText(c.payload)).not.toMatch(/\b(continue|keep going|you should|don’t stop)\b/i);
  });

  it('17T17 does not accuse, certify or help evade on the basis of a detector score', async () => {
    const h = makeStoryHarness();
    const r = await h.ok({ action: 'detector_report', score: 97, tool: 'a detector the student used' });
    expect(r.payload.detector).toMatchObject({ accusation: false, certification: false });
    expect(r.payload.detector!.message).toContain('will not help change writing to get past one');
    expect(JSON.stringify(r.payload)).not.toMatch(/97|likely (ai|written by ai)|human-written/i);
  });

  it('17T18 reassesses an existing story before reuse for a stricter destination', async () => {
    const h = makeStoryHarness();
    h.policies();
    const s = await h.start({ purpose: { kind: 'prompt', destinations: [BROOKFIELD], promptRef: null }, interest: 'tutoring my neighbor' });
    const a = await h.answer(s.payload.sessionId!, 'I help my neighbor with fractions on Tuesdays.');
    const storyId = a.payload.story!.storyId;
    const r = await h.ok({ action: 'reassess', storyId, addDestinations: [ASHGROVE] });
    expect(r.payload.policyReview!.status).toBe('needs_review');
    expect(r.payload.policyReview!.results.map((x) => [x.operation, x.decision])).toEqual([['tailored_brainstorming', 'prohibited'], ['story_prompt_mapping', 'prohibited']]);
    expect(r.payload.notices[0]!.message).toContain('The earlier help is not assumed to be allowed there.');
    expect(r.sourceRefs).toEqual(expect.arrayContaining(['src_ashgrove_ai']));
    expect(h.bank.getStory(TENANT, h.studentId, storyId)!.reviewNotes).toContain('Assistance not yet cleared for ashgrove_institute.');
    // A destination with the same permissions clears.
    const again = await h.ok({ action: 'reassess', storyId, addDestinations: [BROOKFIELD] });
    expect(again.payload.policyReview!.status).toBe('cleared');
  });

  it('respects a boundary and offers a pause or another topic without pressing', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'moving schools' });
    const r = await h.answer(s.payload.sessionId!, "I'd rather not talk about that part, it's too personal.");
    expect(r.payload.choices).toEqual(['Try a different topic', 'Pause', 'Stop']);
    expect(r.payload.question).toBeNull();
    expect(r.payload.notices[0]!.message).toContain('We don’t need to go further with this.');
  });

  it('the synthetic example: an ordinary club resource page, a design decision, and an unresolved meaning', async () => {
    const h = makeStoryHarness();
    const s = await h.start({ interest: 'a club resource page' });
    const sid = s.payload.sessionId!;
    const q1 = await h.answer(sid, 'New members kept opening old forms.');
    expect(q1.payload.question!.text).toBe('What did you decide to do next?');
    const q2 = await h.answer(sid, 'I first added more instructions, then the page got too crowded.');
    expect(q2.payload.question!.text).toBe('What made you decide to do it that way?');
    expect(appText(q2.payload)).not.toMatch(/leadership|exceptional|prove/i);
    await h.answer(sid, 'I watched a friend look for one link and give up.');
    const q4 = await h.answer(sid, "I'm still figuring that out.");
    expect(q4.payload.story!.interpretation).toMatchObject({ status: 'unresolved', studentWords: "I'm still figuring that out." });
    expect(q4.payload.story!.unresolved[0]).toContain('Did it change how you notice similar things elsewhere?');
    const c = await h.ok({ action: 'close', sessionId: sid });
    const o = c.payload.summary!.options[0]!;
    expect(o.notYetConfirmed).toEqual(['New members kept opening old forms.', 'I first added more instructions, then the page got too crowded.', 'I watched a friend look for one link and give up.']);
    expect(o.interpretation).toBe('You’re still working out what it means.');
    expect(detectOutlineStructure(JSON.stringify(c.payload.summary)).outline).toBe(false);
  });

  it('the contract rejects stacked or leading questions, prose for the student, outlines and evasion help', () => {
    const base: StoryPayload = { action: 'answer', sessionId: 's', mode: 'text', recording: 'off', playback: 'idle', policy: null, disclosure: [], question: { id: 'x', purpose: 'open', text: 'What did you do?' }, voiceDelivery: null, choices: [], story: null, stories: [], pending: [], guidance: [], summary: null, handoffPacket: null, policyReview: null, detector: null, notices: [], generatedEssayText: null };
    expect(STORY_CONTRACT.semantic!(base, {} as never)).toEqual([]);
    expect(STORY_CONTRACT.semantic!({ ...base, question: { id: 'x', purpose: 'open', text: 'What happened? Who was there? Why?' } }, {} as never)).toContain('one principal question at a time');
    expect(STORY_CONTRACT.semantic!({ ...base, question: { id: 'x', purpose: 'open', text: 'How did this prove your exceptional leadership?' } }, {} as never)).toContain('the question presumes a trait or a hardship');
    expect(STORY_CONTRACT.semantic!({ ...base, guidance: ['I walked into the room. I saw the forms. I knew then what I had to do.'] }, {} as never)).toContain('the response contains prose written for the student');
    expect(STORY_CONTRACT.semantic!({ ...base, guidance: ['Start with the moment at the club, then describe the change, and end with the lesson learned.'] }, {} as never)).toContain('the response prescribes an essay structure');
    expect(STORY_CONTRACT.semantic!({ ...base, notices: [{ code: 'x', message: 'Here is how to bypass the AI detector.' }] }, {} as never)).toContain('no help evading detection');
    expect(StoryPayloadParses({ ...base, generatedEssayText: 'An essay' })).toBe(false);
  });
});

function StoryPayloadParses(p: unknown): boolean {
  return STORY_CONTRACT.payload.safeParse(p).success;
}
