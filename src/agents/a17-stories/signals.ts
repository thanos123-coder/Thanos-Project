import type { AsrSegment } from '../a02-intake/sessions.js';
import type { NoteKind } from './bank.js';

/**
 * Deterministic reading of a student answer. These checks decide what the
 * app must not do next (write for the student, press on a painful topic,
 * fill in a forgotten detail); they do not judge the student.
 */

export interface AnswerSignals {
  nothingInteresting: boolean;
  brief: boolean;
  wantsWriting: boolean;
  wantsTranslation: boolean;
  wantsFabrication: boolean;
  discomfort: boolean;
  stop: boolean;
  pause: boolean;
  skip: boolean;
  noLesson: boolean;
  unresolved: boolean;
  forgot: boolean;
  interests: string[];
}

const NOTHING = /\b(nothing (interesting|dramatic|special|big|exciting)|haven'?t (really )?(done|had) anything|my life is (pretty )?(boring|normal|ordinary)|no (dramatic|interesting|big) (experiences?|stories)|nothing has (ever )?happened to me)\b/i;
const BRIEF = /^\s*(i don'?t know|idk|not sure|no|nope|nothing|maybe|i guess|not really)[.!]?\s*$/i;
const WRITING = /\b(write|draft|compose|give me|generate|make) (me )?(an? |the |my )?(opening|intro(duction)?|first|sample|example|good)? ?(paragraph|sentence|line|essay|draft|story|hook|version)\b|\bcan you (just )?write\b|\bturn (this|it) into (an? )?(essay|paragraph|story)\b/i;
const TRANSLATION = /\btranslat(e|ion|ing)\b/i;
const FABRICATION = /\b(make up|made[- ]up|invent|fake|pretend|embellish|exaggerate|add (some )?drama)\b[^.?!]*\b(story|event|experience|hardship|achievement|detail|dialogue|moment|struggle)\b/i;
const DISCOMFORT = /\b(don'?t want to (talk|go into|share|say)|uncomfortable|rather not (talk|say|share|go into)|too (personal|hard|painful)|makes me (sad|upset)|can we (change|move on|talk about something else))\b/i;
const STOP = /^\s*(stop|let'?s stop|i want to stop|i'?m done|that'?s enough( for (today|now))?|end (the )?session)[.!]?\s*$/i;
const PAUSE = /^\s*(pause|can we pause|let'?s (take a break|pause)|i need a break)[.!?]?\s*$/i;
const SKIP = /^\s*(skip( (this|that)( one)?)?|next question|pass|another question)[.!]?\s*$/i;
const NO_LESSON = /\b(no (real |clear |big )?lesson|didn'?t (really )?(learn anything|change (me|anything))|nothing (really )?changed|there'?s no (big )?(meaning|moral))\b/i;
const UNRESOLVED = /\b(still (figuring|working) (it|that) out|not sure what it means|i don'?t know what it means( yet)?|haven'?t figured (it|that) out)\b/i;
const FORGOT = /\b((don'?t|can'?t|do not|cannot) (really )?remember|i forget|not sure (when|exactly|who|what year))\b/i;
const INTEREST_LIST = /\b(?:i(?:'m| am)? (?:like|love|enjoy|into|interested in)|my interests are)\s+([^.?!]+)/i;

export function readAnswer(text: string): AnswerSignals {
  const t = text.trim();
  return {
    nothingInteresting: NOTHING.test(t),
    brief: BRIEF.test(t) || t.split(/\s+/).filter(Boolean).length <= 2,
    wantsWriting: WRITING.test(t),
    wantsTranslation: TRANSLATION.test(t),
    wantsFabrication: FABRICATION.test(t),
    discomfort: DISCOMFORT.test(t),
    stop: STOP.test(t),
    pause: PAUSE.test(t),
    skip: SKIP.test(t),
    noLesson: NO_LESSON.test(t),
    unresolved: UNRESOLVED.test(t),
    forgot: FORGOT.test(t),
    interests: listedInterests(t),
  };
}

/** "I like chess, cooking and fixing bikes" is three separate threads, not one identity theme (17T12). */
export function listedInterests(text: string): string[] {
  const m = INTEREST_LIST.exec(text);
  if (!m) return [];
  const items = m[1]!
    .split(/,|\band also\b|\band\b|\bor\b/i)
    .map((x) => x.trim().replace(/^(also|too)\s+/i, '').replace(/\s+(too|also)$/i, ''))
    .filter((x) => x.length > 1 && x.split(/\s+/).length <= 5);
  return items.length >= 3 ? [...new Set(items)] : [];
}

// ---------------------------------------------------------------- critical meaning in speech (17T05)

const NEGATION = /\b(not|never|no|didn'?t|don'?t|wasn'?t|weren'?t|couldn'?t|won'?t|can'?t|isn'?t|haven'?t|hasn'?t)\b/i;

function stripNegation(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(didn'?t|did not)\s+(\w+)/g, '$2')
    .replace(/\b(don'?t|do not)\s+/g, '')
    .replace(/\b(not|never|no)\s+/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\b(led|lead|leads)\b/g, 'lead')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CriticalAmbiguity {
  heard: string;
  alternative: string;
  reason: 'negation' | 'low_confidence';
}

/**
 * A recognized segment whose meaning flips with a negation: the heard text
 * and an alternative differ only by "not", or a low-confidence span carries a
 * negation. Such a fact is confirmed before it is saved.
 */
export function criticalAmbiguities(segments: readonly AsrSegment[]): CriticalAmbiguity[] {
  const out: CriticalAmbiguity[] = [];
  for (const seg of segments) {
    const flip = seg.alternatives.find((alt) => NEGATION.test(alt) !== NEGATION.test(seg.text) && stripNegation(alt) === stripNegation(seg.text));
    if (flip) out.push({ heard: seg.text, alternative: flip, reason: 'negation' });
    else if (seg.confidence !== undefined && seg.confidence < 0.6 && NEGATION.test(seg.text)) out.push({ heard: seg.text, alternative: seg.alternatives[0] ?? seg.text, reason: 'low_confidence' });
  }
  return out;
}

// ---------------------------------------------------------------- candidate notes

/** Kinds a note extractor may propose that never enter factual or interpretation fields (17T14). */
export const INFERRED_KINDS = ['emotion', 'trait', 'motive', 'personality', 'readiness'] as const;

const ACTION = /\b(I|we) (?:(?:first|then|just|also|finally|eventually|\w+ly) )?(decided|chose|started|made|built|added|removed|changed|asked|tried|fixed|organi[sz]ed|reorgani[sz]ed|wrote|learned|taught|helped|took|moved|stopped|kept)\b/i;
const CHOICE = /\b(instead|rather than|or (else )?|chose|decided (not )?to|option)\b/i;

/** Titles and abbreviations whose full stop does not end a sentence ("Mr. Grey", "p.m."). */
const ABBREVIATIONS = /\b(Mr|Mrs|Ms|Mx|Dr|Prof|St|Jr|Sr|vs|etc|e\.g|i\.e|a\.m|p\.m|No)\./g;

/** Sentences with their offsets, not broken at an abbreviation. */
export function sentences(text: string): Array<{ text: string; start: number }> {
  // Mask abbreviation stops with a same-length character so offsets stay exact.
  const masked = text.replace(ABBREVIATIONS, (m) => `${m.slice(0, -1)}\u0000`);
  const out: Array<{ text: string; start: number }> = [];
  const re = /[^.!?]+[.!?]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const raw = text.slice(m.index, m.index + m[0].length);
    const trimmed = raw.trim();
    if (trimmed.length > 0) out.push({ text: trimmed, start: m.index + raw.indexOf(trimmed) });
  }
  return out;
}

/** Split an answer into candidate notes with their spans in the turn. Every note starts as a candidate. */
export function candidateNotes(text: string): Array<{ kind: NoteKind; text: string; span: { start: number; end: number } }> {
  const out: Array<{ kind: NoteKind; text: string; span: { start: number; end: number } }> = [];
  for (const sentence of sentences(text)) {
    const s = sentence.text;
    if (s.split(/\s+/).length < 3 || /\?\s*$/.test(s)) continue;
    const start = sentence.start;
    const kind: NoteKind = CHOICE.test(s) ? 'choice' : ACTION.test(s) ? 'action' : 'context';
    out.push({ kind, text: s, span: { start, end: start + s.length } });
  }
  return out;
}

/** A short phrase worth keeping in the student's exact words: the first sentence, unchanged, when it is short enough to quote whole. */
export function keyPhrase(text: string): string | null {
  const s = sentences(text)[0]?.text.replace(/[.!?]$/, '') ?? '';
  const words = s.split(/\s+/).filter(Boolean).length;
  return words >= 2 && words <= 16 ? s : null;
}
