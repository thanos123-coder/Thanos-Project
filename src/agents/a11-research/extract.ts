import { findDateInText } from '../../shared/date-parse.js';
import type { CalendarDate } from '../../shared/time.js';
import type { Office } from './entities.js';
import {
  familyOf,
  normalizeSpace,
  type ApplicantCategory,
  type ClaimInput,
  type ClaimStatus,
  type ClaimSubject,
  type CostValue,
  type DeadlineValue,
  type Predicate,
  type StatisticValue,
} from './claims.js';
import { readCell, type PageReading, type Passage, type TextTable } from './passages.js';

/**
 * Deterministic claim extraction (11 "Claim level evidence procedure",
 * steps 1, 3 and 6). Code reads dates, times, zones, amounts, periods and
 * table cells; nothing is inferred that the passage does not state. A value
 * that cannot be read safely is reported as a gap, never filled from memory
 * (11 "Source selection and retrieval": "An extraction failure should remain
 * visible").
 */

export interface ExtractionContext {
  sourceId: string;
  url: string;
  finalUrl: string;
  retrievedAt: string;
  subject: ClaimSubject;
  owner: { entityId: string; office: Office; name: string };
  /** Whether the page's host is an official domain of the institution (or the platform/provider the claim is about). */
  official: boolean;
  /** The entry cycle requested. */
  cycle: string;
  /** The applicant category to record when the passage does not distinguish categories. */
  applicantCategory: ApplicantCategory;
  /** The institution's country, which decides what "$" means. */
  country: string;
}

export interface ExtractionGap {
  predicate: Predicate;
  reason: string;
  quote: string | null;
}

export interface Extraction {
  claims: ClaimInput[];
  gaps: ExtractionGap[];
}

// ---------------------------------------------------------------- sentences

function sentencesOf(p: Passage): string[] {
  const out: string[] = [];
  for (const line of p.text.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (p.heading && t === p.heading) continue;
    for (const s of splitSentences(t)) out.push(s);
  }
  return out;
}

/** Abbreviations that end with a period but not a sentence: "11:59 p.m. Eastern Time" is one sentence. */
const ABBREVIATION = /(?:\b[ap]\.\s?m\.|\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|st|dr|mr|mrs|ms|prof|no|approx|dept|e\.g|i\.e|etc|vs|u\.s|u\.k)\.)$/i;

/** Split on sentence ends, but not after an abbreviation, a time's "a.m."/"p.m.", or a decimal. */
export function splitSentences(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]\s+(?=[A-Z(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const end = m.index + 1;
    if (ABBREVIATION.test(line.slice(Math.max(0, end - 8), end))) continue;
    const piece = line.slice(start, end).trim();
    if (piece.length > 0) out.push(piece);
    start = m.index + m[0].length;
  }
  const rest = line.slice(start).trim();
  if (rest.length > 0) out.push(rest);
  return out;
}

// ---------------------------------------------------------------- deadlines

const DEADLINE_WORDS = /\b(deadlines?|due|closes?|closing date|submit(?:ted)? by|must be (?:received|submitted|postmarked)|no later than|apply by|applications? close)\b|\b(?:must|should|need to) (?:submit|send|complete|file)\b.{0,80}\bby\b/i;
const OPENS_ONLY = /\b(opens?|available from|launch(?:es)?)\b/i;

function deadlinePredicate(s: string): Predicate {
  if (/\bnominat/i.test(s)) return 'nomination_deadline';
  if (/\b(scholarship|award|bursary)\b/i.test(s)) return 'scholarship_deadline';
  if (/\b(financial aid|css profile|fafsa|aid application|bursary application)\b/i.test(s)) return 'financial_aid_deadline';
  if (/\b(recommendation|reference|referee|school report|counsel(?:l)?or (?:report|letter))\b/i.test(s)) return 'recommendation_deadline';
  if (/\b(transcripts?|supporting documents|documents)\b/i.test(s) && !/\bapplication\b/i.test(s)) return 'document_deadline';
  if (/\b(reply|respond|enrol(?:l)?ment deposit|commit)\b/i.test(s)) return 'reply_deadline';
  return 'application_deadline';
}

const ROUND_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/\brestrictive early action\b|\bsingle[- ]choice early action\b/i, 'restrictive_early_action'],
  [/\bearly decision (?:ii|2)\b/i, 'early_decision_2'],
  [/\bearly decision(?: (?:i|1))?\b/i, 'early_decision'],
  [/\bearly action\b/i, 'early_action'],
  [/\bregular decision\b|\bregular (?:round|deadline)\b/i, 'regular'],
  [/\bpriority\b/i, 'priority'],
];

