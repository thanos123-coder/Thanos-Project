import { findDateInText } from '../../shared/date-parse.js';
import type { CalendarDate } from '../../shared/time.js';

/**
 * Passage-level reading of an official page (11 "Source selection and
 * retrieval", "Conflicts and incomplete pages").
 *
 * A current URL can hold several cycles at once: "the Toronto Pearson page
 * presented a 2027 application schedule alongside older FAQ dates". Each
 * passage therefore carries its own cycle scope, taken from its heading or
 * its own text, so dates from different cycles are never combined into one
 * plausible invented schedule (11T03). Footer years and "last updated" lines
 * are not evidence of the effective cycle (11T14); archive markers make the
 * whole page historical.
 */

export interface Passage {
  passageId: string;
  heading: string | null;
  /** The entry cycle this passage speaks about, when it states exactly one; null when it states none or several. */
  cycle: string | null;
  /** Every cycle the passage mentions, for explanation. */
  cyclesMentioned: string[];
  text: string;
  /** Frequently-asked-question sections often keep older dates; they never inherit a heading's cycle. */
  faq: boolean;
}

export interface PageReading {
  passages: Passage[];
  archived: boolean;
  /** Years that appear only in footers (copyright, "last updated"): never used as the effective cycle. */
  footerYears: string[];
  publishedOn: CalendarDate | null;
  tables: TextTable[];
}

export interface TextTable {
  passageId: string;
  caption: string | null;
  headers: string[] | null;
  rows: string[][];
  /** True when data rows have more columns than there are headers: a heading was lost in extraction (11T07). */
  headerMismatch: boolean;
  legend: string | null;
}

const FOOTER = /(©|\(c\)|copyright|all rights reserved|privacy policy|terms of use|cookie settings|follow us|site map)/i;
const UPDATED = /\b(?:last\s+)?(?:updated|reviewed|published|modified)\s*(?:on|:)?\s*(.{4,40})$/i;
const ARCHIVED = /\b(archived|this page is (?:no longer|not) (?:maintained|updated|current)|previous (?:year|cycle)'?s? (?:information|policy|requirements)|historical (?:information|record|page)|for reference only)\b/i;
const FAQ = /\b(faq|frequently asked questions|common questions)\b/i;

/** Entry-cycle phrases. Each returns the entry year it names. */
const CYCLE_PATTERNS: ReadonlyArray<{ re: RegExp; year: (m: RegExpExecArray) => string }> = [
  // "Fall 2027", "Autumn 2027 entry", "September 2027"
  { re: /\b(?:fall|autumn|september|spring|january|winter)\s+(20\d\d)\b/gi, year: (m) => m[1]! },
  // "2027 entry", "entry in 2027", "for 2027 admission"
  { re: /\b(20\d\d)\s+(?:entry|intake|admissions?)\b/gi, year: (m) => m[1]! },
  { re: /\b(?:entry|admission|intake)\s+(?:in|for)\s+(20\d\d)\b/gi, year: (m) => m[1]! },
  // "the 2026-27 application cycle" is for entry in 2027.
  { re: /\b(20\d\d)\s*[–-]\s*(?:20)?(\d\d)\s+(?:application|admissions?)\s+(?:cycle|year|season|schedule)\b/gi, year: (m) => `20${m[2]!}` },
  // "2027 application schedule", "2027 deadlines"
  { re: /\b(20\d\d)\s+(?:application|applications|admissions?)\s+(?:schedule|cycle|deadlines?|timeline|dates)\b/gi, year: (m) => m[1]! },
  // "the 2027-28 academic year" starts with entry in 2027.
  { re: /\b(20\d\d)\s*[–-]\s*(?:20)?\d\d\s+(?:academic|school)\s+year\b/gi, year: (m) => m[1]! },
];

export function cyclesIn(text: string): string[] {
  const out = new Set<string>();
  for (const p of CYCLE_PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) out.add(p.year(m));
  }
  return [...out].sort();
}

function isHeading(line: string, next: string | undefined): boolean {
  const t = line.trim();
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (t.length === 0 || t.length > 90 || next === undefined) return false;
  if (/[.;,]$/.test(t) || /^\s*[-*•]/.test(t) || t.includes('|')) return false;
  if (/:\s*$/.test(t)) return true;
  if (FAQ.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length > 12) return false;
  const capitalized = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
  return capitalized >= Math.ceil(words.length * 0.6) && !/\d{1,2}:\d{2}/.test(t);
}

