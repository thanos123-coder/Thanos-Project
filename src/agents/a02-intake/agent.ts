import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { isAbsence } from '../../shared/absence.js';
import type { Handoff, ResultStatus, Uncertainty } from '../../shared/envelopes.js';
import { AccessDeniedError } from '../../shared/errors.js';
import type { EvidenceRef } from '../../shared/evidence.js';
import { fieldKey, type ClaimInput, type Holder } from '../../shared/facts.js';
import { FIELD_CATALOG } from '../../shared/fields.js';
import { sha256Hex, stableStringify } from '../../shared/hash.js';
import type { DataCategory } from '../../shared/permissions.js';
import { calendarDateInZone, isValidTimezone } from '../../shared/time.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import type { FieldView, MutationResponse } from '../a04-record-steward/types.js';
import { UNKNOWN_PHRASES } from '../a04-record-steward/validation.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import {
  emptyInterpretation,
  interpretAnswer,
  isPartialCandidate,
  opportunisticFacts,
  questionForTemplate,
  resolvePending,
  supportNotices,
  type Clarification,
  type FactDraft,
  type InterpretContext,
  type Interpretation,
  type Notice,
  type PendingDraft,
  type Unresolved,
} from './interpreter.js';
import { interpretWithModel } from './model-interpret.js';
import * as P from './parsers.js';
import { planQuestions, type PlannedQuestion } from './planner.js';
import { questionIsPermitted, TEMPLATE_BY_FIELD, TEMPLATE_BY_ID, type Objective } from './question-bank.js';
import { buildReview, catalogKeyOf, REVIEW_NOTE, statementFor, unreviewedItems, visibilityNote, type ReviewEntry } from './review.js';
import type { IntakeSession, PendingConfirmation, ReviewItem, Turn } from './sessions.js';

/**
 * Agent 02 — Intake interviewer.
 *
 * Learns enough about the student to support the current task while keeping
 * the conversation understandable, respectful and easy to correct. Its product
 * is proposed facts and unresolved questions, never a psychological profile or
 * an admission judgment. The question planner, the renderer (text or voice
 * wording) and the answer interpreter are functions of this one role; facts are
 * proposed to Agent 04, which validates and commits them, so there is no
 * separate intake profile that can drift from the canonical record (02R09).
 */

export const OBJECTIVES = ['onboarding', 'find_opportunities', 'check_eligibility', 'explore_majors', 'academic_plan', 'experience_review', 'fill_gaps'] as const satisfies readonly Objective[];

const SessionRef = { sessionId: z.string().min(1) };

export const IntakeScopeSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      objective: z.enum(OBJECTIVES),
      mode: z.enum(['text', 'voice']).default('text'),
      locale: z.string().min(2).max(35).default('en'),
      /** The student's IANA timezone, for resolving "next June" (defaults to UTC). */
      timezone: z.string().refine(isValidTimezone).optional(),
      conversationId: z.string().min(1).optional(),
      /** Field keys a specialist needs (fill_gaps), e.g. "course:c1.level". */
      targetFields: z.array(z.string().min(3)).max(20).default([]),
      /** Wording suggested by the requesting specialist, keyed by field key; validated like any generated question. */
      handoffQuestions: z.record(z.string(), z.string().max(300)).default({}),
    })
    .strict(),
  z.object({ action: z.literal('answer'), ...SessionRef, turnId: z.string().min(1), timezone: z.string().refine(isValidTimezone).optional() }).strict(),
  z.object({ action: z.literal('review'), ...SessionRef }).strict(),
  z
    .object({
      action: z.literal('confirm_review'),
      ...SessionRef,
      decisions: z
        .array(z.object({ claimId: z.string().min(1), decision: z.enum(['approve', 'edit', 'leave_unresolved']), turnId: z.string().min(1).optional() }).strict())
        .min(1)
        .max(40),
    })
    .strict(),
  z.object({ action: z.literal('correct'), ...SessionRef, fieldKey: z.string().min(3), turnId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('reinterpret'), ...SessionRef, turnId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('switch_mode'), ...SessionRef, mode: z.enum(['text', 'voice']) }).strict(),
  z.object({ action: z.literal('stop'), ...SessionRef }).strict(),
]);
export type IntakeScope = z.infer<typeof IntakeScopeSchema>;

const QuestionOutSchema = z
  .object({
    questionId: z.string(),
    kind: z.enum(['ask', 'confirm_imported', 'resolve_conflict', 'confirm_pending', 'targeted', 'clarify']),
    text: z.string().min(1),
    purpose: z.string(),
    options: z.array(z.string()),
    allowSkip: z.boolean(),
    allowDontKnow: z.boolean(),
    allowNotDecided: z.boolean(),
    sensitivity: z.enum(['standard', 'sensitive']),
    visibilityNote: z.string(),
    explanation: z.string().nullable(),
    reasons: z.array(z.string()),
  })
  .strict();
export type QuestionOut = z.infer<typeof QuestionOutSchema>;

const ReviewEntrySchema = z
  .object({
    claimId: z.string(),
    fieldKey: z.string(),
    label: z.string(),
    statement: z.string().min(1),
    heard: z.string().nullable(),
    modality: z.enum(['text', 'voice']),
    consequential: z.boolean(),
    confirmation: z.string(),
    tentative: z.boolean(),
    changedSince: z.boolean(),
    absent: z.boolean(),
  })
  .strict();