export function roundLabelOf(s: string): string {
  for (const [re, label] of ROUND_LABELS) if (re.test(s)) return label;
  return '';
}

/** A stated time; "midnight" is left unresolved because it can mean the start or the end of a day. */
export function parseTime(s: string): { time: string | null; note: string | null } {
  if (/\bnoon\b/i.test(s)) return { time: '12:00', note: null };
  if (/\bmidnight\b/i.test(s)) return { time: null, note: 'The source says “midnight” without saying which day it ends.' };
  const ampm = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?=\W|$)/i.exec(s);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/p/i.test(ampm[3]!)) h += 12;
    return { time: `${String(h).padStart(2, '0')}:${ampm[2] ?? '00'}`, note: null };
  }
  const h24 = /\b([01]\d|2[0-3])[:.h]([0-5]\d)\b(?!\s*(?:%|percent))/.exec(s);
  if (h24) return { time: `${h24[1]}:${h24[2]}`, note: null };
  return { time: null, note: null };
}

/** Zone labels that name one zone; a source-stated label is normalized only when it is unambiguous (11 "Dates and freshness"). */
const ZONES: ReadonlyArray<[RegExp, string, string]> = [
  [/\b(?:eastern (?:standard |daylight )?time|e[sd]?t)\b/i, 'America/New_York', 'Eastern Time'],
  [/\b(?:central (?:standard |daylight )?time|c[sd]t)\b/i, 'America/Chicago', 'Central Time'],
  [/\b(?:mountain (?:standard |daylight )?time|m[sd]t)\b/i, 'America/Denver', 'Mountain Time'],
  [/\b(?:pacific (?:standard |daylight )?time|p[sd]t)\b/i, 'America/Los_Angeles', 'Pacific Time'],
  [/\b(?:uk time|london time|gmt|bst|british (?:summer )?time)\b/i, 'Europe/London', 'UK time'],
  [/\b(?:toronto time)\b/i, 'America/Toronto', 'Toronto time'],
  [/\b(?:vancouver time)\b/i, 'America/Vancouver', 'Vancouver time'],
  [/\butc\b/i, 'UTC', 'UTC'],
];

export function parseZone(s: string): { timezone: string | null; label: string | null } {
  const iana = /\b([A-Z][a-z]+\/[A-Z][A-Za-z_]+)\b/.exec(s);
  if (iana) return { timezone: iana[1]!, label: iana[1]! };
  if (/\b(?:your|applicant'?s?|the applicant's) local time\b/i.test(s)) return { timezone: null, label: "applicant's local time" };
  for (const [re, tz, label] of ZONES) if (re.test(s)) return { timezone: tz, label };
  return { timezone: null, label: null };
}

function receiptOf(s: string): DeadlineValue['receipt'] {
  if (/\bpostmarked\b/i.test(s)) return 'postmarked_by';
  if (/\b(received|receipt)\b/i.test(s)) return 'received_by';
  if (/\bsubmit/i.test(s)) return 'submitted_by';
  return null;
}

/** A deadline for entry in cycle Y falls between the start of Y-1 and the end of Y; anything else belongs to another cycle. */
function dateFitsCycle(date: string, cycle: string): boolean {
  const y = Number(date.slice(0, 4));
  const c = Number(cycle);
  return y >= c - 1 && y <= c;
}

// ---------------------------------------------------------------- costs

