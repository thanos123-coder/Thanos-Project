import { parsePartialDate, type PartialDate } from './time.js';

/**
 * Human date parsing with explicit precision and ambiguity.
 *
 * "A month-only date must not acquire an invented day." A numeric date such as
 * 03/04/2027 is ambiguous between day-first and month-first conventions; unless
 * the locale convention is known, both readings are returned rather than one
 * being guessed.
 */

export type DateParse =
  | { kind: 'date'; value: PartialDate }
  | { kind: 'ambiguous'; candidates: PartialDate[]; reason: string }
  | { kind: 'none' };

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

function valid(y: number, m?: number, d?: number): PartialDate | null {
  const s = d !== undefined ? `${y}-${pad(m!)}-${pad(d)}` : m !== undefined ? `${y}-${pad(m)}` : `${y}`;
  return parsePartialDate(s) ? s : null;
}

export function parseHumanDate(input: string, convention: 'day_first' | 'month_first' | 'unknown' = 'unknown'): DateParse {
  const s = input.trim().replace(/\s+/g, ' ').replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s))) {
    const v = valid(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
    return v ? { kind: 'date', value: v } : { kind: 'none' };
  }
  if ((m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/.exec(s))) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    const v = mo ? valid(Number(m[3]), mo, Number(m[1])) : null;
    return v ? { kind: 'date', value: v } : { kind: 'none' };
  }
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s))) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const v = mo ? valid(Number(m[3]), mo, Number(m[2])) : null;
    return v ? { kind: 'date', value: v } : { kind: 'none' };
  }
  if ((m = /^([A-Za-z]{3,9})\.?,? (\d{4})$/.exec(s))) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const v = mo ? valid(Number(m[2]), mo) : null;
    return v ? { kind: 'date', value: v } : { kind: 'none' };
  }
  if ((m = /^(\d{1,2})[/.](\d{4})$/.exec(s))) {
    const v = valid(Number(m[2]), Number(m[1]));
    return v ? { kind: 'date', value: v } : { kind: 'none' };
  }
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    const dayFirst = valid(y, b, a);
    const monthFirst = valid(y, a, b);
    if (a === b) return dayFirst ? { kind: 'date', value: dayFirst } : { kind: 'none' };
    if (dayFirst && !monthFirst) return { kind: 'date', value: dayFirst };
    if (monthFirst && !dayFirst) return { kind: 'date', value: monthFirst };
    if (dayFirst && monthFirst) {
      if (convention === 'day_first') return { kind: 'date', value: dayFirst };
      if (convention === 'month_first') return { kind: 'date', value: monthFirst };
      return { kind: 'ambiguous', candidates: [dayFirst, monthFirst], reason: 'day and month order is not known' };
    }
    return { kind: 'none' };
  }
  if ((m = /^(\d{4})$/.exec(s))) {
    const v = valid(Number(m[1]));
    return v ? { kind: 'date', value: v } : { kind: 'none' };
  }
  return { kind: 'none' };
}

/** Find the first date-like phrase inside free text and parse it. */
export function findDateInText(text: string, convention: 'day_first' | 'month_first' | 'unknown' = 'unknown'): DateParse & { match?: string } {
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3,9}\.?,? \d{4}\b/,
    /\b[A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b/,
    /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b/,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?,? \d{4}\b/i,
    /\b\d{4}-\d{2}\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const r = parseHumanDate(m[0], convention);
      if (r.kind !== 'none') return { ...r, match: m[0] };
    }
  }
  return { kind: 'none' };
}
