import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import type { ExternalActionProposal, Handoff, ResultStatus, Uncertainty } from '../../shared/envelopes.js';
import { AccessDeniedError } from '../../shared/errors.js';
import { fieldKey, type ClaimInput } from '../../shared/facts.js';
import { sha256Hex, stableStringify } from '../../shared/hash.js';
import { CalendarDateSchema, calendarDateInZone } from '../../shared/time.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import type { MutationResponse } from '../a04-record-steward/types.js';
import { UNKNOWN_PHRASES } from '../a04-record-steward/validation.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { questionIsPermitted } from '../a02-intake/question-bank.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import { compareOptions, decisionAid, explainField, type Comparison, type DecisionAid, type FieldExplanation, type Rating } from './compare.js';
import { chooseExperiments, generateHypotheses, preparationNotes, readGoalContext, type GoalContext, type Hypothesis, type PlannedExperiment } from './explore.js';
import type { KnowledgeResult, SubjectProfile } from './knowledge.js';

/**
 * Agent 05 — Goals and major exploration advisor.
 *
 * Turns the student's own examples into a few revisable hypotheses and small,
 * feasible experiments. It does not diagnose personality, assign a major,
 * predict earnings for a person, or let a paid partnership steer a subject.
 * Hypotheses are recorded as labelled interpretations the student can reject;
 * other people's preferences stay attributed to them.
 */

const RatingSchema = z.enum(['strong', 'some', 'weak', 'unclear']);

export const GoalsScopeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goal_map'), record: z.boolean().default(true), timezone: z.string().optional() }).strict(),
  z
    .object({
      action: z.literal('compare_options'),
      subjectKeys: z.array(z.string().regex(/^[a-z_]+$/)).min(2).max(4),
      dimensions: z.array(z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(80), weight: z.number().int().min(0).max(5).nullable().optional() }).strict()).max(8).optional(),
      studentRatings: z.record(z.string(), z.record(z.string(), RatingSchema)).default({}),
    })
    .strict(),
  z.object({ action: z.literal('decision_aid'), subjectKeys: z.array(z.string().regex(/^[a-z_]+$/)).min(2).max(4), decisionKind: z.enum(['school_course_choice', 'university_application']), deadline: CalendarDateSchema.optional(), timezone: z.string().optional() }).strict(),
  z.object({ action: z.literal('explain_option'), subjectKey: z.string().regex(/^[a-z_]+$/), topic: z.enum(['what_you_study', 'occupations', 'earnings', 'routes']), question: z.string().max(400).optional() }).strict(),
  z.object({ action: z.literal('respond_to_hypothesis'), hypothesisId: z.string().min(1), response: z.enum(['accepted_as_tentative', 'rejected', 'edited']), turnId: z.string().min(1), editedText: z.string().min(1).max(300).optional() }).strict(),
  z.object({ action: z.literal('record_reflection'), turnId: z.string().min(1), about: z.string().min(1).max(60).optional(), timezone: z.string().optional() }).strict(),
  z
    .object({
      action: z.literal('record_assessment'),
      turnId: z.string().min(1),
      instrument: z
        .object({
          name: z.string().min(1).max(120),
          version: z.string().max(40).nullable(),
          language: z.string().min(2).max(20),
          administeredOn: CalendarDateSchema,
          scoringMethod: z.string().min(1).max(200),
          /** How the questions relate to the published instrument. */
          form: z.enum(['published_unmodified', 'modified_from_published', 'app_prompts']),
          licensed: z.boolean(),
          languageValidated: z.boolean(),
          consentContext: z.string().min(1).max(200),
        })
        .strict(),
      results: z.array(z.object({ scale: z.string().min(1).max(60), value: z.union([z.number(), z.string().max(40)]) }).strict()).min(1).max(20),
    })
    .strict(),
  z.object({ action: z.literal('prepare_contact'), experimentId: z.string().min(1), contactDescription: z.string().min(1).max(120) }).strict(),
]);
export type GoalsScope = z.infer<typeof GoalsScopeSchema>;

const HypothesisOutSchema = z
  .object({
    id: z.string(),
    subjectKeys: z.array(z.string()),
    label: z.string(),
    kind: z.enum(['direct', 'combination', 'adjacent']),
    statement: z.string(),
    evidence: z.array(z.object({ claimId: z.string(), quote: z.string(), kind: z.string(), direction: z.enum(['supports', 'against']) }).strict()).min(1),
    unknowns: z.array(z.string()),
    support: z.enum(['emerging', 'several_examples', 'mixed', 'less_supported']),
    taskFocus: z.array(z.string()),
    pressureNote: z.string().nullable(),
    commitmentLevel: z.literal('tentative'),
    existingEntityId: z.string().nullable(),
    preparation: z.string().nullable(),
  })
  .strict();

