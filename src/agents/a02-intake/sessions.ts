import { z } from 'zod';
import type { DerivativeStore } from '../a04-record-steward/types.js';
import type { PermissionService } from '../a04-record-steward/permissions.js';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import type { Clock } from '../../shared/clock.js';
import { AccessDeniedError } from '../../shared/errors.js';
import type { IdGenerator } from '../../shared/ids.js';
import type { PlannedQuestion } from './planner.js';

/**
 * Conversation turns and intake session state, stored server-side so that the
 * same interview continues across text and voice (02T07, XT14) and evidence can
 * point at a specific turn instead of copying the transcript (02 data contract).
 * Both stores are purged on account deletion.
 */

export const AsrSegmentSchema = z
  .object({
    text: z.string(),
    /** Recognizer confidence 0..1 for this span, if the speech service provides one. */
    confidence: z.number().min(0).max(1).optional(),
    /** Alternative hypotheses for this span. */
    alternatives: z.array(z.string()).default([]),
  })
  .strict();
export type AsrSegment = z.infer<typeof AsrSegmentSchema>;

export const TurnSchema = z
  .object({
    turnId: z.string(),
    conversationId: z.string(),
    role: z.enum(['student', 'assistant']),
    /** The authenticated actor who produced the turn (for student turns). */
    actorId: z.string().nullable(),
    modality: z.enum(['text', 'voice']),
    text: z.string(),
    /** Voice only: recognized segments with uncertainty. */
    segments: z.array(AsrSegmentSchema).default([]),
    /** Voice only: diarization label. A label is not proof of identity. */
    speakerLabel: z.enum(['primary', 'other', 'unknown']).default('primary'),
    /** When the student corrected a recognized transcript, the original recognition is kept separately. */
    originalRecognition: z.string().nullable().default(null),
    createdAt: z.string(),
  })
  .strict();
export type Turn = z.infer<typeof TurnSchema>;

export interface PendingConfirmation {
  id: string;
  field: { entity: string; entityId: string; attribute: string };
  holder?: { kind: 'student' } | { kind: 'reported_other'; label: string } | { kind: 'supporter'; actorId: string };
  /** Candidate values in stored form (one for a read-back, several for a choice). */
  candidates: unknown[];
  /** Human-readable versions of the candidates, in the same order. */
  candidateLabels: string[];
  lifecycle: 'current' | 'planned' | 'considering' | 'in_progress' | 'completed';
  question: string;
  sourceTurnId: string;
  /** The relevant part of the answer, kept as evidence (never the whole transcript). */
  quote: string;
  modality: 'text' | 'voice';
  recognitionUncertain: boolean;
  reason: 'recognition_uncertain' | 'voice_readback' | 'ambiguous_value' | 'tentative' | 'unassigned_speaker' | 'conflict' | 'derived_value' | 'no_spending_limit';
  /** Template of the original question, so a "no, it's ..." answer can be re-read. */
  templateId: string | null;
  /** The question this confirmation belongs to. */
  questionId: string;
  /** For confirmations of an existing claim. */
  existingClaimIds: string[];
}

/** A fact recorded in this session that the student can review before consequential use (02R08). */
export interface ReviewItem {
  claimId: string;
  fieldKey: string;
  turnId: string;
  modality: 'text' | 'voice';
  /** What was recognized or typed, for the review display (the relevant clause only). */
  heard: string;
  tentative: boolean;
  questionId: string;
}

export interface IntakeSession {
  sessionId: string;
  tenantId: string;
  studentId: string;
  conversationId: string;
  objective: string;
  mode: 'text' | 'voice';
  locale: string;
  /** True when the requested locale is not supported and English wording is used (02T15). */
  localeFallback: boolean;
  dateConvention: 'day_first' | 'month_first' | 'unknown';
  status: 'active' | 'paused' | 'completed';
  askedQuestionIds: string[];
  /** Question ids the student skipped, declined or could not answer in this session: not asked again. */
  settledQuestionIds: string[];
  pending: PendingConfirmation[];
  /** Extra target fields requested by a handoff (fill_gaps). */
  targetFields: string[];
  /** Question texts supplied by a handoff, keyed by field key. */
  handoffQuestions: Record<string, string>;
  lastQuestionId: string | null;
  /** The questions asked in the last assistant turn (one in voice; a small group in text). */
  lastQuestions: PlannedQuestion[];
  /** Targeted follow-ups used per question (at most one, 02R07). */
  clarifications: Record<string, number>;
  /** Partial answers carried into a clarification (e.g. a city waiting for its country). */
  carry: Record<string, unknown>;
  /** Facts recorded in this session, for the review step. */
  reviewItems: ReviewItem[];
  /** Questions each student turn answered, so a corrected transcript can be re-read. */
  turnQuestions: Record<string, PlannedQuestion[]>;
  createdAt: string;
  updatedAt: string;
}

