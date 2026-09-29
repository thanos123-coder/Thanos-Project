import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import { DestinationRefSchema, detectOutlineStructure, looksLikeSubmissionProse, type DestinationRef, type OperationDecision } from '../../policy/assistance.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { RoleIdSchema, type Handoff } from '../../shared/envelopes.js';
import { STORY_USE_STATES } from '../../shared/fields.js';
import type { Turn } from '../a02-intake/sessions.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import type { DerivedArtifact, MutationResponse } from '../a04-record-steward/types.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import { NOTE_KINDS, storyRef, type Anchor, type SessionState, type StoryEntry } from './bank.js';
import { LEADING, nextQuestionId, ORDINARY_ENTRY_POINTS, PROCESS_CHOICES, question, type QuestionPurpose } from './questions.js';
import { candidateNotes, criticalAmbiguities, INFERRED_KINDS, keyPhrase, readAnswer } from './signals.js';

/**
 * Agent 17 — Personal essay brainstorming interviewer.
 *
 * Helps the student find what they might want to write about, one question
 * at a time, following their own words. It keeps an editable story bank of
 * factual anchors, the student's actions and exact phrases, and their own
 * interpretation, which can stay unresolved. It never writes an essay, an
 * opening, an outline, a scene or a lesson, never invents a detail, and never
 * treats distress as material. Policy for the planned operation is checked
 * before the session and again when a destination is added.
 */

const PurposeSchema = z
  .object({ kind: z.enum(['general', 'prompt']), destinations: z.array(DestinationRefSchema).max(12).default([]), promptRef: z.string().max(160).nullable().default(null) })
  .strict();

const ExtractorNoteSchema = z.object({ kind: z.enum([...NOTE_KINDS, ...INFERRED_KINDS, 'phrase']), text: z.string().min(1).max(400) }).strict();

export const StoryScopeSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      purpose: PurposeSchema.default({ kind: 'general', destinations: [], promptRef: null }),
      mode: z.enum(['text', 'voice']).default('text'),
      minutes: z.number().int().min(5).max(90).default(12),
      avoidTopics: z.array(z.string().min(1).max(120)).max(20).default([]),
      /** Live audio capture for a voice session; audio is not kept after transcription. */
      recordAudio: z.boolean().default(false),
      interest: z.string().max(200).nullable().default(null),
      language: z.string().max(40).nullable().default(null),
      conversationId: z.string().min(1).default('conv_story'),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('answer'), sessionId: z.string().min(1), turnId: z.string().min(1), extractorNotes: z.array(ExtractorNoteSchema).max(20).optional(), requester: RoleIdSchema.default('01') }).strict(),
  z
    .object({
      action: z.literal('control'),
      sessionId: z.string().min(1),
      event: z.enum(['interrupt', 'pause', 'resume', 'switch_mode', 'stop', 'disconnect', 'reconnect']),
      mode: z.enum(['text', 'voice']).nullable().default(null),
      /** The student explicitly turns audio capture back on (never done for them). */
      startRecording: z.boolean().default(false),
      instruction: z.string().max(400).nullable().default(null),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('confirm'),
      storyId: z.string().min(1),
      sessionId: z.string().min(1).nullable().default(null),
      confirm: z.array(z.string()).max(40).default([]),
      reject: z.array(z.string()).max(40).default([]),
      corrections: z.array(z.object({ anchorId: z.string(), text: z.string().min(1).max(400) }).strict()).max(20).default([]),
      rename: z.object({ from: z.string().min(1).max(80), to: z.string().min(1).max(80) }).strict().nullable().default(null),
      resolvePending: z.array(z.object({ pendingId: z.string(), chosen: z.string().min(1).max(400) }).strict()).max(10).default([]),
      title: z.string().min(1).max(80).nullable().default(null),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('set_use'), storyId: z.string().min(1), state: z.enum(STORY_USE_STATES), requester: RoleIdSchema.default('01') }).strict(),
  z
    .object({
      action: z.literal('close'),
      sessionId: z.string().min(1),
      selections: z.array(z.object({ storyId: z.string(), choice: z.enum(['chosen', 'undecided', 'excluded', 'private']) }).strict()).max(20).default([]),
      nextStep: z.string().max(300).nullable().default(null),
      shareForDrafting: z.boolean().default(false),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('review'), storyId: z.string().min(1).nullable().default(null), requester: RoleIdSchema.default('01') }).strict(),
  z.object({ action: z.literal('detector_report'), score: z.number().min(0).max(100), tool: z.string().max(120).nullable().default(null), requester: RoleIdSchema.default('01') }).strict(),
  z.object({ action: z.literal('reassess'), storyId: z.string().min(1), addDestinations: z.array(DestinationRefSchema).min(1).max(10), requester: RoleIdSchema.default('01') }).strict(),
]);
export type StoryScope = z.infer<typeof StoryScopeSchema>;
type Scope<A extends StoryScope['action']> = Extract<StoryScope, { action: A }>;

// ---------------------------------------------------------------- payload

const StoryViewSchema = z
  .object({
    storyId: z.string(),
    version: z.number(),
    title: z.string(),
    titleApproved: z.boolean(),
    privacy: z.enum(STORY_USE_STATES),
    status: z.enum(['active', 'excluded']),
    facts: z.array(z.object({ anchorId: z.string(), kind: z.enum(NOTE_KINDS), text: z.string(), status: z.enum(['candidate', 'confirmed', 'rejected']), uncertain: z.boolean(), sourceTurnId: z.string().nullable() }).strict()),
    phrases: z.array(z.object({ text: z.string(), sourceTurnId: z.string().nullable() }).strict()),
    interpretation: z.object({ status: z.enum(['not_discussed', 'unresolved', 'none', 'stated']), studentWords: z.string().nullable(), sourceTurnId: z.string().nullable() }).strict(),
    unresolved: z.array(z.string()),
    reviewNotes: z.array(z.string()),
  })
  .strict();
export type StoryView = z.infer<typeof StoryViewSchema>;