const COST_KINDS: ReadonlyArray<[RegExp, Predicate]> = [
  [/\bapplication fee\b/i, 'application_fee'],
  [/\b(enrol(?:l)?ment|acceptance|tuition) deposit\b/i, 'enrollment_deposit'],
  [/\b(cost of attendance|estimated (?:total )?cost|total (?:estimated )?cost|student budget)\b/i, 'cost_of_attendance'],
  [/\btuition\b/i, 'tuition'],
  [/\b(room and board|housing|accommodation|residence hall|room)\b/i, 'housing'],
  [/\b(meal plan|meals|board|dining)\b/i, 'meals'],
  [/\b(books|supplies)\b/i, 'books_supplies'],
  [/\bhealth insurance\b/i, 'health_insurance'],
  [/\b(transportation|transport|travel)\b/i, 'transport'],
  [/\bpersonal (?:expenses|costs)\b/i, 'personal'],
  [/\b(mandatory|required|student|comprehensive) fees?\b|\bfees\b/i, 'mandatory_fees'],
];

const PERIODS: ReadonlyArray<[RegExp, CostValue['period']]> = [
  [/\bper (?:academic )?year\b|\bannual(?:ly)?\b|\/\s?(?:yr|year)\b|\ba year\b|\beach year\b|\bper annum\b/i, 'academic_year'],
  [/\bper semester\b|\/\s?semester\b/i, 'semester'],
  [/\bper (?:term|trimester)\b|\/\s?term\b/i, 'term'],
  [/\bper quarter\b/i, 'quarter'],
  [/\bper month\b|\bmonthly\b|\/\s?month\b/i, 'month'],
  [/\bper (?:credit|unit|credit hour)\b/i, 'credit'],
  [/\bone[- ]time\b|\bnon[- ]refundable\b/i, 'one_time'],
  [/\b(?:for the (?:whole|entire|full) (?:program|programme|degree)|total (?:program|programme|degree) cost)\b/i, 'program_total'],
];