export const IntakePayloadSchema = z
  .object({
    sessionId: z.string(),
    conversationId: z.string(),
    action: z.string(),
    objective: z.string(),
    mode: z.enum(['text', 'voice']),
    locale: z.string(),
    localeFallback: z.boolean(),
    nextQuestion: QuestionOutSchema.nullable(),
    additionalQuestions: z.array(QuestionOutSchema),
    skipped: z.array(z.object({ questionId: z.string(), reason: z.string() }).strict()),
    recorded: z.array(
      z
        .object({
          claimId: z.string(),
          fieldKey: z.string(),
          label: z.string(),
          statement: z.string().min(1),
          confirmation: z.string(),
          lifecycle: z.string(),
          attributedTo: z.string().nullable(),
          supersededClaimIds: z.array(z.string()),
        })
        .strict(),
    ),
    notRecorded: z.array(z.object({ field: z.string(), reason: z.string() }).strict()),
    pendingConfirmations: z.array(z.object({ id: z.string(), question: z.string(), options: z.array(z.string()), reason: z.string() }).strict()),
    unresolved: z.array(z.object({ field: z.string(), reason: z.string(), evidenceRoute: z.string().nullable() }).strict()),
    review: z.object({ items: z.array(ReviewEntrySchema), note: z.string() }).strict().nullable(),
    enoughForObjective: z.boolean(),
    nextAction: z.enum(['answer_question', 'confirm_value', 'review', 'offer_document_import', 'proceed', 'paused', 'support_referral', 'mode_handoff']),
    canProceed: z.array(z.string()),
    waitingOn: z.array(z.string()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    modeHandoff: z
      .object({ mode: z.enum(['interview_practice', 'essay_brainstorming']), message: z.string(), requiresExplicitChoice: z.literal(true), scoring: z.literal('none_during_intake') })
      .strict()
      .nullable(),
    invalidatedArtifacts: z.number().int().nonnegative(),
    sessionStatus: z.enum(['active', 'paused', 'completed']),
  })
  .strict();
export type IntakePayload = z.infer<typeof IntakePayloadSchema>;

export const INTAKE_CONTRACT: ContractDefinition<IntakePayload> = {
  id: 'intake_turn_v1',
  role: '02',
  payload: IntakePayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    for (const q of [p.nextQuestion, ...p.additionalQuestions]) {
      if (q && !questionIsPermitted(q.text)) issues.push(`question ${q.questionId} asks about a prohibited private topic`);
      if (q && /\b(you must want|surely you|don'?t you want)\b/i.test(q.text)) issues.push(`question ${q.questionId} uses leading wording`);
    }
    if (p.enoughForObjective && p.nextQuestion !== null) issues.push('next_question must be omitted when the task has enough information');
    if (p.nextQuestion === null && p.additionalQuestions.length > 0) issues.push('additional questions without a main question');
    if (p.modeHandoff && p.nextAction !== 'mode_handoff') issues.push('a mode change must be offered explicitly');
    if (p.mode === 'voice' && p.additionalQuestions.length > 0) issues.push('voice mode asks one main question at a time');
    return issues;
  },
};

const OBJECTIVE_LABEL: Record<Objective, string> = {
  onboarding: 'initial plan',
  find_opportunities: 'opportunity search',
  check_eligibility: 'eligibility check',
  explore_majors: 'major exploration',
  academic_plan: 'academic plan',
  experience_review: 'activity review',
  fill_gaps: 'requested update',
};

const SUPPORTED_LOCALE = /^en(-|$)/i;

function dateConventionFor(locale: string): IntakeSession['dateConvention'] {
  const region = /-([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
  if (!region) return 'unknown';
  if (region === 'US') return 'month_first';
  if (region === 'CA') return 'unknown';
  return 'day_first';
}

function effectiveModality(t: Turn): 'text' | 'voice' {
  // A transcript the student corrected by typing is the student's typed words.
  return t.modality === 'voice' && t.originalRecognition === null ? 'voice' : 'text';
}

function asTyped(t: Turn): Turn {
  return effectiveModality(t) === 'text' && t.modality === 'voice' ? { ...t, modality: 'text', segments: [], speakerLabel: 'primary' } : t;
}

interface Outcome {
  recorded: IntakePayload['recorded'];
  notRecorded: IntakePayload['notRecorded'];
  notices: Notice[];
  unresolved: Unresolved[];
  invalidated: number;
  recordVersion: number | null;
}

export class IntakeInterviewerAgent implements SpecialistAgent {
  readonly role = '02' as const;
  readonly contracts = [INTAKE_CONTRACT];

  constructor(private readonly model: ModelGateway) {}

  async handle(ctx: TaskContext) {
    const parsed = IntakeScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The intake request was incomplete.', 'invalid_scope');
    const kind = ctx.request.actor.kind;
    if (kind !== 'student' && kind !== 'supporter' && kind !== 'school_counselor') return failedResult(ctx, 'blocked', 'Intake runs on behalf of the student, a supporter or a counselor.', 'actor_not_supported');
    try {
      const scope = parsed.data;
      switch (scope.action) {
        case 'start':
          return await this.start(ctx, scope);
        case 'answer':
          return await this.answer(ctx, scope);
        case 'review':
          return await this.review(ctx, scope);
        case 'confirm_review':
          return await this.confirmReview(ctx, scope);
        case 'correct':
          return await this.correct(ctx, scope);
        case 'reinterpret':
          return await this.reinterpret(ctx, scope);
        case 'switch_mode':
          return await this.switchMode(ctx, scope);
        case 'stop':
          return await this.stop(ctx, scope);
      }
    } catch (e) {
      if (e instanceof AccessDeniedError) return failedResult(ctx, 'blocked', 'That is not available with the current permissions.', e.code);
      throw e;
    }
  }

  // ---------------------------------------------------------------- tools

  private sessionCall(ctx: TaskContext, args: Record<string, unknown>): Promise<IntakeSession> {
    return ctx.call<IntakeSession>('intake.session', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, ...args });
  }

  private readTurn(ctx: TaskContext, turnId: string): Promise<Turn> {
    return ctx.call<Turn>('conversation.read_turn', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, turnId });
  }

  private today(ctx: TaskContext, tz?: string): string {
    return calendarDateInZone(ctx.clock.nowIso(), tz ?? 'UTC');
  }

  // ---------------------------------------------------------------- actions

  private async start(ctx: TaskContext, scope: Extract<IntakeScope, { action: 'start' }>) {
    const notices: Notice[] = [];
    const supported = SUPPORTED_LOCALE.test(scope.locale);
    if (!supported) {
      notices.push({ code: 'locale_fallback', message: 'Questions are available in English for now. You can answer in English or choose from the options, and I will check anything I am unsure about. A counselor can also help if that is easier.' });
    }
    const handoffQuestions: Record<string, string> = {};
    for (const [k, v] of Object.entries(scope.handoffQuestions)) {
      if (questionIsPermitted(v) && /\?\s*$/.test(v.trim())) handoffQuestions[k] = v.trim();
      else notices.push({ code: 'generated_question_rejected', message: 'A requested question was not appropriate, so a standard question is used instead.' });
    }
    const targetFields = scope.targetFields.filter((k) => {
      const m = /^([^:]+):([^.]+)\.(.+)$/.exec(k);
      return !!m && FIELD_CATALOG.has(`${m[1]}.${m[3]}`);
    });
    const createArgs: Record<string, unknown> = { op: 'create', objective: scope.objective, mode: scope.mode, locale: scope.locale, localeFallback: !supported, dateConvention: dateConventionFor(scope.locale), targetFields, handoffQuestions };
    if (scope.conversationId) createArgs['conversationId'] = scope.conversationId;
    let session = await this.sessionCall(ctx, createArgs);
    const view = await readView(ctx, 'local');
    const out = emptyOutcome();
    out.notices.push(...notices);
    return this.finish(ctx, session, view, out, { action: 'start' }, (s) => (session = s));
  }

  private async answer(ctx: TaskContext, scope: Extract<IntakeScope, { action: 'answer' }>) {
    let session = await this.sessionCall(ctx, { op: 'read', sessionId: scope.sessionId });
    const rawTurn = await this.readTurn(ctx, scope.turnId);
    const out = emptyOutcome();
    if (rawTurn.conversationId !== session.conversationId || rawTurn.role !== 'student') {
      return failedResult(ctx, 'failed', 'That message is not part of this interview.', 'turn_not_in_session');
    }
    if (rawTurn.actorId !== ctx.request.actor.id) {
      // A turn written from another account is never recorded as this person's statement.
      return failedResult(ctx, 'blocked', 'That message was written from a different account, so it cannot be recorded here.', 'turn_actor_mismatch');
    }
    if (session.turnQuestions[rawTurn.turnId]) {
      // The same turn was already processed (e.g. a double submit): report the current state, change nothing.
      const view = await readView(ctx, 'local');
      out.notices.push({ code: 'not_recorded', message: 'That answer was already received.' });
      return this.finish(ctx, session, view, out, { action: 'answer' }, (s) => (session = s), { keepQuestions: true, skipSave: true });
    }
    if (session.status !== 'active') session = { ...session, status: 'active' };
    const turn = asTyped(rawTurn);
    const text = turn.text.trim();

    const support = supportNotices(text);
    out.notices.push(...support.notices);
    if (support.crisis) {
      session = { ...session, status: 'paused' };
      session = await this.sessionCall(ctx, { op: 'save', session });
      const view = await readView(ctx, 'local');
      return this.finish(ctx, session, view, out, { action: 'answer', crisis: true }, (s) => (session = s), { skipSave: true });
    }
    const modeRequest = P.modeChangeRequest(text);
    if (modeRequest) {
      const view = await readView(ctx, 'local');
      return this.finish(ctx, session, view, out, { action: 'answer', modeRequest }, (s) => (session = s), { keepQuestions: true });
    }

    const view = await readView(ctx, 'local');
    const interp = await this.interpretTurn(ctx, session, view, turn, session.lastQuestions, {});
    session = this.applyInterpretation(session, interp, turn, session.lastQuestions);
    if (interp.redactions.length > 0) {
      await ctx.call('conversation.redact_turn', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, turnId: turn.turnId, spans: interp.redactions });
    }
    const committed = await this.commit(ctx, session, view, turn, interp.facts, out, `answer:${turn.turnId}`);
    session = committed.session;
    out.notices.push(...interp.notices);
    out.unresolved.push(...interp.unresolved);
    const fresh = await readView(ctx, 'local');
    return this.finish(ctx, session, fresh, out, { action: 'answer', clarification: interp.clarification }, (s) => (session = s));
  }

  private async review(ctx: TaskContext, scope: Extract<IntakeScope, { action: 'review' }>) {
    let session = await this.sessionCall(ctx, { op: 'read', sessionId: scope.sessionId });
    const view = await readView(ctx, 'local');
    return this.finish(ctx, session, view, emptyOutcome(), { action: 'review', showReview: true }, (s) => (session = s), { keepQuestions: true });
  }

  private async confirmReview(ctx: TaskContext, scope: Extract<IntakeScope, { action: 'confirm_review' }>) {
    let session = await this.sessionCall(ctx, { op: 'read', sessionId: scope.sessionId });
    const view = await readView(ctx, 'local');
    const out = emptyOutcome();
    const entries = new Map(buildReview(session, view).map((e) => [e.claimId, e]));
    const actor = ctx.request.actor;
    const claims: Array<{ claim: ClaimInput; review: Omit<ReviewItem, 'claimId'>; supersedes: string }> = [];
    for (const d of scope.decisions) {
      const entry = entries.get(d.claimId);
      if (!entry) {
        out.notRecorded.push({ field: d.claimId, reason: 'not part of this review' });
        continue;
      }
      if (d.decision === 'leave_unresolved') continue;
      const fv = view.fieldByKey(entry.fieldKey);
      const cur = fv?.current;
      if (!fv || !cur || cur.claimId !== entry.claimId) {
        out.notRecorded.push({ field: entry.label, reason: 'this changed since the review was shown; please review it again' });
        continue;
      }
      const item = [...session.reviewItems].reverse().find((r) => r.fieldKey === entry.fieldKey)!;
      if (d.decision === 'approve') {
        if (cur.confirmation !== 'unreviewed') continue;
        if (actor.kind !== 'student') {
          out.notRecorded.push({ field: entry.label, reason: 'only the student can confirm their own record' });
          continue;
        }
        const evidence: EvidenceRef[] = [conversationEvidence(session.conversationId, item.turnId, UNKNOWN_PHRASES.test(item.heard) ? undefined : item.heard || undefined, item.modality, false)];
        if (d.turnId) {
          const t = await this.readTurn(ctx, d.turnId);
          evidence.push(conversationEvidence(session.conversationId, t.turnId, t.text.slice(0, 280), effectiveModality(t), false));
        }
        claims.push({
          claim: this.claimFromView(ctx, fv, cur.value, cur.lifecycle, evidence, 'student_confirmed', [cur.claimId], cur.validity),
          review: { fieldKey: entry.fieldKey, turnId: item.turnId, modality: item.modality, heard: item.heard, tentative: item.tentative, questionId: item.questionId },
          supersedes: cur.claimId,
        });
        continue;
      }
      // edit
      if (!d.turnId) {
        out.notRecorded.push({ field: entry.label, reason: 'an edit needs the corrected answer' });
        continue;
      }
      const t = asTyped(await this.readTurn(ctx, d.turnId));
      const q = this.questionForField(fv);
      if (!q) {
        out.notRecorded.push({ field: entry.label, reason: 'this field can be edited from your profile page' });
        continue;
      }
      const facts = this.parseCorrection(ctx, session, view, q, t);
      const f = facts.find((x) => x.field.attribute === fv.field.attribute);
      if (!f) {
        out.notRecorded.push({ field: entry.label, reason: 'I could not read that correction; please rephrase it' });
        continue;
      }
      const confirmation = actor.kind === 'student' && effectiveModality(t) === 'text' ? 'student_confirmed' : 'unreviewed';
      const evidence = [conversationEvidence(session.conversationId, t.turnId, UNKNOWN_PHRASES.test(f.quote) ? undefined : f.quote, effectiveModality(t), f.recognitionUncertain)];
      claims.push({
        claim: this.claimFromView(ctx, fv, f.value, f.lifecycle, evidence, confirmation, [cur.claimId], {}),
        review: { fieldKey: entry.fieldKey, turnId: t.turnId, modality: effectiveModality(t), heard: f.quote, tentative: f.tentative, questionId: item.questionId },
        supersedes: cur.claimId,
      });
    }
    if (claims.length > 0) {
      const res = await this.propose(ctx, view.recordVersion, 'confirm_claim', claims.map((c) => c.claim), `review:${scope.sessionId}:${scope.decisions.map((d) => `${d.claimId}=${d.decision}`).join(',')}`, `intake_review:${scope.sessionId}`);
      if (res.outcome === 'accepted') {
        out.invalidated += res.invalidatedArtifactIds.length;
        out.recordVersion = res.recordVersion ?? null;
        res.createdClaimIds.forEach((id, i) => {
          const c = claims[i]!;
          session.reviewItems.push({ claimId: id, ...c.review });
          out.recorded.push(this.recordedEntry(id, c.claim, [c.supersedes]));
        });
      } else out.notRecorded.push(...claims.map((c) => ({ field: FIELD_CATALOG.get(`${c.claim.field.entity}.${c.claim.field.attribute}`)?.label ?? 'information', reason: res.reasons[0] ?? res.outcome })));
    }
    const fresh = await readView(ctx, 'local');
    return this.finish(ctx, session, fresh, out, { action: 'confirm_review', showReview: true }, (s) => (session = s), { keepQuestions: true });
  }

  private async correct(ctx: TaskContext, scope: Extract<IntakeScope, { action: 'correct' }>) {
    let session = await this.sessionCall(ctx, { op: 'read', sessionId: scope.sessionId });
    const view = await readView(ctx, 'local');
    const out = emptyOutcome();
    const fv = view.fieldByKey(scope.fieldKey);
    const q = fv ? this.questionForField(fv) : null;
    if (!fv || !q) {
      out.notRecorded.push({ field: scope.fieldKey, reason: 'this field is not available to correct here' });
      return this.finish(ctx, session, view, out, { action: 'correct' }, (s) => (session = s), { keepQuestions: true });
    }
    const turn = asTyped(await this.readTurn(ctx, scope.turnId));
    if (turn.actorId !== ctx.request.actor.id) return failedResult(ctx, 'blocked', 'That message was written from a different account.', 'turn_actor_mismatch');
    const facts = this.parseCorrection(ctx, session, view, q, turn);
    const f = facts.find((x) => x.field.attribute === fv.field.attribute);
    if (!f) {
      out.notRecorded.push({ field: fv.label, reason: 'I could not read that correction; please rephrase it' });
      return this.finish(ctx, session, view, out, { action: 'correct' }, (s) => (session = s), { keepQuestions: true });
    }
    const cur = fv.current;
    if (cur && stableStringify(cur.value) === stableStringify(f.value)) {
      out.notices.push({ code: 'correction_recorded', message: 'That already matches what is recorded, so nothing changed.' });
      return this.finish(ctx, session, view, out, { action: 'correct' }, (s) => (session = s), { keepQuestions: true });
    }
    const own = cur && (cur.origin === 'student_statement' || cur.origin === 'supporter_statement' || cur.origin === 'counselor_statement');
    const actor = ctx.request.actor;
    const confirmation = actor.kind === 'student' && effectiveModality(turn) === 'text' ? 'student_confirmed' : 'unreviewed';
    const evidence = [conversationEvidence(session.conversationId, turn.turnId, UNKNOWN_PHRASES.test(f.quote) ? undefined : f.quote, effectiveModality(turn), f.recognitionUncertain)];
    const supersedes = own && cur ? [cur.claimId] : [];
    const claim = this.claimFromView(ctx, fv, f.value, f.lifecycle, evidence, confirmation, supersedes, {});
    const res = await this.propose(ctx, view.recordVersion, 'add_claims', [claim], `correct:${scope.fieldKey}:${turn.turnId}`, `intake_correction:${scope.sessionId}`);
    if (res.outcome === 'accepted') {
      const id = res.createdClaimIds[0]!;
      session.reviewItems.push({ claimId: id, fieldKey: scope.fieldKey, turnId: turn.turnId, modality: effectiveModality(turn), heard: f.quote, tentative: f.tentative, questionId: q.questionId });
      out.recorded.push(this.recordedEntry(id, claim, res.supersededClaimIds));
      out.invalidated += res.invalidatedArtifactIds.length;
      out.recordVersion = res.recordVersion ?? null;
      out.notices.push({ code: 'correction_recorded', message: `${res.studentSummary}${res.invalidatedArtifactIds.length > 0 ? ` ${res.invalidatedArtifactIds.length} result${res.invalidatedArtifactIds.length === 1 ? ' that used the old value is' : 's that used the old value are'} marked for an update.` : ''} The earlier answer is kept in the history.` });
    } else out.notRecorded.push({ field: fv.label, reason: res.reasons[0] ?? res.outcome });
    const fresh = await readView(ctx, 'local');
    return this.finish(ctx, session, fresh, out, { action: 'correct' }, (s) => (session = s), { keepQuestions: true });
  }

  private async reinterpret(ctx: TaskContext, scope: Extract<IntakeScope, { action: 'reinterpret' }>) {
    let session = await this.sessionCall(ctx, { op: 'read', sessionId: scope.sessionId });
    const raw = await this.readTurn(ctx, scope.turnId);
    if (raw.conversationId !== session.conversationId || raw.actorId !== ctx.request.actor.id) return failedResult(ctx, 'blocked', 'That message is not part of this interview.', 'turn_not_in_session');
    const turn = asTyped(raw);
    const view = await readView(ctx, 'local');
    const out = emptyOutcome();
    const questions = session.turnQuestions[turn.turnId] ?? [];
    const previous = new Map(session.reviewItems.filter((r) => r.turnId === turn.turnId).map((r) => [r.fieldKey, r.claimId]));
    const interp = await this.interpretTurn(ctx, { ...session, pending: session.pending.filter((p) => p.sourceTurnId !== turn.turnId) }, view, turn, questions, { correction: true });
    // The student typed the corrected transcript themselves, so the corrected values are their confirmed words.
    if (raw.originalRecognition !== null && ctx.request.actor.kind === 'student') for (const f of interp.facts) if (!isAbsence(f.value)) f.confirmed = true;
    session = { ...session, pending: session.pending.filter((p) => p.sourceTurnId !== turn.turnId) };
    session = this.applyInterpretation(session, interp, turn, questions, { keepLastQuestions: true });
    const committed = await this.commit(ctx, session, view, turn, interp.facts, out, `reinterpret:${turn.turnId}:${sha256Hex(turn.text).slice(0, 16)}`, previous);
    session = committed.session;
    if (out.recorded.some((r) => r.supersededClaimIds.length > 0)) out.notices.push({ code: 'correction_recorded', message: 'Your corrected transcript was read again and the record was updated. The earlier reading is kept in the history.' });
    out.notices.push(...interp.notices);
    out.unresolved.push(...interp.unresolved);
    const fresh = await readView(ctx, 'local');
    return this.finish(ctx, session, fresh, out, { action: 'reinterpret', clarification: interp.clarification }, (s) => (session = s));
  }

  private async switchMode(ctx: TaskContext, scope: Extract<IntakeScope, { action: 'switch_mode' }>) {
    let session = await this.sessionCall(ctx, { op: 'read', sessionId: scope.sessionId });
    const out = emptyOutcome();
    const from = session.mode;
    session = { ...session, mode: scope.mode, status: 'active' };
    if (from !== scope.mode) {
      out.notices.push({ code: 'not_recorded', message: scope.mode === 'text' ? 'Switched to text. Everything already confirmed is kept, and you can correct any transcript line.' : 'Switched to voice. Everything already confirmed is kept; I will ask one question at a time.' });
    }
    const view = await readView(ctx, 'local');
    // The same question plan continues in the new modality; nothing is asked again from the start.
    return this.finish(ctx, session, view, out, { action: 'switch_mode' }, (s) => (session = s));
  }

  private async stop(ctx: TaskContext, scope: Extract<IntakeScope, { action: 'stop' }>) {
    let session = await this.sessionCall(ctx, { op: 'read', sessionId: scope.sessionId });
    session = { ...session, status: 'paused' };
    const view = await readView(ctx, 'local');
    return this.finish(ctx, session, view, emptyOutcome(), { action: 'stop' }, (s) => (session = s));
  }

  // ---------------------------------------------------------------- interpretation

  private async interpretTurn(ctx: TaskContext, session: IntakeSession, view: RecordView, turn: Turn, questions: readonly PlannedQuestion[], opts: { correction?: boolean }): Promise<Interpretation & { resolvedPending: string[] }> {
    const result: Interpretation & { resolvedPending: string[] } = { ...emptyInterpretation(), resolvedPending: [] };
    const base = this.interpretBase(ctx, session, view, turn);
    const group = questions.length > 1;
    const perQuestion: Interpretation[] = [];
    let modelUsed = false;

    for (const q of questions) {
      const qctx: InterpretContext = { ...base, question: q, clarificationsUsed: session.clarifications[q.questionId] ?? 0, carry: session.carry[q.questionId] };
      if (q.questionId.startsWith('confirm:')) {
        const pending = session.pending.find((p) => `confirm:${p.id}` === q.questionId);
        if (!pending) continue;
        perQuestion.push(this.resolvePendingAnswer(pending, turn, qctx, session, result));
        continue;
      }
      if (q.kind === 'confirm_imported' || q.kind === 'resolve_conflict') {
        perQuestion.push(this.answerExisting(q, turn, qctx, view));
        continue;
      }
      let interp = interpretAnswer(qctx);
      // Model help for free text, used only to segment and attribute the student's own words.
      const t = q.templateId ? TEMPLATE_BY_ID.get(q.templateId) : undefined;
      if (!modelUsed && t && ['interest', 'free_text', 'activities'].includes(t.answerType) && this.model.configured && P.controlAnswer(turn.text) === null && turn.text.trim().split(/\s+/).length >= 6 && interp.pending.length === 0) {
        modelUsed = true;
        const actorKind = ctx.request.actor.kind as 'student' | 'supporter' | 'school_counselor';
        const m = await interpretWithModel(ctx, this.model, { question: q, template: t, answer: turn.text, turnId: turn.turnId, actorKind, actorId: ctx.request.actor.id, recognitionUncertain: turn.modality === 'voice' });
        if (m) {
          result.notices.push(...m.notices);
          if (m.facts.length > 0) {
            interp = { ...interp, facts: m.facts, clarification: null, settled: [...new Set([...interp.settled, q.questionId])], unresolved: interp.unresolved.filter((u) => u.reason !== 'unclear_answer') };
          } else if (m.followUp && (session.clarifications[q.questionId] ?? 0) === 0) {
            interp = { ...interp, clarification: { questionId: q.questionId, text: m.followUp, options: [], templateId: q.templateId, field: q.field } };
          }
        }
      }
      perQuestion.push(interp);
    }

    // In a text group, questions the answer did not address stay open instead of each getting a follow-up.
    const addressed = perQuestion.filter((i) => i.facts.length > 0 || i.pending.length > 0);
    for (const i of perQuestion) {
      result.facts.push(...i.facts);
      result.pending.push(...i.pending);
      result.notices.push(...i.notices);
      result.redactions.push(...i.redactions);
      if (group && addressed.length > 0 && i.facts.length === 0 && i.pending.length === 0) continue;
      Object.assign(result.carry, i.carry);
      result.settled.push(...i.settled);
      result.unresolved.push(...i.unresolved);
      if (!result.clarification && i.clarification) result.clarification = i.clarification;
    }

    // Explicit extra facts for other fields ("I'm in Year 12, doing the IB").
    if (!opts.correction) {
      const asked = new Set(questions.map((q) => q.templateId).filter((x): x is string => !!x));
      const q0 = questions[0] ?? { questionId: 'unsolicited', kind: 'ask', text: '', purpose: '', field: { entity: 'student', entityId: 'self', attribute: 'goals.current_objective' }, reasons: [], options: [], allowSkip: true, allowDontKnow: true, sensitivity: 'standard', claimIds: [], templateId: null };
      for (const f of opportunisticFacts(turn.text, { ...base, question: q0 as PlannedQuestion, clarificationsUsed: 0, carry: undefined }, asked)) {
        const existing = view.student(f.field.attribute);
        const alreadyRecording = result.facts.some((x) => x.field.entity === f.field.entity && x.field.attribute === f.field.attribute);
        if ((!existing || existing.state === 'absent') && !alreadyRecording) result.facts.push(f);
      }
    }

    // Neutral handling of a contradiction with an earlier statement (02 "Handling conflicting answers").
    if (!opts.correction) {
      const kindOf = new Map(questions.map((q) => [q.questionId, q.kind]));
      for (const f of [...result.facts]) {
        if (f.confirmed || f.field.entity !== 'student' || isAbsence(f.value)) continue;
        // Answers to "is that still right?" or "which should I use?" are explicit corrections already.
        const k = kindOf.get(f.questionId);
        if (k === 'confirm_imported' || k === 'resolve_conflict' || k === 'targeted' || f.questionId.startsWith('confirm:')) continue;
        const fv = view.student(f.field.attribute);
        const cur = fv?.state === 'current' ? fv.current : undefined;
        if (!cur || isAbsence(cur.value) || stableStringify(cur.value) === stableStringify(f.value)) continue;
        // Only the student's own earlier statement is contrasted; a document value is handled by the record's field policy.
        if (!['student_statement', 'supporter_statement', 'counselor_statement'].includes(cur.origin)) continue;
        const catalog = `student.${f.field.attribute}`;
        const oldText = statementFor(catalog, cur.value, cur.lifecycle).replace(/^[^:]+: /, '');
        const newText = f.display.replace(/^[^:]+: /, '');
        result.facts = result.facts.filter((x) => x !== f);
        result.pending.push({
          field: f.field,
          candidates: [f.value, cur.value],
          candidateLabels: [newText, oldText],
          lifecycle: f.lifecycle === 'enrolled' || f.lifecycle === 'cancelled' ? 'current' : f.lifecycle,
          question: `Earlier we had ${oldText}, and you just said ${newText}. Which should I use for this plan?`,
          sourceTurnId: turn.turnId,
          quote: f.quote,
          modality: turn.modality,
          recognitionUncertain: f.recognitionUncertain,
          reason: 'conflict',
          templateId: TEMPLATE_BY_FIELD.get(catalog)?.id ?? null,
          questionId: f.questionId,
          existingClaimIds: [cur.claimId],
        });
      }
    }
    result.settled = [...new Set(result.settled)];
    return result;
  }

  private interpretBase(ctx: TaskContext, session: IntakeSession, view: RecordView, turn: Turn): Omit<InterpretContext, 'question' | 'clarificationsUsed' | 'carry'> {
    const scopeTz = (ctx.request.scope as { timezone?: string }).timezone;
    const tz = scopeTz ?? view.studentValue<string>('constraints.timezone') ?? 'UTC';
    return {
      turn,
      today: this.today(ctx, tz),
      dateConvention: session.dateConvention,
      actor: { kind: ctx.request.actor.kind as 'student' | 'supporter' | 'school_counselor', id: ctx.request.actor.id },
      knownSystemLabel: view.studentValue<{ label: string }>('education.qualification_system')?.label ?? null,
    };
  }

  /** The student answers a pending confirmation (read-back, choice, tentative value, second speaker, contradiction). */
  private resolvePendingAnswer(p: PendingConfirmation, turn: Turn, qctx: InterpretContext, session: IntakeSession, acc: { resolvedPending: string[] }): Interpretation {
    const out = emptyInterpretation();
    const res = resolvePending(p, turn.text, qctx);
    const originalQuestion = p.templateId ? questionForTemplate(p.templateId, p.questionId, p.field) : null;
    const fieldName = `${p.field.entity}.${p.field.attribute}`;
    const clarifyOriginal = (text: string) => {
      if ((session.clarifications[p.questionId] ?? 0) >= 1 || !originalQuestion) {
        out.settled.push(p.questionId);
        out.unresolved.push({ field: fieldName, reason: 'unclear_answer', evidenceRoute: originalQuestion?.templateId ? (TEMPLATE_BY_ID.get(originalQuestion.templateId)?.evidenceRoute ?? null) : null });
      } else out.clarification = { questionId: p.questionId, text, options: originalQuestion.options, templateId: originalQuestion.templateId, field: originalQuestion.field };
    };
    switch (res.kind) {
      case 'accept': {
        acc.resolvedPending.push(p.id);
        const value = p.candidates[res.index];
        if (isPartialCandidate(value)) {
          out.carry[p.questionId] = value.carry;
          if (originalQuestion) out.clarification = { questionId: p.questionId, text: value.clarify, options: ['Including travel', 'Program fee only'], templateId: originalQuestion.templateId, field: originalQuestion.field, continuation: true };
          return out;
        }
        const fact: FactDraft = {
          field: p.field,
          value,
          lifecycle: p.lifecycle,
          quote: turn.text.trim().slice(0, 200),
          display: p.candidateLabels[res.index] ?? '',
          tentative: p.reason === 'tentative' || p.lifecycle === 'considering',
          confirmed: true,
          recognitionUncertain: false,
          questionId: p.questionId,
          priorTurn: { turnId: p.sourceTurnId, quote: p.quote, modality: p.modality, recognitionUncertain: p.recognitionUncertain, quoteContainsUnknown: UNKNOWN_PHRASES.test(p.quote) },
        };
        if (p.holder && p.holder.kind !== 'student') fact.holder = p.holder as Holder;
        out.facts.push(fact);
        out.settled.push(p.questionId);
        return out;
      }
      case 'reject': {
        acc.resolvedPending.push(p.id);
        if (p.reason === 'tentative') {
          out.settled.push(p.questionId);
          if (p.field.entityId !== 'new') out.facts.push({ field: p.field, value: { kind: 'absent', reason: 'unknown_to_student' }, lifecycle: 'current', quote: turn.text.trim().slice(0, 120), display: 'not known yet', tentative: false, confirmed: false, recognitionUncertain: false, questionId: p.questionId });
          out.unresolved.push({ field: fieldName, reason: 'unknown_to_student', evidenceRoute: p.templateId ? (TEMPLATE_BY_ID.get(p.templateId)?.evidenceRoute ?? null) : null });
          return out;
        }
        if (p.reason === 'conflict') {
          // Neither value: keep the earlier record and leave the difference for later.
          out.settled.push(p.questionId);
          out.unresolved.push({ field: fieldName, reason: 'unclear_answer', evidenceRoute: null });
          return out;
        }
        clarifyOriginal(p.reason === 'unassigned_speaker' ? `Thanks for checking. ${originalQuestion?.text ?? 'What is your own answer?'}` : originalQuestion?.text ?? p.question);
        return out;
      }
      case 'reanswer': {
        acc.resolvedPending.push(p.id);
        if (!originalQuestion) return out;
        return interpretAnswer({ ...qctx, question: originalQuestion, turn: { ...turn, text: res.text }, clarificationsUsed: session.clarifications[p.questionId] ?? 0, carry: session.carry[p.questionId] });
      }
      case 'control': {
        acc.resolvedPending.push(p.id);
        if (!originalQuestion) {
          out.settled.push(p.questionId);
          return out;
        }
        return interpretAnswer({ ...qctx, question: originalQuestion, clarificationsUsed: 1, carry: undefined });
      }
      case 'unclear': {
        const used = session.clarifications[`confirm:${p.id}`] ?? 0;
        if (used >= 1) {
          acc.resolvedPending.push(p.id);
          out.settled.push(p.questionId);
          out.unresolved.push({ field: fieldName, reason: 'unclear_answer', evidenceRoute: null });
          return out;
        }
        out.clarification = { questionId: `confirm:${p.id}`, text: p.candidates.length > 1 ? `Sorry, I didn't catch which one. ${p.question}` : `Sorry, I didn't catch that. ${p.question}`, options: p.candidateLabels.length > 1 ? p.candidateLabels : ['Yes', 'No'], templateId: null, field: p.field };
        return out;
      }
    }
  }

  /** Answers to "Your document lists ... Is that still right?" and "Which should I use?" questions. */
  private answerExisting(q: PlannedQuestion, turn: Turn, qctx: InterpretContext, view: RecordView): Interpretation {
    const out = emptyInterpretation();
    const fv = view.field(q.field.entity, q.field.entityId, q.field.attribute);
    const text = turn.text.trim();
    const control = P.controlAnswer(text);
    const asAsk: PlannedQuestion = { ...q, kind: 'ask' };
    const base = (value: unknown, lifecycle: FactDraft['lifecycle'], display: string): FactDraft => ({ field: q.field, value, lifecycle, quote: text.slice(0, 200), display, tentative: false, confirmed: true, recognitionUncertain: false, questionId: q.questionId });
    if (q.kind === 'confirm_imported') {
      const cur = fv?.current;
      if (cur && !isAbsence(cur.value)) {
        if (control === 'yes' || /^(yes|yeah|yep|correct|right|that'?s right|still right|it is)\b/i.test(text)) {
          out.facts.push(base(cur.value, cur.lifecycle, statementFor(`${q.field.entity}.${q.field.attribute}`, cur.value, cur.lifecycle)));
          out.settled.push(q.questionId);
          return out;
        }
        if (control === 'no' || /^(no|nope|not any more|not anymore|it changed)\b/i.test(text)) {
          const rest = text.replace(/^(no|nope|not any more|not anymore|it changed)[,.!\s-]*/i, '').trim();
          if (rest.length === 0) {
            out.clarification = { questionId: q.questionId, text: q.templateId ? (TEMPLATE_BY_ID.get(q.templateId)?.text ?? 'What should it be?') : 'What should it be?', options: [], templateId: q.templateId, field: q.field };
            return out;
          }
          return interpretAnswer({ ...qctx, question: asAsk, turn: { ...turn, text: rest } });
        }
      }
      return interpretAnswer({ ...qctx, question: asAsk });
    }
    // resolve_conflict
    const options = fv?.conflicting ?? [];
    const lower = text.toLowerCase();
    let idx = q.options.findIndex((o, i) => i < options.length && lower.includes(o.toLowerCase()));
    if (idx < 0 && /\b(the )?(first|former)\b/.test(lower)) idx = 0;
    if (idx < 0 && /\b(the )?(second|latter)\b/.test(lower) && options.length > 1) idx = 1;
    if (idx >= 0) {
      const c = options[idx]!;
      out.facts.push(base(c.value, c.lifecycle, q.options[idx]!));
      out.settled.push(q.questionId);
      return out;
    }
    if (/\b(neither|not sure|don'?t know)\b/i.test(text) || control === 'dont_know') {
      out.settled.push(q.questionId);
      out.unresolved.push({ field: `${q.field.entity}.${q.field.attribute}`, reason: 'unknown_to_student', evidenceRoute: q.templateId ? (TEMPLATE_BY_ID.get(q.templateId)?.evidenceRoute ?? null) : null });
      return out;
    }
    return interpretAnswer({ ...qctx, question: asAsk });
  }

  private parseCorrection(ctx: TaskContext, session: IntakeSession, view: RecordView, q: PlannedQuestion, turn: Turn): FactDraft[] {
    const base = this.interpretBase(ctx, session, view, turn);
    // An explicit correction is read once, without follow-ups.
    const i = interpretAnswer({ ...base, question: q, clarificationsUsed: 1, carry: undefined });
    return i.facts;
  }

  private questionForField(fv: FieldView): PlannedQuestion | null {
    const catalog = catalogKeyOf(fv);
    const t = TEMPLATE_BY_FIELD.get(catalog);
    if (t) return questionForTemplate(t.id, `correct:${fv.fieldKey}`, { entity: fv.field.entity, entityId: fv.field.entityId, attribute: fv.field.attribute });
    if (fv.field.entity === 'course' && (fv.field.attribute === 'level' || fv.field.attribute === 'enrollment_status')) {
      return { questionId: `correct:${fv.fieldKey}`, kind: 'targeted', text: `Correct the ${fv.label}`, purpose: '', field: { ...fv.field }, reasons: [], options: [], allowSkip: true, allowDontKnow: true, sensitivity: 'standard', claimIds: [], templateId: null };
    }
    return null;
  }

  private applyInterpretation(session: IntakeSession, interp: Interpretation & { resolvedPending: string[] }, turn: Turn, questions: readonly PlannedQuestion[], opts: { keepLastQuestions?: boolean } = {}): IntakeSession {
    const s = structuredClone(session);
    s.pending = s.pending.filter((p) => !interp.resolvedPending.includes(p.id));
    interp.pending.forEach((p: PendingDraft, i) => s.pending.push({ ...p, id: `${turn.turnId}_p${i}` }));
    s.settledQuestionIds = [...new Set([...s.settledQuestionIds, ...interp.settled])];
    for (const [k, v] of Object.entries(interp.carry)) s.carry[k] = v;
    for (const q of interp.settled) delete s.carry[q];
    if (!opts.keepLastQuestions) s.turnQuestions[turn.turnId] = [...questions];
    return s;
  }

  // ---------------------------------------------------------------- committing facts

  private async commit(ctx: TaskContext, session: IntakeSession, view: RecordView, turn: Turn, facts: FactDraft[], out: Outcome, mutationSuffix: string, correctionOf?: Map<string, string>): Promise<{ session: IntakeSession }> {
    if (facts.length === 0) return { session };
    const s = structuredClone(session);
    const built = facts.map((f, i) => {
      const entityId = f.field.entityId === 'new' ? `${f.field.entity}_${turn.turnId}_${i}` : f.field.entityId;
      const def = FIELD_CATALOG.get(`${f.field.entity}.${f.field.attribute}`);
      const key = fieldKey({ entity: f.field.entity, entityId, attribute: f.field.attribute }, def?.holderScoped && f.holder && f.holder.kind !== 'student' ? f.holder : undefined);
      const supersedes = correctionOf?.get(key);
      return { fact: f, key, claim: this.claimFromFact(ctx, s, turn, f, entityId, supersedes ? [supersedes] : []) };
    });
    let pending = built;
    let res = await this.propose(ctx, view.recordVersion, 'add_claims', pending.map((b) => b.claim), mutationSuffix, `intake:${s.sessionId}:${turn.turnId}`, s.sessionId);
    if (res.outcome === 'conflict') {
      // Another change landed on the same field meanwhile: revalidate against the latest version once.
      out.notices.push({ code: 'record_changed_elsewhere', message: 'Your record changed while this was being saved, so it was checked again against the latest version.' });
      const latest = await readView(ctx, 'local', { catalogKeys: [...new Set(pending.map((b) => `${b.claim.field.entity}.${b.claim.field.attribute}`))] });
      res = await this.propose(ctx, latest.recordVersion, 'add_claims', pending.map((b) => b.claim), `${mutationSuffix}:rebased`, `intake:${s.sessionId}:${turn.turnId}`, s.sessionId);
    }
    if (res.outcome === 'rejected') {
      const bad = new Set<number>();
      for (const r of res.reasons) {
        const m = /^claims\[(\d+)\]/.exec(r);
        if (m) bad.add(Number(m[1]));
      }
      const dropped = pending.filter((_, i) => bad.has(i));
      for (const d of dropped) out.notRecorded.push({ field: FIELD_CATALOG.get(`${d.claim.field.entity}.${d.claim.field.attribute}`)?.label ?? d.key, reason: res.reasons.find((r) => r.startsWith(`claims[${pending.indexOf(d)}]`))?.replace(/^claims\[\d+\]: /, '') ?? 'not accepted by the record' });
      pending = pending.filter((_, i) => !bad.has(i));
      if (bad.size > 0 && pending.length > 0) res = await this.propose(ctx, res.recordVersion ?? view.recordVersion, 'add_claims', pending.map((b) => b.claim), `${mutationSuffix}:partial`, `intake:${s.sessionId}:${turn.turnId}`, s.sessionId);
      else if (bad.size === 0) out.notRecorded.push(...pending.map((b) => ({ field: FIELD_CATALOG.get(`${b.claim.field.entity}.${b.claim.field.attribute}`)?.label ?? b.key, reason: res.reasons[0] ?? 'not accepted by the record' })));
    }
    if (res.outcome === 'requires_review') {
      out.notRecorded.push(...pending.map((b) => ({ field: FIELD_CATALOG.get(`${b.claim.field.entity}.${b.claim.field.attribute}`)?.label ?? b.key, reason: res.reasons[0] ?? 'needs review before it can be applied' })));
      return { session: s };
    }
    if (res.outcome !== 'accepted') {
      if (pending.length > 0 && !out.notRecorded.some((n) => pending.some((b) => n.field === (FIELD_CATALOG.get(`${b.claim.field.entity}.${b.claim.field.attribute}`)?.label ?? b.key)))) {
        out.notRecorded.push(...pending.map((b) => ({ field: FIELD_CATALOG.get(`${b.claim.field.entity}.${b.claim.field.attribute}`)?.label ?? b.key, reason: res.reasons[0] ?? res.outcome })));
      }
      return { session: s };
    }
    out.invalidated += res.invalidatedArtifactIds.length;
    out.recordVersion = res.recordVersion ?? null;
    res.createdClaimIds.forEach((id, i) => {
      const b = pending[i]!;
      const superseded = res.createdClaimIds.length === 1 ? res.supersededClaimIds : (b.claim.supersedes ?? []);
      out.recorded.push(this.recordedEntry(id, b.claim, [...new Set(superseded)]));
      s.reviewItems.push({ claimId: id, fieldKey: b.key, turnId: b.fact.priorTurn?.turnId ?? turn.turnId, modality: b.fact.priorTurn?.modality ?? effectiveModality(turn), heard: UNKNOWN_PHRASES.test(b.fact.priorTurn?.quote ?? b.fact.quote) ? '' : (b.fact.priorTurn?.quote ?? b.fact.quote), tentative: b.fact.tentative, questionId: b.fact.questionId });
    });
    return { session: s };
  }

  /**
   * Mutation ids are scoped to the interview session and the turn, not only to
   * the task, so the same answer can never be applied twice even if it is
   * submitted again in a new task.
   */
  private propose(ctx: TaskContext, expected: number, operation: 'add_claims' | 'confirm_claim', claims: ClaimInput[], suffix: string, reason: string, sessionId?: string): Promise<MutationResponse> {
    return ctx.call<MutationResponse>('record.propose_change', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      mutation: { mutationId: sessionId ? `${sessionId}:${suffix}` : mutationIdFor(ctx, suffix), operation, claims, expectedRecordVersion: expected, reason },
    });
  }

  private originFor(ctx: TaskContext): 'student_statement' | 'supporter_statement' | 'counselor_statement' {
    const k = ctx.request.actor.kind;
    return k === 'student' ? 'student_statement' : k === 'supporter' ? 'supporter_statement' : 'counselor_statement';
  }

  private claimFromFact(ctx: TaskContext, session: IntakeSession, turn: Turn, f: FactDraft, entityId: string, supersedes: string[]): ClaimInput {
    const actor = ctx.request.actor;
    const evidence: EvidenceRef[] = [];
    if (f.priorTurn) evidence.push(conversationEvidence(session.conversationId, f.priorTurn.turnId, f.priorTurn.quoteContainsUnknown ? undefined : f.priorTurn.quote, f.priorTurn.modality, f.priorTurn.recognitionUncertain));
    const quote = !isAbsence(f.value) && UNKNOWN_PHRASES.test(f.quote) ? undefined : f.quote;
    evidence.push(conversationEvidence(session.conversationId, turn.turnId, quote, effectiveModality(turn), f.recognitionUncertain));
    const confirmation = f.confirmed ? (actor.kind === 'student' ? 'student_confirmed' : actor.kind === 'school_counselor' ? 'counselor_confirmed' : 'unreviewed') : 'unreviewed';
    const init: Parameters<typeof buildClaim>[0] = {
      entity: f.field.entity,
      entityId,
      attribute: f.field.attribute,
      value: f.value,
      origin: this.originFor(ctx),
      confirmation,
      lifecycle: f.lifecycle,
      evidence,
      actor,
      viaRole: '02',
      supersedes,
    };
    const def = FIELD_CATALOG.get(`${f.field.entity}.${f.field.attribute}`);
    if (def?.holderScoped && f.holder && f.holder.kind !== 'student') init.holder = f.holder;
    return buildClaim(init);
  }

  private claimFromView(ctx: TaskContext, fv: FieldView, value: unknown, lifecycle: FactDraft['lifecycle'], evidence: EvidenceRef[], confirmation: 'student_confirmed' | 'unreviewed', supersedes: string[], validity: ClaimInput['validity']): ClaimInput {
    const init: Parameters<typeof buildClaim>[0] = {
      entity: fv.field.entity,
      entityId: fv.field.entityId,
      attribute: fv.field.attribute,
      value,
      origin: this.originFor(ctx),
      confirmation,
      lifecycle,
      evidence,
      actor: ctx.request.actor,
      viaRole: '02',
      supersedes,
      validity: validity ?? {},
    };
    if (fv.holder && fv.holder.kind !== 'student') init.holder = fv.holder;
    return buildClaim(init);
  }

  private recordedEntry(claimId: string, claim: ClaimInput, superseded: string[]): IntakePayload['recorded'][number] {
    const catalog = `${claim.field.entity}.${claim.field.attribute}`;
    const def = FIELD_CATALOG.get(catalog);
    const holder = claim.holder;
    const key = fieldKey(claim.field, def?.holderScoped && holder && holder.kind !== 'student' ? holder : undefined);
    return {
      claimId,
      fieldKey: key,
      label: def?.label ?? catalog,
      statement: statementFor(catalog, claim.value, claim.lifecycle ?? 'current', holder),
      confirmation: claim.confirmation ?? 'unreviewed',
      lifecycle: claim.lifecycle ?? 'current',
      attributedTo: holder?.kind === 'reported_other' ? holder.label : holder?.kind === 'supporter' ? 'supporter' : null,
      supersededClaimIds: superseded,
    };
  }

  // ---------------------------------------------------------------- composing the result

  private async finish(
    ctx: TaskContext,
    sessionIn: IntakeSession,
    view: RecordView,
    out: Outcome,
    info: { action: string; clarification?: Clarification | null; showReview?: boolean; modeRequest?: 'interview_practice' | 'essay_brainstorming'; crisis?: boolean },
    setSession: (s: IntakeSession) => void,
    opts: { keepQuestions?: boolean; skipSave?: boolean } = {},
  ) {
    let session = structuredClone(sessionIn);
    const objective = session.objective as Objective;
    const plan = planQuestions({ objective, mode: session.mode, view, session });
    let questions: PlannedQuestion[];
    if (info.crisis || session.status === 'paused') questions = [];
    else if (opts.keepQuestions && session.lastQuestions.length > 0) questions = session.lastQuestions.map((q) => this.render(q, session.mode));
    else {
      const c = info.clarification;
      // A re-asked confirmation keeps its place; otherwise waiting confirmations come before a follow-up.
      const clarifiesPending = !!c && c.questionId.startsWith('confirm:');
      if (plan.questions[0]?.kind === 'confirm_pending' && !clarifiesPending) questions = plan.questions.slice(0, 1);
      else if (c) {
        const t = c.templateId ? TEMPLATE_BY_ID.get(c.templateId) : undefined;
        questions = [{ questionId: c.questionId, kind: 'clarify', text: c.text, purpose: t?.purpose ?? 'To record this accurately.', field: c.field, reasons: ['resolves_ambiguity'], options: c.options, allowSkip: true, allowDontKnow: true, sensitivity: t?.sensitivity ?? 'standard', claimIds: [], templateId: c.templateId }];
        // At most one targeted follow-up per question (02R07); continuing a multi-part answer does not count.
        if (!c.continuation) session.clarifications[c.questionId] = (session.clarifications[c.questionId] ?? 0) + 1;
      } else questions = plan.questions;
    }
    if (session.mode === 'voice') questions = questions.slice(0, 1);
    questions = questions.filter((q) => questionIsPermitted(q.text));

    const reviewEntries = buildReview(session, view);
    const unreviewed = unreviewedItems(reviewEntries).filter((e) => e.consequential);
    const enough = plan.enough && !info.clarification && session.pending.length === 0 && !info.modeRequest && !info.crisis;
    if (enough && !opts.keepQuestions) questions = [];

    const notices = [...out.notices];
    if (session.localeFallback && info.action === 'start') {
      /* already noted at start */
    }
    let modeHandoff: IntakePayload['modeHandoff'] = null;
    const handoffs: Handoff[] = [];
    if (info.modeRequest) {
      const isInterview = info.modeRequest === 'interview_practice';
      modeHandoff = {
        mode: info.modeRequest,
        message: isInterview
          ? 'Interview practice is a separate mode with its own explained feedback. Nothing in this conversation is being scored. Would you like to switch now, or finish these questions first?'
          : 'Essay brainstorming is a separate mode. Would you like to switch now, or finish these questions first?',
        requiresExplicitChoice: true,
        scoring: 'none_during_intake',
      };
      notices.push({ code: 'mode_change_offered', message: modeHandoff.message });
      handoffs.push({ toRole: isInterview ? '29' : '17', reason: `The student asked for ${isInterview ? 'interview practice' : 'essay brainstorming'} during intake.`, requestedOutcome: 'Start that mode only after the student explicitly chooses to switch.', inputRefs: [`intake_session:${session.sessionId}`], unresolved: [], completionCondition: 'The student chooses to switch, or continues intake.' });
    }
    if (info.crisis) {
      handoffs.push({ toRole: '34', reason: 'The student said something that needs the application’s support policy rather than counseling questions.', requestedOutcome: 'Follow the safeguarding and support policy for this account.', inputRefs: [`conversation:${session.conversationId}`], unresolved: [], completionCondition: 'A person responsible under the support policy has been notified.' });
    }

    // Hand exploration to the goals specialist; activity details to the experience assessor.
    const recordedKeys = out.recorded.map((r) => r.fieldKey);
    if (objective === 'explore_majors' && enough) handoffs.push({ toRole: '05', reason: 'Intake has what exploration needs to start.', requestedOutcome: 'Begin major exploration from the student’s stated interests and decision horizon.', inputRefs: recordedKeys.filter((k) => k.startsWith('interest:') || k.includes('goals.')), unresolved: [], completionCondition: 'The student has an exploration plan they can act on.' });
    if (out.recorded.some((r) => r.attributedTo && r.attributedTo !== 'supporter')) handoffs.push({ toRole: '05', reason: 'The student described someone else’s preference alongside their own.', requestedOutcome: 'Help the student explore their own preference and the tradeoff, without treating the other view as theirs.', inputRefs: out.recorded.filter((r) => r.attributedTo).map((r) => r.fieldKey), unresolved: [], completionCondition: 'The student has considered both views.' });
    const newExperiences = out.recorded.filter((r) => r.fieldKey.startsWith('experience:'));
    if (newExperiences.length > 0) handoffs.push({ toRole: '08', reason: 'New activities were mentioned.', requestedOutcome: 'Clarify dates, roles and contributions of the listed activities with the student.', inputRefs: newExperiences.map((r) => r.fieldKey), unresolved: [], completionCondition: 'Each activity has confirmed basic facts or is left unresolved.' });
    const allUnresolved = dedupeUnresolved(out.unresolved);
    const docRoute = allUnresolved.filter((u) => u.evidenceRoute && /upload/i.test(u.evidenceRoute));
    if (docRoute.length > 0) handoffs.push({ toRole: '03', reason: 'The student does not know some facts that a document can establish.', requestedOutcome: 'Interpret a transcript or school document if the student uploads one.', inputRefs: docRoute.map((u) => `field:${u.field}`), unresolved: docRoute.map((u) => u.field), completionCondition: 'A document is interpreted or the student declines to upload one.' });

    const pendingOut = session.pending.map((p) => ({ id: p.id, question: p.question, options: p.candidateLabels.length > 1 ? p.candidateLabels : ['Yes', 'No'], reason: p.reason }));
    let nextAction: IntakePayload['nextAction'];
    if (info.crisis) nextAction = 'support_referral';
    else if (modeHandoff) nextAction = 'mode_handoff';
    else if (session.status === 'paused') nextAction = 'paused';
    else if (questions[0]?.kind === 'confirm_pending') nextAction = 'confirm_value';
    else if (questions.length > 0) nextAction = 'answer_question';
    else if (unreviewed.length > 0 && !info.showReview) nextAction = 'review';
    else if (docRoute.length > 0) nextAction = 'offer_document_import';
    else nextAction = 'proceed';

    const label = OBJECTIVE_LABEL[objective] ?? 'plan';
    const waitingOn = [
      ...session.pending.map((p) => `Waiting for your confirmation: ${p.question}`),
      ...allUnresolved.filter((u) => u.reason !== 'skipped').map((u) => `${FIELD_CATALOG.get(u.field)?.label ?? u.field}: ${u.reason.replace(/_/g, ' ')}${u.evidenceRoute ? `. ${u.evidenceRoute}` : ''}`),
      ...(session.status === 'paused' && !enough ? plan.questions.filter((q) => q.kind === 'ask').map((q) => `Not asked yet: ${q.text}`) : []),
    ];
    const canProceed = enough ? [`Your ${label} can go ahead with what you have shared.`] : [`Your ${label} can start now; anything still missing is shown as conditional rather than blocking.`];

    const mainQ = questions[0] ? this.out(questions[0]) : null;
    const payload: IntakePayload = {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      action: info.action,
      objective,
      mode: session.mode,
      locale: session.locale,
      localeFallback: session.localeFallback,
      nextQuestion: enough && !opts.keepQuestions ? null : mainQ,
      additionalQuestions: enough && !opts.keepQuestions ? [] : questions.slice(1).map((q) => this.out(q)),
      skipped: plan.skipped,
      recorded: out.recorded,
      notRecorded: out.notRecorded,
      pendingConfirmations: pendingOut,
      unresolved: allUnresolved.map((u) => ({ field: u.field, reason: u.reason, evidenceRoute: u.evidenceRoute })),
      review: null,
      enoughForObjective: enough,
      nextAction,
      canProceed,
      waitingOn,
      notices: dedupeNotices(notices),
      modeHandoff,
      invalidatedArtifacts: out.invalidated,
      sessionStatus: session.status,
    };
    // 02R10: stop when the task has enough, the student stops, or a fact cannot be resolved now; a partial profile is normal.
    if (payload.enoughForObjective && payload.nextQuestion) payload.enoughForObjective = false;
    if (info.showReview || info.action === 'stop' || nextAction === 'review') payload.review = { items: reviewEntries, note: REVIEW_NOTE };

    if (!opts.keepQuestions || info.action === 'switch_mode') {
      session.lastQuestions = questions;
      session.lastQuestionId = questions[0]?.questionId ?? null;
      session.askedQuestionIds = [...new Set([...session.askedQuestionIds, ...questions.map((q) => q.questionId)])];
    } else if (opts.keepQuestions) session.lastQuestions = questions;
    if (enough && info.action !== 'stop' && session.status === 'active' && questions.length === 0 && unreviewed.length === 0) session.status = 'completed';
    if (!opts.skipSave) session = await this.sessionCall(ctx, { op: 'save', session });
    setSession(session);
    payload.sessionStatus = session.status;

    const status: ResultStatus = info.crisis ? 'needs_human_review' : info.action === 'stop' ? (enough ? 'completed' : 'partial') : payload.nextQuestion || session.pending.length > 0 || modeHandoff ? 'needs_student_input' : unreviewed.length > 0 && info.showReview ? 'needs_student_input' : 'completed';
    const uncertainties: Uncertainty[] = allUnresolved
      .filter((u) => FIELD_CATALOG.get(u.field)?.consequential && u.reason !== 'skipped')
      .slice(0, 10)
      .map((u) => ({ affects: `field:${u.field}`, description: `${FIELD_CATALOG.get(u.field)?.label ?? u.field} is ${u.reason.replace(/_/g, ' ')}, so results that depend on it stay conditional.`, resolution: u.evidenceRoute ?? 'Add it later from your profile or in another conversation.', consequence: 'changes_decision' }));

    const summary = this.summary(payload);
    const cited = [...new Set([...out.recorded.map((r) => r.claimId), ...reviewEntries.map((e) => e.claimId)])].filter((id) => ctx.servedClaimIds.has(id));
    return makeResult(ctx, {
      status,
      summary,
      payload,
      claimIds: cited,
      recordVersion: view.recordVersion,
      uncertainties,
      handoffs,
      completionReason: `intake_${info.action}_${nextAction}`,
    });
  }

  private render(q: PlannedQuestion, mode: 'text' | 'voice'): PlannedQuestion {
    if (q.kind !== 'ask' || !q.templateId) return q;
    const t = TEMPLATE_BY_ID.get(q.templateId);
    if (!t) return q;
    return { ...q, text: mode === 'voice' && t.voice ? t.voice : t.text };
  }

  private out(q: PlannedQuestion): QuestionOut {
    const t = q.templateId ? TEMPLATE_BY_ID.get(q.templateId) : undefined;
    const def = FIELD_CATALOG.get(`${q.field.entity}.${q.field.attribute}`);
    const category: DataCategory | null = def?.category ?? null;
    return {
      questionId: q.questionId,
      kind: q.kind,
      text: q.text,
      purpose: q.purpose,
      options: q.options,
      allowSkip: q.allowSkip,
      allowDontKnow: q.allowDontKnow,
      allowNotDecided: t?.allowNotDecided ?? false,
      sensitivity: q.sensitivity,
      visibilityNote: visibilityNote(category, q.sensitivity === 'sensitive'),
      explanation: t?.explanation ?? null,
      reasons: q.reasons,
    };
  }

  private summary(p: IntakePayload): string {
    const parts: string[] = [];
    if (p.recorded.length > 0) parts.push(`Recorded ${p.recorded.length} answer${p.recorded.length === 1 ? '' : 's'}.`);
    if (p.notRecorded.length > 0) parts.push(`${p.notRecorded.length} answer${p.notRecorded.length === 1 ? ' was' : 's were'} not recorded.`);
    if (p.nextAction === 'support_referral') parts.push('The questions are paused so you can get support.');
    else if (p.nextAction === 'mode_handoff') parts.push('A switch to a different mode was offered; nothing is scored during intake.');
    else if (p.nextAction === 'paused') parts.push('The interview is paused; everything saved so far is kept.');
    else if (p.nextQuestion) parts.push(p.nextQuestion.text);
    else if (p.nextAction === 'review') parts.push('Please review what was recorded before it is used for decisions.');
    else if (p.enoughForObjective) parts.push('There is enough information to continue.');
    return parts.join(' ') || 'Intake updated.';
  }
}

function emptyOutcome(): Outcome {
  return { recorded: [], notRecorded: [], notices: [], unresolved: [], invalidated: 0, recordVersion: null };
}

function dedupeNotices(n: readonly Notice[]): Notice[] {
  const seen = new Set<string>();
  return n.filter((x) => (seen.has(x.code + x.message) ? false : (seen.add(x.code + x.message), true)));
}

function dedupeUnresolved(u: readonly Unresolved[]): Unresolved[] {
  const seen = new Set<string>();
  return u.filter((x) => (seen.has(x.field + x.reason) ? false : (seen.add(x.field + x.reason), true)));
}

export type { ReviewEntry };