export const StoryPayloadSchema = z
  .object({
    action: z.string(),
    sessionId: z.string().nullable(),
    mode: z.enum(['text', 'voice', 'paused', 'stopped']).nullable(),
    recording: z.enum(['off', 'on']).nullable(),
    playback: z.enum(['idle', 'speaking', 'stopped']).nullable(),
    policy: z.object({ operation: z.string(), decision: z.enum(['allowed', 'prohibited', 'unclear']), generalOnly: z.boolean(), explanation: z.string(), sourceIds: z.array(z.string()) }).strict().nullable(),
    disclosure: z.array(z.string()),
    question: z.object({ id: z.string(), purpose: z.string(), text: z.string() }).strict().nullable(),
    /** What voice delivery may say: the intent and wording, nothing more (17 "Voice architecture"). */
    voiceDelivery: z.object({ intent: z.string(), wording: z.string(), permittedVariation: z.literal('rephrase_only'), repairAllowed: z.boolean() }).strict().nullable(),
    choices: z.array(z.string()),
    story: StoryViewSchema.nullable(),
    stories: z.array(StoryViewSchema),
    pending: z.array(z.object({ id: z.string(), question: z.string(), options: z.array(z.string()) }).strict()),
    guidance: z.array(z.string()),
    summary: z
      .object({
        options: z.array(z.object({ storyId: z.string(), title: z.string(), facts: z.array(z.string()), notYetConfirmed: z.array(z.string()), studentPhrases: z.array(z.string()), interpretation: z.string(), stillToExplore: z.array(z.string()), selection: z.enum(['chosen', 'undecided', 'excluded', 'private']) }).strict()),
        remainingQuestions: z.array(z.string()),
        nextStep: z.string().nullable(),
      })
      .strict()
      .nullable(),
    handoffPacket: z.object({ sharingForDrafting: z.enum(['not_yet_approved', 'approved']), storyIds: z.array(z.string()), notes: z.array(z.string()), chosenQuestions: z.array(z.string()), generatedEssayText: z.null() }).strict().nullable(),
    policyReview: z.object({ storyId: z.string(), destinations: z.array(z.string()), results: z.array(z.object({ operation: z.string(), decision: z.enum(['allowed', 'prohibited', 'unclear']), explanation: z.string() }).strict()), status: z.enum(['cleared', 'needs_review']) }).strict().nullable(),
    detector: z.object({ accusation: z.literal(false), certification: z.literal(false), message: z.string() }).strict().nullable(),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    generatedEssayText: z.null(),
  })
  .strict();
export type StoryPayload = z.infer<typeof StoryPayloadSchema>;

const EVASION = /\b(evade|evasion|bypass|beat|fool|trick) (the )?(ai )?detect\w*|\bhumani[sz]e (the |your )?(text|essay|writing)\b|\bundetectable\b/i;

export const STORY_CONTRACT: ContractDefinition<StoryPayload> = {
  id: 'story_session_v1',
  role: '17',
  payload: StoryPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    if (p.question) {
      if ((p.question.text.match(/\?/g) ?? []).length > 1) issues.push('one principal question at a time');
      if (LEADING.test(p.question.text)) issues.push('the question presumes a trait or a hardship');
    }
    // The app's own words are never prose for submission or a structure for the essay.
    const own = [p.question?.text ?? '', p.voiceDelivery?.wording ?? '', ...p.guidance, ...p.choices, ...p.notices.map((n) => n.message), p.summary?.nextStep ?? ''].join('\n');
    if (detectOutlineStructure(own).outline) issues.push('the response prescribes an essay structure');
    for (const t of [...p.guidance, ...p.notices.map((n) => n.message)]) if (looksLikeSubmissionProse(t)) issues.push('the response contains prose written for the student');
    if (EVASION.test(own)) issues.push('no help evading detection');
    // An interpretation is the student's own words, from a turn they gave.
    for (const s of [p.story, ...p.stories]) if (s && s.interpretation.studentWords !== null && s.interpretation.sourceTurnId === null) issues.push(`${s.storyId}: an interpretation must come from the student`);
    return issues;
  },
};

// ---------------------------------------------------------------- helpers

function view(e: StoryEntry): StoryView {
  return {
    storyId: e.storyId,
    version: e.version,
    title: e.title,
    titleApproved: e.titleApproved,
    privacy: e.privacy,
    status: e.status,
    facts: e.anchors.map((a) => ({ anchorId: a.anchorId, kind: a.kind, text: a.text, status: a.status, uncertain: a.uncertain, sourceTurnId: a.source.turnId })),
    phrases: e.phrases.map((ph) => ({ text: ph.text, sourceTurnId: ph.source.turnId })),
    interpretation: { status: e.interpretation.status, studentWords: e.interpretation.studentWords, sourceTurnId: e.interpretation.source.turnId },
    unresolved: e.unresolved,
    reviewNotes: e.reviewNotes,
  };
}

const DISCLOSURE = [
  'Your answers are saved as notes you can read, correct or delete. Audio is not kept after it is turned into text.',
  'Only you can see these notes unless you give someone access to them. Nothing here is shared for writing help unless you choose that.',
  'You can skip any question, answer briefly, switch between typing and speaking, pause, or stop at any time.',
];

export class StoryInterviewerAgent implements SpecialistAgent {
  readonly role = '17' as const;
  readonly contracts = [STORY_CONTRACT];

  /** Questions come from the library and the student's own words; a model could only help rephrase within an intent. */
  constructor(private readonly model: ModelGateway) {}

  get modelConfigured(): boolean {
    return this.model.configured;
  }

  async handle(ctx: TaskContext) {
    const parsed = StoryScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The request was incomplete.', 'invalid_scope');
    const s = parsed.data;
    switch (s.action) {
      case 'start':
        return this.start(ctx, s);
      case 'answer':
        return this.answer(ctx, s);
      case 'control':
        return this.control(ctx, s);
      case 'confirm':
        return this.confirm(ctx, s);
      case 'set_use':
        return this.setUse(ctx, s);
      case 'close':
        return this.close(ctx, s);
      case 'review':
        return this.review(ctx, s);
      case 'detector_report':
        return this.detector(ctx);
      case 'reassess':
        return this.reassess(ctx, s);
    }
  }