const skey = (tenantId: string, studentId: string) => `${tenantId}::${studentId}`;

export class ConversationStore implements DerivativeStore {
  readonly name = 'conversation_store';
  private readonly turns = new Map<string, Turn[]>();

  constructor(private readonly clock: Clock, private readonly ids: IdGenerator) {}

  append(tenantId: string, studentId: string, turn: Omit<Turn, 'turnId' | 'createdAt' | 'segments' | 'speakerLabel' | 'originalRecognition'> & Partial<Pick<Turn, 'segments' | 'speakerLabel' | 'originalRecognition'>>): Turn {
    const t = TurnSchema.parse({ ...turn, turnId: this.ids.next('turn'), createdAt: this.clock.nowIso() });
    const k = skey(tenantId, studentId);
    this.turns.set(k, [...(this.turns.get(k) ?? []), t]);
    return t;
  }

  /**
   * Remove text that must not be kept (a street address or postcode typed into
   * an answer). Unlike a correction, the original is not preserved.
   */
  redact(tenantId: string, studentId: string, turnId: string, redactor: (text: string) => string): Turn | undefined {
    const t = this.turns.get(skey(tenantId, studentId))?.find((x) => x.turnId === turnId);
    if (!t) return undefined;
    t.text = redactor(t.text);
    if (t.originalRecognition !== null) t.originalRecognition = redactor(t.originalRecognition);
    t.segments = t.segments.map((seg) => ({ ...seg, text: redactor(seg.text), alternatives: seg.alternatives.map(redactor) }));
    return structuredClone(t);
  }

  /** The student edits a recognized transcript; the original recognition is preserved separately. */
  correct(tenantId: string, studentId: string, turnId: string, correctedText: string): Turn | undefined {
    const t = this.turns.get(skey(tenantId, studentId))?.find((x) => x.turnId === turnId);
    if (!t) return undefined;
    if (t.originalRecognition === null) t.originalRecognition = t.text;
    t.text = correctedText;
    t.segments = [];
    return structuredClone(t);
  }

  get(tenantId: string, studentId: string, turnId: string): Turn | undefined {
    const t = this.turns.get(skey(tenantId, studentId))?.find((x) => x.turnId === turnId);
    return t ? structuredClone(t) : undefined;
  }

  list(tenantId: string, studentId: string, conversationId: string): Turn[] {
    return (this.turns.get(skey(tenantId, studentId)) ?? []).filter((t) => t.conversationId === conversationId).map((t) => structuredClone(t));
  }

  purgeByDocument(): number {
    return 0;
  }

  purgeByClaims(): number {
    return 0;
  }

  purgeByStudent(tenantId: string, studentId: string): number {
    const n = this.turns.get(skey(tenantId, studentId))?.length ?? 0;
    this.turns.delete(skey(tenantId, studentId));
    return n;
  }
}

export class IntakeSessionStore implements DerivativeStore {
  readonly name = 'intake_session_store';
  private readonly sessions = new Map<string, Map<string, IntakeSession>>();

  constructor(private readonly clock: Clock, private readonly ids: IdGenerator) {}

  create(tenantId: string, studentId: string, init: { objective: string; mode: 'text' | 'voice'; locale: string; localeFallback?: boolean; dateConvention?: IntakeSession['dateConvention']; conversationId?: string; targetFields?: string[]; handoffQuestions?: Record<string, string> }): IntakeSession {
    const now = this.clock.nowIso();
    const s: IntakeSession = {
      sessionId: this.ids.next('intake'),
      tenantId,
      studentId,
      conversationId: init.conversationId ?? this.ids.next('conv'),
      objective: init.objective,
      mode: init.mode,
      locale: init.locale,
      localeFallback: init.localeFallback ?? false,
      dateConvention: init.dateConvention ?? 'unknown',
      status: 'active',
      askedQuestionIds: [],
      settledQuestionIds: [],
      pending: [],
      targetFields: init.targetFields ?? [],
      handoffQuestions: init.handoffQuestions ?? {},
      lastQuestionId: null,
      lastQuestions: [],
      clarifications: {},
      carry: {},
      reviewItems: [],
      turnQuestions: {},
      createdAt: now,
      updatedAt: now,
    };
    const k = skey(tenantId, studentId);
    const m = this.sessions.get(k) ?? new Map();
    m.set(s.sessionId, s);
    this.sessions.set(k, m);
    return structuredClone(s);
  }

