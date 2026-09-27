import type { Budget, CostComponentKind } from '../../shared/money.js';
import { money } from '../../shared/money.js';
import { findCity, findCountryCodes } from '../../shared/places.js';

/**
 * Deterministic answer parsers for intake (02R05, 02R06). Each parser returns
 * what the words explicitly say, with ambiguity kept visible. Nothing here
 * infers wealth, identity, disability or immigration status.
 */

// ------------------------------------------------------------------ control answers

export type ControlAnswer = 'skip' | 'declined' | 'dont_know' | 'not_decided' | 'yes' | 'no' | null;

export function controlAnswer(text: string): ControlAnswer {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(skip|pass|next|skip it|skip this|next question)$/.test(t)) return 'skip';
  if (/^(i('d| would)? )?(prefer|rather) not( to)?( say| share| answer)?$|^no comment$|^i('d| would) rather not$|^(that'?s )?private$/.test(t)) return 'declined';
  if (/^(i )?(don'?t|do not) know( yet)?$|^not sure( yet)?$|^no idea$|^unsure$|^i'?m not sure$/.test(t)) return 'dont_know';
  if (/^(not decided( yet)?|undecided|haven'?t decided( yet)?|still deciding|no idea yet)$/.test(t)) return 'not_decided';
  if (/^(yes|yeah|yep|correct|right|that'?s right|sure|ok|okay|y)$/.test(t)) return 'yes';
  if (/^(no|nope|not really|n|incorrect|wrong)$/.test(t)) return 'no';
  return null;
}

/** Words that make a statement tentative: "I might graduate in June" is not a confirmed plan. */
export function isTentative(text: string): boolean {
  return /\b(might|maybe|perhaps|probably|possibly|i think|i guess|hopefully|planning to|plan to|hope to|hoping to|considering|thinking (about|of)|not sure but|likely)\b/i.test(text);
}

/** Explicit negation near the statement. Used to surface meaning in review summaries (02T12). */
export function hasNegation(text: string): boolean {
  return /\b(not|n't|never|no longer|none|neither|nor|without)\b/i.test(text);
}

// ------------------------------------------------------------------ numbers

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };

/** Parse English number words ("one hundred and fifty", "a thousand and fifty") into a number. */
export function wordsToNumber(text: string): number | null {
  const words = text.toLowerCase().replace(/-/g, ' ').replace(/,/g, ' ').split(/\s+/).filter((w) => w && w !== 'and');
  if (words.length === 0) return null;
  let total = 0;
  let current = 0;
  let any = false;
  for (const w of words) {
    if (w === 'a' || w === 'an') {
      current = current === 0 ? 1 : current;
      continue;
    }
    if (w in SMALL) {
      current += SMALL[w]!;
      any = true;
    } else if (w in TENS) {
      current += TENS[w]!;
      any = true;
    } else if (w === 'hundred') {
      current = (current || 1) * 100;
      any = true;
    } else if (w in SCALES) {
      total += (current || 1) * SCALES[w]!;
      current = 0;
      any = true;
    } else return null;
  }
  return any ? total + current : null;
}

export interface NumberMention {
  value: number;
  text: string;
  index: number;
}

const NUMBER_WORD_RE = /\b((?:(?:a|an|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:[\s-]+and[\s-]+(?=(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)|[\s-]+(?=(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b))?)+)\b/gi;

/** All numbers mentioned, as digits or words, in order. */
export function findNumbers(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  for (const m of text.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\w])/g)) {
    const raw = m[0].replace(/,/g, '');
    out.push({ value: Number(raw), text: m[0], index: m.index! });
  }
  for (const m of text.matchAll(NUMBER_WORD_RE)) {
    const phrase = m[1]!.trim();
    if (/^(a|an)$/i.test(phrase)) continue;
    const v = wordsToNumber(phrase);
    if (v !== null) out.push({ value: v, text: phrase, index: m.index! });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ------------------------------------------------------------------ money

const CURRENCY_WORDS: Array<{ code: string; re: RegExp }> = [
  { code: 'EUR', re: /€|\beur(o|os)?\b/i },
  { code: 'USD', re: /\$|\busd\b|\b(us )?dollars?\b/i },
  { code: 'GBP', re: /£|\bgbp\b|\bpounds?( sterling)?\b/i },
  { code: 'CHF', re: /\bchf\b|\bswiss francs?\b/i },
  { code: 'CAD', re: /\bcad\b|\bcanadian dollars?\b/i },
  { code: 'AUD', re: /\baud\b|\baustralian dollars?\b/i },
  { code: 'INR', re: /₹|\binr\b|\brupees?\b/i },
  { code: 'JPY', re: /¥|\bjpy\b|\byen\b/i },
];

export interface MoneyMention {
  amount: number;
  currency: string | null;
  text: string;
}

export function findMoney(text: string): MoneyMention[] {
  const currencies = CURRENCY_WORDS.filter((c) => c.re.test(text)).map((c) => c.code);
  const currency = currencies.length === 1 ? currencies[0]! : null;
  return findNumbers(text).map((n) => ({ amount: n.value, currency, text: n.text }));
}

export interface BudgetParse {
  budget?: Budget;
  /** Missing pieces that must be asked, never guessed. */
  missing: Array<'currency' | 'amount' | 'scope'>;
  /** Several different amounts were mentioned (possible recognition error or range). */
  conflictingAmounts: number[];
}

/**
 * Whether a budget is a firm cap or a preference, and which costs it must
 * cover. `covers: null` means the answer did not say whether travel is included,
 * which must be asked rather than assumed.
 */
export function budgetShape(text: string): { kind: Budget['kind']; covers: Budget['covers'] | null } {
  const includesTravel = /\b(including|incl\.?|with|covers?)\b.{0,30}\b(travel|transport|transportation|everything|all costs|all in|flights?|bus|train)\b|\ball[- ]in\b|\bin total\b|\btotal\b/i.test(text);
  const tuitionOnly = /\b(tuition|fees?|program(me)? fee|course fee)\b(?!.{0,30}\b(including|and) (travel|transport))/i.test(text) && !includesTravel;
  const covers: Budget['covers'] | null = tuitionOnly ? (['tuition', 'application_fee', 'registration_fee'] as CostComponentKind[]) : includesTravel ? 'all' : null;
  const kind: Budget['kind'] = /\b(ideally|prefer|preferably|around|about|roughly|would like)\b/i.test(text) && !/\b(max|maximum|at most|no more than|up to|limit|can'?t (spend|afford) more)\b/i.test(text) ? 'preference' : 'hard_cap';
  return { kind, covers };
}

export function parseBudget(text: string, defaultAppliesTo: Budget['appliesTo'] = 'per_opportunity'): BudgetParse {
  const amounts = findMoney(text);
  const distinct = [...new Set(amounts.map((a) => a.amount))];
  const missing: BudgetParse['missing'] = [];
  if (distinct.length === 0) return { missing: ['amount'], conflictingAmounts: [] };
  const currency = amounts[0]!.currency;
  if (!currency) missing.push('currency');
  // A range "100 to 200" is not a single limit: both ends are offered as a choice, never one picked silently.
  const range = /(\d[\d,]*)\s*(-|–|to|and)\s*(\d[\d,]*)/.exec(text);
  const amount = !range && distinct.length === 1 ? distinct[0]! : null;
  const conflicting = range ? [Number(range[1]!.replace(/,/g, '')), Number(range[3]!.replace(/,/g, ''))] : distinct.length === 1 ? [] : distinct;
  const shape = budgetShape(text);
  const covers: Budget['covers'] = shape.covers ?? 'all';
  if (shape.covers === null) missing.push('scope');
  const kind = shape.kind;
  if (amount === null || !currency) return { missing, conflictingAmounts: conflicting };
  return { budget: { amount: money(amount, currency), kind, covers, appliesTo: defaultAppliesTo }, missing, conflictingAmounts: conflicting };
}

// ------------------------------------------------------------------ hours

export function parseHoursPerWeek(text: string): { min: number; max: number } | 'vague' | null {
  const t = text.toLowerCase();
  const range = /(\d+(?:\.\d+)?)\s*(?:-|–|to|or)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/.exec(t);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const nums = findNumbers(t).filter((n) => /\b(hours?|hrs?|h)\b/.test(t.slice(n.index, n.index + n.text.length + 8)));
  const single = nums.length === 1 ? nums[0]!.value : /\bhalf an hour\b/.test(t) ? 0.5 : /\b(an|one) hour\b/.test(t) ? 1 : null;
  if (single !== null) {
    const v = single;
    const perDay = /\b(a|per|each|every) day\b|\bdaily\b/.test(t);
    const weekdays = /\bweekdays?\b/.test(t) ? 5 : 7;
    const perWeek = perDay ? v * weekdays : v;
    return { min: perWeek, max: perWeek };
  }
  if (/\b(a few|a couple|some|not much|a little|a lot)\b/.test(t)) return 'vague';
  return null;
}

// ------------------------------------------------------------------ places

/**
 * Countries explicitly mentioned (not negated), in order. Demonyms ("Greek")
 * are accepted by default; pass `demonyms: false` where a demonym would more
 * likely name a language or heritage than a country.
 */
export function findCountries(text: string, opts: { demonyms: boolean } = { demonyms: true }): string[] {
  return findCountryCodes(text, opts);
}

export { findCity };

/** A street address or postcode is more precise than intake needs; it is never stored (09 minimum data). */
export function looksLikeStreetAddress(text: string): boolean {
  return /\b\d{1,5}\s+[A-Za-z][A-Za-z.\s]{2,30}\b(street|st\.?|avenue|ave\.?|road|rd\.?|lane|ln\.?|boulevard|blvd\.?|odos|drive|dr\.?)\b/i.test(text) || /\b\d{5}(-\d{4})?\b/.test(text) || /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/.test(text);
}

// ------------------------------------------------------------------ education

const QUAL_SYSTEMS: Array<{ id: string; label: string; re: RegExp }> = [
  { id: 'IB_DP', label: 'IB Diploma Programme', re: /\b(ib|international baccalaureate)\b(?!\s*myp)/i },
  { id: 'A_LEVEL', label: 'A levels', re: /\b(a[- ]?levels?|gce advanced)\b/i },
  { id: 'GR_APOLYTIRIO', label: 'Greek Apolytirio (national system)', re: /\b(apolytirio|panhellenic|greek (national )?(system|curriculum|school)|lykeio|lyceum)\b/i },
  { id: 'US_HIGH_SCHOOL', label: 'US high school diploma', re: /\b(us|american) (high school|curriculum)\b|\bhigh school diploma\b|\bap courses\b/i },
  { id: 'FR_BAC', label: 'French Baccalauréat', re: /\b(french )?bac(calaur[ée]at)?\b/i },
  { id: 'EUROPEAN_BAC', label: 'European Baccalaureate', re: /\beuropean baccalaureate\b/i },
];

export function findQualificationSystem(text: string): { id: string; label: string } | null {
  if (/\beuropean baccalaureate\b/i.test(text)) return { id: 'EUROPEAN_BAC', label: 'European Baccalaureate' };
  const q = QUAL_SYSTEMS.find((x) => x.re.test(text));
  return q ? { id: q.id, label: q.label } : null;
}

/** "Year 12", "Grade 11", "Form 5", "B Lykeiou": kept exactly; never mapped to another system's grade. */
export function findYearLabel(text: string): string | null {
  const m = /\b(year|grade|form|class)\s+(\d{1,2})\b/i.exec(text) ?? /\b([ABCΑΒΓ]['΄]?\s*(lykeiou|λυκείου|gymnasiou|γυμνασίου))\b/i.exec(text);
  return m ? m[0].trim() : null;
}

// ------------------------------------------------------------------ attribution

const OTHER_HOLDERS: Array<{ label: string; re: RegExp }> = [
  { label: 'parents', re: /\b(my )?(parents|mom and dad|mum and dad|family)\b/i },
  { label: 'mother', re: /\b(my )?(mom|mum|mother)\b/i },
  { label: 'father', re: /\b(my )?(dad|father)\b/i },
  { label: 'guardian', re: /\b(my )?guardian\b/i },
  { label: 'teacher', re: /\b(my )?teacher\b/i },
  { label: 'counselor', re: /\b(my )?(school )?counsell?or\b/i },
];

export interface AttributedClause {
  holder: 'student' | 'reported_other';
  holderLabel: string | null;
  text: string;
}

/**
 * Split a statement into clauses attributed to the student or to someone else
 * the student reports ("I want design but my parents want medicine").
 */
export function attributeClauses(text: string): AttributedClause[] {
  const clauses = text.split(/\b(?:but|while|whereas|however|although)\b|[;]/i).map((c) => c.trim()).filter(Boolean);
  return clauses.map((c) => {
    const verb = /\b(want|wants|think|thinks|prefer|prefers|expect|expects|say|says|said|would like|hope|hopes|push(es)?|insist(s)?)\b/i;
    for (const h of OTHER_HOLDERS) {
      const m = h.re.exec(c);
      if (m && verb.test(c.slice(m.index)) && !/^\s*i\b/i.test(c.slice(0, m.index))) return { holder: 'reported_other' as const, holderLabel: h.label, text: c };
    }
    return { holder: 'student' as const, holderLabel: null, text: c };
  });
}

/** Detect a request that belongs to another mode (mock interview practice, essay writing). */
export function modeChangeRequest(text: string): 'interview_practice' | 'essay_brainstorming' | null {
  if (/\b(mock|practice|practise)\b.{0,20}\binterview\b|\binterview\b.{0,20}\b(practice|practise|prep|preparation)\b/i.test(text)) return 'interview_practice';
  if (/\b(essay|personal statement)\b.{0,30}\b(brainstorm|write|draft|help)\b|\b(brainstorm|write|draft|help)\b.{0,30}\b(essay|personal statement)\b/i.test(text)) return 'essay_brainstorming';
  return null;
}

/** Ordinary admissions stress: respond supportively, never record a health label. */
export function expressesStress(text: string): boolean {
  return /\b(stressed|stressing|overwhelmed|anxious|anxiety|panicking|scared|worried|freaking out|nervous)\b/i.test(text);
}

// ------------------------------------------------------------------ clauses

export interface Clause {
  text: string;
  start: number;
}

const CLAUSE_BREAK = /[.!?;]+(?:\s+|$)|,?\s+\b(?:but|while|whereas|although|though|however)\b\s+|,?\s+\band\b\s+(?=(?:i|i'm|i've|i'll|i'd|my|we)\b)/gi;

/** Split an answer into clauses at sentence ends and at joins that introduce a new statement. */
export function splitClauses(text: string): Clause[] {
  const out: Clause[] = [];
  let last = 0;
  for (const m of text.matchAll(CLAUSE_BREAK)) {
    const seg = text.slice(last, m.index!);
    if (seg.trim()) out.push({ text: seg.trim(), start: last + (seg.length - seg.trimStart().length) });
    last = m.index! + m[0].length;
  }
  const tail = text.slice(last);
  if (tail.trim()) out.push({ text: tail.trim(), start: last + (tail.length - tail.trimStart().length) });
  return out;
}

/** The clause that contains a character offset (used to quote only the relevant part of an answer). */
export function clauseAt(text: string, index: number): string {
  const clauses = splitClauses(text);
  const c = [...clauses].reverse().find((x) => x.start <= index) ?? clauses[0];
  return c ? c.text : text.trim();
}

// ------------------------------------------------------------------ weekly hours (with day ambiguity)

export type WeeklyHours =
  | { kind: 'range'; min: number; max: number; derivedFromPerDay: boolean }
  | { kind: 'per_day_ambiguous'; perDay: number; candidates: Array<{ min: number; max: number; label: string }> }
  | { kind: 'vague' }
  | { kind: 'none' };

/**
 * Weekly hours. "2 hours a day" is ambiguous between weekdays and every day, so
 * both readings are returned for the student to choose rather than one guessed.
 */
export function parseWeeklyHours(text: string): WeeklyHours {
  const t = text.toLowerCase();
  const perDay = /\b(a|per|each|every) day\b|\bdaily\b|\ba night\b|\bper night\b/.test(t);
  if (!perDay) {
    const r = parseHoursPerWeek(text);
    if (r === null) return { kind: 'none' };
    if (r === 'vague') return { kind: 'vague' };
    return { kind: 'range', min: r.min, max: r.max, derivedFromPerDay: false };
  }
  const nums = findNumbers(t).filter((n) => /^\s*(hours?|hrs?|h)\b/.test(t.slice(n.index + n.text.length)));
  const v = nums.length === 1 ? nums[0]!.value : /\bhalf an hour\b/.test(t) ? 0.5 : /\b(an|one) hour\b/.test(t) ? 1 : null;
  if (v === null) return /\b(a few|a couple|some|not much|a little|a lot)\b/.test(t) ? { kind: 'vague' } : { kind: 'none' };
  if (/\bweekdays?\b|\bschool days?\b|\bmonday to friday\b/.test(t)) return { kind: 'range', min: v * 5, max: v * 5, derivedFromPerDay: true };
  if (/\bweekends?\b|\bsaturdays? and sundays?\b/.test(t)) return { kind: 'range', min: v * 2, max: v * 2, derivedFromPerDay: true };
  if (/\bevery day\b|\bdaily\b|\bseven days\b|\b7 days\b/.test(t)) return { kind: 'range', min: v * 7, max: v * 7, derivedFromPerDay: true };
  return {
    kind: 'per_day_ambiguous',
    perDay: v,
    candidates: [
      { min: v * 5, max: v * 5, label: `${v * 5} hours a week (weekdays only)` },
      { min: v * 7, max: v * 7, label: `${v * 7} hours a week (every day)` },
    ],
  };
}

// ------------------------------------------------------------------ travel

export interface TravelParse {
  overnightTravelPossible: boolean | null;
  maxTravelMinutes: number | null;
  travelDuringTermPossible: boolean | null;
  remotePreference: 'remote_only' | null;
  /** Text that established each part, for the evidence quote. */
  matched: string[];
}

const NEG = String.raw`(?:can'?t|cannot|can not|not able to|unable to|not allowed to|won'?t be able to|couldn'?t|am not able to|no)`;

export function parseTravel(text: string): TravelParse | null {
  const t = text.toLowerCase();
  const r: TravelParse = { overnightTravelPossible: null, maxTravelMinutes: null, travelDuringTermPossible: null, remotePreference: null, matched: [] };
  const hit = (re: RegExp): string | null => re.exec(t)?.[0] ?? null;
  let m: string | null;
  if ((m = hit(/\b(online only|only online|remote only|only remote|virtual only|only virtual|from home only|only from home)\b/))) {
    r.remotePreference = 'remote_only';
    r.overnightTravelPossible = false;
    r.matched.push(m);
  }
  if ((m = hit(/\b(local(ly)? only|only local(ly)?|nearby only|only nearby|close to home|in my (city|town|area) only|only in my (city|town|area))\b/))) {
    r.overnightTravelPossible = false;
    r.matched.push(m);
  }
  if ((m = hit(new RegExp(String.raw`\b${NEG}\b[^.;]{0,25}\b(overnight|stay (away|over)|sleep (away|over)|stay the night)\b|\b(?:no|not|never)\s+(?:overnight|staying (?:away|over))\b`)))) {
    r.overnightTravelPossible = false;
    r.matched.push(m);
  } else if ((m = hit(/\b(can|could|able to|happy to|fine to|ok to|okay to|allowed to|yes)\b[^.;]{0,25}\b(overnight|stay (away|over)|sleep (away|over)|stay the night)\b/))) {
    r.overnightTravelPossible = true;
    r.matched.push(m);
  } else if ((m = hit(new RegExp(String.raw`\b${NEG}\b[^.;]{0,15}\btravel\b|\bno travel(ling|ing)?\b`)))) {
    r.overnightTravelPossible = false;
    r.matched.push(m);
  } else if ((m = hit(/\b(can|could|able to|happy to|fine to|ok to|okay to|allowed to)\b[^.;]{0,15}\btravel\b(?![^.;]{0,20}\b(but|except)\b)/))) {
    r.overnightTravelPossible = true;
    r.matched.push(m);
  }
  const lim = /\b(?:within|up to|at most|max(?:imum)?|no more than|under|less than)\s+((?:\d+(?:\.\d+)?)|an?|one|two|three|half an)\s*(hours?|hrs?|minutes?|mins?)\b/.exec(t) ?? /\b(\d+(?:\.\d+)?|an?|one|two|half an)\s*(hours?|hrs?|minutes?|mins?)\s+(?:away|by (?:bus|train|car)|of travel|travel|commute|drive|journey)\b/.exec(t);
  if (lim) {
    const q = lim[1]!;
    const n = /^\d/.test(q) ? Number(q) : q === 'half an' ? 0.5 : (wordsToNumber(q) ?? 1);
    const minutes = /^h/.test(lim[2]!) ? Math.round(n * 60) : Math.round(n);
    if (minutes > 0) {
      r.maxTravelMinutes = minutes;
      r.matched.push(lim[0]);
    }
  }
  if ((m = hit(new RegExp(String.raw`\b${NEG}\b[^.;]{0,30}\bduring (term|the school year|school( time)?)\b|\bonly (in|during) (the )?(holidays|vacation|summer|breaks?)\b|\bnot during (term|school)\b`)))) {
    r.travelDuringTermPossible = false;
    r.matched.push(m);
  } else if ((m = hit(/\b(also |even )?during (term|the school year)\b/))) {
    r.travelDuringTermPossible = true;
    r.matched.push(m);
  }
  return r.matched.length > 0 ? r : null;
}

// ------------------------------------------------------------------ date windows

const MONTH_RE = String.raw`(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)`;
const MONTH_NUM: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

interface DateToken {
  day?: number;
  month: number;
  year?: number;
  index: number;
  end: number;
  /** Second half of a compact range such as "1-15 July". */
  rangeJoined?: boolean;
}

function dateTokens(text: string): DateToken[] {
  const t = text.toLowerCase();
  const out: DateToken[] = [];
  const re = new RegExp(
    String.raw`\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|to)\s*(\d{1,2})(?:st|nd|rd|th)?)?\s+(?:of\s+)?${MONTH_RE}\.?(?:,?\s+(\d{4}))?\b|\b${MONTH_RE}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?|\b${MONTH_RE}\.?,?\s+(\d{4})\b|\b${MONTH_RE}\b`,
    'g',
  );
  for (const m of t.matchAll(re)) {
    const i = m.index!;
    const e = i + m[0].length;
    if (m[1]) out.push({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), index: i, end: e });
    else if (m[6]) {
      const month = MONTH_NUM[m[6]]!;
      const year = m[7] ? Number(m[7]) : undefined;
      if (m[5]) {
        // "1-15 July 2027": two tokens sharing month and year.
        out.push({ day: Number(m[4]), month, ...(year !== undefined ? { year } : {}), index: i, end: i + m[4]!.length });
        out.push({ day: Number(m[5]), month, ...(year !== undefined ? { year } : {}), index: e - 1, end: e, rangeJoined: true });
      } else out.push({ day: Number(m[4]), month, ...(year !== undefined ? { year } : {}), index: i, end: e });
    } else if (m[8]) out.push({ month: MONTH_NUM[m[8]]!, day: Number(m[9]), ...(m[10] ? { year: Number(m[10]) } : {}), index: i, end: e });
    else if (m[11]) out.push({ month: MONTH_NUM[m[11]]!, year: Number(m[12]), index: i, end: e });
    else if (m[13]) {
      // A bare month name. "may" alone is usually the verb, never a date.
      if (m[13] === 'may' || m[13] === 'mar') continue;
      out.push({ month: MONTH_NUM[m[13]]!, index: i, end: e });
    }
  }
  return out;
}

export interface DateWindowParse {
  windows: Array<{ start: string; end: string; ongoing: false }>;
  /** A year was not stated and was taken as the next occurrence; must be confirmed. */
  yearInferred: boolean;
  issues: string[];
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
function tokenDate(t: DateToken, year: number): string | null {
  if (t.day !== undefined) {
    const d = new Date(Date.UTC(year, t.month - 1, t.day));
    if (d.getUTCMonth() !== t.month - 1 || d.getUTCDate() !== t.day) return null;
    return `${year}-${pad2(t.month)}-${pad2(t.day)}`;
  }
  return `${year}-${pad2(t.month)}`;
}

/**
 * Availability windows such as "1 July to 15 August 2027" or "July 2027".
 * A missing start year is taken from the end date; when no year is given at
 * all, the next occurrence after `today` is used and flagged for confirmation.
 */
export function parseDateWindows(text: string, today: string): DateWindowParse {
  const tokens = dateTokens(text);
  const result: DateWindowParse = { windows: [], yearInferred: false, issues: [] };
  if (tokens.length === 0) return result;
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  const explicitYear = tokens.find((t) => t.year !== undefined)?.year;
  const used = new Set<number>();
  for (let i = 0; i < tokens.length; i += 1) {
    if (used.has(i)) continue;
    const a = tokens[i]!;
    const b = tokens[i + 1];
    const between = b ? text.slice(a.end, b.index).toLowerCase() : '';
    const monthsOnly = a.day === undefined && b?.day === undefined;
    const isRange = !!b && (b.rangeJoined === true || /^\s*(?:-|–|to|until|till|through|thru)\s*(?:the\s+)?$/.test(between) || (monthsOnly && /^\s*and\s*$/.test(between)));
    const end = isRange ? b! : a;
    if (isRange) used.add(i + 1);
    let endYear = end.year ?? a.year ?? explicitYear;
    if (endYear === undefined) {
      endYear = end.month < tm || (end.month === tm && end.day !== undefined && end.day < Number(today.slice(8, 10))) ? ty + 1 : ty;
      result.yearInferred = true;
    }
    let startYear = a.year ?? endYear;
    if (a.year === undefined && (a.month > end.month || (a.month === end.month && (a.day ?? 1) > (end.day ?? 31)))) startYear = endYear - 1;
    const s = tokenDate(a, startYear);
    const e = tokenDate(end, endYear);
    if (!s || !e) {
      result.issues.push('invalid_date');
      continue;
    }
    if (s.slice(0, 7) > e.slice(0, 7) || (s.length === 10 && e.length === 10 && s > e)) {
      result.issues.push('end_before_start');
      continue;
    }
    result.windows.push({ start: s, end: e, ongoing: false });
  }
  return result;
}

// ------------------------------------------------------------------ activities

/**
 * The lifecycle an activity statement describes (02R05, 02T11). A hypothetical
 * or wished-for activity is 'considering'; a decided future one is 'planned';
 * it is never 'completed' unless the words say it happened.
 */
export function activityTiming(text: string): 'considering' | 'planned' | 'in_progress' | 'completed' | null {
  const t = text.toLowerCase();
  if (/\b(if i|i would|i'd like to|i'd love to|i might|i may|maybe|perhaps|thinking (about|of)|considering|want to|wanna|hoping to|hope to|would (like|love) to|interested in (joining|starting|doing|trying)|dream(ing)? of|wish i could)\b/.test(t)) return 'considering';
  if (/\b(i will|i'll|i'm going to|i am going to|going to|planning to|plan to|i've signed up|i have signed up|signed up|registered for|i've applied|starting (next|in|this coming)|next (year|summer|term|semester|month|week)|this coming)\b/.test(t)) return 'planned';
  if (/\b(currently|right now|at the moment|these days|every (week|weekend|day|saturday|sunday|monday|tuesday|wednesday|thursday|friday)|most (weekends|days|weeks)|i'm (in|on|part of|doing|working|volunteering|playing|learning|taking|running|leading)|i am (in|on|part of|doing|working|volunteering|playing|learning|taking|running|leading)|i (do|play|volunteer|work|help|run|lead|coach|tutor|practi[cs]e|take care of|look after|babysit|sing|dance|paint|draw|code|write|train|swim|compete|organi[sz]e))\b/.test(t)) return 'in_progress';
  if (/\b(i (did|was|used to|had|won|finished|completed|participated|volunteered|worked|played|led|founded|started|organi[sz]ed|attended|ran|built|made|took part)|last (year|summer|term|semester|month)|years? ago|in 20\d\d)\b/.test(t)) return 'completed';
  return null;
}

const ACTIVITY_CATEGORIES: ReadonlyArray<{ category: 'paid_work' | 'caregiving' | 'household_responsibility' | 'sport' | 'club' | 'volunteering' | 'research' | 'creative_practice' | 'program_or_course' | 'independent_project' | 'independent_learning' | 'community'; re: RegExp }> = [
  { category: 'caregiving', re: /\b(take care of|taking care of|look after|looking after|caring for|babysit|carer|caregiv)/i },
  { category: 'paid_work', re: /\b(job|part[- ]time|shifts?|paid|employ|work(ing)? (at|in|for))\b/i },
  { category: 'household_responsibility', re: /\b(chores|housework|household|family business)\b/i },
  { category: 'volunteering', re: /\bvolunteer/i },
  { category: 'research', re: /\bresearch\b/i },
  { category: 'club', re: /\b(club|society|robotics|debate|debating|model un|mun|student council|school newspaper)\b/i },
  { category: 'sport', re: /\b(football|soccer|basketball|tennis|swim|swimming|athletics|track|volleyball|rugby|cricket|hockey|martial arts|karate|judo|taekwondo|climbing|rowing|sailing|team|sports?)\b/i },
  { category: 'creative_practice', re: /\b(piano|guitar|violin|cello|drums|music|band|orchestra|choir|sing|paint|draw|art|photograph|film|theatre|theater|drama|dance|poetry|creative writing)\w*/i },
  { category: 'program_or_course', re: /\b(course|summer school|summer program(me)?|camp|internship|workshop|class(es)?)\b/i },
  { category: 'independent_project', re: /\b(app|website|built|build|project|startup|start-up|coding|game)\b/i },
  { category: 'community', re: /\b(community|neighbou?rhood|local group)\b/i },
  { category: 'independent_learning', re: /\b(teach(ing)? myself|self[- ]taught|learning on my own|online course)\b/i },
];

export function activityCategory(text: string): (typeof ACTIVITY_CATEGORIES)[number]['category'] | 'other' {
  return ACTIVITY_CATEGORIES.find((c) => c.re.test(text))?.category ?? 'other';
}

/** A short activity title in the student's own words, without the leading "I'm thinking about". */
export function activityTitle(clause: string): string {
  let t = clause.trim().replace(/[.!?]+$/, '');
  t = t.replace(/^(and|also|plus|then)\s+/i, '');
  t = t.replace(/^(i('m| am| was| will| would| might| want to| plan to| have been| hope to| used to| also| really|'d like to|'ll)?\s+)((currently|also|really|still|thinking (about|of)|considering|planning (to|on)|going to|hoping to|about to)\s+)*/i, '');
  t = t.trim();
  if (t.length === 0) t = clause.trim();
  return t.length > 120 ? `${t.slice(0, 117)}...` : t;
}

// ------------------------------------------------------------------ responsibilities

export interface ResponsibilitiesParse {
  has: boolean | null;
  /** Broad kinds only; no details about other people are kept. */
  kinds: Array<'caregiving' | 'paid work' | 'household responsibilities' | 'activities' | 'other regular commitments'>;
  hours: { min: number; max: number } | null;
  /** The answer mentioned health or other private details about someone else; only the broad kind was kept. */
  privateDetailOmitted: boolean;
}

const PRIVATE_DETAIL = /\b(diagnos|disab|autis|illness|ill\b|sick|cancer|dementia|disorder|medication|hospital|therapy|mental health|depress|anxiety|pregnan|divorc|prison|jail|deport|immigra|visa|undocumented|church|mosque|temple|synagogue|religio)\w*/i;

const HEALTH_AND_STATUS = String.raw`(?:diagnos\w*|disab\w*|autis\w*|adhd|illness|sick|cancer|dementia|disorder|medication|hospital\w*|therapy|mental health|depress\w*|anxiety|pregnan\w*|prison|jail|deport\w*|immigra\w*|visa|undocumented|asylum|sexual\w*|gay|lesbian|bisexual|transgender)`;
const PERSONAL_DISCLOSURE = new RegExp(String.raw`\b(?:my|mine|his|her|their|our|i have|i've got|i had|i was|i am|i'm|he has|she has|they have|he is|she is|they are|who has|who is|because of)\b[^.;]{0,40}\b${HEALTH_AND_STATUS}`, 'i');

/**
 * A personal disclosure of health, disability, immigration status or sexuality
 * (the student's own or someone else's). Such clauses are not stored from
 * free text; topics of interest ("mental health research") are not affected.
 */
export function mentionsPrivateDetail(text: string): boolean {
  return PERSONAL_DISCLOSURE.test(text);
}

export function parseResponsibilities(text: string): ResponsibilitiesParse {
  const t = text.toLowerCase();
  const kinds = new Set<ResponsibilitiesParse['kinds'][number]>();
  if (/\b(take care of|taking care of|look after|looking after|caring for|care for|babysit|carer|caregiv|pick up my|siblings?|brother|sister|grand(ma|pa|mother|father|parents?))\b/.test(t)) kinds.add('caregiving');
  if (/\b(job|part[- ]time|shifts?|paid|employ|work(ing)? (at|in|for|on)|i work)\b/.test(t)) kinds.add('paid work');
  if (/\b(chores|housework|household|cook(ing)?|clean(ing)?|family business|help (at|in) (the|our) (shop|store|restaurant|farm))\b/.test(t)) kinds.add('household responsibilities');
  if (/\b(practice|training|rehearsal|club|team|lessons?)\b/.test(t)) kinds.add('activities');
  const control = controlAnswer(text);
  let has: boolean | null = null;
  if (control === 'no' || /^\s*(no|none|nothing|not really|nope)\b/.test(t)) has = kinds.size > 0 ? true : false;
  else if (kinds.size > 0 || control === 'yes') has = true;
  if (has === true && kinds.size === 0 && control !== 'yes') kinds.add('other regular commitments');
  if (PRIVATE_DETAIL.test(t) && kinds.size === 0 && has !== false) {
    kinds.add('other regular commitments');
    has = true;
  }
  const hrs = parseWeeklyHours(text);
  return { has, kinds: [...kinds], hours: hrs.kind === 'range' ? { min: hrs.min, max: hrs.max } : null, privateDetailOmitted: PRIVATE_DETAIL.test(t) };
}

// ------------------------------------------------------------------ budget extras

/** An explicit statement that cost does not limit the choice ("no limit"). Must be confirmed; never assumed from a skip. */
export function statesNoSpendingLimit(text: string): boolean {
  return /\b(no (budget|limit|spending limit|cap|maximum)|money (is not|isn'?t) an issue|cost (doesn'?t|does not) matter|(any|whatever) (price|amount|cost)|unlimited)\b/i.test(text);
}

/** Answers that are clearly not about the question (a greeting, a question back). */
export function isQuestionBack(text: string): boolean {
  return /\?\s*$/.test(text.trim()) && !/^\s*(yes|no|maybe)\b/i.test(text);
}

// ------------------------------------------------------------------ vague answers

const FILLER = new Set(['honestly', 'just', 'stuff', 'things', 'thing', 'i', 'guess', 'whatever', 'really', 'idk', 'dunno', 'like', 'um', 'uh', 'umm', 'hmm', 'anything', 'everything', 'nothing', 'not', 'much', 'sure', 'maybe', 'kind', 'of', 'sort', 'you', 'know', 'i\'m', 'im', 'so', 'yeah', 'well', 'the', 'a', 'and', 'or', 'lots', 'lot', 'some', 'various', 'random', 'depends', 'it', 'what', 'say', 'to', 'here', 'do', 'don\'t', 'dont']);

/** An answer with no content words ("honestly just stuff I guess"). It is not recorded as an interest. */
export function isVagueAnswer(text: string): boolean {
  const toks = text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every((t) => FILLER.has(t));
}