const DOLLAR_COUNTRIES: Record<string, string> = { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD' };

export function parseMoney(s: string, country: string): { amount: string; currency: string } | { unclear: true } | null {
  const m = /(US\$|C\$|CA\$|A\$|AU\$|NZ\$|\$|£|€|USD|CAD|GBP|EUR|AUD|CHF|NZD)\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?|(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(USD|CAD|GBP|EUR|AUD|CHF|NZD)\b/.exec(s);
  if (!m) return null;
  const sym = (m[1] ?? m[6])!;
  const whole = (m[2] ?? m[4])!.replace(/,/g, '');
  const frac = (m[3] ?? m[5]) ?? '.00';
  const currency =
    sym === '£' || sym === 'GBP' ? 'GBP' : sym === '€' || sym === 'EUR' ? 'EUR' : sym === 'US$' || sym === 'USD' ? 'USD' : sym === 'C$' || sym === 'CA$' || sym === 'CAD' ? 'CAD' : sym === 'A$' || sym === 'AU$' || sym === 'AUD' ? 'AUD' : sym === 'NZ$' || sym === 'NZD' ? 'NZD' : sym === 'CHF' ? 'CHF' : DOLLAR_COUNTRIES[country];
  if (!currency) return { unclear: true };
  return { amount: `${whole}${frac.padEnd(3, '0')}`, currency };
}

function feeCategoryOf(s: string): CostValue['feeCategory'] | null {
  if (/\bout[- ]of[- ]state\b|\bnon[- ]resident\b/i.test(s)) return 'out_of_state';
  if (/\bin[- ]state\b|\bresident\b/i.test(s)) return 'in_state';
  if (/\binternational\b/i.test(s)) return 'international';
  if (/\bdomestic\b/i.test(s)) return 'domestic';
  if (/\boverseas\b/i.test(s)) return 'overseas';
  if (/\bhome (?:fee|student)s?\b/i.test(s)) return 'home';
  return null;
}

// ---------------------------------------------------------------- requirements

/** Every English test named in a sentence, each with the minimum stated after it ("IELTS 7.0 or TOEFL iBT 100" is two rules). */
function englishRequirements(s: string): Array<{ test: string; minimum: number }> {
  const out: Array<{ test: string; minimum: number }> = [];
  const re = /\b(IELTS|TOEFL(?:\s?iBT)?|Duolingo(?: English Test)?|PTE(?: Academic)?)\b(?:(?!\b(?:IELTS|TOEFL|Duolingo|PTE)\b)[^.]|\.\d)*?\b(\d{1,3}(?:\.\d)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push({ test: m[1]!.replace(/\s+/g, '_').toUpperCase(), minimum: Number(m[2]) });
  return out;
}

function testingPolicy(s: string): 'optional' | 'required' | 'blind' | null {
  if (/\btest[- ](?:blind|free)\b|\bdo(?:es)? not (?:consider|accept|review) (?:test |sat |act )?scores\b/i.test(s)) return 'blind';
  if (/\btest[- ]optional\b|\bscores? (?:are|is) optional\b/i.test(s)) return 'optional';
  if (/\btest[- ]required\b|\b(?:sat|act|standardized test)(?: scores?)? (?:are|is) required\b|\brequired to submit (?:the )?(?:sat|act|standardized test)/i.test(s)) return 'required';
  return null;
}

function accessRoute(s: string): { route: 'direct_entry' | 'later_competitive_selection' | 'open_after_prerequisites'; guaranteed: boolean | null } | null {
  const notGuaranteed = /\b(?:not|never) guarantee[ds]?\b|\bdoes not guarantee\b|\bis not assured\b|\bno guarantee\b/i.test(s);
  if (/\b(competitive|capacity[- ]constrained|limited (?:capacity|space|enrollment)|apply (?:to|for) (?:the|this|a) major|internal (?:transfer|selection|application)|after (?:your|the) first year)\b/i.test(s) || notGuaranteed) {
    return { route: 'later_competitive_selection', guaranteed: notGuaranteed ? false : null };
  }
  if (/\b(direct(?:ly)? admi(?:t|ssion)|admitted directly)\b/i.test(s) && !/\bnot\b/i.test(s)) return { route: 'direct_entry', guaranteed: true };
  if (/\bopen to (?:all|any) students? who (?:complete|have completed)\b/i.test(s)) return { route: 'open_after_prerequisites', guaranteed: null };
  return null;
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function nominationLimit(s: string): number | null {
  const m = /\b(?:may|can) nominate (?:up to |no more than |a maximum of )?(one|two|three|four|five|\d+)\b/i.exec(s) ?? /\b(one|two|three|four|five|\d+) (?:nominee|nomination)s? (?:per|from each) (?:school|secondary school|high school)\b/i.exec(s);
  if (!m) return null;
  return WORD_NUMBERS[m[1]!.toLowerCase()] ?? Number(m[1]);
}

// ---------------------------------------------------------------- the extractor

interface Found {
  predicate: Predicate;
  qualifier: string;
  value: unknown;
  quote: string;
  passage: Passage;
  missing: string[];
  conditions: string[];
  categoryOverride: ApplicantCategory | null;
}

/** Code reads a deadline sentence: the date (with its year), a stated time and zone, and how receipt is judged. */
function deadlineFound(s: string, p: Passage, predicate: Predicate, gaps: ExtractionGap[]): Found | null {
  const d = findDateInText(s, 'unknown');
  if (d.kind === 'ambiguous') {
    gaps.push({ predicate, reason: 'The date could be read two ways (day and month order); it needs confirmation.', quote: s });
    return null;
  }
  if (d.kind !== 'date' || !/^\d{4}-\d{2}/.test(d.value)) {
    gaps.push({ predicate, reason: 'The sentence names a deadline without a date that includes the year.', quote: s });
    return null;
  }
  const exact = /^\d{4}-\d{2}-\d{2}$/.test(d.value);
  const t = parseTime(s);
  const z = parseZone(s);
  const value: DeadlineValue = { date: exact ? (d.value as CalendarDate) : null, month: exact ? null : d.value.slice(0, 7), time: t.time, timezone: z.timezone, timezoneLabel: z.label, receipt: receiptOf(s), originalText: s.slice(0, 500) };
  return { predicate, qualifier: roundLabelOf(s), value, quote: s, passage: p, missing: [], conditions: t.note ? [t.note] : [], categoryOverride: categoryOf(s, p) };
}

/** Code reads a cost sentence: amount, currency and period. A missing period or an unclear currency is a gap, never a guess. */
function costFound(s: string, p: Passage, predicate: Predicate, country: string, gaps: ExtractionGap[]): Found | null {
  const money = parseMoney(s, country);
  if (money === null) {
    gaps.push({ predicate, reason: 'The passage does not state an amount.', quote: s });
    return null;
  }
  if ('unclear' in money) {
    gaps.push({ predicate, reason: 'The currency of this amount is not clear from the page.', quote: s });
    return null;
  }
  const period = PERIODS.find(([re]) => re.test(s))?.[1] ?? (predicate === 'application_fee' || predicate === 'enrollment_deposit' ? 'one_time' : null);
  if (!period) {
    // A cost missing its period is rejected, never guessed (11 step 4, 15T03).
    gaps.push({ predicate, reason: 'The page gives an amount without saying what period it covers.', quote: s });
    return null;
  }
  const includes: string[] = [];
  if (predicate === 'tuition' && /\btuition and (?:mandatory |required |comprehensive )?fees\b/i.test(s)) includes.push('mandatory_fees');
  if (predicate === 'housing' && /\broom and board\b/i.test(s)) includes.push('meals');
  if (predicate === 'cost_of_attendance') for (const [re, pr] of COST_KINDS.slice(3)) if (re.test(s.replace(/\bcost of attendance\b/i, ''))) includes.push(pr);
  const category = feeCategoryOf(s) ?? feeCategoryOf(p.heading ?? '') ?? 'all';
  const value: CostValue = { amount: { amount: money.amount, currency: money.currency }, period, feeCategory: category, includes, billed: /\bbilled\b|\bon your (?:bill|invoice)\b/i.test(s) ? true : null };
  return { predicate, qualifier: category, value, quote: s, passage: p, missing: [], conditions: [], categoryOverride: null };
}

/** Families a model may help locate. Their values are always read by code from the located sentence. */
export const LOCATABLE_FAMILIES: ReadonlySet<string> = new Set(['deadline', 'cost']);

/**
 * Read sentences that a model located on the page. The model only points at
 * text: each quote must occur verbatim in a passage of this reading, and the
 * value is parsed by the same code as a deterministic reading. Claims made
 * this way are provisional (11 "Source selection and retrieval": "The model
 * can help locate relevant passages; code checks formats").
 */
export function extractLocated(reading: PageReading, ctx: ExtractionContext, located: ReadonlyArray<{ predicate: Predicate; quote: string }>): Extraction & { unverifiable: number } {
  const found: Found[] = [];
  const gaps: ExtractionGap[] = [];
  let unverifiable = 0;
  for (const l of located) {
    if (!LOCATABLE_FAMILIES.has(familyOf(l.predicate))) continue;
    const q = normalizeSpace(l.quote);
    const passage = q.length >= 12 ? reading.passages.find((p) => normalizeSpace(p.text).includes(q)) : undefined;
    if (!passage) {
      unverifiable += 1;
      continue;
    }
    const quote = l.quote.replace(/\s+/g, ' ').trim();
    const f = familyOf(l.predicate) === 'deadline' ? deadlineFound(quote, passage, l.predicate, gaps) : costFound(quote, passage, l.predicate, ctx.country, gaps);
    if (f) found.push(f);
  }
  return { claims: buildClaims(found, reading, ctx, gaps, 'model'), gaps, unverifiable };
}

export function extractFromPage(reading: PageReading, ctx: ExtractionContext, predicates: readonly Predicate[]): Extraction {
  const wanted = new Set(predicates);
  const wantFamily = (f: string) => predicates.some((p) => familyOf(p) === f);
  const found: Found[] = [];
  const gaps: ExtractionGap[] = [];

  for (const p of reading.passages) {
    for (const s of sentencesOf(p)) {
      if (wantFamily('deadline') && DEADLINE_WORDS.test(s) && !(OPENS_ONLY.test(s) && !/\b(close|deadline|due)\b/i.test(s))) {
        const predicate = deadlinePredicate(s);
        if (!wanted.has(predicate)) continue;
        const f = deadlineFound(s, p, predicate, gaps);
        if (f) found.push(f);
      }
      if (wantFamily('cost')) {
        const kind = COST_KINDS.find(([re]) => re.test(s));
        if (kind && wanted.has(kind[1]) && parseMoney(s, ctx.country) !== null) {
          const f = costFound(s, p, kind[1], ctx.country, gaps);
          if (f) found.push(f);
        }
      }
      if (wanted.has('english_language_requirement') && /\b(minimum|at least|require|must|overall|score of)\b/i.test(s)) {
        for (const e of englishRequirements(s)) found.push({ predicate: 'english_language_requirement', qualifier: e.test.toLowerCase(), value: { text: s, normalized: { test: e.test, minimum: e.minimum } }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: categoryOf(s, p) });
      }
      if (wanted.has('testing_policy')) {
        const t = testingPolicy(s);
        if (t) found.push({ predicate: 'testing_policy', qualifier: '', value: { text: s, normalized: { policy: t } }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: categoryOf(s, p) });
      }
      if (wanted.has('portfolio_requirement') && /\bportfolio\b/i.test(s) && /\b(required|must|submit|requires)\b/i.test(s)) {
        found.push({ predicate: 'portfolio_requirement', qualifier: '', value: { text: s, normalized: { required: !/\boptional\b|\bnot required\b/i.test(s) } }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: categoryOf(s, p) });
      }
      if (wanted.has('additional_requirement') && /\b(audition|interview|supplementary application|additional application|writing sample)\b/i.test(s) && /\b(required|must|requires)\b/i.test(s)) {
        found.push({ predicate: 'additional_requirement', qualifier: (/\b(audition|interview|supplementary application|additional application|writing sample)\b/i.exec(s)![1]!).toLowerCase().replace(/\s+/g, '_'), value: { text: s, normalized: { required: !/\bnot required\b|\boptional\b/i.test(s) } }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: categoryOf(s, p) });
      }
      if (wanted.has('program_access_route')) {
        const a = accessRoute(s);
        if (a) found.push({ predicate: 'program_access_route', qualifier: '', value: { route: a.route, guaranteed: a.guaranteed, text: s }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: categoryOf(s, p) });
      }
      if (wanted.has('scholarship_program_restriction') && /\bfirst[- ]choice (?:program|programme|course|faculty|degree)\b/i.test(s)) {
        found.push({ predicate: 'scholarship_program_restriction', qualifier: '', value: { restriction: 'first_choice_program', programs: [], text: s }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: categoryOf(s, p) });
      }
      if (wanted.has('nomination_limit')) {
        const n = nominationLimit(s);
        if (n !== null) {
          const refereeMustDiffer = /\b(?:nominator|nominating (?:counsel(?:l)?or|teacher)).{0,60}\b(?:cannot|must not|may not)\b.{0,30}\breferee\b|\breferee.{0,60}\bdifferent from\b.{0,20}\bnominator\b/i.test(p.text) ? true : null;
          found.push({ predicate: 'nomination_limit', qualifier: '', value: { perSchool: n, nominator: null, refereeMustDiffer, text: s }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: categoryOf(s, p) });
        }
      }
      if (wanted.has('aid_application_timing') && /\b(?:must|need to|required to|should) apply for (?:financial )?aid\b.{0,60}\b(?:at the (?:same )?time|when you apply|with (?:your|the) application|as a first[- ]year applicant)\b|\b(?:cannot|will not be able to|not eligible to) apply for (?:financial )?aid (?:after|later|in a later year)\b/i.test(s)) {
        found.push({ predicate: 'aid_application_timing', qualifier: '', value: { mustApplyWithAdmission: true, text: s }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: categoryOf(s, p) });
      }
      if (wanted.has('estimator_scope') && /\b(calculator|estimator)s?\b/i.test(s) && /\b(designed for|intended for|will not (?:accurately )?estimate|not (?:accurate|suitable) for|only for)\b/i.test(s)) {
        const supported: string[] = [];
        const excluded: string[] = [];
        if (/\bparents? (?:who )?live and work in the united states\b/i.test(s)) supported.push('parents_live_and_work_in_us');
        if (/\b(?:abroad|outside the united states|overseas|international)\b/i.test(s)) excluded.push('family_lives_or_works_abroad');
        found.push({ predicate: 'estimator_scope', qualifier: '', value: { estimatorUrl: null, supportedPopulations: supported.length > 0 ? supported : ['stated_population'], excludedSituations: excluded, text: s }, quote: s, passage: p, missing: [], conditions: [], categoryOverride: null });
      }
    }
  }
  if (wanted.has('statistic')) found.push(...statisticsFrom(reading.tables, reading.passages, gaps));
  return { claims: buildClaims(found, reading, ctx, gaps, 'deterministic'), gaps };
}

/** Scope, cycle-fit and status checks shared by every extraction path; anything that fails becomes a visible gap. */
function buildClaims(found: readonly Found[], reading: PageReading, ctx: ExtractionContext, gaps: ExtractionGap[], extraction: 'deterministic' | 'model'): ClaimInput[] {
  const claims: ClaimInput[] = [];
  for (const f of found) {
    const cycle = f.predicate === 'statistic' ? cohortCycle(f.value as StatisticValue) : f.passage.cycle;
    if (familyOf(f.predicate) !== 'statistic' && cycle === null) {
      gaps.push({ predicate: f.predicate, reason: f.passage.cyclesMentioned.length > 1 ? 'This passage mixes several entry years, so it cannot be applied to one cycle.' : 'The page does not say which entry cycle this applies to.', quote: f.quote });
      continue;
    }
    if (familyOf(f.predicate) === 'deadline' && cycle !== null) {
      const d = f.value as DeadlineValue;
      const probe = d.date ?? `${d.month!}-01`;
      if (!dateFitsCycle(probe, cycle)) {
        gaps.push({ predicate: f.predicate, reason: `The date ${d.date ?? d.month} does not fit the ${cycle} entry cycle this passage describes; it was not used.`, quote: f.quote });
        continue;
      }
    }
    const older = cycle !== null && Number(cycle) < Number(ctx.cycle) && familyOf(f.predicate) !== 'statistic';
    // A value the model located is never verified on its own: it stays provisional until a person or a deterministic reading confirms it.
    const status: ClaimStatus = reading.archived || older ? 'historical' : !ctx.official || extraction === 'model' ? 'provisional' : 'verified';
    claims.push({
      subject: ctx.subject,
      cycle,
      applicantCategory: f.categoryOverride ?? ctx.applicantCategory,
      predicate: f.predicate,
      qualifier: f.qualifier,
      value: f.value,
      conditions: f.conditions,
      exceptions: [],
      overrides: null,
      sourceOwner: ctx.owner,
      anchor: { sourceId: ctx.sourceId, url: ctx.url, finalUrl: ctx.finalUrl, passageId: f.passage.passageId, section: f.passage.heading, page: null, quote: f.quote },
      publishedOn: reading.publishedOn,
      effectiveCycle: cycle,
      retrievedAt: ctx.retrievedAt,
      status,
      statusReason: reading.archived ? 'The page is marked as archived or historical.' : !ctx.official ? 'The page is not on an official domain of the institution.' : extraction === 'model' ? 'The passage was located with help from a language model; its value was read by code but awaits confirmation.' : null,
      missing: f.missing,
      extraction,
      extractionConfidence: extraction === 'model' ? 'low' : 'high',
      visibility: { kind: 'public' },
    });
  }
  return claims;
}

function categoryOf(s: string, p: Passage): ApplicantCategory | null {
  const text = `${p.heading ?? ''} ${s}`;
  const intl = /\binternational\b/i.test(text);
  if (/\btransfer\b/i.test(text)) return intl ? 'transfer_international' : 'transfer';
  if (/\bgraduate\b(?!\s+(?:from|high school|secondary))/i.test(text) && !/\bundergraduate\b/i.test(text)) return 'graduate';
  if (/\bfirst[- ]year\b|\bfreshm[ae]n\b/i.test(text)) return intl ? 'first_year_international' : /\bdomestic\b/i.test(text) ? 'first_year_domestic' : 'first_year';
  if (intl) return 'first_year_international';
  return null;
}

function cohortCycle(v: StatisticValue): string | null {
  const m = /\b(20\d\d)\b/.exec(v.cohort.year);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------- statistics

const MEASURE_HEADERS: ReadonlyArray<[RegExp, StatisticValue['measure'], 'count' | 'percent' | 'score' | 'gpa']> = [
  [/\b25(?:th)?\b/i, 'score_25th', 'score'],
  [/\b(?:50(?:th)?|median)\b/i, 'score_50th', 'score'],
  [/\b75(?:th)?\b/i, 'score_75th', 'score'],
  [/\b(?:admit|admission|acceptance) rate\b/i, 'admit_rate', 'percent'],
  [/\byield\b/i, 'yield', 'percent'],
  [/\bapplicants?\b|\bapplied\b/i, 'applicants', 'count'],
  [/\badmit(?:ted|s)\b/i, 'admits', 'count'],
  [/\benrolled\b/i, 'enrolled', 'count'],
];

function populationOf(text: string): StatisticValue['cohort']['population'] | null {
  if (/\benrolled\b/i.test(text) && /\b(submitt(?:ed|ing|ers?)|who submitted)\b/i.test(text)) return 'enrolled_score_submitters';
  if (/\btransfer\b/i.test(text)) return /\badmit/i.test(text) ? 'transfer_admits' : 'transfer_applicants';
  if (/\benrolled\b/i.test(text)) return 'first_year_enrolled';
  if (/\badmit(?:ted|s)\b/i.test(text)) return 'first_year_admits';
  if (/\bapplicants?\b/i.test(text)) return 'first_year_applicants';
  return null;
}

function cohortYearOf(text: string): string | null {
  const m = /\b(?:fall|autumn)\s+(20\d\d)\b/i.exec(text) ?? /\b(20\d\d\s*[–-]\s*(?:20)?\d\d)\b/.exec(text) ?? /\b(20\d\d)\b/.exec(text);
  return m ? m[0]!.trim() : null;
}

/**
 * Statistics from a table keep the cohort, the reporting year, the denominator
 * and missingness (11 "Statistics and comparative data"). A table whose
 * headings do not line up with its columns is blocked as a whole: "A value
 * beside a heading can belong to the next column after a faulty extraction"
 * (11T07). A suppressed cell is stored as suppressed, never as zero (11T08).
 */
function statisticsFrom(tables: readonly TextTable[], passages: readonly Passage[], gaps: ExtractionGap[]): Found[] {
  const out: Found[] = [];
  for (const t of tables) {
    const passage = passages.find((p) => p.passageId === t.passageId)!;
    const context = `${passage.heading ?? ''} ${t.caption ?? ''}`;
    const population = populationOf(context);
    const year = cohortYearOf(context);
    if (!t.headers || population === null || year === null) continue;
    if (t.headerMismatch) {
      for (const r of t.rows) gaps.push({ predicate: 'statistic', reason: 'The table’s column headings do not line up with its values, so no value from it is used until the layout is checked.', quote: r.join(' | ') });
      continue;
    }
    for (const row of t.rows) {
      const label = row[0] ?? '';
      // A row can name a different group than the table's caption (a "Transfer" row in an admissions table).
      const rowPopulation = /\btransfer\b/i.test(label) && !/\btransfer\b/i.test(context) ? populationOf(`transfer ${context}`) ?? population : population;
      for (let c = 1; c < row.length; c += 1) {
        const header = t.headers[c] ?? '';
        const m = MEASURE_HEADERS.find(([re]) => re.test(header));
        if (!m) continue;
        const cell = readCell(row[c]!, t.legend);
        if (cell.kind === 'text') continue;
        const value: StatisticValue['value'] = cell.kind === 'number' ? { kind: 'number', value: cell.value, unit: m[2], currency: null } : cell.kind === 'suppressed' ? { kind: 'suppressed' } : { kind: 'not_reported' };
        const lineQuote = passage.text.split('\n').find((l) => normalizeSpace(l).includes(normalizeSpace(label)) && normalizeSpace(l).includes(normalizeSpace(row[c]!))) ?? label;
        const stat: StatisticValue = {
          measure: m[1],
          cohort: { population: rowPopulation, year, applicantCategory: /\binternational\b/i.test(context) ? 'first_year_international' : null },
          denominator: m[1] === 'admit_rate' ? 'first-year applicants in the same cohort' : m[1] === 'yield' ? 'admitted students in the same cohort' : null,
          value,
          scoreType: m[2] === 'score' ? label : null,
          methodology: null,
          notAThreshold: true,
        };
        out.push({ predicate: 'statistic', qualifier: `${m[1]}:${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}:${rowPopulation}`, value: stat, quote: lineQuote, passage, missing: [], conditions: [], categoryOverride: null });
      }
    }
  }
  return out;
}