  get(tenantId: string, studentId: string, sessionId: string): IntakeSession | undefined {
    const s = this.sessions.get(skey(tenantId, studentId))?.get(sessionId);
    return s ? structuredClone(s) : undefined;
  }

  save(s: IntakeSession): IntakeSession {
    const m = this.sessions.get(skey(s.tenantId, s.studentId));
    if (!m?.has(s.sessionId)) throw new Error('Unknown session');
    const saved = { ...structuredClone(s), updatedAt: this.clock.nowIso() };
    m.set(s.sessionId, saved);
    return structuredClone(saved);
  }

  purgeByDocument(): number {
    return 0;
  }

  purgeByClaims(): number {
    return 0;
  }

  purgeByStudent(tenantId: string, studentId: string): number {
    const n = this.sessions.get(skey(tenantId, studentId))?.size ?? 0;
    this.sessions.delete(skey(tenantId, studentId));
    return n;
  }
}

export function registerIntakeTools(gateway: ToolGateway, conversations: ConversationStore, sessions: IntakeSessionStore, permissions: PermissionService): void {
  const check = (inv: { actor: Parameters<PermissionService['authorize']>[0]['actor']; tenantId: string; studentId: string; purpose: Parameters<PermissionService['authorize']>[0]['purpose'] }, access: 'read' | 'write') => {
    const d = permissions.authorize({ actor: inv.actor, tenantId: inv.tenantId, studentId: inv.studentId, category: 'conversation_transcripts', access, purpose: inv.purpose });
    if (!d.allowed) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
  };
  gateway.register({
    name: 'conversation.read_turn',
    description: 'Read one conversation turn (the student answer being interpreted).',
    kind: 'read',
    args: z.object({ tenantId: z.string(), studentId: z.string(), turnId: z.string() }).strict(),
    handler: async (inv, args) => {
      check(inv, 'read');
      const t = conversations.get(args.tenantId, args.studentId, args.turnId);
      if (!t) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
      return t;
    },
  });
  gateway.register({
    name: 'conversation.redact_turn',
    description: 'Remove exact spans (such as a street address) from a stored turn. Can only remove text, never add it.',
    kind: 'write',
    args: z.object({ tenantId: z.string(), studentId: z.string(), turnId: z.string(), spans: z.array(z.string().min(1)).min(1).max(10) }).strict(),
    handler: async (inv, args) => {
      check(inv, 'write');
      const t = conversations.redact(args.tenantId, args.studentId, args.turnId, (text) => args.spans.reduce((acc: string, span: string) => acc.split(span).join('[removed]'), text));
      if (!t) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
      return { turnId: t.turnId, redacted: true };
    },
  });
  gateway.register({
    name: 'intake.session',
    description: 'Create, read or save an intake session for this student.',
    kind: 'write',
    args: z.discriminatedUnion('op', [
      z
        .object({
          op: z.literal('create'),
          tenantId: z.string(),
          studentId: z.string(),
          objective: z.string(),
          mode: z.enum(['text', 'voice']),
          locale: z.string(),
          localeFallback: z.boolean().optional(),
          dateConvention: z.enum(['day_first', 'month_first', 'unknown']).optional(),
          conversationId: z.string().optional(),
          targetFields: z.array(z.string()).optional(),
          handoffQuestions: z.record(z.string(), z.string()).optional(),
        })
        .strict(),
      z.object({ op: z.literal('read'), tenantId: z.string(), studentId: z.string(), sessionId: z.string() }).strict(),
      z.object({ op: z.literal('save'), tenantId: z.string(), studentId: z.string(), session: z.custom<IntakeSession>((v) => !!v && typeof v === 'object') }).strict(),
    ]),
    handler: async (inv, args) => {
      check(inv, args.op === 'read' ? 'read' : 'write');
      if (args.op === 'create') {
        const init: Parameters<IntakeSessionStore['create']>[2] = { objective: args.objective, mode: args.mode, locale: args.locale };
        if (args.localeFallback !== undefined) init.localeFallback = args.localeFallback;
        if (args.dateConvention) init.dateConvention = args.dateConvention;
        if (args.conversationId) init.conversationId = args.conversationId;
        if (args.targetFields) init.targetFields = args.targetFields;
        if (args.handoffQuestions) init.handoffQuestions = args.handoffQuestions;
        return sessions.create(args.tenantId, args.studentId, init);
      }
      if (args.op === 'read') {
        const s = sessions.get(args.tenantId, args.studentId, args.sessionId);
        if (!s) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
        return s;
      }
      if (args.session.tenantId !== args.tenantId || args.session.studentId !== args.studentId) throw new AccessDeniedError('scope_violation', 'Session outside task scope');
      return sessions.save(args.session);
    },
  });
}