export function readPage(text: string, sourceId: string): PageReading {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const passages: Passage[] = [];
  const footerYears = new Set<string>();
  let publishedOn: CalendarDate | null = null;
  let archived = false;
  let heading: string | null = null;
  let headingCycle: string | null = null;
  let body: string[] = [];
  let n = 0;

  const flush = () => {
    const bodyText = body.join('\n').trim();
    if (bodyText.length === 0 && heading === null) return;
    const faq = heading !== null && FAQ.test(heading);
    const own = cyclesIn(bodyText);
    const headOwn = heading ? cyclesIn(heading) : [];
    let cycle: string | null;
    if (headOwn.length === 1) cycle = headOwn[0]!;
    else if (headOwn.length > 1) cycle = null;
    else if (own.length === 1) cycle = own[0]!;
    else if (own.length > 1) cycle = null;
    else cycle = faq ? null : headingCycle;
    passages.push({ passageId: `${sourceId}#p${++n}`, heading, cycle, cyclesMentioned: [...new Set([...headOwn, ...own])].sort(), text: bodyText.length > 0 ? `${heading ? `${heading}\n` : ''}${bodyText}` : heading ?? '', faq });
    body = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (line.length === 0) {
      body.push('');
      continue;
    }
    if (FOOTER.test(line) || (UPDATED.test(line) && line.length < 80)) {
      for (const y of line.match(/\b20\d\d\b/g) ?? []) footerYears.add(y);
      const u = UPDATED.exec(line);
      if (u) {
        const d = findDateInText(u[1]!);
        if (d.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(d.value)) publishedOn = d.value as CalendarDate;
      }
      continue;
    }
    if (ARCHIVED.test(line)) archived = true;
    const next = lines.slice(i + 1).find((l) => l.trim().length > 0);
    if (isHeading(raw, next)) {
      flush();
      heading = line.replace(/^#{1,6}\s+/, '').replace(/:\s*$/, '');
      const hc = cyclesIn(heading);
      // A heading that names one cycle scopes what follows until another cycle heading or an FAQ.
      if (hc.length === 1) headingCycle = hc[0]!;
      else if (hc.length > 1 || FAQ.test(heading)) headingCycle = null;
      continue;
    }
    body.push(line);
  }
  flush();
  const tables = passages.flatMap((p) => parseTables(p));
  return { passages, archived, footerYears: [...footerYears].sort(), publishedOn, tables };
}

// ---------------------------------------------------------------- tables

const SUPPRESSED = /^(\*|s|—|–|-|†|‡|suppressed|<\s*\d+)$/i;
const NOT_REPORTED = /^(n\/?a|nr|not reported|not available|\.\.\.)$/i;

export type CellValue = { kind: 'number'; value: number } | { kind: 'suppressed' } | { kind: 'not_reported' } | { kind: 'text'; text: string };

export function readCell(cell: string, legend: string | null): CellValue {
  const t = cell.trim();
  const suppressionMeansSuppressed = legend === null || /suppress|small cell|privacy|withheld|fewer than/i.test(legend);
  if (SUPPRESSED.test(t) && t !== '-' && suppressionMeansSuppressed) return { kind: 'suppressed' };
  if (t === '-' && legend !== null && /-\s*(=|means|:)\s*suppress/i.test(legend)) return { kind: 'suppressed' };
  if (NOT_REPORTED.test(t)) return { kind: 'not_reported' };
  const num = t.replace(/[,\s%$£€]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(num)) return { kind: 'number', value: Number(num) };
  return { kind: 'text', text: t };
}

/** Pipe-separated or tab/multi-space aligned tables inside one passage. */
export function parseTables(p: Passage): TextTable[] {
  const lines = p.text.split('\n');
  const tables: TextTable[] = [];
  let block: string[][] = [];
  let caption: string | null = p.heading;
  const legendLine = lines.find((l) => /^(note|legend|key)\s*:|\bsuppressed\b|\*\s*(=|means)/i.test(l.trim())) ?? null;
  const split = (l: string): string[] | null => {
    if (l.includes('|')) return l.split('|').map((c) => c.trim()).filter((c, i, arr) => !(c === '' && (i === 0 || i === arr.length - 1)));
    if (/\t/.test(l)) return l.split('\t').map((c) => c.trim());
    if (/\S {2,}\S/.test(l)) return l.split(/ {2,}/).map((c) => c.trim());
    return null;
  };
  const close = () => {
    if (block.length >= 2) {
      const first = block[0]!;
      const firstIsHeader = first.filter((c) => readCell(c, null).kind === 'number').length === 0 && block.slice(1).some((r) => r.some((c) => readCell(c, legendLine).kind !== 'text'));
      const headers = firstIsHeader ? first : null;
      const rows = firstIsHeader ? block.slice(1) : block;
      const width = Math.max(...rows.map((r) => r.length));
      tables.push({ passageId: p.passageId, caption, headers, rows, headerMismatch: headers !== null && (headers.length < width || headers.some((h) => h.length === 0)), legend: legendLine });
    }
    block = [];
  };
  for (const l of lines) {
    if (/^\s*[-|: ]+\s*$/.test(l) && l.includes('-')) continue; // markdown separator row
    const cells = split(l);
    if (cells && cells.length >= 2) block.push(cells);
    else {
      close();
      if (l.trim().length > 0 && !/^(note|legend|key)\s*:/i.test(l.trim())) caption = l.trim();
    }
  }
  close();
  return tables;
}