const ExperimentOutSchema = z
  .object({
    experimentId: z.string(),
    hypothesisRef: z.string().nullable(),
    learningQuestion: z.string(),
    activity: z.string(),
    timeBudget: z.string(),
    minutesTotal: z.number(),
    cost: z.enum(['free', 'low_cost', 'paid']),
    accessNotes: z.array(z.string()),
    reflectionPrompt: z.string(),
    publicSharingRequired: z.literal(false),
    externalContact: z.object({ needed: z.boolean(), preparedQuestions: z.array(z.string()), sent: z.literal(false) }).strict(),
    sponsorDisclosure: z.string().nullable(),
    reviewDate: z.string(),
  })
  .strict();

export const ExplorationPayloadSchema = z
  .object({
    action: z.string(),
    goalState: z.enum(['exploring', 'narrowing', 'comparing', 'open_by_choice']).nullable(),
    hypotheses: z.array(HypothesisOutSchema).max(5),
    attributedViews: z.array(z.object({ holderLabel: z.string(), text: z.string(), claimId: z.string() }).strict()),
    studentPriorities: z.array(z.string()),
    experiments: z.array(ExperimentOutSchema).max(3),
    questions: z.array(z.object({ text: z.string(), purpose: z.string() }).strict()).max(3),
    comparison: z.custom<Comparison>().nullable(),
    decisionAid: z.custom<DecisionAid>((v) => v === null || (typeof v === 'object' && (v as DecisionAid).recommendedOption === null)).nullable(),
    explanation: z.custom<FieldExplanation>().nullable(),
    recorded: z.array(z.object({ claimId: z.string(), fieldKey: z.string(), statement: z.string() }).strict()),
    hypothesisUpdates: z.array(z.object({ hypothesisId: z.string(), before: z.string().nullable(), after: z.string(), evidenceAdded: z.string() }).strict()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    uncertainty: z.array(z.string()),
    commitmentLevel: z.literal('tentative'),
  })
  .strict();
export type ExplorationPayload = z.infer<typeof ExplorationPayloadSchema>;

const PERSONALITY = /\b(you are (a|an) (natural|born|creative|analytical|people|logical|visual|introverted|extroverted)\b|personality type|introvert|extrovert|born to|naturally (gifted|talented)|your (true )?calling|destined|meant to be a|\d+ ?(%|percent) (suited|match|fit|compatible))/i;
const GUARANTEE = /\b(guarantee[ds]?|will (definitely|certainly) (earn|get|succeed|be)|certain to (earn|get))\b/i;
const MOTIVATION_JUDGMENT = /\b(unmotivated|lazy|not trying hard|lack of (effort|motivation|commitment)|gave up too (easily|soon)|should try harder)\b/i;
const NEGATED_GUARANTEE = /\b(no one can guarantee|cannot guarantee|can'?t guarantee|not guaranteed|no guarantee)\b/i;

export const EXPLORATION_CONTRACT: ContractDefinition<ExplorationPayload> = {
  id: 'exploration_v1',
  role: '05',
  payload: ExplorationPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    const texts = [...p.hypotheses.map((h) => h.statement), ...p.questions.map((q) => q.text), ...p.notices.map((n) => n.message)];
    for (const t of texts) {
      if (PERSONALITY.test(t)) issues.push(`personality or diagnostic language: "${t.slice(0, 80)}"`);
      if (GUARANTEE.test(t) && !NEGATED_GUARANTEE.test(t)) issues.push(`guarantee language: "${t.slice(0, 80)}"`);
      if (MOTIVATION_JUDGMENT.test(t)) issues.push(`judges the student's motivation: "${t.slice(0, 80)}"`);
    }
    for (const q of p.questions) if (!questionIsPermitted(q.text)) issues.push(`question asks about a prohibited private topic: "${q.text.slice(0, 80)}"`);
    for (const e of p.experiments) if (e.externalContact.sent) issues.push('an experiment contacted someone without authorization');
    if (p.explanation?.earnings.some((e) => !e.geography || !e.dataYear || !e.sourceId)) issues.push('earnings data must carry geography, year and source');
    return issues;
  },
};

// ---- optional model help: discriminating questions only

const ModelQuestionsSchema = z.object({ questions: z.array(z.object({ text: z.string().min(5).max(220), hypothesisIds: z.array(z.string()).max(3) }).strict()).max(2) }).strict();

const QUESTIONS_SYSTEM = [
  'You help a student explore possible fields of study. You are given a few tentative hypotheses built from the student’s own words.',
  'Write at most two short, neutral questions that would help tell these hypotheses apart, asking about concrete tasks, projects or examples ("What part of that project did you enjoy?"), not about personality.',
  'Never label the student’s personality, ability or motivation. Never ask about health, family income, religion, ethnicity or other private topics. No leading questions.',
  'Refer to hypotheses only by the ids you were given.',
].join('\n');

export class GoalsExplorationAgent implements SpecialistAgent {
  readonly role = '05' as const;
  readonly contracts = [EXPLORATION_CONTRACT];

  constructor(private readonly model: ModelGateway) {}

  async handle(ctx: TaskContext) {
    const parsed = GoalsScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The exploration request was incomplete.', 'invalid_scope');
    try {
      const s = parsed.data;
      switch (s.action) {
        case 'goal_map':
          return await this.goalMap(ctx, s.record, s.timezone, []);
        case 'compare_options':
          return await this.compare(ctx, s);
        case 'decision_aid':
          return await this.decision(ctx, s);
        case 'explain_option':
          return await this.explain(ctx, s);
        case 'respond_to_hypothesis':
          return await this.respond(ctx, s);
        // 05R08: after an experiment the student's own reflection is recorded; completing an activity is not evidence of fit.
        case 'record_reflection':
          return await this.reflect(ctx, s);
        case 'record_assessment':
          return await this.assessment(ctx, s);
        case 'prepare_contact':
          return await this.prepareContact(ctx, s);
      }
    } catch (e) {
      if (e instanceof AccessDeniedError) return failedResult(ctx, 'blocked', 'That is not available with the current permissions.', e.code);
      throw e;
    }
  }

  // ---------------------------------------------------------------- helpers

  private knowledge(ctx: TaskContext, subjectKeys: string[] | null, include: Array<'profiles' | 'labor' | 'routes' | 'experiments'>): Promise<KnowledgeResult> {
    return ctx.call<KnowledgeResult>('sources.read_verified', { subjectKeys, include });
  }

  private goalsView(ctx: TaskContext): Promise<RecordView> {
    return readView(ctx, 'local', { entityTypes: ['student', 'interest', 'preference', 'reflection', 'hypothesis', 'assessment', 'experience', 'course', 'school_context'] });
  }

  private today(ctx: TaskContext, view: RecordView, tz?: string): string {
    return calendarDateInZone(ctx.clock.nowIso(), tz ?? view.studentValue<string>('constraints.timezone') ?? 'UTC');
  }

  private empty(action: string): ExplorationPayload {
    return { action, goalState: null, hypotheses: [], attributedViews: [], studentPriorities: [], experiments: [], questions: [], comparison: null, decisionAid: null, explanation: null, recorded: [], hypothesisUpdates: [], notices: [], uncertainty: [], commitmentLevel: 'tentative' };
  }

  private async turn(ctx: TaskContext, turnId: string) {
    const t = await ctx.call<{ turnId: string; conversationId: string; actorId: string | null; text: string; modality: 'text' | 'voice'; role: string }>('conversation.read_turn', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, turnId });
    if (t.role !== 'student' || t.actorId !== ctx.request.actor.id) throw new AccessDeniedError('scope_violation', 'That message was not written by this account');
    return t;
  }

  private async propose(ctx: TaskContext, expected: number, claims: ClaimInput[], suffix: string, reason: string): Promise<MutationResponse> {
    return ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, suffix), operation: 'add_claims', claims, expectedRecordVersion: expected, reason } });
  }

  // ---------------------------------------------------------------- goal map

  private async goalMap(ctx: TaskContext, record: boolean, tz: string | undefined, notices: ExplorationPayload['notices'], extra: Partial<ExplorationPayload> = {}) {
    const view = await this.goalsView(ctx);
    const today = this.today(ctx, view, tz);
    const gc = readGoalContext(view);
    const k = await this.knowledge(ctx, null, ['profiles', 'experiments']);
    const hypotheses = generateHypotheses(gc, k.profiles);
    const byKey = new Map(k.profiles.map((p) => [p.key, p]));
    const payload = { ...this.empty('goal_map'), ...extra };
    payload.notices.push(...notices);
    payload.hypotheses = hypotheses.map((h) => ({ ...h, preparation: preparationNotes(h, byKey.get(h.subjectKeys[0]!)!, gc)?.text ?? null }));
    payload.attributedViews = gc.otherViews.map((v) => ({ holderLabel: v.holderLabel, text: v.text, claimId: v.claimId }));
    payload.studentPriorities = gc.evidence.filter((e) => e.kind === 'own_preference').map((e) => e.text).slice(0, 6);
    payload.experiments = chooseExperiments(hypotheses, k.experiments, gc, today);
    // 05R01: the decision horizon (broad exploration, course choice, subject choice, narrowed comparison) sets the precision.
    payload.goalState = goalStateOf(gc, hypotheses);
    payload.questions = await this.questions(ctx, hypotheses, byKey);
    payload.uncertainty = hypotheses.length === 0 ? ['There are not enough examples yet to suggest specific fields; that is normal at this stage.'] : [...new Set(hypotheses.flatMap((h) => h.unknowns))].slice(0, 6);
    if (gc.otherViews.length > 0) {
      payload.notices.push({ code: 'attributed_views', message: `Views from ${[...new Set(gc.otherViews.map((v) => v.holderLabel))].join(' and ')} are shown separately from your own interests. You decide what you want to explore.` });
    }
    if (hypotheses.length === 0 && (gc.decisionHorizon === 'broad_exploration' || gc.decisionHorizon === null)) {
      payload.notices.push({ code: 'no_rush', message: 'There is no need to choose a major now. Trying a few small things is a good way to learn what you enjoy.' });
    }
    let recordVersion = view.recordVersion;
    if (record && hypotheses.length > 0) {
      const r = await this.recordHypotheses(ctx, gc, hypotheses, view.recordVersion);
      payload.recorded.push(...r.recorded);
      recordVersion = r.recordVersion ?? recordVersion;
      for (const h of payload.hypotheses) h.existingEntityId = r.entityIds.get(h.id) ?? h.existingEntityId;
    }
    return this.finish(ctx, payload, recordVersion, 'goal_map_ready');
  }

  private async recordHypotheses(ctx: TaskContext, gc: GoalContext, hypotheses: readonly Hypothesis[], expected: number) {
    const claims: ClaimInput[] = [];
    const ids: string[] = [];
    const entityIds = new Map<string, string>();
    for (const h of hypotheses) {
      const supports = [...new Set(h.evidence.filter((e) => e.direction === 'supports').map((e) => e.claimId))];
      if (supports.length === 0) continue;
      const value = { text: h.statement, commitmentLevel: 'tentative' as const, evidenceClaimIds: supports, subjectKeys: h.subjectKeys, taskFocus: h.taskFocus };
      const entityId = h.existingEntityId ?? `hypothesis_${h.subjectKeys.join('_')}`;
      entityIds.set(h.id, entityId);
      const existing = gc.hypotheses.find((x) => x.entityId === entityId);
      if (existing && stableStringify({ t: existing.text, e: [...existing.evidenceClaimIds].sort(), k: existing.subjectKeys }) === stableStringify({ t: value.text, e: [...supports].sort(), k: value.subjectKeys })) continue;
      // 05R09: interpretations are proposed to Agent 04 as labelled, tentative claims with their evidence; the student can reject them.
      claims.push(buildClaim({ entity: 'hypothesis', entityId, attribute: 'statement', value, origin: 'model_interpretation', confirmation: 'unreviewed', lifecycle: 'current', evidence: [{ kind: 'derivation', method: 'goals.hypotheses_from_student_evidence', softwareVersion: 'a05_v1', inputClaimIds: supports }], actor: ctx.request.actor, viaRole: '05' }));
      ids.push(entityId);
    }
    if (claims.length === 0) return { recorded: [], recordVersion: null, entityIds };
    const res = await this.propose(ctx, expected, claims, `hypotheses:${ids.join(',')}:${sha256Hex(stableStringify(claims.map((c) => c.value))).slice(0, 16)}`, 'exploration_hypotheses');
    const recorded = res.outcome === 'accepted' ? res.createdClaimIds.map((id, i) => ({ claimId: id, fieldKey: fieldKey(claims[i]!.field), statement: `Suggestion (tentative): ${(claims[i]!.value as { text: string }).text}` })) : [];
    return { recorded, recordVersion: res.recordVersion ?? null, entityIds };
  }

  private async questions(ctx: TaskContext, hypotheses: readonly Hypothesis[], byKey: ReadonlyMap<string, SubjectProfile>): Promise<ExplorationPayload['questions']> {
    const out: ExplorationPayload['questions'] = [];
    const pressured = hypotheses.find((h) => h.pressureNote);
    if (pressured) out.push({ text: `What attracts you to ${pressured.label.toLowerCase()} yourself, and whose expectation is it?`, purpose: 'To separate your own interest from pressure, without dismissing either.' });
    if (hypotheses.length === 0) {
      out.push({ text: 'Could you tell me about one task, project or question you found absorbing, and which part of it you enjoyed?', purpose: 'Concrete examples are more useful than labels.' });
      return out;
    }
    if (this.model.configured && out.length < 2) {
      const r = await this.model.generate(ctx, {
        purpose: 'goals.discriminating_questions',
        system: QUESTIONS_SYSTEM,
        instructions: 'Suggest up to two questions that would help tell these hypotheses apart.',
        context: [{ label: 'hypotheses', data: hypotheses.map((h) => ({ id: h.id, field: h.label, statement: h.statement, unknowns: h.unknowns })) }],
        schema: ModelQuestionsSchema,
        schemaName: 'DiscriminatingQuestions',
        tier: 'fast',
        maxOutputTokens: 600,
      });
      if (r.ok) {
        const ids = new Set(hypotheses.map((h) => h.id));
        for (const q of r.output.questions) {
          const text = q.text.trim();
          const valid = questionIsPermitted(text) && /\?$/.test(text) && !PERSONALITY.test(text) && !/\b(right|correct|surely)\?$/i.test(text) && q.hypothesisIds.every((id) => ids.has(id));
          if (valid && out.length < 2) out.push({ text, purpose: 'Helps tell apart the options suggested so far.' });
        }
      }
    }
    if (out.length < 2) {
      const withExample = hypotheses.find((h) => h.evidence.some((e) => e.direction === 'supports' && (e.kind === 'experience' || e.kind === 'reflection')));
      if (withExample) {
        const q = withExample.evidence.find((e) => e.direction === 'supports' && (e.kind === 'experience' || e.kind === 'reflection'))!.quote;
        // 05R02: questions ask about concrete tasks and examples, never about personality labels.
        out.push({ text: `What part of “${q}” did you enjoy most?`, purpose: 'The specific part you enjoy says more than the activity’s name.' });
      } else if (hypotheses.length >= 2) {
        const a = byKey.get(hypotheses[0]!.subjectKeys[0]!)!;
        const b = byKey.get(hypotheses[1]!.subjectKeys[0]!)!;
        out.push({ text: `Which question sounds more interesting to you: “${a.typicalQuestions[0]}” or “${b.typicalQuestions[0]}”?`, purpose: 'Comparing the kinds of questions each field asks.' });
      }
    }
    return out.slice(0, 3);
  }

  // ---------------------------------------------------------------- comparison, decision, explanation

  private async compare(ctx: TaskContext, s: Extract<GoalsScope, { action: 'compare_options' }>) {
    const view = await this.goalsView(ctx);
    const gc = readGoalContext(view);
    const k = await this.knowledge(ctx, null, ['profiles', 'routes']);
    const byKey = new Map(k.profiles.map((p) => [p.key, p]));
    const profiles = s.subjectKeys.map((key) => byKey.get(key)).filter((p): p is SubjectProfile => !!p);
    if (profiles.length < 2) return failedResult(ctx, 'failed', 'Those options are not in the subject information yet.', 'unknown_subject');
    const hypotheses = generateHypotheses(gc, k.profiles, 10);
    const verified = new Map<string, string[]>();
    for (const r of k.routes) verified.set(r.note.subjectKey, [...(verified.get(r.note.subjectKey) ?? []), r.note.country]);
    const payload = this.empty('compare_options');
    payload.comparison = compareOptions(profiles, hypotheses, gc, s.dimensions ?? null, s.studentRatings as Record<string, Record<string, Rating>>, verified);
    payload.hypotheses = hypotheses.filter((h) => h.subjectKeys.some((x) => s.subjectKeys.includes(x))).slice(0, 5).map((h) => ({ ...h, preparation: null }));
    payload.goalState = 'comparing';
    if (payload.comparison.reputationNote) payload.notices.push({ code: 'reputation_unpacked', message: payload.comparison.reputationNote });
    payload.uncertainty = payload.comparison.missingInformation;
    return this.finish(ctx, payload, view.recordVersion, 'comparison_ready');
  }

  private async decision(ctx: TaskContext, s: Extract<GoalsScope, { action: 'decision_aid' }>) {
    const view = await this.goalsView(ctx);
    const k = await this.knowledge(ctx, s.subjectKeys, ['profiles']);
    if (k.profiles.length < 2) return failedResult(ctx, 'failed', 'Those options are not in the subject information yet.', 'unknown_subject');
    const payload = this.empty('decision_aid');
    payload.decisionAid = decisionAid(k.profiles, s.decisionKind, s.deadline ?? null, this.today(ctx, view, s.timezone));
    payload.goalState = 'comparing';
    payload.notices.push({ code: 'student_chooses', message: 'You make this choice. This summary separates what is harder to undo from what stays open.' });
    return this.finish(ctx, payload, view.recordVersion, 'decision_aid_ready', { decisionKeys: s.subjectKeys });
  }

  private async explain(ctx: TaskContext, s: Extract<GoalsScope, { action: 'explain_option' }>) {
    const view = await this.goalsView(ctx);
    const gc = readGoalContext(view);
    const k = await this.knowledge(ctx, [s.subjectKey], ['profiles', 'labor', 'routes']);
    const p = k.profiles[0];
    if (!p) return failedResult(ctx, 'failed', 'That field is not in the subject information yet.', 'unknown_subject');
    const payload = this.empty('explain_option');
    const guarantee = !!s.question && /\b(guarantee|guaranteed|promise|for sure|definitely)\b/i.test(s.question);
    payload.explanation = explainField(p, s.topic, k, gc, guarantee);
    if (guarantee) payload.notices.push({ code: 'no_guarantee', message: 'No one can guarantee a salary or an outcome for any subject, so I can only share what verified data describes and what it cannot tell you.' });
    return this.finish(ctx, payload, view.recordVersion, `explained_${s.topic}`);
  }

  // ---------------------------------------------------------------- student responses and reflections

  private async respond(ctx: TaskContext, s: Extract<GoalsScope, { action: 'respond_to_hypothesis' }>) {
    const t = await this.turn(ctx, s.turnId);
    const view = await this.goalsView(ctx);
    if (!view.current('hypothesis', s.hypothesisId, 'statement')) return failedResult(ctx, 'failed', 'That suggestion is not in your record.', 'unknown_hypothesis');
    if (ctx.request.actor.kind !== 'student') return failedResult(ctx, 'blocked', 'Only the student can accept or reject a suggestion about their own interests.', 'student_only');
    const evidence = [conversationEvidence(t.conversationId, t.turnId, UNKNOWN_PHRASES.test(t.text) ? undefined : t.text.slice(0, 200), t.modality, false)];
    const claims: ClaimInput[] = [buildClaim({ entity: 'hypothesis', entityId: s.hypothesisId, attribute: 'student_response', value: s.response, origin: 'student_statement', confirmation: 'student_confirmed', evidence, actor: ctx.request.actor, viaRole: '05' })];
    if (s.response === 'edited' && s.editedText) claims.push(buildClaim({ entity: 'interest', entityId: `interest_${s.hypothesisId}`, attribute: 'description', value: { text: s.editedText, lens: 'interest' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [conversationEvidence(t.conversationId, t.turnId, s.editedText.slice(0, 200), t.modality, false)], actor: ctx.request.actor, viaRole: '05' }));
    const res = await this.propose(ctx, view.recordVersion, claims, `respond:${s.hypothesisId}:${t.turnId}`, `hypothesis_${s.response}`);
    const notices: ExplorationPayload['notices'] = [];
    if (res.outcome !== 'accepted') notices.push({ code: 'not_recorded', message: 'Your response could not be saved; please try again.' });
    else if (s.response === 'rejected') notices.push({ code: 'suggestion_removed', message: 'Removed. You know your interests better than any suggestion, and it will not be suggested again unless you bring it up.' });
    else if (s.response === 'edited') notices.push({ code: 'suggestion_edited', message: 'Updated in your own words.' });
    else notices.push({ code: 'suggestion_kept', message: 'Kept as a tentative idea you can change at any time.' });
    const recorded = res.outcome === 'accepted' ? res.createdClaimIds.map((id, i) => ({ claimId: id, fieldKey: fieldKey(claims[i]!.field), statement: i === 0 ? `Your response: ${s.response.replace(/_/g, ' ')}` : `Interest: “${s.editedText}”` })) : [];
    return this.goalMap(ctx, true, undefined, notices, { recorded, action: 'respond_to_hypothesis' } as Partial<ExplorationPayload>);
  }

  private async reflect(ctx: TaskContext, s: Extract<GoalsScope, { action: 'record_reflection' }>) {
    const t = await this.turn(ctx, s.turnId);
    if (ctx.request.actor.kind !== 'student') return failedResult(ctx, 'blocked', 'Reflections are the student’s own words.', 'student_only');
    const before = await this.goalsView(ctx);
    const gcBefore = readGoalContext(before);
    const k = await this.knowledge(ctx, null, ['profiles']);
    const prior = new Map(generateHypotheses(gcBefore, k.profiles, 10).map((h) => [h.id, h.support]));
    const claim = buildClaim({ entity: 'reflection', entityId: `reflection_${t.turnId}`, attribute: 'text', value: { text: t.text.slice(0, 2000), about: s.about ?? null }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [conversationEvidence(t.conversationId, t.turnId, UNKNOWN_PHRASES.test(t.text) ? undefined : t.text.slice(0, 200), t.modality, false)], actor: ctx.request.actor, viaRole: '05' });
    const res = await this.propose(ctx, before.recordVersion, [claim], `reflection:${t.turnId}`, 'exploration_reflection');
    const notices: ExplorationPayload['notices'] = [];
    const recorded = res.outcome === 'accepted' ? [{ claimId: res.createdClaimIds[0]!, fieldKey: fieldKey(claim.field), statement: 'Your reflection, in your own words.' }] : [];
    if (res.outcome !== 'accepted') notices.push({ code: 'not_recorded', message: 'Your reflection could not be saved; please try again.' });
    const after = readGoalContext(await this.goalsView(ctx));
    const now = generateHypotheses(after, k.profiles, 10);
    const updates = now
      .filter((h) => prior.get(h.id) !== h.support)
      .map((h) => ({ hypothesisId: h.id, before: prior.get(h.id) ?? null, after: h.support, evidenceAdded: recorded[0]?.claimId ?? '' }))
      .filter((u) => u.evidenceAdded !== '');
    for (const u of updates) {
      const h = now.find((x) => x.id === u.hypothesisId)!;
      if (u.after === 'less_supported' || u.after === 'mixed') notices.push({ code: 'hypothesis_updated', message: `Thanks. Learning what you did not enjoy is useful information. ${h.label} stays as an option marked ${u.after.replace(/_/g, ' ')}; you can remove it whenever you like.` });
      else if (u.before === null) notices.push({ code: 'hypothesis_updated', message: `Based on what you just described, ${h.label.toLowerCase()} is now one of the options to explore. It stays tentative.` });
    }
    return this.goalMap(ctx, true, s.timezone, notices, { recorded, hypothesisUpdates: updates, action: 'record_reflection' } as Partial<ExplorationPayload>);
  }

  private async assessment(ctx: TaskContext, s: Extract<GoalsScope, { action: 'record_assessment' }>) {
    const t = await this.turn(ctx, s.turnId);
    const view = await this.goalsView(ctx);
    const i = s.instrument;
    // "Validated" only for the original instrument, unmodified, licensed, in a validated language version (05T05).
    const validationStatus = i.form === 'app_prompts' ? 'exploratory_prompts' : i.form === 'published_unmodified' && i.licensed && i.languageValidated ? 'validated_original' : 'modified_not_validated';
    const value = { instrument: i.name, version: i.version, language: i.language, administeredOn: i.administeredOn, scoringMethod: i.scoringMethod, validationStatus, consentContext: i.consentContext, results: s.results };
    const claim = buildClaim({ entity: 'assessment', entityId: `assessment_${t.turnId}`, attribute: 'result', value, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [conversationEvidence(t.conversationId, t.turnId, undefined, t.modality, false)], actor: ctx.request.actor, viaRole: '05' });
    const res = await this.propose(ctx, view.recordVersion, [claim], `assessment:${t.turnId}`, 'interest_inventory');
    const notices: ExplorationPayload['notices'] = [
      validationStatus === 'validated_original'
        ? { code: 'assessment_scope', message: `${i.name} results are one input for conversation. Interests are not the same as ability, admission chances or guaranteed satisfaction.` }
        : { code: 'assessment_not_validated', message: `Because these questions were ${validationStatus === 'modified_not_validated' ? 'changed from the published version, translated informally or used outside its license' : 'the app’s own prompts'}, they are treated as exploratory prompts, not as the validated ${i.name}. Interests are not the same as ability or admission chances.` },
    ];
    const recorded = res.outcome === 'accepted' ? [{ claimId: res.createdClaimIds[0]!, fieldKey: fieldKey(claim.field), statement: `${i.name}: ${validationStatus.replace(/_/g, ' ')}` }] : [];
    return this.goalMap(ctx, false, undefined, notices, { recorded, action: 'record_assessment' } as Partial<ExplorationPayload>);
  }

  private async prepareContact(ctx: TaskContext, s: Extract<GoalsScope, { action: 'prepare_contact' }>) {
    const view = await this.goalsView(ctx);
    const gc = readGoalContext(view);
    const k = await this.knowledge(ctx, null, ['profiles', 'experiments']);
    const exp = k.experiments.find((e) => e.id === s.experimentId);
    if (!exp || !exp.needs.includes('external_contact')) return failedResult(ctx, 'failed', 'That experiment does not involve contacting anyone.', 'not_a_contact_experiment');
    // The app prepares the message; sending it is a separate action the student must approve (05T14).
    const exactContent = [`Hello, I'm a student exploring whether I might enjoy this kind of work. Would you be willing to talk for about 20 minutes? I would like to ask:`, ...exp.contactQuestions.map((q) => `- ${q}`), 'Thank you for considering it.'].join('\n');
    const proposal = await ctx.call<ExternalActionProposal>('actions.propose', { kind: 'send_message', destination: `contact described by the student: ${s.contactDescription}`, exactContent, consequence: 'A message would be sent to this person. Nothing is sent unless you approve it, and you can edit it or send it yourself instead.' });
    const payload = this.empty('prepare_contact');
    const planned = chooseExperiments([], [exp], gc, this.today(ctx, view));
    payload.experiments = planned;
    payload.notices.push({ code: 'nothing_sent', message: 'I prepared a message and questions. Nothing has been sent; you can review it, change it, or send it yourself. A trusted adult or your school can help arrange the conversation.' });
    return this.finish(ctx, payload, view.recordVersion, 'contact_prepared', { externalActions: [proposal] });
  }

  // ---------------------------------------------------------------- result

  private finish(ctx: TaskContext, payload: ExplorationPayload, recordVersion: number, reason: string, extra: { externalActions?: ExternalActionProposal[]; decisionKeys?: string[] } = {}) {
    const handoffs: Handoff[] = [];
    const prepGaps = payload.hypotheses.filter((h) => h.preparation && /often help/.test(h.preparation));
    if (prepGaps.length > 0) handoffs.push({ toRole: '07', reason: 'Some options are commonly helped by school subjects not yet on record.', requestedOutcome: 'Check course options that would keep these routes open, within the student’s time and school offerings.', inputRefs: prepGaps.map((h) => `subject:${h.subjectKeys[0]}`), unresolved: [], completionCondition: 'A feasible course or preparation option, or a clear statement that none fits.' });
    if (extra.decisionKeys) handoffs.push({ toRole: '06', reason: 'A near-term choice depends on program requirements.', requestedOutcome: 'Check the formal subject requirements of specific programs for these options.', inputRefs: extra.decisionKeys.map((k) => `subject:${k}`), unresolved: [], completionCondition: 'Findings for the programs the student names.' });
    const routes = payload.explanation?.routesNeedingVerification ?? [];
    if (routes.length > 0) handoffs.push({ toRole: '11', reason: 'A professional route depends on the country.', requestedOutcome: `Find official information on the route to ${[...new Set(routes.map((r) => r.profession))].join(', ')} in ${[...new Set(routes.map((r) => r.country))].join(', ')}.`, inputRefs: [`subject:${payload.explanation!.subjectKey}`], unresolved: routes.map((r) => `${r.profession}:${r.country}`), completionCondition: 'An official source for each country, or a note that none was found.' });
    const needsOpportunities = payload.experiments.length === 0 && payload.hypotheses.length > 0;
    if (needsOpportunities) handoffs.push({ toRole: '09', reason: 'No built-in experiment fits; a concrete low-cost opportunity may help.', requestedOutcome: `Find free or low-cost ways to try ${payload.hypotheses[0]!.label.toLowerCase()} within the student’s constraints.`, inputRefs: payload.hypotheses.map((h) => `subject:${h.subjectKeys[0]}`), unresolved: [], completionCondition: 'A short list of feasible options or none found.' });

    const uncertainties: Uncertainty[] = [];
    for (const r of routes) uncertainties.push({ affects: `route:${payload.explanation!.subjectKey}:${r.country}`, description: `The professional route to ${r.profession} has not been verified for ${r.country === 'unspecified' ? 'your countries' : r.country}.`, resolution: 'Check the official regulator or program pages for that country.', consequence: 'changes_decision' });
    if (payload.explanation?.topic === 'earnings' && payload.explanation.earnings.length === 0) uncertainties.push({ affects: `earnings:${payload.explanation.subjectKey}`, description: 'No verified, current earnings data is available for this field.', resolution: 'Add an official labor-market source for the relevant country.', consequence: 'minor' });

    const status: ResultStatus = payload.explanation?.topic === 'earnings' && payload.explanation.earnings.length === 0 ? 'needs_source' : payload.hypotheses.length === 0 && payload.action === 'goal_map' && payload.questions.length > 0 ? 'needs_student_input' : 'completed';
    const sourceRefs = [...new Set([...(payload.explanation?.earnings.map((e) => e.sourceId) ?? []), ...(payload.explanation?.routes.map((r) => r.sourceId) ?? [])])];
    const cited = [...new Set([...payload.hypotheses.flatMap((h) => h.evidence.map((e) => e.claimId)), ...payload.attributedViews.map((v) => v.claimId), ...payload.recorded.map((r) => r.claimId)])].filter((id) => ctx.servedClaimIds.has(id));
    const summary =
      payload.action === 'explain_option'
        ? `${payload.explanation!.label}: ${payload.explanation!.topic.replace(/_/g, ' ')}. General information; programs and countries differ.`
        : payload.action === 'compare_options'
          ? `Compared ${payload.comparison!.options.map((o) => o.label).join(' and ')} on the dimensions shown. You make the choice.`
          : payload.action === 'decision_aid'
            ? 'Summarized what is harder to undo and what stays open for each option. You make the choice.'
            : payload.action === 'prepare_contact'
              ? 'Prepared questions and a draft message. Nothing has been sent.'
              : payload.hypotheses.length > 0
                ? `${payload.hypotheses.length} tentative option${payload.hypotheses.length === 1 ? '' : 's'} to explore, each tied to what you said${payload.experiments.length > 0 ? `, and ${payload.experiments.length} small experiment${payload.experiments.length === 1 ? '' : 's'} to try` : ''}.`
                : 'No specific fields yet; a few small experiments or examples will help.';
    return makeResult(ctx, {
      status,
      summary,
      payload,
      claimIds: cited,
      recordVersion,
      sourceRefs,
      uncertainties,
      handoffs,
      externalActions: extra.externalActions ?? [],
      completionReason: reason,
    });
  }
}

function goalStateOf(gc: GoalContext, hypotheses: readonly Hypothesis[]): ExplorationPayload['goalState'] {
  if (gc.decisionHorizon === 'comparing_narrowed_options') return 'comparing';
  if (hypotheses.some((h) => h.support === 'several_examples') && (gc.decisionHorizon === 'university_subject_choice' || gc.decisionHorizon === 'school_course_choice')) return 'narrowing';
  return 'exploring';
}

export type { Hypothesis, PlannedExperiment };