  private empty(action: string, session: SessionState | null): StoryPayload {
    return { action, sessionId: session?.sessionId ?? null, mode: session?.mode ?? null, recording: session?.recording ?? null, playback: session?.playback ?? null, policy: session ? { operation: session.policy.operation, decision: session.policy.decision, generalOnly: session.policy.generalOnly, explanation: session.policy.explanation, sourceIds: session.policy.sourceIds } : null, disclosure: [], question: null, voiceDelivery: null, choices: [], story: null, stories: [], pending: session?.pending.map((x) => ({ id: x.id, question: x.question, options: x.options })) ?? [], guidance: [], summary: null, handoffPacket: null, policyReview: null, detector: null, notices: [], generatedEssayText: null };
  }

  private async session(ctx: TaskContext, id: string): Promise<SessionState | null> {
    return ctx.call<SessionState | null>('story.bank', { op: 'get_session', sessionId: id });
  }

  private async saveSession(ctx: TaskContext, s: SessionState): Promise<void> {
    await ctx.call('story.bank', { op: 'put_session', session: s });
  }

  private async saveStory(ctx: TaskContext, e: StoryEntry, change: string): Promise<StoryEntry> {
    return ctx.call<StoryEntry>('story.bank', { op: 'put_story', story: e, change });
  }

