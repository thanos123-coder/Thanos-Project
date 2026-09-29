import { z } from 'zod';
import type { PermissionService } from '../a04-record-steward/permissions.js';
import type { DerivativeStore } from '../a04-record-steward/types.js';
import { DestinationRefSchema, type DestinationRef } from '../../policy/assistance.js';
import type { ToolGateway, ToolInvocation } from '../../runtime/tool-gateway.js';
import { AccessDeniedError } from '../../shared/errors.js';
import { STORY_USE_STATES } from '../../shared/fields.js';

/**
 * The story bank and exploration sessions (17 "Story bank structure",
 * "Adaptive question planning", "Data contract").
 *
 * A story entry separates what happened (factual anchors, each a candidate
 * until the student confirms it), what the student did, the student's exact
 * phrases, the student's own interpretation (which may be "unresolved"), open
 * questions, and the app's review notes, which never become claims about the
 * student. Every note keeps the turn it came from. Entries live under the
 * story-bank permission category: a parent or counselor sees them only with
 * the student's explicit grant. An entry the student marks "do not use" is
 * excluded from every retrieval for writing work, and dependents are told.
 */

export const NOTE_KINDS = ['context', 'action', 'choice', 'outcome'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface Provenance {
  turnId: string | null;
  /** Character offsets in the source turn, when the note quotes it. */
  span: { start: number; end: number } | null;
}

export interface Anchor {
  anchorId: string;
  kind: NoteKind;
  text: string;
  status: 'candidate' | 'confirmed' | 'rejected';
  /** The student said they are not sure (a date, who was there); the uncertainty is kept, never filled in. */
  uncertain: boolean;
  source: Provenance;
  corrections: Array<{ previous: string; at: string; by: 'student' }>;
}

export interface Phrase {
  phraseId: string;
  text: string;
  source: Provenance;
  corrections: Array<{ previous: string; at: string; by: 'student' }>;
}

export interface Interpretation {
  /** unresolved: the student is still working it out; none: they said there is no lesson; stated: in their own words. */
  status: 'not_discussed' | 'unresolved' | 'none' | 'stated';
  /** Only the student's own words, never the app's inference. */
  studentWords: string | null;
  source: Provenance;
}

export interface StoryEntry {
  storyId: string;
  tenantId: string;
  studentId: string;
  version: number;
  /** A neutral planning title the student chose or approved. */
  title: string;
  titleApproved: boolean;
  /** The prompt or purpose being explored when this was discussed. */
  purpose: { kind: 'general' | 'prompt'; destinations: DestinationRef[]; promptRef: string | null };
  /** The assistance decisions that governed the sessions that built this entry. */
  assistance: Array<{ operation: string; decision: 'allowed' | 'prohibited' | 'unclear'; decisionId: string; destinations: DestinationRef[] }>;
  anchors: Anchor[];
  phrases: Phrase[];
  interpretation: Interpretation;
  unresolved: string[];
  /** The app's observations for review ("the reason for the choice has not been discussed"); never claims about the student. */
  reviewNotes: string[];
  /** Other people appear by planning label only. */
  otherPeople: string[];
  privacy: (typeof STORY_USE_STATES)[number];
  status: 'active' | 'excluded';
  history: Array<{ version: number; at: string; change: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface SessionState {
  sessionId: string;
  tenantId: string;
  studentId: string;
  conversationId: string;
  purpose: StoryEntry['purpose'];
  policy: { operation: string; decision: 'allowed' | 'prohibited' | 'unclear'; decisionId: string; generalOnly: boolean; explanation: string; sourceIds: string[] };
  mode: 'text' | 'voice' | 'paused' | 'stopped';
  /** Audio capture. It is never turned back on without the student's explicit choice (17T08). */
  recording: 'off' | 'on';
  recordingConsented: boolean;
  playback: 'idle' | 'speaking' | 'stopped';
  minutes: number;
  avoidTopics: string[];
  currentStoryId: string | null;
  storyIds: string[];
  /** Interests the student listed, each its own thread rather than one theme (17T12). */
  threads: Array<{ label: string; storyId: string }>;
  asked: Array<{ questionId: string; purpose: string; storyId: string | null; turnId: string | null }>;
  pending: Array<{ id: string; storyId: string; question: string; options: string[]; reason: 'negation' | 'low_confidence'; heard: string; turnId: string }>;
  language: string | null;
  lastTurnId: string | null;
  status: 'open' | 'closed';
}

export class StoryBank implements DerivativeStore {
  readonly name = 'story_bank';
  private readonly stories = new Map<string, StoryEntry>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly listeners: Array<(e: { tenantId: string; studentId: string; storyId: string; change: string }) => void> = [];

  constructor(private readonly now: () => string) {}

  /** Every change after an entry's first version: dependents built on it are told (17T09, 17T15). */
  onChange(l: (e: { tenantId: string; studentId: string; storyId: string; change: string }) => void): void {
    this.listeners.push(l);
  }

  putSession(s: SessionState): SessionState {
    this.sessions.set(s.sessionId, structuredClone(s));
    return structuredClone(s);
  }

  getSession(tenantId: string, studentId: string, sessionId: string): SessionState | undefined {
    const s = this.sessions.get(sessionId);
    return s && s.tenantId === tenantId && s.studentId === studentId ? structuredClone(s) : undefined;
  }

  putStory(e: StoryEntry, change: string): StoryEntry {
    const prev = this.stories.get(e.storyId);
    if (prev && (prev.tenantId !== e.tenantId || prev.studentId !== e.studentId)) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
    const next: StoryEntry = { ...structuredClone(e), version: (prev?.version ?? 0) + 1, updatedAt: this.now() };
    next.history = [...(prev?.history ?? []), { version: next.version, at: next.updatedAt, change }];
    this.stories.set(e.storyId, next);
    if (prev) for (const l of this.listeners) l({ tenantId: e.tenantId, studentId: e.studentId, storyId: e.storyId, change });
    return structuredClone(next);
  }

  getStory(tenantId: string, studentId: string, storyId: string): StoryEntry | undefined {
    const e = this.stories.get(storyId);
    return e && e.tenantId === tenantId && e.studentId === studentId ? structuredClone(e) : undefined;
  }

  list(tenantId: string, studentId: string, opts: { includeExcluded?: boolean } = {}): StoryEntry[] {
    return [...this.stories.values()].filter((e) => e.tenantId === tenantId && e.studentId === studentId && (opts.includeExcluded || e.status !== 'excluded')).map((e) => structuredClone(e));
  }

  /** Material another role may use for writing work: only what the student allowed, never excluded or private notes. */
  permitted(tenantId: string, studentId: string): StoryEntry[] {
    return this.list(tenantId, studentId).filter((e) => e.privacy === 'possible_writing_material');
  }

  purgeByDocument(): number {
    return 0;
  }

  purgeByClaims(): number {
    return 0;
  }

  purgeByStudent(tenantId: string, studentId: string): number {
    let n = 0;
    for (const [id, e] of [...this.stories]) {
      if (e.tenantId !== tenantId || e.studentId !== studentId) continue;
      this.stories.delete(id);
      n += 1;
    }
    for (const [id, s] of [...this.sessions]) {
      if (s.tenantId !== tenantId || s.studentId !== studentId) continue;
      this.sessions.delete(id);
      n += 1;
    }
    return n;
  }
}

export function storyRef(storyId: string): string {
  return `story:${storyId}`;
}

const StoryPutSchema = z.custom<StoryEntry>((v) => typeof v === 'object' && v !== null && 'storyId' in v && 'anchors' in v);
const SessionPutSchema = z.custom<SessionState>((v) => typeof v === 'object' && v !== null && 'sessionId' in v && 'mode' in v);

/**
 * Story bank tools. Every call checks the story-bank permission for the
 * acting person and purpose, so a supporter's general access does not reach
 * private exploration notes (17T10).
 */
export function registerStoryTools(gateway: ToolGateway, bank: StoryBank, permissions: PermissionService): void {
  const check = (inv: ToolInvocation, access: 'read' | 'write') => {
    const d = permissions.authorize({ actor: inv.actor, tenantId: inv.tenantId, studentId: inv.studentId, category: 'story_bank', access, purpose: inv.purpose });
    if (!d.allowed) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
  };
  gateway.register({
    name: 'story.bank',
    description: 'Read or save the student’s exploration sessions and story entries (private notes under the story-bank permission).',
    kind: 'write',
    args: z.discriminatedUnion('op', [
      z.object({ op: z.literal('get_session'), sessionId: z.string().min(1) }).strict(),
      z.object({ op: z.literal('put_session'), session: SessionPutSchema }).strict(),
      z.object({ op: z.literal('get_story'), storyId: z.string().min(1) }).strict(),
      z.object({ op: z.literal('list') }).strict(),
      z.object({ op: z.literal('put_story'), story: StoryPutSchema, change: z.string().min(1).max(200) }).strict(),
    ]),
    handler: async (inv, args): Promise<unknown> => {
      const write = args.op === 'put_session' || args.op === 'put_story';
      check(inv, write ? 'write' : 'read');
      switch (args.op) {
        case 'get_session':
          return bank.getSession(inv.tenantId, inv.studentId, args.sessionId) ?? null;
        case 'put_session':
          if (args.session.tenantId !== inv.tenantId || args.session.studentId !== inv.studentId) throw new AccessDeniedError('scope_violation', 'Requested object is outside the task scope');
          return bank.putSession(args.session);
        case 'get_story': {
          const e = bank.getStory(inv.tenantId, inv.studentId, args.storyId);
          if (e) inv.context.servedSourceIds.add(storyRef(e.storyId));
          return e ?? null;
        }
        case 'list': {
          const out = bank.list(inv.tenantId, inv.studentId);
          for (const e of out) inv.context.servedSourceIds.add(storyRef(e.storyId));
          return out;
        }
        case 'put_story':
          if (args.story.tenantId !== inv.tenantId || args.story.studentId !== inv.studentId) throw new AccessDeniedError('scope_violation', 'Requested object is outside the task scope');
          return bank.putStory(args.story, args.change);
        default:
          return null;
      }
    },
  });
  gateway.register({
    name: 'story.read_permitted',
    description: 'Read only the story entries the student allowed as possible writing material (never private, discuss-only or excluded entries).',
    kind: 'read',
    args: z.object({ destinations: z.array(DestinationRefSchema).max(20).default([]) }).strict(),
    handler: async (inv) => {
      check(inv, 'read');
      const out = bank.permitted(inv.tenantId, inv.studentId);
      for (const e of out) inv.context.servedSourceIds.add(storyRef(e.storyId));
      return out;
    },
  });
}
