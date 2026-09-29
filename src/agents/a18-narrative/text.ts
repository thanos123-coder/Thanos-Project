/**
 * Deterministic text checks for the narrative coordinator (18 "Repetition
 * analysis", "Length and completeness checks", "Prompt manifest"). Every
 * finding points at exact spans of the student's own text; nothing here
 * produces text for the student.
 */

// ---------------------------------------------------------------- length

export interface LengthCount {
  words: number;
  charactersWithSpaces: number;
  charactersWithoutSpaces: number;
}

/** Counts by code point, so an accented letter or an emoji is one character. Portals can count differently. */
export function countText(text: string): LengthCount {
  const chars = [...text];
  return { words: text.trim() === '' ? 0 : text.trim().split(/\s+/).length, charactersWithSpaces: chars.length, charactersWithoutSpaces: chars.filter((c) => !/\s/.test(c)).length };
}

export function measure(c: LengthCount, unit: 'words' | 'characters', countsSpaces: boolean | null): number {
  if (unit === 'words') return c.words;
  return countsSpaces === false ? c.charactersWithoutSpaces : c.charactersWithSpaces;
}

// ---------------------------------------------------------------- repetition

interface Token {
  norm: string;
  start: number;
  end: number;
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}’']+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ norm: m[0].toLowerCase().replace(/[’']/g, ''), start: m.index, end: m.index + m[0].length });
  return out;
}

export interface SharedSpan {
  a: { start: number; end: number; text: string };
  b: { start: number; end: number; text: string };
  words: number;
}

/**
 * Passages the two texts share word for word (at least `min` consecutive
 * words), with exact offsets in each. A shared topic without shared wording
 * produces nothing here; a similarity score alone is never a finding (18T10).
 */
export function sharedSpans(textA: string, textB: string, min = 8): SharedSpan[] {
  const ta = tokens(textA);
  const tb = tokens(textB);
  const index = new Map<string, number[]>();
  for (let i = 0; i + min <= tb.length; i += 1) {
    const k = tb.slice(i, i + min).map((t) => t.norm).join(' ');
    index.set(k, [...(index.get(k) ?? []), i]);
  }
  const out: SharedSpan[] = [];
  let i = 0;
  while (i + min <= ta.length) {
    const k = ta.slice(i, i + min).map((t) => t.norm).join(' ');
    const hits = index.get(k);
    if (!hits) {
      i += 1;
      continue;
    }
    // Extend the first match as far as both texts agree.
    const j0 = hits[0]!;
    let len = min;
    while (i + len < ta.length && j0 + len < tb.length && ta[i + len]!.norm === tb[j0 + len]!.norm) len += 1;
    const a = { start: ta[i]!.start, end: ta[i + len - 1]!.end };
    const b = { start: tb[j0]!.start, end: tb[j0 + len - 1]!.end };
    out.push({ a: { ...a, text: textA.slice(a.start, a.end) }, b: { ...b, text: textB.slice(b.start, b.end) }, words: len });
    i += len;
  }
  return out;
}

/** The share of a text's words that are not inside the shared spans: what it contributes of its own. */
export function distinctShare(text: string, spans: ReadonlyArray<{ start: number; end: number }>): number {
  const t = tokens(text);
  if (t.length === 0) return 0;
  const inside = t.filter((w) => spans.some((s) => w.start >= s.start && w.end <= s.end)).length;
  return (t.length - inside) / t.length;
}

// ---------------------------------------------------------------- prompt asks

const STOP = new Set(['what', 'when', 'where', 'which', 'while', 'with', 'would', 'could', 'should', 'your', 'you', 'have', 'that', 'this', 'there', 'their', 'them', 'they', 'from', 'into', 'about', 'tell', 'share', 'please', 'does', 'did', 'were', 'been', 'being', 'will', 'also', 'some', 'more', 'most', 'other', 'than', 'then', 'these', 'those', 'each', 'response', 'essay', 'explain']);

function stem(w: string): string {
  return w.replace(/(ingly|edly|ing|ed|ies|es|s|ly)$/, '').replace(/e$/, '');
}

function contentStems(text: string): Set<string> {
  return new Set(tokens(text).map((t) => t.norm).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem));
}

/**
 * Whether a draft appears to take up an explicit ask of the prompt, by the
 * share of the ask's content words it uses. This only decides whether to
 * ask the student; it is never a judgment of quality and never an answer.
 */
export function askAddressed(ask: string, draft: string): { addressed: boolean; overlap: number } {
  const a = contentStems(ask);
  if (a.size === 0) return { addressed: true, overlap: 1 };
  const d = contentStems(draft);
  const hit = [...a].filter((x) => d.has(x)).length;
  const overlap = hit / a.size;
  return { addressed: overlap >= 0.4, overlap: Math.round(overlap * 100) / 100 };
}

// ---------------------------------------------------------------- claims needing a source (18T15)

const SCHOOL_CLAIM = /[^.!?]*\b(guarantee[sd]?|guaranteed|only (school|program|university|college)|every (student|undergraduate) (gets|receives|is given)|ranked (#|number )?\d+|the (best|largest|top) [a-z]+ (program|department|school))\b[^.!?]*[.!?]?/gi;

/** Sentences asserting a fact about a school or program that the student's interest alone cannot support. */
export function schoolClaims(text: string): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(SCHOOL_CLAIM.source, SCHOOL_CLAIM.flags);
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    const start = m.index + raw.indexOf(trimmed);
    out.push({ start, end: start + trimmed.length, text: trimmed });
  }
  return out;
}

/** Institution names in a draft that are not among its destinations: a likely copy-paste mismatch. */
export function otherInstitutionsNamed(text: string, names: ReadonlyArray<{ id: string; name: string }>, destinationIds: readonly string[]): Array<{ id: string; name: string; start: number }> {
  const out: Array<{ id: string; name: string; start: number }> = [];
  for (const n of names) {
    if (destinationIds.includes(n.id)) continue;
    const at = text.indexOf(n.name);
    if (at >= 0) out.push({ id: n.id, name: n.name, start: at });
  }
  return out;
}

/** Words that describe a result as launched or widely used, which the record may not support. */
export const LAUNCH_WORDS = /\b(launched|widely used|used by (the whole|every|hundreds|thousands)|deployed|school[- ]wide service|published)\b/i;