  private newStory(ctx: TaskContext, session: SessionState, title: string): StoryEntry {
    const now = ctx.clock.nowIso();
    return {
      storyId: ctx.ids.next('story'),
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      version: 0,
      title,
      titleApproved: false,
      purpose: session.purpose,
      assistance: [{ operation: session.policy.operation, decision: session.policy.decision, decisionId: session.policy.decisionId, destinations: session.purpose.destinations }],
      anchors: [],
      phrases: [],
      interpretation: { status: 'not_discussed', studentWords: null, source: { turnId: null, span: null } },
      unresolved: [],
      reviewNotes: [],
      otherPeople: [],
      privacy: 'private',
      status: 'active',
      history: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Ask one question, and describe it for voice delivery when the session is spoken. */
  private ask(p: StoryPayload, session: SessionState, id: string, phrase: string | null = null, storyId: string | null = null, turnId: string | null = null): void {
    const q = question(id);
    const text = phrase && q.withPhrase ? q.withPhrase(phrase) : q.text;
    p.question = { id, purpose: q.purpose, text };
    session.asked.push({ questionId: id, purpose: q.purpose, storyId, turnId });
    if (session.mode === 'voice') {
      p.voiceDelivery = { intent: q.purpose, wording: text, permittedVariation: 'rephrase_only', repairAllowed: true };
      session.playback = 'speaking';
      p.playback = 'speaking';
    }
  }

  // ------------------------------------------------------------ start (steps 1-3)

  private async start(ctx: TaskContext, s: Scope<'start'>) {
    // Policy before personalization: tailored help only where every destination allows it.
    const tailored = s.purpose.destinations.length > 0;
    let d = await ctx.call<OperationDecision>('policy.check_operation', { operation: tailored ? 'tailored_brainstorming' : 'exploration_questions', destinations: s.purpose.destinations });
    const notices: StoryPayload['notices'] = [];
    if (tailored && d.decision !== 'allowed') {
      notices.push({ code: 'general_only', message: `${d.explanation} We can still explore in general terms; these notes will not be treated as cleared for ${s.purpose.destinations.map((x) => x.ref).join(', ')}.` });
      d = await ctx.call<OperationDecision>('policy.check_operation', { operation: 'exploration_questions', destinations: [] });
    } else if (!tailored) {
      notices.push({ code: 'not_cleared', message: 'This is general exploration. The notes have not been checked against any particular application’s rules yet.' });
    }
    const session: SessionState = {
      sessionId: ctx.ids.next('story_session'),
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      conversationId: s.conversationId,
      purpose: s.purpose,
      policy: { operation: d.operation, decision: d.decision, decisionId: d.id, generalOnly: d.generalOnly, explanation: d.explanation, sourceIds: d.perDestination.map((x) => x.sourceId).filter((x): x is string => x !== null) },
      mode: s.mode,
      recording: s.mode === 'voice' && s.recordAudio ? 'on' : 'off',
      recordingConsented: s.mode === 'voice' && s.recordAudio,
      playback: 'idle',
      minutes: s.minutes,
      avoidTopics: s.avoidTopics,
      currentStoryId: null,
      storyIds: [],
      threads: [],
      asked: [],
      pending: [],
      language: s.language,
      lastTurnId: null,
      status: 'open',
    };
    const p = this.empty('start', session);
    p.disclosure = [...DISCLOSURE, s.mode === 'voice' ? (s.recordAudio ? 'The microphone is on while you speak; you can see when it is on and stop it at any time.' : 'The microphone is off until you turn it on.') : 'You are typing; you can switch to speaking whenever you like.'];
    if (s.avoidTopics.length > 0) notices.push({ code: 'topics_avoided', message: `These topics will be left out: ${s.avoidTopics.join(', ')}.` });
    if (s.language) notices.push({ code: 'language', message: `You can think and talk in ${s.language}. Any text you submit is a separate question: translating it is not something this app does.` });
    p.notices = notices;
    p.choices = ['Explore one experience for about ten minutes', 'Compare a few possibilities', 'Stop whenever you like'];
    if (s.interest) {
      const story = this.newStory(ctx, session, `About ${s.interest}`);
      const saved = await this.saveStory(ctx, story, 'started from an interest you named');
      session.currentStoryId = saved.storyId;
      session.storyIds.push(saved.storyId);
      this.ask(p, session, 'specific_moment', s.interest, saved.storyId);
      p.story = view(saved);
    } else this.ask(p, session, 'open_ordinary');
    await this.saveSession(ctx, session);
    p.mode = session.mode;
    p.recording = session.recording;
    p.playback = session.playback;
    return makeResult(ctx, { status: 'needs_student_input', summary: 'The session is set up; here is a first question, and you can skip it.', payload: p, sourceRefs: session.policy.sourceIds, completionReason: 'session_started' });
  }

  // ------------------------------------------------------------ answers (steps 4-6)

  private async answer(ctx: TaskContext, s: Scope<'answer'>) {
    const session = await this.session(ctx, s.sessionId);
    if (!session || session.status !== 'open') return failedResult(ctx, 'failed', 'That session is not open.', 'session_not_open');
    const turn = await ctx.call<Turn>('conversation.read_turn', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, turnId: s.turnId });
    const p = this.empty('answer', session);
    session.playback = 'idle';
    session.lastTurnId = turn.turnId;
    const sig = readAnswer(turn.text);
    let story = session.currentStoryId ? await ctx.call<StoryEntry | null>('story.bank', { op: 'get_story', storyId: session.currentStoryId }) : null;
    const lastAsked = session.asked.at(-1);
    const finish = async (status: 'needs_student_input' | 'completed', summary: string, reason: string) => {
      await this.saveSession(ctx, session);
      p.mode = session.mode;
      p.recording = session.recording;
      p.playback = session.playback;
      p.pending = session.pending.map((x) => ({ id: x.id, question: x.question, options: x.options }));
      if (story) p.story = view(story);
      return makeResult(ctx, { status, summary, payload: p, completionReason: reason });
    };

    if (sig.stop) {
      session.mode = 'stopped';
      session.recording = 'off';
      p.notices.push({ code: 'stopped', message: 'Stopped. Your confirmed notes are kept, and you can come back whenever you like, or not at all.' });
      return finish('completed', 'The session is stopped.', 'student_stopped');
    }
    if (sig.pause) {
      session.mode = 'paused';
      session.recording = 'off';
      p.notices.push({ code: 'paused', message: 'Paused. The microphone is off. Pick up again whenever you want.' });
      return finish('completed', 'Paused.', 'student_paused');
    }
    // Requests the app does not carry out: writing for the student, translating submission text, inventing events (17T03, 17T13).
    if (sig.wantsWriting) {
      await ctx.call<OperationDecision>('policy.check_operation', { operation: 'prose_generation', destinations: session.purpose.destinations });
      p.notices.push({ code: 'student_is_author', message: 'I won’t write an opening or any part of the essay, because it needs to be yours. I can help you think it through.' });
      p.guidance.push('A general point that many writers find useful: start from a moment you actually remember, in plain words, and add only details you are sure of.');
      this.ask(p, session, 'what_before', null, story?.storyId ?? null, turn.turnId);
      return finish('needs_student_input', 'The essay stays yours; here is a question to help you think instead.', 'writing_declined');
    }
    if (sig.wantsTranslation) {
      const d = await ctx.call<OperationDecision>('policy.check_operation', { operation: 'translation', destinations: session.purpose.destinations });
      p.notices.push({ code: 'translation_checked', message: `${d.explanation} You can keep exploring in whichever language you think in best.` });
      return finish('needs_student_input', 'Translating submission text was checked against the rules and is not something this app does.', `translation_${d.decision}`);
    }
    if (sig.wantsFabrication) {
      p.notices.push({ code: 'real_experiences_only', message: 'I can’t help add events or details that didn’t happen. Real, ordinary experiences are enough to explore.' });
      this.ask(p, session, 'open_week');
      return finish('needs_student_input', 'Only real experiences are explored; here is another way in.', 'fabrication_declined');
    }
    // Discomfort: offer a pause or another topic, and do not press on this one.
    if (sig.discomfort) {
      p.notices.push({ code: 'no_pressure', message: 'That’s completely fine. We don’t need to go further with this. Would you like to try something else, pause, or stop? If something is weighing on you, a counselor or someone you trust can help in ways this app can’t.' });
      p.choices = ['Try a different topic', 'Pause', 'Stop'];
      if (story) story = await this.saveStory(ctx, { ...story, reviewNotes: [...story.reviewNotes, 'The student chose not to go further with part of this.'] }, 'student set a boundary');
      return finish('needs_student_input', 'We can leave that topic; you choose what happens next.', 'boundary_respected');
    }
    if (sig.skip) {
      const id = lastAsked?.purpose === 'open' ? ORDINARY_ENTRY_POINTS.find((x) => !session.asked.some((a) => a.questionId === x)) ?? 'stay_or_switch' : 'stay_or_switch';
      this.ask(p, session, id, null, story?.storyId ?? null, turn.turnId);
      return finish('needs_student_input', 'Skipped.', 'question_skipped');
    }
    // "Nothing interesting has happened to me": ordinary ways in, no disclosure expected (17T01).
    if (sig.nothingInteresting || (sig.brief && (!lastAsked || lastAsked.purpose === 'open'))) {
      p.notices.push({ code: 'ordinary_is_enough', message: 'You don’t need a dramatic experience. Everyday things you do, notice or wonder about can be worth exploring, and you can pass on any question.' });
      const id = ORDINARY_ENTRY_POINTS.find((x) => !session.asked.some((a) => a.questionId === x)) ?? 'stay_or_switch';
      this.ask(p, session, id);
      p.choices = [...PROCESS_CHOICES];
      return finish('needs_student_input', 'Here is an everyday way in, with no pressure to share more than you want.', 'ordinary_entry_offered');
    }
    // Several interests: each is its own thread, not one theme (17T12).
    if (sig.interests.length >= 3) {
      for (const label of sig.interests.slice(0, 5)) {
        const e = await this.saveStory(ctx, this.newStory(ctx, session, `About ${label}`), 'an interest you listed');
        session.storyIds.push(e.storyId);
        session.threads.push({ label, storyId: e.storyId });
        p.stories.push(view(e));
      }
      p.choices = session.threads.map((t) => t.label);
      p.notices.push({ code: 'separate_threads', message: 'These are kept as separate possibilities. They don’t need to add up to one theme.' });
      this.ask(p, session, 'which_further');
      return finish('needs_student_input', `${sig.interests.length} interests noted separately; you choose which to explore.`, 'threads_listed');
    }
    // Choosing a thread by name.
    const thread = session.threads.find((t) => turn.text.toLowerCase().includes(t.label.toLowerCase()));
    if (thread && lastAsked?.purpose === 'choose') {
      session.currentStoryId = thread.storyId;
      story = await ctx.call<StoryEntry | null>('story.bank', { op: 'get_story', storyId: thread.storyId });
      this.ask(p, session, 'specific_moment', thread.label, thread.storyId, turn.turnId);
      return finish('needs_student_input', `Exploring ${thread.label}.`, 'thread_chosen');
    }

    // An experience: notes are candidates until the student confirms them.
    if (!story) {
      story = this.newStory(ctx, session, 'An experience you described');
      session.storyIds.push(story.storyId);
      session.currentStoryId = story.storyId;
    }
    const e: StoryEntry = structuredClone(story);
    const ambiguities = turn.modality === 'voice' ? criticalAmbiguities(turn.segments) : [];
    const heldBack = new Set(ambiguities.map((a) => a.heard.toLowerCase().trim()));
    for (const a of ambiguities) {
      const id = ctx.ids.next('pending');
      session.pending.push({ id, storyId: e.storyId, question: `I want to be sure I heard this right. Did you say “${a.heard}” or “${a.alternative}”?`, options: [a.heard, a.alternative], reason: a.reason, heard: a.heard, turnId: turn.turnId });
      p.notices.push({ code: 'confirm_meaning', message: 'One part of that could mean the opposite depending on a single word, so it is not saved until you confirm it.' });
    }
    const dropped: string[] = [];
    const notes = s.extractorNotes
      ? s.extractorNotes.flatMap((n) => {
          if ((INFERRED_KINDS as readonly string[]).includes(n.kind)) {
            dropped.push(n.kind);
            return [];
          }
          if (n.kind === 'phrase') return [];
          const at = turn.text.indexOf(n.text);
          return [{ kind: n.kind as Anchor['kind'], text: n.text, span: at >= 0 ? { start: at, end: at + n.text.length } : null }];
        })
      : candidateNotes(turn.text);
    if (dropped.length > 0) p.notices.push({ code: 'inference_not_stored', message: 'A suggested note about how you felt or what you are like was not saved. Only what you say about yourself goes in your notes.' });
    // An answer about what it means is the student's interpretation, not a new fact.
    const interpreting = lastAsked?.purpose === 'perspective' || sig.noLesson || sig.unresolved;
    for (const n of interpreting ? [] : notes) {
      if ([...heldBack].some((h) => n.text.toLowerCase().includes(h) || h.includes(n.text.toLowerCase().replace(/[.!?]$/, '')))) continue;
      e.anchors.push({ anchorId: ctx.ids.next('anchor'), kind: n.kind, text: n.text, status: 'candidate', uncertain: sig.forgot, source: { turnId: turn.turnId, span: n.span }, corrections: [] });
    }
    const phrase = keyPhrase(turn.text);
    if (phrase && ambiguities.length === 0) e.phrases.push({ phraseId: ctx.ids.next('phrase'), text: phrase, source: { turnId: turn.turnId, span: { start: turn.text.indexOf(phrase), end: turn.text.indexOf(phrase) + phrase.length } }, corrections: [] });
    if (sig.forgot) {
      e.unresolved.push('A detail you don’t remember; it stays unknown.');
      p.notices.push({ code: 'uncertainty_kept', message: 'It’s fine not to remember. That detail stays marked as unknown; nothing will be filled in for you.' });
    }
    // The student's own view, including "no lesson" or "still figuring it out" (17T04).
    if (interpreting) {
      e.interpretation = { status: sig.noLesson ? 'none' : sig.unresolved ? 'unresolved' : 'stated', studentWords: turn.text.trim(), source: { turnId: turn.turnId, span: { start: 0, end: turn.text.length } } };
      if (sig.unresolved) e.unresolved.push('Did it change how you notice similar things elsewhere? (Only if you want to think about it; “no” is an answer too.)');
      if (sig.noLesson) p.notices.push({ code: 'no_lesson_needed', message: 'That’s a real answer. An experience doesn’t need a lesson to be worth thinking about.' });
    }
    const covered = new Set<QuestionPurpose>();
    if (!interpreting && notes.some((n) => n.kind === 'action')) covered.add('decision');
    if (!interpreting && notes.some((n) => n.kind === 'choice')) covered.add('choice');
    if (interpreting) covered.add('perspective');
    if (covered.has('decision') && !covered.has('choice') && !e.reviewNotes.includes('The reason for the choice has not been discussed yet.')) e.reviewNotes.push('The reason for the choice has not been discussed yet.');
    story = await this.saveStory(ctx, e, `notes from your answer (${turn.modality})`);
    const askedForStory = session.asked.filter((a) => a.storyId === story!.storyId).map((a) => a.questionId);
    // A forgotten detail is not asked about again.
    let nextId = nextQuestionId(askedForStory, covered);
    if (sig.forgot && question(nextId).purpose === 'factual') nextId = nextQuestionId([...askedForStory, nextId], covered);
    this.ask(p, session, nextId, nextId === 'specific_moment' ? phrase : null, story.storyId, turn.turnId);
    if (session.pending.length > 0) p.choices = session.pending[0]!.options;
    return finish('needs_student_input', session.pending.length > 0 ? 'Please confirm one part before it is saved; then there is a next question.' : 'Noted as candidate notes for you to check; here is the next question.', 'answer_noted');
  }

  // ------------------------------------------------------------ control (17T06, 17T07, 17T08)

  private async control(ctx: TaskContext, s: Scope<'control'>) {
    const session = await this.session(ctx, s.sessionId);
    if (!session) return failedResult(ctx, 'failed', 'That session was not found.', 'session_not_found');
    const p = this.empty('control', session);
    let summary = '';
    switch (s.event) {
      case 'interrupt': {
        // Stop speaking at once and follow what the student said.
        session.playback = 'stopped';
        const sig = s.instruction ? readAnswer(s.instruction) : null;
        if (sig?.stop) {
          session.mode = 'stopped';
          session.recording = 'off';
          p.notices.push({ code: 'stopped', message: 'Stopped. Your confirmed notes are kept.' });
          summary = 'Stopped as you asked.';
        } else if (sig?.pause) {
          session.mode = 'paused';
          session.recording = 'off';
          summary = 'Paused as you asked.';
        } else if (sig?.skip) {
          this.ask(p, session, 'stay_or_switch', null, session.currentStoryId);
          summary = 'Skipped that question.';
        } else {
          p.notices.push({ code: 'listening', message: 'I stopped. Go ahead.' });
          summary = 'Stopped speaking and listening to you.';
        }
        break;
      }
      case 'switch_mode': {
        if (s.mode === 'text') {
          session.mode = 'text';
          session.recording = 'off';
          session.playback = 'stopped';
          p.notices.push({ code: 'mic_off', message: 'Switched to typing. The microphone is off, and everything you confirmed is still here.' });
          summary = 'Switched to typing; audio capture is off.';
        } else if (s.mode === 'voice') {
          session.mode = 'voice';
          session.recording = s.startRecording ? 'on' : 'off';
          if (s.startRecording) session.recordingConsented = true;
          p.notices.push({ code: s.startRecording ? 'mic_on' : 'mic_off', message: s.startRecording ? 'Switched to speaking. The microphone is on; you can stop it at any time.' : 'Switched to speaking. The microphone stays off until you turn it on.' });
          summary = 'Switched to speaking.';
        }
        break;
      }
      case 'disconnect':
        // Confirmed notes are already saved; fall back to text and never resume recording silently.
        session.recording = 'off';
        session.playback = 'stopped';
        if (session.mode === 'voice') session.mode = 'text';
        p.notices.push({ code: 'connection_lost', message: 'The connection dropped. Your confirmed notes are saved, the microphone is off, and you can carry on by typing.' });
        summary = 'Connection lost; notes kept and recording off.';
        break;
      case 'reconnect':
        session.recording = s.startRecording ? 'on' : 'off';
        p.notices.push({ code: 'reconnected', message: s.startRecording ? 'Reconnected, and the microphone is on because you turned it on.' : 'Reconnected. The microphone is still off; turn it on if you want to keep talking.' });
        summary = 'Reconnected; recording stays off unless you turn it on.';
        break;
      case 'pause':
        session.mode = 'paused';
        session.recording = 'off';
        session.playback = 'stopped';
        summary = 'Paused.';
        break;
      case 'resume':
        session.mode = s.mode ?? 'text';
        session.recording = session.mode === 'voice' && s.startRecording ? 'on' : 'off';
        this.ask(p, session, 'stay_or_switch', null, session.currentStoryId);
        summary = 'Resumed.';
        break;
      case 'stop':
        session.mode = 'stopped';
        session.recording = 'off';
        session.playback = 'stopped';
        p.notices.push({ code: 'stopped', message: 'Stopped. Your confirmed notes are kept.' });
        summary = 'Stopped.';
        break;
    }
    await this.saveSession(ctx, session);
    p.mode = session.mode;
    p.recording = session.recording;
    p.playback = session.playback;
    return makeResult(ctx, { status: p.question ? 'needs_student_input' : 'completed', summary, payload: p, completionReason: `control_${s.event}` });
  }

  // ------------------------------------------------------------ confirm and correct (step 5, 17T05, 17T15)

  private async confirm(ctx: TaskContext, s: Scope<'confirm'>) {
    const story = await ctx.call<StoryEntry | null>('story.bank', { op: 'get_story', storyId: s.storyId });
    if (!story) return failedResult(ctx, 'failed', 'That story was not found.', 'story_not_found');
    const session = s.sessionId ? await this.session(ctx, s.sessionId) : null;
    const p = this.empty('confirm', session);
    const e = structuredClone(story);
    const now = ctx.clock.nowIso();
    const changes: string[] = [];
    for (const a of e.anchors) {
      if (s.confirm.includes(a.anchorId)) a.status = 'confirmed';
      if (s.reject.includes(a.anchorId)) a.status = 'rejected';
      const c = s.corrections.find((x) => x.anchorId === a.anchorId);
      if (c && c.text !== a.text) {
        a.corrections.push({ previous: a.text, at: now, by: 'student' });
        a.text = c.text;
        a.status = 'confirmed';
        changes.push(`corrected ${a.anchorId}`);
      }
    }
    // A name the transcript got wrong is corrected everywhere it appears, with the earlier text kept.
    if (s.rename) {
      // A fresh expression for each use: a shared global pattern would carry its position between strings.
      const pattern = s.rename.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const has = (t: string) => new RegExp(pattern).test(t);
      const swap = (t: string) => t.replace(new RegExp(pattern, 'g'), s.rename!.to);
      for (const a of e.anchors.filter((x) => has(x.text))) {
        a.corrections.push({ previous: a.text, at: now, by: 'student' });
        a.text = swap(a.text);
      }
      for (const ph of e.phrases.filter((x) => has(x.text))) {
        ph.corrections.push({ previous: ph.text, at: now, by: 'student' });
        ph.text = swap(ph.text);
      }
      if (e.interpretation.studentWords && has(e.interpretation.studentWords)) e.interpretation.studentWords = swap(e.interpretation.studentWords);
      e.unresolved = e.unresolved.map(swap);
      changes.push(`“${s.rename.from}” corrected to “${s.rename.to}”`);
    }
    // The student's choice between two hearings becomes the confirmed note.
    if (session) {
      for (const r of s.resolvePending) {
        const pend = session.pending.find((x) => x.id === r.pendingId && x.storyId === e.storyId);
        if (!pend) continue;
        e.anchors.push({ anchorId: ctx.ids.next('anchor'), kind: 'context', text: r.chosen, status: 'confirmed', uncertain: false, source: { turnId: pend.turnId, span: null }, corrections: r.chosen === pend.heard ? [] : [{ previous: pend.heard, at: now, by: 'student' }] });
        session.pending = session.pending.filter((x) => x.id !== pend.id);
        changes.push('confirmed what you meant');
      }
      await this.saveSession(ctx, session);
      p.pending = session.pending.map((x) => ({ id: x.id, question: x.question, options: x.options }));
    }
    if (s.title) {
      e.title = s.title;
      e.titleApproved = true;
    }
    const saved = await this.saveStory(ctx, e, changes.length > 0 ? changes.join('; ') : 'notes reviewed');
    p.story = view(saved);
    if (changes.length > 0) p.notices.push({ code: 'corrected', message: 'Updated. The earlier wording is kept in the note’s history, and anything built on this story will be checked again.' });
    p.question = { id: 'sounds_right', purpose: 'ownership', text: question('sounds_right').text };
    return makeResult(ctx, { status: 'needs_student_input', summary: `Notes updated (version ${saved.version}).`, payload: p, sourceRefs: [storyRef(saved.storyId)], completionReason: 'notes_confirmed' });
  }

  // ------------------------------------------------------------ use permissions (17T09)

  private async setUse(ctx: TaskContext, s: Scope<'set_use'>) {
    const p = this.empty('set_use', null);
    if (ctx.request.actor.kind !== 'student') return failedResult(ctx, 'blocked', 'Only the student decides how their stories are used.', 'student_only');
    const story = await ctx.call<StoryEntry | null>('story.bank', { op: 'get_story', storyId: s.storyId });
    if (!story) return failedResult(ctx, 'failed', 'That story was not found.', 'story_not_found');
    const rv = await readView(ctx, 'local', { entityTypes: ['story_use'] });
    const claim = buildClaim({ entity: 'story_use', entityId: s.storyId, attribute: 'permission', value: { sourceRef: storyRef(s.storyId), state: s.state }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [conversationEvidence('conv_story', `use_${s.storyId}`, `use: ${s.state}`, 'text', false)], actor: ctx.request.actor, viaRole: '17' });
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `use_${s.storyId}_${s.state}`), operation: 'add_claims', claims: [claim], expectedRecordVersion: rv.recordVersion, reason: `story_use:${s.storyId}` } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', 'The choice could not be saved.', `record_${res.outcome}`);
    const saved = await this.saveStory(ctx, { ...story, privacy: s.state, status: s.state === 'do_not_use' ? 'excluded' : 'active' }, `use set to ${s.state}`);
    p.story = view(saved);
    p.notices.push({ code: 'use_saved', message: s.state === 'do_not_use' ? 'This story won’t be used again for writing work. Anything built on it has been marked out of date, and it won’t appear in summaries.' : s.state === 'possible_writing_material' ? 'This story can be used as possible writing material when you ask for writing help.' : 'Saved. This story stays out of writing work.' });
    return makeResult(ctx, { status: 'completed', summary: `Use set to ${s.state.replace(/_/g, ' ')}.`, payload: p, recordVersion: res.recordVersion ?? rv.recordVersion, completionReason: 'use_set' });
  }

  // ------------------------------------------------------------ close (step 7, 17T02, 17T16)

  private async close(ctx: TaskContext, s: Scope<'close'>) {
    const session = await this.session(ctx, s.sessionId);
    if (!session) return failedResult(ctx, 'failed', 'That session was not found.', 'session_not_found');
    const p = this.empty('close', session);
    const all = await ctx.call<StoryEntry[]>('story.bank', { op: 'list' });
    const rv = await readView(ctx, 'local', { entityTypes: ['story_use'] });
    const choiceOf = (id: string) => s.selections.find((x) => x.storyId === id)?.choice ?? 'undecided';
    // Excluded or private choices are saved as the student's use setting.
    const claims = s.selections
      .filter((x) => x.choice === 'excluded' || x.choice === 'private')
      .map((x) => buildClaim({ entity: 'story_use', entityId: x.storyId, attribute: 'permission', value: { sourceRef: storyRef(x.storyId), state: x.choice === 'excluded' ? 'do_not_use' : 'private' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [conversationEvidence('conv_story', `close_${x.storyId}`, `selection: ${x.choice}`, 'text', false)], actor: ctx.request.actor, viaRole: '17' }));
    let recordVersion = rv.recordVersion;
    if (claims.length > 0 && ctx.request.actor.kind === 'student') {
      const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `close_${s.sessionId}`), operation: 'add_claims', claims, expectedRecordVersion: rv.recordVersion, reason: `story_selection:${s.sessionId}` } });
      if (res.outcome === 'accepted') recordVersion = res.recordVersion ?? recordVersion;
      for (const x of s.selections.filter((y) => y.choice === 'excluded' || y.choice === 'private')) {
        const st = all.find((e) => e.storyId === x.storyId);
        if (st) await this.saveStory(ctx, { ...st, privacy: x.choice === 'excluded' ? 'do_not_use' : 'private', status: x.choice === 'excluded' ? 'excluded' : 'active' }, `selection: ${x.choice}`);
      }
    }
    // A small number of options in factual notes; the student decides (default three to five when there are that many).
    const mine = all.filter((e) => session.storyIds.includes(e.storyId) && e.status === 'active' && choiceOf(e.storyId) !== 'excluded');
    const options = mine.slice(0, 5).map((e) => ({
      storyId: e.storyId,
      title: e.title,
      facts: e.anchors.filter((a) => a.status === 'confirmed').map((a) => a.text),
      notYetConfirmed: e.anchors.filter((a) => a.status === 'candidate').map((a) => a.text),
      studentPhrases: e.phrases.map((ph) => ph.text),
      interpretation: e.interpretation.status === 'none' ? 'You said there wasn’t a particular lesson.' : e.interpretation.status === 'unresolved' ? 'You’re still working out what it means.' : e.interpretation.status === 'stated' ? 'In your words, noted above.' : 'Not discussed yet.',
      stillToExplore: e.reviewNotes,
      selection: choiceOf(e.storyId),
    }));
    p.summary = { options, remainingQuestions: [...new Set(mine.flatMap((e) => e.unresolved))], nextStep: s.nextStep };
    const chosen = mine.filter((e) => choiceOf(e.storyId) === 'chosen');
    if (chosen.length === 0) p.notices.push({ code: 'no_topic_needed', message: 'You don’t need to pick a topic today. These notes will be here if you want them.' });
    // Drafting help receives only approved factual notes and the student's own questions, never a narrative sequence.
    const shareable = chosen.filter((e) => e.privacy === 'possible_writing_material');
    const approved = s.shareForDrafting && ctx.request.actor.kind === 'student' && shareable.length > 0;
    p.handoffPacket = { sharingForDrafting: approved ? 'approved' : 'not_yet_approved', storyIds: approved ? shareable.map((e) => e.storyId) : [], notes: approved ? shareable.flatMap((e) => e.anchors.filter((a) => a.status === 'confirmed').map((a) => a.text)) : [], chosenQuestions: approved ? shareable.flatMap((e) => e.unresolved) : [], generatedEssayText: null };
    if (s.shareForDrafting && !approved) p.notices.push({ code: 'not_shared', message: chosen.length === 0 ? 'Nothing was shared, because no story is chosen yet.' : 'Nothing was shared yet: mark a chosen story as possible writing material first.' });
    session.status = 'closed';
    session.mode = 'stopped';
    session.recording = 'off';
    session.playback = 'stopped';
    await this.saveSession(ctx, session);
    p.mode = session.mode;
    p.recording = session.recording;
    p.playback = session.playback;
    await ctx.call<DerivedArtifact>('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind: 'story_summary',
      scopeKey: s.sessionId,
      payload: { options: options.map((o) => ({ storyId: o.storyId, selection: o.selection })), nextStep: s.nextStep },
      inputClaimIds: [],
      inputFieldKeys: mine.map((e) => `story_use:${e.storyId}.permission`),
      sourceIds: mine.map((e) => storyRef(e.storyId)),
      recordVersion,
    });
    const handoffs: Handoff[] = approved ? [{ toRole: '18', reason: 'The student chose stories to use as possible writing material.', requestedOutcome: 'Use only these approved notes, within the assistance policy for each destination.', inputRefs: shareable.map((e) => storyRef(e.storyId)), unresolved: [], completionCondition: 'The student decides what to write, in their own words.' }] : [];
    return makeResult(ctx, { status: 'completed', summary: `Session closed with ${options.length} possibilit${options.length === 1 ? 'y' : 'ies'} noted${chosen.length > 0 ? ` and ${chosen.length} chosen` : ''}.`, payload: p, recordVersion, sourceRefs: mine.map((e) => storyRef(e.storyId)), handoffs, completionReason: 'session_closed' });
  }

  // ------------------------------------------------------------ review (17T10)

  private async review(ctx: TaskContext, s: Scope<'review'>) {
    const p = this.empty('review', null);
    const stories = s.storyId ? [await ctx.call<StoryEntry | null>('story.bank', { op: 'get_story', storyId: s.storyId })].filter((x): x is StoryEntry => x !== null) : await ctx.call<StoryEntry[]>('story.bank', { op: 'list' });
    p.stories = stories.map(view);
    return makeResult(ctx, { status: 'completed', summary: `${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}.`, payload: p, sourceRefs: stories.map((e) => storyRef(e.storyId)), completionReason: 'reviewed' });
  }

  // ------------------------------------------------------------ detectors (17T17)

  private async detector(ctx: TaskContext) {
    const p = this.empty('detector_report', null);
    p.detector = { accusation: false, certification: false, message: 'Detector scores are not reliable evidence of how something was written, and they misclassify some writers more than others. This app will not accuse you on the basis of one, will not certify that writing is human, and will not help change writing to get past one. What it can show is the record of help you actually used in your sessions.' };
    return makeResult(ctx, { status: 'completed', summary: 'A detector score is not treated as evidence either way.', payload: p, completionReason: 'detector_not_used' });
  }

  // ------------------------------------------------------------ a new destination (17T18)

  private async reassess(ctx: TaskContext, s: Scope<'reassess'>) {
    const story = await ctx.call<StoryEntry | null>('story.bank', { op: 'get_story', storyId: s.storyId });
    if (!story) return failedResult(ctx, 'failed', 'That story was not found.', 'story_not_found');
    const p = this.empty('reassess', null);
    const key = (d: DestinationRef) => `${d.kind}:${d.ref}:${d.cycle}`;
    const destinations = [...new Map([...story.purpose.destinations, ...s.addDestinations].map((d) => [key(d), d])).values()];
    // Every kind of help this story has already had, checked against the whole new destination set.
    // Reusing material for a named destination is tailored help, and matching it to a prompt is mapping.
    const operations = [...new Set([...story.assistance.map((a) => (a.operation === 'exploration_questions' ? 'tailored_brainstorming' : a.operation)), 'story_prompt_mapping'])];
    const results: NonNullable<StoryPayload['policyReview']>['results'] = [];
    const sources: string[] = [];
    for (const op of operations) {
      const d = await ctx.call<OperationDecision>('policy.check_operation', { operation: op, destinations });
      results.push({ operation: d.operation, decision: d.decision, explanation: d.explanation });
      sources.push(...d.perDestination.map((x) => x.sourceId).filter((x): x is string => x !== null));
    }
    const cleared = results.every((r) => r.decision === 'allowed');
    p.policyReview = { storyId: story.storyId, destinations: destinations.map(key), results, status: cleared ? 'cleared' : 'needs_review' };
    if (!cleared) p.notices.push({ code: 'reuse_needs_review', message: `Before this material is reused for ${s.addDestinations.map((d) => d.ref).join(', ')}: ${results.filter((r) => r.decision !== 'allowed').map((r) => `${r.operation.replace(/_/g, ' ')} is ${r.decision} (${r.explanation})`).join('; ')}. The earlier help is not assumed to be allowed there.` });
    const saved = await this.saveStory(ctx, { ...story, reviewNotes: cleared ? story.reviewNotes : [...story.reviewNotes, `Assistance not yet cleared for ${s.addDestinations.map((d) => d.ref).join(', ')}.`] }, cleared ? 'destinations added and cleared' : 'destination added; reuse needs review');
    p.story = view(saved);
    return makeResult(ctx, { status: cleared ? 'completed' : 'needs_student_input', summary: cleared ? 'The existing notes can be used for the new destination.' : 'The new destination’s rules need to be settled before these notes are reused.', payload: p, sourceRefs: [...new Set([...sources, storyRef(story.storyId)])], completionReason: cleared ? 'policy_cleared' : 'policy_review_needed' });
  }
}
