import { absent, isAbsence, type Absence } from '../../shared/absence.js';
import { findDateInText, parseHumanDate } from '../../shared/date-parse.js';
import type { Holder, Lifecycle } from '../../shared/facts.js';
import { FIELD_CATALOG } from '../../shared/fields.js';
import { stableStringify } from '../../shared/hash.js';
import { formatMoney, money, type Budget, type Money } from '../../shared/money.js';
import { countryName, findCountryMentions, findLanguages, languageName, nonLatinLetterShare, SINGLE_ZONE_COUNTRIES } from '../../shared/places.js';
import { isValidTimezone, parsePartialDate, type PartialDate } from '../../shared/time.js';
import { UNKNOWN_PHRASES } from '../a04-record-steward/validation.js';
import * as P from './parsers.js';
import type { PlannedQuestion } from './planner.js';
import { TEMPLATE_BY_ID, type QuestionTemplate } from './question-bank.js';
import type { PendingConfirmation, Turn } from './sessions.js';

/**
 * Answer interpretation (02R05-02R07). Extracts explicit statements from one
 * student turn and keeps uncertainty visible:
 * - tentative wording stays tentative ("I might graduate in June");
 * - statements about other people stay attributed ("my parents want medicine");
 * - vague quantities are not turned into numbers ("most weekends");
 * - in voice, numbers, dates and amounts are read back, and recognizer
 *   alternatives become an explicit choice ("€150 or €1,050?");
 * - a hypothetical activity is 'considering', never 'completed';
 * - a street address is never stored, and details about other people's health
 *   are reduced to a broad note.
 *
 * Nothing here decides eligibility or infers emotions, identity, disability,
 * wealth or immigration status.
 */

export interface FactDraft {
  field: { entity: string; entityId: string; attribute: string };
  value: unknown;
  lifecycle: Lifecycle;
  holder?: Holder;
  /** The part of the answer that supports this fact. */
  quote: string;
  /** Plain-language rendering for read-backs and review. */
  display: string;
  tentative: boolean;
  /** The student explicitly confirmed this value in this exchange. */
  confirmed: boolean;
  recognitionUncertain: boolean;
  questionId: string;
  /** The earlier answer a confirmation refers to (kept as a turn reference). */
  priorTurn?: { turnId: string; quote: string; modality: 'text' | 'voice'; recognitionUncertain: boolean; quoteContainsUnknown: boolean };
}

export type PendingDraft = Omit<PendingConfirmation, 'id'>;

export type NoticeCode =
  | 'address_not_stored'
  | 'private_detail_omitted'
  | 'unsupported_language'
  | 'unrecognized_curriculum'
  | 'recognition_uncertain'
  | 'speaker_unassigned'
  | 'stress_support'
  | 'support_referral'
  | 'mode_change_offered'
  | 'generated_question_rejected'
  | 'reported_preference_recorded'
  | 'not_recorded'
  | 'correction_recorded'
  | 'locale_fallback'
  | 'record_changed_elsewhere';

export interface Notice {
  code: NoticeCode;
  message: string;
}

export type UnresolvedReason = 'unknown_to_student' | 'not_decided' | 'declined' | 'unclear_answer' | 'imprecise_answer' | 'unsupported_input' | 'skipped';

export interface Unresolved {
  field: string;
  reason: UnresolvedReason;
  evidenceRoute: string | null;
}

export interface Clarification {
  questionId: string;
  text: string;
  options: string[];
  templateId: string | null;
  field: PlannedQuestion['field'];
  /** Continues a multi-part answer (not a second follow-up). */
  continuation?: boolean;
}

export interface Interpretation {
  facts: FactDraft[];
  pending: PendingDraft[];
  clarification: Clarification | null;
  unresolved: Unresolved[];
  notices: Notice[];
  /** Question ids finished for this session (answered, skipped, declined or given up on). */
  settled: string[];
  /** Exact spans to remove from the stored transcript. */
  redactions: string[];
  /** Partial answers carried into a clarification, keyed by question id. */
  carry: Record<string, unknown>;
}

export interface InterpretContext {
  question: PlannedQuestion;
  turn: Turn;
  /** The student's local calendar date (YYYY-MM-DD). */
  today: string;
  dateConvention: 'day_first' | 'month_first' | 'unknown';
  clarificationsUsed: number;
  carry: unknown;
  actor: { kind: 'student' | 'supporter' | 'school_counselor'; id: string };
  /** Label of the student's qualification system, for year-label context. */
  knownSystemLabel: string | null;
}

export function emptyInterpretation(): Interpretation {
  return { facts: [], pending: [], clarification: null, unresolved: [], notices: [], settled: [], redactions: [], carry: {} };
}

// ------------------------------------------------------------------ parse results per answer type

interface ParsedFact {
  field: FactDraft['field'];
  value: unknown;
  lifecycle: Lifecycle;
  holder?: Holder;
  quote: string;
  display: string;
}

interface Parsed {
  facts: ParsedFact[];
  /** A choice the student must make before anything is recorded. */
  choice?: { field: FactDraft['field']; lifecycle: Lifecycle; candidates: Array<{ value: unknown; display: string }>; quote: string; reason: PendingConfirmation['reason']; question: string; holder?: Holder };
  clarify?: { text: string; carry?: unknown; options?: string[] };
  notices: Notice[];
  redactions: string[];
  /** Values here are numbers, dates or amounts that a recognizer can mishear. */
  numeric: boolean;
}

const none = (): Parsed => ({ facts: [], notices: [], redactions: [], numeric: false });

const PRIVATE_OMITTED: Notice = { code: 'private_detail_omitted', message: 'I left out part of your answer that included health or other private details. You can add it yourself later if you want it noted.' };

const studentField = (attribute: string): FactDraft['field'] => ({ entity: 'student', entityId: 'self', attribute });

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function monthName(m: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]!;
}

export function displayPartialDate(d: string): string {
  const p = parsePartialDate(d);
  if (!p) return d;
  if (p.precision === 'year') return String(p.year);
  if (p.precision === 'month') return `${monthName(p.month!)} ${p.year}`;
  return `${p.day} ${monthName(p.month!)} ${p.year}`;
}

function negatedBefore(text: string, index: number): boolean {
  return /\b(not|no longer|never|n't|no)\s+(?:\w+\s+){0,2}$/i.test(text.slice(Math.max(0, index - 24), index));
}

// ---- dates

function parseDateAnswer(text: string, today: string, convention: InterpretContext['dateConvention']): { value: PartialDate; match: string; derived: boolean } | { ambiguous: PartialDate[]; match: string; reason: string } | { needsYear: number; match: string } | null {
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  const found = findDateInText(text, convention);
  if (found.kind === 'date') return { value: found.value, match: found.match ?? text, derived: false };
  if (found.kind === 'ambiguous') return { ambiguous: found.candidates, match: found.match ?? text, reason: found.reason };
  const my = /\b(\d{1,2})[/.](\d{4})\b/.exec(text);
  if (my) {
    const r = parseHumanDate(my[0], convention);
    if (r.kind === 'date') return { value: r.value, match: my[0], derived: false };
  }
  const season = /\b(?:(?:early|late|end of|beginning of|mid|start of|summer|spring|autumn|fall|winter)\s+(?:of\s+)?)(20\d{2})\b/i.exec(text);
  if (season) return { value: season[1]!, match: season[0], derived: false };
  const years = [...new Set([...text.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]!))];
  if (years.length === 1) return { value: years[0]!, match: years[0]!, derived: false };
  if (years.length > 1) return { ambiguous: years, match: years.join(' / '), reason: 'more than one year was mentioned' };
  const month = /\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b|\bmay\b(?=\s*(?:next|this|$|[.,!?]))/i.exec(text);
  if (/\bnext year\b/i.test(text)) {
    if (month) {
      const m = monthIndex(month[0]);
      return { value: `${ty + 1}-${m < 10 ? `0${m}` : m}`, match: `${month[0]} next year`, derived: true };
    }
    return { value: String(ty + 1), match: 'next year', derived: true };
  }
  if (/\bthis year\b/i.test(text)) return { value: String(ty), match: 'this year', derived: true };
  if (month) {
    const m = monthIndex(month[0]);
    if (/\bnext\s+$/i.test(text.slice(Math.max(0, month.index - 6), month.index))) {
      const y = m > tm ? ty : ty + 1;
      return { value: `${y}-${m < 10 ? `0${m}` : m}`, match: `next ${month[0]}`, derived: true };
    }
    return { needsYear: m, match: month[0] };
  }
  return null;
}

function monthIndex(name: string): number {
  const k = name.toLowerCase().slice(0, 3);
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(k) + 1;
}

function dateLifecycle(d: PartialDate, today: string, tentative: boolean): Lifecycle {
  const b = d.length === 4 ? `${d}-12-31` : d.length === 7 ? `${d}-28` : d;
  if (b < today) return 'completed';
  return tentative ? 'considering' : 'planned';
}

// ---- per answer type

function parseEnum(t: QuestionTemplate, text: string): Parsed {
  const r = none();
  const control = P.controlAnswer(text);
  if (t.yesNo && (control === 'yes' || control === 'no')) {
    const v = control === 'yes' ? t.yesNo.yes : t.yesNo.no;
    const opt = t.options?.find((o) => o.value === v);
    if (opt) {
      r.facts.push({ field: fieldOf(t), value: opt.value, lifecycle: 'current', quote: text.trim(), display: opt.label });
      return r;
    }
    r.clarify = { text: t.clarify ?? t.text, options: (t.options ?? []).map((o) => o.label) };
    return r;
  }
  const matches = (t.options ?? []).filter((o) => {
    const m = o.synonyms.exec(text);
    if (!m) return false;
    // "I'm not in school any more" must not match "in school".
    return m.index === 0 || !negatedBefore(text, m.index) || o.value === 'none';
  });
  const exact = (t.options ?? []).filter((o) => text.toLowerCase().includes(o.label.toLowerCase()));
  const chosen = exact.length === 1 ? exact : matches;
  if (chosen.length === 1) {
    const o = chosen[0]!;
    const m = o.synonyms.exec(text);
    r.facts.push({ field: fieldOf(t), value: o.value, lifecycle: 'current', quote: m ? P.clauseAt(text, m.index) : text.trim(), display: o.label });
  } else if (chosen.length > 1) {
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: chosen.map((o) => ({ value: o.value, display: o.label })), quote: text.trim(), reason: 'ambiguous_value', question: `Which fits best: ${chosen.map((o) => o.label).join(', or ')}?` };
  } else {
    r.clarify = { text: t.clarify ?? t.text, options: (t.options ?? []).map((o) => o.label) };
  }
  return r;
}

function fieldOf(t: QuestionTemplate): FactDraft['field'] {
  const [entity, ...rest] = t.field.split('.');
  return entity === 'student' ? studentField(rest.join('.')) : { entity: entity!, entityId: 'new', attribute: rest.join('.') };
}

function parseAttributed(t: QuestionTemplate, text: string, ctx: InterpretContext, kind: 'goal' | 'interest'): Parsed {
  const r = none();
  if (P.isVagueAnswer(text)) {
    r.clarify = { text: t.clarify ?? t.text };
    return r;
  }
  const all = P.attributeClauses(text);
  const clauses = all.filter((c) => !P.mentionsPrivateDetail(c.text));
  if (clauses.length < all.length) r.notices.push(PRIVATE_OMITTED);
  const own = clauses.filter((c) => c.holder === 'student');
  const others = clauses.filter((c) => c.holder === 'reported_other');
  for (const c of others) {
    r.facts.push({ field: { entity: 'preference', entityId: 'new', attribute: 'statement' }, value: { text: c.text.slice(0, 300), topic: kind === 'goal' ? 'goal' : 'interests', normalized: [] }, lifecycle: 'current', holder: { kind: 'reported_other', label: c.holderLabel! }, quote: c.text, display: `${possessive(c.holderLabel!)} view (as you described it): “${c.text}”` });
  }
  if (others.length > 0) r.notices.push({ code: 'reported_preference_recorded', message: `I noted what you said about your ${others.map((o) => o.holderLabel).join(' and ')} as their view, separate from your own.` });
  if (ctx.actor.kind === 'supporter') {
    // A supporter's words are the supporter's statement, never the student's own interest or goal.
    for (const c of own) r.facts.push({ field: { entity: 'preference', entityId: 'new', attribute: 'statement' }, value: { text: c.text.slice(0, 300), topic: kind === 'goal' ? 'goal' : 'interests', normalized: [] }, lifecycle: 'current', holder: { kind: 'supporter', actorId: ctx.actor.id }, quote: c.text, display: `Your view: “${c.text}”` });
    return r;
  }
  const ownText = own.map((c) => c.text).join('; ').trim();
  if (ownText.length > 0 && !/^(and|also|but)$/i.test(ownText)) {
    if (kind === 'goal') r.facts.push({ field: studentField('goals.current_objective'), value: ownText.slice(0, 300), lifecycle: 'current', quote: ownText, display: `What you want help with: “${ownText.slice(0, 120)}”` });
    else {
      for (const c of own) {
        const tentative = P.isTentative(c.text);
        r.facts.push({ field: { entity: 'interest', entityId: 'new', attribute: 'description' }, value: { text: c.text.slice(0, 300), lens: 'interest' }, lifecycle: tentative ? 'considering' : 'current', quote: c.text, display: `Interest: “${c.text.slice(0, 120)}”${tentative ? ' (tentative)' : ''}` });
      }
    }
  } else if (others.length > 0) {
    const who = others.map((o) => o.holderLabel).join(' and ');
    r.clarify = { text: kind === 'goal' ? `Thanks, I have noted that as your ${who}'s view. What would you like help with yourself? "Not sure yet" is fine.` : `Thanks, I have noted that as your ${who}'s view. What interests you yourself? "Not sure yet" is fine.` };
  } else r.clarify = { text: t.clarify ?? t.text };
  return r;
}

function possessive(label: string): string {
  const cap = `Your ${label}`;
  return label.endsWith('s') ? `${cap}'` : `${cap}'s`;
}

function parseCountry(t: QuestionTemplate, text: string): Parsed {
  const r = none();
  const shortAnswer = words(text) <= 3;
  let mentions = findCountryMentions(text, { demonyms: shortAnswer });
  if (mentions.length === 0) {
    const city = P.findCity(text);
    if (city) {
      r.facts.push({ field: fieldOf(t), value: city.country, lifecycle: 'current', quote: text.trim(), display: countryName(city.country) });
      return r;
    }
    r.clarify = { text: t.clarify ?? t.text };
    return r;
  }
  const codes = [...new Set(mentions.map((m) => m.code))];
  if (codes.length > 1) {
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: codes.map((c) => ({ value: c, display: countryName(c) })), quote: text.trim(), reason: 'ambiguous_value', question: `Which country: ${codes.map(countryName).join(' or ')}?` };
    return r;
  }
  mentions = mentions.filter((m) => m.code === codes[0]);
  const m = mentions[0]!;
  if (m.needsConfirmation) {
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: [{ value: m.code, display: countryName(m.code) }], quote: P.clauseAt(text, m.index), reason: 'ambiguous_value', question: `Just to check: do you mean the country ${countryName(m.code)}?` };
    return r;
  }
  r.facts.push({ field: fieldOf(t), value: m.code, lifecycle: 'current', quote: P.clauseAt(text, m.index), display: countryName(m.code) });
  return r;
}

function parseCountries(t: QuestionTemplate, text: string): Parsed {
  const r = none();
  const mentions = findCountryMentions(text, { demonyms: true });
  const codes = [...new Set(mentions.map((m) => m.code))];
  if (codes.length === 0) {
    r.clarify = { text: t.clarify ?? t.text };
    return r;
  }
  const display = codes.map(countryName).join(', ');
  const tentative = P.isTentative(text);
  if (mentions.some((m) => m.needsConfirmation)) {
    r.choice = { field: fieldOf(t), lifecycle: tentative ? 'considering' : 'current', candidates: [{ value: codes, display }], quote: text.trim(), reason: 'ambiguous_value', question: `Just to check: ${display}?` };
    return r;
  }
  r.facts.push({ field: fieldOf(t), value: codes, lifecycle: tentative ? 'considering' : 'current', quote: text.trim(), display });
  return r;
}

function parseQualification(t: QuestionTemplate, text: string): Parsed {
  const r = none();
  const q = P.findQualificationSystem(text);
  if (q) {
    r.facts.push({ field: fieldOf(t), value: q, lifecycle: 'current', quote: text.trim(), display: q.label });
    return r;
  }
  const label = text.trim().replace(/^(it'?s|it is|we do|we have|i do|i'?m doing|i am doing|called|the)\s+/i, '').replace(/[.!]+$/, '').trim();
  // Only a short name is offered as an unfamiliar qualification; a sentence is not a curriculum name.
  const looksLikeName = label.length >= 2 && words(label) <= 5 && !/\b(i|i'm|im|my|we|and|but|might|maybe|want|apply|think|year|grade)\b/i.test(label) && !/[?]/.test(label);
  if (looksLikeName) {
    // 02T15: an unfamiliar curriculum is recorded in the student's words, never mapped to a known one.
    r.notices.push({ code: 'unrecognized_curriculum', message: `I don't have detailed information about “${label}” yet. I can note it exactly as you wrote it; requirement checks for it will say they need confirmation from an official source or a counselor.` });
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: [{ value: { id: 'UNRECOGNIZED', label: label.slice(0, 80) }, display: label.slice(0, 80) }], quote: text.trim(), reason: 'ambiguous_value', question: `Should I note “${label.slice(0, 80)}” as your qualification, exactly as written?` };
    return r;
  }
  r.clarify = { text: t.clarify ?? t.text };
  return r;
}

function parseYearLabel(t: QuestionTemplate, text: string, ctx: InterpretContext): Parsed {
  const r = none();
  const label = P.findYearLabel(text) ?? (words(text) <= 4 && !/\d{4}/.test(text) && P.controlAnswer(text) === null ? text.trim().replace(/[.!]+$/, '') : null);
  if (!label) {
    r.clarify = { text: t.clarify ?? t.text };
    return r;
  }
  // 02T04: kept in the school's own terms; never converted to another system's grade.
  r.facts.push({ field: fieldOf(t), value: { label: label.slice(0, 40), systemContext: ctx.knownSystemLabel }, lifecycle: 'current', quote: label, display: `Current year: ${label} (as your school calls it)` });
  return r;
}

function parseLanguageYears(t: QuestionTemplate, text: string, carry: unknown): Parsed {
  const r = none();
  r.numeric = true;
  const langs = findLanguages(text);
  const carried = carry && typeof carry === 'object' && 'language' in (carry as Record<string, unknown>) ? String((carry as Record<string, unknown>)['language']) : null;
  const years = yearsOfInstruction(text);
  if (langs.length > 1 && !carried) {
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: langs.map((l) => ({ value: { language: l.code, yearsOfInstruction: years }, display: `${l.name}${years !== null ? `, for ${years} years` : ''}` })), quote: text.trim(), reason: 'ambiguous_value', question: `Which language are most of your classes taught in: ${langs.map((l) => l.name).join(' or ')}?` };
    return r;
  }
  const language = langs[0]?.code ?? carried;
  if (!language) {
    r.clarify = { text: t.text };
    return r;
  }
  if (years === null) {
    if (!carried) {
      r.clarify = { text: t.clarify ?? t.text, carry: { language } };
      return r;
    }
  }
  const name = languageName(language);
  r.facts.push({ field: fieldOf(t), value: { language, yearsOfInstruction: years }, lifecycle: 'current', quote: text.trim(), display: years === null ? `Language of instruction: ${name} (number of years not known)` : `Language of instruction: ${name}, for ${years} year${years === 1 ? '' : 's'}` });
  return r;
}

function yearsOfInstruction(text: string): number | null {
  const t = text.toLowerCase();
  for (const n of P.findNumbers(t)) {
    const after = t.slice(n.index + n.text.length, n.index + n.text.length + 10);
    if (/^\s*(\+\s*)?(years?|yrs?)\b/.test(after) && n.value >= 0 && n.value <= 20) return n.value;
  }
  return null;
}

/**
 * A choice candidate that still needs one more detail before it can be
 * recorded (e.g. an amount chosen from "€150 or €1,050" when the answer did not
 * say whether travel is included). Accepting it continues the clarification.
 */
export interface PartialCandidate {
  partial: true;
  carry: unknown;
  clarify: string;
  order: number;
}

export function isPartialCandidate(v: unknown): v is PartialCandidate {
  return !!v && typeof v === 'object' && (v as Record<string, unknown>)['partial'] === true && 'clarify' in (v as Record<string, unknown>);
}

const SCOPE_QUESTION = 'Does that amount need to include travel, or is it only for the program fee?';

function parseBudgetAnswer(t: QuestionTemplate, text: string, ctx: InterpretContext): Parsed {
  const r = none();
  r.numeric = true;
  if (P.statesNoSpendingLimit(text)) {
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: [{ value: absent('not_applicable', 'The student said there is no spending limit.'), display: 'no spending limit' }], quote: text.trim(), reason: 'no_spending_limit', question: 'Just to check: should I show options regardless of cost? Costs will still be listed.' };
    return r;
  }
  const carried = ctx.carry && typeof ctx.carry === 'object' ? ((ctx.carry as { budgetText?: string }).budgetText ?? null) : null;
  const combined = carried ? `${carried} ${text}` : text;
  const b = P.parseBudget(combined);
  const shape = P.budgetShape(combined);
  // In voice, amounts heard in recognizer alternatives are candidates too ("one hundred and fifty" vs "one thousand fifty").
  const altAmounts = alternativeTexts(ctx.turn).flatMap((a) => P.findMoney(a).map((m) => m.amount));
  const amounts = [...new Set([...(b.conflictingAmounts.length > 0 ? b.conflictingAmounts : b.budget ? [Number(b.budget.amount.amount)] : []), ...altAmounts])].sort((x, y) => x - y);
  const currency = P.findMoney(combined)[0]?.currency ?? null;
  if (amounts.length > 1) {
    if (!currency) {
      r.clarify = { text: 'Which amount did you mean, and in which currency?', carry: { budgetText: carried ?? '' } };
      return r;
    }
    r.choice = {
      field: fieldOf(t),
      lifecycle: 'current',
      candidates: amounts.map((a) => {
        const shown = formatMoney(money(a, currency));
        if (shape.covers === null) {
          const partial: PartialCandidate = { partial: true, carry: { budgetText: `${a} ${currency} ${shape.kind === 'preference' ? 'ideally' : 'up to'}` }, clarify: SCOPE_QUESTION, order: a };
          return { value: partial, display: shown };
        }
        const budget: Budget = { amount: money(a, currency), kind: shape.kind, covers: shape.covers, appliesTo: 'per_opportunity' };
        return { value: budget, display: shown };
      }),
      quote: combined.trim(),
      reason: altAmounts.length > 0 ? 'recognition_uncertain' : 'ambiguous_value',
      question: `Did you mean ${amounts.map((a) => formatMoney(money(a, currency))).join(' or ')}?`,
    };
    if (altAmounts.length > 0) r.notices.push({ code: 'recognition_uncertain', message: 'The speech recognizer was unsure about the amount, so I am checking it before using it.' });
    return r;
  }
  if (b.missing.includes('amount')) {
    r.clarify = { text: t.clarify ?? t.text, carry: { budgetText: combined } };
    return r;
  }
  if (b.missing.includes('currency')) {
    r.clarify = { text: 'Which currency is that in?', carry: { budgetText: combined } };
    return r;
  }
  if (b.missing.includes('scope')) {
    r.clarify = { text: SCOPE_QUESTION, carry: { budgetText: combined }, options: ['Including travel', 'Program fee only'] };
    return r;
  }
  const budget = b.budget!;
  r.facts.push({ field: fieldOf(t), value: budget, lifecycle: 'current', quote: combined.trim(), display: budgetDisplay(budget) });
  return r;
}

export function budgetDisplay(b: Budget): string {
  const scope = b.covers === 'all' ? 'including travel and other costs' : `for ${b.covers.map((c) => c.replace(/_/g, ' ')).join(', ')} only`;
  return `${b.kind === 'hard_cap' ? 'up to' : 'ideally about'} ${formatMoney(b.amount)} per opportunity, ${scope}${b.kind === 'hard_cap' ? ' (a firm limit)' : ' (a preference, not a firm limit)'}`;
}

function parseHours(t: QuestionTemplate, text: string, ctx: InterpretContext): Parsed {
  const r = none();
  r.numeric = true;
  const h = P.parseWeeklyHours(text);
  if (h.kind === 'range') {
    const display = h.min === h.max ? `about ${h.min} hour${h.min === 1 ? '' : 's'} a week` : `about ${h.min} to ${h.max} hours a week`;
    r.facts.push({ field: fieldOf(t), value: { min: h.min, max: h.max }, lifecycle: 'current', quote: text.trim(), display });
  } else if (h.kind === 'per_day_ambiguous') {
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: h.candidates.map((c) => ({ value: { min: c.min, max: c.max }, display: c.label })), quote: text.trim(), reason: 'ambiguous_value', question: `Is that on weekdays only (${h.candidates[0]!.min} hours a week) or every day (${h.candidates[1]!.min} hours a week)?` };
  } else if (h.kind === 'vague' && ctx.clarificationsUsed === 0) {
    // "Most weekends" or "a few hours" is not an exact number (02R05).
    r.clarify = { text: t.clarify ?? t.text };
  } else if (h.kind === 'vague') {
    r.facts = [];
  } else r.clarify = { text: t.clarify ?? t.text };
  return r;
}

function parseTimezone(t: QuestionTemplate, text: string): Parsed {
  const r = none();
  const iana = /\b([A-Z][a-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/.exec(text);
  if (iana && isValidTimezone(iana[1]!)) {
    r.facts.push({ field: fieldOf(t), value: iana[1]!, lifecycle: 'current', quote: iana[1]!, display: iana[1]! });
    return r;
  }
  const city = P.findCity(text);
  if (city) {
    r.facts.push({ field: fieldOf(t), value: city.zone, lifecycle: 'current', quote: text.trim(), display: `${city.zone} (from ${city.city})` });
    return r;
  }
  const codes = [...new Set(findCountryMentions(text, { demonyms: false }).map((m) => m.code))];
  if (codes.length === 1 && SINGLE_ZONE_COUNTRIES[codes[0]!]) {
    const zone = SINGLE_ZONE_COUNTRIES[codes[0]!]!;
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: [{ value: zone, display: `${zone} (${countryName(codes[0]!)})` }], quote: text.trim(), reason: 'derived_value', question: `So your time zone is ${zone}, the one used across ${countryName(codes[0]!)}. Is that right?` };
    return r;
  }
  r.clarify = { text: codes.length === 1 ? `${countryName(codes[0]!)} has more than one time zone. Which city are you in?` : t.clarify ?? t.text };
  return r;
}

const ADDRESS_SPANS = [/\b\d{1,5}\s+[A-Za-z][A-Za-z.\s]{2,30}\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|lane|ln\.?|boulevard|blvd\.?|odos|drive|dr\.?)\b/gi, /\b\d{5}(?:-\d{4})?\b/g, /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g, /\b(?:odos|οδός)\s+[\p{L}]+\s*\d{1,4}\b/giu];

function addressSpans(text: string): string[] {
  const spans = new Set<string>();
  for (const re of ADDRESS_SPANS) for (const m of text.matchAll(re)) spans.add(m[0]);
  return [...spans];
}

function removeSpans(text: string, spans: readonly string[]): string {
  return spans.reduce((acc, s) => acc.split(s).join(' '), text).replace(/\s*,\s*,/g, ',').replace(/\s+/g, ' ').trim();
}

function parseLocation(t: QuestionTemplate, text: string, carry: unknown): Parsed {
  const r = none();
  let working = text;
  if (P.looksLikeStreetAddress(text)) {
    const spans = addressSpans(text);
    r.redactions.push(...spans);
    working = removeSpans(text, spans);
    r.notices.push({ code: 'address_not_stored', message: 'A city or region is enough, so I did not keep the street address or postcode.' });
  }
  const carriedCity = carry && typeof carry === 'object' ? ((carry as { city?: string }).city ?? null) : null;
  const city = P.findCity(working);
  if (city) {
    r.facts.push({ field: fieldOf(t), value: { country: city.country, region: city.region, city: city.city }, lifecycle: 'current', quote: working, display: `${city.city}, ${countryName(city.country)}` });
    return r;
  }
  const codes = [...new Set(findCountryMentions(working, { demonyms: false }).map((m) => m.code))];
  if (codes.length === 1) {
    r.facts.push({ field: fieldOf(t), value: { country: codes[0]!, region: null, city: carriedCity }, lifecycle: 'current', quote: working, display: carriedCity ? `${carriedCity}, ${countryName(codes[0]!)}` : countryName(codes[0]!) });
    return r;
  }
  const candidate = working.replace(/^(i live in|i'?m in|in|near|close to|based in)\s+/i, '').replace(/[.!]+$/, '').trim();
  if (!carriedCity && candidate.length >= 2 && words(candidate) <= 3 && /^\p{Lu}/u.test(candidate) && P.controlAnswer(candidate) === null) {
    r.clarify = { text: `Which country is ${candidate} in?`, carry: { city: candidate.slice(0, 60) } };
    return r;
  }
  r.clarify = { text: t.clarify ?? t.text };
  return r;
}

function parseTravelAnswer(t: QuestionTemplate, text: string): Parsed {
  const r = none();
  const tr = P.parseTravel(text);
  if (!tr || (tr.overnightTravelPossible === null && tr.maxTravelMinutes === null && tr.travelDuringTermPossible === null)) {
    r.clarify = { text: t.clarify ?? t.text };
    return r;
  }
  const value = { overnightTravelPossible: tr.overnightTravelPossible, maxTravelMinutes: tr.maxTravelMinutes, travelDuringTermPossible: tr.travelDuringTermPossible };
  r.facts.push({ field: fieldOf(t), value, lifecycle: 'current', quote: text.trim(), display: travelDisplay(value) });
  if (tr.remotePreference) r.facts.push({ field: studentField('constraints.remote_preference'), value: tr.remotePreference, lifecycle: 'current', quote: text.trim(), display: 'Online only' });
  return r;
}

export function travelDisplay(v: { overnightTravelPossible: boolean | null; maxTravelMinutes: number | null; travelDuringTermPossible: boolean | null }): string {
  const parts: string[] = [];
  if (v.overnightTravelPossible === true) parts.push('you CAN travel and stay away overnight');
  if (v.overnightTravelPossible === false) parts.push('you can NOT stay away overnight');
  if (v.maxTravelMinutes !== null) parts.push(`travel of up to ${v.maxTravelMinutes} minutes`);
  if (v.travelDuringTermPossible === false) parts.push('NOT during term time');
  if (v.travelDuringTermPossible === true) parts.push('travel during term time is possible');
  return parts.length > 0 ? `Travel: ${parts.join('; ')}` : 'Travel: not stated';
}

function parseWindows(t: QuestionTemplate, text: string, ctx: InterpretContext): Parsed {
  const r = none();
  r.numeric = true;
  const w = P.parseDateWindows(text, ctx.today);
  if (w.windows.length === 0 || w.issues.length > 0) {
    r.clarify = { text: w.issues.includes('end_before_start') ? 'The end date seems to be before the start date. Could you give the dates again?' : t.clarify ?? t.text };
    return r;
  }
  const display = w.windows.map((x) => (x.start === x.end ? displayPartialDate(x.start) : `${displayPartialDate(x.start)} to ${displayPartialDate(x.end)}`)).join('; ');
  if (w.yearInferred) {
    r.choice = { field: fieldOf(t), lifecycle: 'current', candidates: [{ value: w.windows, display }], quote: text.trim(), reason: 'derived_value', question: `So that is ${display}. Is that right?` };
    return r;
  }
  r.facts.push({ field: fieldOf(t), value: w.windows, lifecycle: 'current', quote: text.trim(), display: `Available: ${display}` });
  return r;
}

function parseResponsibilitiesAnswer(t: QuestionTemplate, text: string, ctx: InterpretContext): Parsed {
  const r = none();
  const p = P.parseResponsibilities(text);
  if (p.has === null) {
    if (ctx.clarificationsUsed === 0) r.clarify = { text: 'Is that a yes? A broad answer such as "caregiving" or "a part-time job" is enough.', options: ['Yes', 'No'] };
    return r;
  }
  const value = { hasRegularResponsibilities: p.has, broadDescription: p.has && p.kinds.length > 0 ? p.kinds.join(', ') : null, hoursPerWeek: p.has ? p.hours : null };
  // Only the broad kind is kept; the student's own words about family members are not stored.
  const quote = p.has ? (p.kinds.length > 0 ? `regular responsibilities: ${p.kinds.join(', ')}` : 'yes') : 'no';
  r.facts.push({ field: fieldOf(t), value, lifecycle: 'current', quote, display: p.has ? `You have regular responsibilities to plan around${value.broadDescription ? ` (${value.broadDescription})` : ''}${p.hours ? `, about ${p.hours.min === p.hours.max ? p.hours.min : `${p.hours.min}-${p.hours.max}`} hours a week` : ''}` : 'You have no regular responsibilities to plan around' });
  if (p.privateDetailOmitted) r.notices.push({ code: 'private_detail_omitted', message: 'I kept only a broad note about your responsibilities, not details about other people.' });
  return r;
}

function parseActivities(t: QuestionTemplate, text: string, ctx: InterpretContext): Parsed {
  const r = none();
  if (/^\s*(no|none|nothing|not really|nope)\b[.!]?\s*$/i.test(text)) return r;
  if (P.isVagueAnswer(text)) {
    if (ctx.clarificationsUsed === 0) r.clarify = { text: t.clarify ?? t.text };
    return r;
  }
  if (P.mentionsPrivateDetail(text)) r.notices.push(PRIVATE_OMITTED);
  const reported = P.attributeClauses(text).filter((c) => c.holder === 'reported_other' && !P.mentionsPrivateDetail(c.text));
  for (const c of reported) r.facts.push({ field: { entity: 'preference', entityId: 'new', attribute: 'statement' }, value: { text: c.text.slice(0, 300), topic: 'activities', normalized: [] }, lifecycle: 'current', holder: { kind: 'reported_other', label: c.holderLabel! }, quote: c.text, display: `${possessive(c.holderLabel!)} view (as you described it): “${c.text}”` });
  const reportedTexts = new Set(reported.map((c) => c.text));
  const clauses = P.splitClauses(text).filter((c) => !P.mentionsPrivateDetail(c.text) && ![...reportedTexts].some((rt) => rt.includes(c.text) || c.text.includes(rt)));
  const unclear: string[] = [];
  for (const c of clauses) {
    if (words(c.text) < 2) continue;
    const timing = P.activityTiming(c.text);
    if (!timing) {
      unclear.push(c.text);
      continue;
    }
    const title = P.activityTitle(c.text);
    const lifecycleWord = timing === 'considering' ? 'being considered' : timing === 'planned' ? 'planned' : timing === 'in_progress' ? 'current' : 'done';
    r.facts.push({
      field: { entity: 'experience', entityId: 'new', attribute: 'identity' },
      value: { titleStudentSupplied: title, organization: null, organizationKind: 'unknown', category: P.activityCategory(c.text) },
      lifecycle: timing,
      quote: c.text,
      display: `Activity: “${title}” (${lifecycleWord})`,
    });
  }
  if (r.facts.length === 0 && unclear.length > 0 && ctx.clarificationsUsed === 0) r.clarify = { text: t.clarify ?? t.text };
  return r;
}

function parseYear(t: QuestionTemplate, text: string, ctx: InterpretContext): Parsed {
  const r = none();
  r.numeric = true;
  const ty = Number(ctx.today.slice(0, 4));
  const years = [...new Set([...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1])))].filter((y) => y >= ty - 1 && y <= ty + 12);
  if (years.length === 0 && /\bnext year\b/i.test(text)) {
    r.choice = { field: fieldOf(t), lifecycle: 'planned', candidates: [{ value: String(ty + 1), display: String(ty + 1) }], quote: 'next year', reason: 'derived_value', question: `So that would be ${ty + 1}. Is that right?` };
    return r;
  }
  if (years.length === 0 && /\bthis year\b/i.test(text)) years.push(ty);
  if (years.length > 1) {
    r.choice = { field: fieldOf(t), lifecycle: 'planned', candidates: years.map((y) => ({ value: String(y), display: String(y) })), quote: text.trim(), reason: 'ambiguous_value', question: `Which year should I use for planning: ${years.join(' or ')}?` };
    return r;
  }
  if (years.length === 0) {
    r.clarify = { text: t.clarify ?? t.text };
    return r;
  }
  const y = years[0]!;
  if (y < ty) {
    r.clarify = { text: `${y} has already passed. Which year would you like to start?` };
    return r;
  }
  r.facts.push({ field: fieldOf(t), value: String(y), lifecycle: P.isTentative(text) ? 'considering' : 'planned', quote: text.trim(), display: String(y) });
  return r;
}

function parsePartialDateAnswer(t: QuestionTemplate, text: string, ctx: InterpretContext): Parsed {
  const r = none();
  r.numeric = true;
  const tentative = P.isTentative(text);
  const d = parseDateAnswer(text, ctx.today, ctx.dateConvention);
  if (!d) {
    r.clarify = { text: t.clarify ?? t.text };
    return r;
  }
  if ('needsYear' in d) {
    const ty = Number(ctx.today.slice(0, 4));
    const tm = Number(ctx.today.slice(5, 7));
    const first = d.needsYear >= tm ? ty : ty + 1;
    const cands = [first, first + 1].map((y) => `${y}-${d.needsYear < 10 ? `0${d.needsYear}` : d.needsYear}`);
    r.choice = { field: fieldOf(t), lifecycle: tentative ? 'considering' : 'planned', candidates: cands.map((c) => ({ value: c, display: displayPartialDate(c) })), quote: P.clauseAt(text, text.toLowerCase().indexOf(d.match.toLowerCase())), reason: 'ambiguous_value', question: `${monthName(d.needsYear)} of which year: ${cands.map(displayPartialDate).join(' or ')}?` };
    return r;
  }
  if ('ambiguous' in d) {
    r.choice = { field: fieldOf(t), lifecycle: tentative ? 'considering' : 'planned', candidates: d.ambiguous.map((c) => ({ value: c, display: displayPartialDate(c) })), quote: d.match, reason: 'ambiguous_value', question: `Just to be sure I have the right date: ${d.ambiguous.map(displayPartialDate).join(' or ')}?` };
    return r;
  }
  const lifecycle = dateLifecycle(d.value, ctx.today, tentative);
  const quote = P.clauseAt(text, Math.max(0, text.toLowerCase().indexOf(d.match.toLowerCase())));
  if (d.derived) {
    r.choice = { field: fieldOf(t), lifecycle, candidates: [{ value: d.value, display: displayPartialDate(d.value) }], quote, reason: 'derived_value', question: `So that would be ${displayPartialDate(d.value)}. Is that right?` };
    return r;
  }
  r.facts.push({ field: fieldOf(t), value: d.value, lifecycle, quote, display: `${displayPartialDate(d.value)}${lifecycle === 'considering' ? ' (tentative)' : lifecycle === 'completed' ? ' (already finished)' : ''}` });
  return r;
}

// ---- targeted (handoff) questions without a template

const LEVELS: ReadonlyArray<{ re: RegExp; original: string | null; normalized: 'IB_HL' | 'IB_SL' | 'AP' | 'honors' | 'A_LEVEL' | 'AS_LEVEL' | 'standard' }> = [
  { re: /\b(hl|higher level|higher)\b/i, original: 'HL', normalized: 'IB_HL' },
  { re: /\b(sl|standard level)\b/i, original: 'SL', normalized: 'IB_SL' },
  { re: /\b(ap|advanced placement)\b/i, original: 'AP', normalized: 'AP' },
  { re: /\bhonou?rs\b/i, original: 'Honors', normalized: 'honors' },
  { re: /\bas[- ]level\b|\bas\b(?=\s+(level|only))/i, original: 'AS level', normalized: 'AS_LEVEL' },
  { re: /\ba[- ]level\b/i, original: 'A level', normalized: 'A_LEVEL' },
  { re: /\b(no level|no track|standard|regular|normal)\b/i, original: null, normalized: 'standard' },
];

function parseTargeted(q: PlannedQuestion, text: string): Parsed {
  const r = none();
  if (q.field.attribute === 'level') {
    const hits = LEVELS.filter((l) => l.re.test(text));
    if (hits.length === 1) {
      const h = hits[0]!;
      r.facts.push({ field: { ...q.field }, value: { original: h.original, normalized: h.normalized }, lifecycle: 'current', quote: text.trim(), display: `Course level: ${h.original ?? 'no level shown'}` });
    } else if (hits.length > 1) {
      r.choice = { field: { ...q.field }, lifecycle: 'current', candidates: hits.map((h) => ({ value: { original: h.original, normalized: h.normalized }, display: h.original ?? 'no level shown' })), quote: text.trim(), reason: 'ambiguous_value', question: `Which level: ${hits.map((h) => h.original ?? 'no level').join(' or ')}?` };
    }
    return r;
  }
  if (q.field.attribute === 'enrollment_status') {
    const map: Array<[RegExp, string]> = [
      [/\b(plan(ning)? to|will take|next year|going to take)\b/i, 'planned'],
      [/\b(taking it now|currently|this year|in progress|doing it now)\b/i, 'in_progress'],
      [/\b(finished|completed|done|took it)\b/i, 'completed'],
      [/\b(dropped|withdrew|withdrawn|stopped)\b/i, 'withdrawn'],
    ];
    const hit = map.filter(([re]) => re.test(text));
    if (hit.length === 1) r.facts.push({ field: { ...q.field }, value: hit[0]![1], lifecycle: 'current', quote: text.trim(), display: `Course status: ${hit[0]![1].replace('_', ' ')}` });
  }
  return r;
}

// ------------------------------------------------------------------ main entry points

function parseForQuestion(q: PlannedQuestion, text: string, ctx: InterpretContext): Parsed {
  const t = q.templateId ? TEMPLATE_BY_ID.get(q.templateId) : undefined;
  if (!t) return parseTargeted(q, text);
  switch (t.answerType) {
    case 'free_text':
      return parseAttributed(t, text, ctx, 'goal');
    case 'interest':
      return parseAttributed(t, text, ctx, 'interest');
    case 'enum':
      return parseEnum(t, text);
    case 'partial_date':
      return parsePartialDateAnswer(t, text, ctx);
    case 'year':
      return parseYear(t, text, ctx);
    case 'year_label':
      return parseYearLabel(t, text, ctx);
    case 'country':
      return parseCountry(t, text);
    case 'countries':
      return parseCountries(t, text);
    case 'qualification_system':
      return parseQualification(t, text);
    case 'language_years':
      return parseLanguageYears(t, text, ctx.carry);
    case 'money_budget':
      return parseBudgetAnswer(t, text, ctx);
    case 'hours_range':
      return parseHours(t, text, ctx);
    case 'timezone':
      return parseTimezone(t, text);
    case 'location':
      return parseLocation(t, text, ctx.carry);
    case 'travel':
      return parseTravelAnswer(t, text);
    case 'date_window':
      return parseWindows(t, text, ctx);
    case 'responsibilities':
      return parseResponsibilitiesAnswer(t, text, ctx);
    case 'activities':
      return parseActivities(t, text, ctx);
  }
}

/** Full texts obtained by substituting each recognizer alternative into the turn (voice only). */
export function alternativeTexts(turn: Turn): string[] {
  if (turn.modality !== 'voice') return [];
  const out = new Set<string>();
  for (const seg of turn.segments) {
    for (const alt of seg.alternatives) {
      if (!seg.text || alt === seg.text) continue;
      const i = turn.text.indexOf(seg.text);
      if (i < 0) continue;
      out.add(turn.text.slice(0, i) + alt + turn.text.slice(i + seg.text.length));
    }
  }
  return [...out].slice(0, 4);
}

function recognitionUncertain(turn: Turn): boolean {
  return turn.modality === 'voice' && turn.segments.some((s) => s.alternatives.length > 0 || (s.confidence !== undefined && s.confidence < 0.8));
}

function numericOrder(v: unknown): number | null {
  if (isPartialCandidate(v)) return v.order;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o['amount'] && typeof o['amount'] === 'object') return Number((o['amount'] as Money).amount);
    if (typeof o['amount'] === 'string') return Number(o['amount']);
    if (typeof o['min'] === 'number') return o['min'] as number;
    if (typeof o['yearsOfInstruction'] === 'number') return o['yearsOfInstruction'] as number;
  }
  if (typeof v === 'string' && /^\d{4}/.test(v)) return Number(v.replace(/-/g, ''));
  return null;
}

function controlQuestionFor(q: PlannedQuestion): QuestionTemplate | undefined {
  return q.templateId ? TEMPLATE_BY_ID.get(q.templateId) : undefined;
}

/**
 * Interpret one answer to one question. The caller combines the results for a
 * group of questions asked together in text mode.
 */
export function interpretAnswer(ctx: InterpretContext): Interpretation {
  const out = emptyInterpretation();
  const q = ctx.question;
  const t = controlQuestionFor(q);
  const text = ctx.turn.text.trim();
  const catalogField = `${q.field.entity}.${q.field.attribute}`;
  // Questions without a template target a specific record item (a course level, a course status).
  const route = t?.evidenceRoute ?? (!t && q.field.entity !== 'student' ? 'Your school transcript or counselor can confirm this; you can upload the transcript and I will read it.' : null);
  const consequential = t?.consequential ?? FIELD_CATALOG.get(catalogField)?.consequential ?? false;

  if (text.length === 0) {
    out.clarification = clarificationFor(q, t?.text ?? q.text);
    return out;
  }
  if (nonLatinLetterShare(text) > 0.5) {
    // 02T15: do not guess at answers the parsers cannot read.
    out.notices.push({ code: 'unsupported_language', message: 'I can only reliably read answers in English right now, so I have not recorded anything from that answer. You can choose one of the options, answer in English, or ask a counselor to help.' });
    out.unresolved.push({ field: catalogField, reason: 'unsupported_input', evidenceRoute: route });
    if (ctx.clarificationsUsed === 0) out.clarification = clarificationFor(q, q.text);
    else out.settled.push(q.questionId);
    return out;
  }

  const control = P.controlAnswer(text);
  if (control === 'skip') {
    out.settled.push(q.questionId);
    out.unresolved.push({ field: catalogField, reason: 'skipped', evidenceRoute: null });
    return out;
  }
  // Collection items ("a new interest") are not created just to hold an absence.
  const canHoldAbsence = q.field.entityId !== 'new';
  if (control === 'declined') {
    out.settled.push(q.questionId);
    if (canHoldAbsence) out.facts.push(absenceFact(q, absent('declined'), text, ctx));
    out.unresolved.push({ field: catalogField, reason: 'declined', evidenceRoute: route });
    return out;
  }
  if (control === 'not_decided' && (t?.allowNotDecided ?? false)) {
    out.settled.push(q.questionId);
    if (canHoldAbsence) out.facts.push(absenceFact(q, absent('not_decided'), text, ctx));
    out.unresolved.push({ field: catalogField, reason: 'not_decided', evidenceRoute: null });
    return out;
  }
  if (control === 'dont_know' || control === 'not_decided') {
    const helpful = t?.clarify ?? (!t && q.field.entity !== 'student' ? targetedClarify(q) : undefined);
    if (consequential && ctx.clarificationsUsed === 0 && helpful) {
      // One targeted follow-up that may help the student find the answer (02R07).
      out.clarification = clarificationFor(q, helpful);
      return out;
    }
    out.settled.push(q.questionId);
    if (canHoldAbsence) out.facts.push(absenceFact(q, absent('unknown_to_student', route ?? undefined), text, ctx));
    out.unresolved.push({ field: catalogField, reason: 'unknown_to_student', evidenceRoute: route });
    return out;
  }

  const parsed = parseForQuestion(q, text, ctx);
  out.notices.push(...parsed.notices);
  out.redactions.push(...parsed.redactions);
  const uncertain = recognitionUncertain(ctx.turn);
  const voice = ctx.turn.modality === 'voice';

  // Recognizer alternatives that change the value become an explicit choice (02R06).
  if (voice && parsed.facts.length > 0 && !parsed.choice) {
    const alts = alternativeTexts(ctx.turn).map((a) => parseForQuestion(q, a, { ...ctx, turn: { ...ctx.turn, text: a } }));
    const primary = parsed.facts[0]!;
    const candidates = new Map<string, { value: unknown; display: string }>([[stableStringify(primary.value), { value: primary.value, display: primary.display }]]);
    for (const a of alts) {
      const f = a.facts.find((x) => x.field.attribute === primary.field.attribute);
      if (f) candidates.set(stableStringify(f.value), { value: f.value, display: f.display });
    }
    if (candidates.size > 1) {
      const list = [...candidates.values()].sort((a, b) => (numericOrder(a.value) ?? 0) - (numericOrder(b.value) ?? 0));
      parsed.choice = { field: primary.field, lifecycle: primary.lifecycle, candidates: list, quote: primary.quote, reason: 'recognition_uncertain', question: `Did you mean ${list.map((c) => c.display).join(' or ')}?` };
      parsed.facts = parsed.facts.filter((f) => f !== primary);
      out.notices.push({ code: 'recognition_uncertain', message: 'The speech recognizer was unsure, so I am checking the exact value before using it.' });
    } else if (parsed.numeric && consequential) {
      // In voice, "fifteen" and "fifty" must not silently become a number: read it back.
      parsed.choice = { field: primary.field, lifecycle: primary.lifecycle, candidates: [{ value: primary.value, display: primary.display }], quote: primary.quote, reason: 'voice_readback', question: `I heard ${stripLabel(primary.display)}. Is that right?` };
      parsed.facts = parsed.facts.filter((f) => f !== primary);
    }
  }

  // A value given together with "not sure" is only recorded once the student confirms it as tentative.
  for (const f of [...parsed.facts]) {
    if (!isAbsence(f.value) && UNKNOWN_PHRASES.test(f.quote) && !parsed.choice) {
      parsed.facts = parsed.facts.filter((x) => x !== f);
      parsed.choice = { field: f.field, lifecycle: f.lifecycle === 'planned' ? 'considering' : f.lifecycle, candidates: [{ value: f.value, display: f.display }], quote: f.quote, reason: 'tentative', question: `You mentioned you're not sure. Should I note ${stripLabel(f.display)} for now? You can change it at any time.` };
    }
  }

  // A second voice in the room: a speaker label is not proof of identity (02T08).
  if (voice && ctx.turn.speakerLabel !== 'primary' && (parsed.facts.length > 0 || parsed.choice)) {
    const all = [...parsed.facts.map((f) => ({ field: f.field, lifecycle: f.lifecycle, candidates: [{ value: f.value, display: f.display }], quote: f.quote, holder: f.holder })), ...(parsed.choice ? [parsed.choice] : [])];
    for (const c of all) {
      const pend: PendingDraft = {
        field: c.field,
        candidates: c.candidates.map((x) => x.value),
        candidateLabels: c.candidates.map((x) => x.display),
        lifecycle: narrowLifecycle(c.lifecycle),
        question: `I want to record this correctly. Is “${c.candidates.map((x) => stripLabel(x.display)).join(' or ')}” your own answer? I never identify people by their voice.`,
        sourceTurnId: ctx.turn.turnId,
        quote: c.quote,
        modality: ctx.turn.modality,
        recognitionUncertain: uncertain,
        reason: 'unassigned_speaker',
        templateId: q.templateId,
        questionId: q.questionId,
        existingClaimIds: [],
      };
      if (c.holder && c.holder.kind !== 'student') pend.holder = c.holder;
      out.pending.push(pend);
    }
    out.notices.push({ code: 'speaker_unassigned', message: 'It sounded like someone else may have answered. Nothing is recorded until you confirm it is your answer.' });
    return out;
  }

  for (const f of parsed.facts) {
    const draft: FactDraft = { field: f.field, value: f.value, lifecycle: f.lifecycle, quote: f.quote, display: f.display, tentative: P.isTentative(f.quote), confirmed: false, recognitionUncertain: uncertain, questionId: q.questionId };
    if (f.holder) draft.holder = f.holder;
    out.facts.push(draft);
  }
  if (parsed.choice) {
    const c = parsed.choice;
    const pend: PendingDraft = {
      field: c.field,
      candidates: c.candidates.map((x) => x.value),
      candidateLabels: c.candidates.map((x) => x.display),
      lifecycle: narrowLifecycle(c.lifecycle),
      question: c.question,
      sourceTurnId: ctx.turn.turnId,
      quote: c.quote,
      modality: ctx.turn.modality,
      recognitionUncertain: uncertain,
      reason: c.reason,
      templateId: q.templateId,
      questionId: q.questionId,
      existingClaimIds: [],
    };
    if (c.holder && c.holder.kind !== 'student') pend.holder = c.holder;
    out.pending.push(pend);
  }
  // Asking for a different missing piece after progress ("which currency?" then "does it include travel?") is not a repeat.
  const progressed = parsed.clarify?.carry !== undefined && ctx.carry !== undefined && stableStringify(parsed.clarify.carry) !== stableStringify(ctx.carry);
  if (parsed.clarify) {
    if (ctx.clarificationsUsed === 0 || progressed) {
      out.clarification = { ...clarificationFor(q, parsed.clarify.text), options: parsed.clarify.options ?? clarificationFor(q, parsed.clarify.text).options };
      if (progressed) out.clarification.continuation = true;
      if (parsed.clarify.carry !== undefined) out.carry[q.questionId] = parsed.clarify.carry;
    } else if (out.facts.length === 0 && out.pending.length === 0) {
      // Do not loop over the same question with different wording (02R07).
      out.settled.push(q.questionId);
      out.unresolved.push({ field: catalogField, reason: 'unclear_answer', evidenceRoute: route });
    }
  }
  if (!parsed.clarify && parsed.facts.length === 0 && !parsed.choice) {
    out.settled.push(q.questionId);
    out.unresolved.push({ field: catalogField, reason: /\b(a few|a couple|some|most|usually|sometimes)\b/i.test(text) ? 'imprecise_answer' : 'unclear_answer', evidenceRoute: route });
  }
  if (out.facts.length > 0 && out.pending.length === 0 && !out.clarification) out.settled.push(q.questionId);
  return out;
}

function narrowLifecycle(l: Lifecycle): PendingConfirmation['lifecycle'] {
  return l === 'enrolled' || l === 'cancelled' ? 'current' : l;
}

function stripLabel(display: string): string {
  return display.replace(/^(Travel|Available|Interest|Activity|Course level|Course status|Language of instruction|Current year): /, '');
}

function targetedClarify(q: PlannedQuestion): string | undefined {
  if (q.field.attribute === 'level') return 'That is fine. Does your timetable or report card show a level such as HL, SL or Honors next to this course?';
  return undefined;
}

function clarificationFor(q: PlannedQuestion, text: string): Clarification {
  return { questionId: q.questionId, text, options: q.options, templateId: q.templateId, field: q.field };
}

function absenceFact(q: PlannedQuestion, value: Absence, text: string, ctx: InterpretContext): FactDraft {
  return {
    field: { ...q.field },
    value,
    lifecycle: 'current',
    quote: text.slice(0, 120),
    display: value.reason === 'declined' ? 'chose not to share' : value.reason === 'not_decided' ? 'not decided yet' : 'not known yet',
    tentative: false,
    confirmed: false,
    recognitionUncertain: recognitionUncertain(ctx.turn),
    questionId: q.questionId,
  };
}

// ------------------------------------------------------------------ resolving a pending confirmation

export type PendingResolution =
  | { kind: 'accept'; index: number }
  | { kind: 'reject' }
  | { kind: 'reanswer'; text: string }
  | { kind: 'unclear' }
  | { kind: 'control'; control: 'skip' | 'declined' | 'dont_know' | 'not_decided' };

const ORDINALS: ReadonlyArray<[RegExp, number]> = [
  [/\b(the )?(first|former|1st)( one)?\b|^\s*1\s*$/i, 0],
  [/\b(the )?(second|latter|2nd)( one)?\b|^\s*2\s*$/i, 1],
  [/\b(the )?(third|3rd)( one)?\b|^\s*3\s*$/i, 2],
];

function numbersIn(s: string): number[] {
  return P.findNumbers(s.replace(/[€$£¥₹]/g, ' ')).map((n) => n.value);
}

export function resolvePending(p: PendingConfirmation, answer: string, ctx: Omit<InterpretContext, 'question' | 'clarificationsUsed' | 'carry'>): PendingResolution {
  const text = answer.trim();
  const control = P.controlAnswer(text);
  if (control === 'skip' || control === 'declined' || control === 'dont_know' || control === 'not_decided') return { kind: 'control', control };
  const yes = control === 'yes' || /^(yes|yeah|yep|correct|right|exactly|that'?s (right|correct|it)|sure|it is|it was me|that was me|my answer|mine)\b/i.test(text);
  const no = control === 'no' || /^(no|nope|not really|incorrect|wrong|neither|that'?s wrong|not mine|someone else)\b/i.test(text);
  const rest = text.replace(/^(no|nope|not quite|actually|incorrect|wrong)[,.!\s-]*/i, '').replace(/^(it'?s|it is|i said|i meant)\s+/i, '').trim();

  const negativeOnly = /^(no|nope|not really|incorrect|wrong|neither|not mine|someone else)\b/i;
  if (p.candidates.length === 1) {
    if (yes && !no) return { kind: 'accept', index: 0 };
    if (no) {
      // "No, it's 150" corrects the value; "No" or "someone else said it" rejects it.
      if (p.reason === 'unassigned_speaker' || rest.length === 0 || negativeOnly.test(rest)) return { kind: 'reject' };
      return p.templateId ? { kind: 'reanswer', text: rest } : { kind: 'reject' };
    }
    return matchCandidate(p, text, ctx) ?? (p.templateId ? { kind: 'reanswer', text } : { kind: 'unclear' });
  }
  for (const [re, idx] of ORDINALS) if (re.test(text) && idx < p.candidates.length) return { kind: 'accept', index: idx };
  const m = matchCandidate(p, text, ctx);
  if (m) return m;
  if (no) return rest.length > 0 && p.templateId ? { kind: 'reanswer', text: rest } : { kind: 'reject' };
  return { kind: 'unclear' };
}

function matchCandidate(p: PendingConfirmation, text: string, ctx: Omit<InterpretContext, 'question' | 'clarificationsUsed' | 'carry'>): PendingResolution | null {
  const lower = text.toLowerCase();
  // Exact label mention.
  const byLabel = p.candidateLabels.map((l, i) => ({ i, hit: lower.includes(l.toLowerCase()) })).filter((x) => x.hit);
  if (byLabel.length === 1) return { kind: 'accept', index: byLabel[0]!.i };
  // The answer quotes part of one label ("weekdays only").
  const core = lower.replace(/[.!?]+$/, '').trim();
  if (core.length >= 4) {
    const partial = p.candidateLabels.map((l, i) => ({ i, hit: l.toLowerCase().includes(core) })).filter((x) => x.hit);
    if (partial.length === 1) return { kind: 'accept', index: partial[0]!.i };
  }
  // Numbers in the answer that single out one candidate ("150", "one fifty").
  const nums = numbersIn(text);
  if (nums.length > 0) {
    const hits = p.candidateLabels.map((l, i) => ({ i, n: numbersIn(l) })).filter((x) => x.n.some((n) => nums.includes(n)));
    if (hits.length === 1) return { kind: 'accept', index: hits[0]!.i };
  }
  // Parse the answer as a fresh answer to the original question and compare values.
  if (p.templateId) {
    const t = TEMPLATE_BY_ID.get(p.templateId);
    if (t) {
      const q: PlannedQuestion = { questionId: p.questionId, kind: 'ask', text: t.text, purpose: t.purpose, field: p.field, reasons: [], options: [], allowSkip: true, allowDontKnow: true, sensitivity: t.sensitivity, claimIds: [], templateId: t.id };
      const parsed = parseForQuestion(q, text, { ...ctx, question: q, clarificationsUsed: 1, carry: undefined });
      const values = [...parsed.facts.map((f) => f.value), ...(parsed.choice?.candidates.map((c) => c.value) ?? [])].map(stableStringify);
      const idx = p.candidates.findIndex((c) => values.includes(stableStringify(c)));
      if (idx >= 0 && values.length === 1) return { kind: 'accept', index: idx };
      if (parsed.facts.length > 0 || parsed.choice) return { kind: 'reanswer', text };
    }
  }
  return null;
}

/** A PlannedQuestion for re-reading an answer to a template question. */
export function questionForTemplate(templateId: string, questionId: string, field: PlannedQuestion['field']): PlannedQuestion | null {
  const t = TEMPLATE_BY_ID.get(templateId);
  if (!t) return null;
  return { questionId, kind: 'ask', text: t.text, purpose: t.purpose, field, reasons: [], options: (t.options ?? []).map((o) => o.label), allowSkip: t.skippable, allowDontKnow: true, sensitivity: t.sensitivity, claimIds: [], templateId: t.id };
}

// ------------------------------------------------------------------ opportunistic extraction

/**
 * Facts an answer states explicitly for other fields ("I'm in Year 12, doing the
 * IB"). Only unambiguous patterns are used; nothing is inferred from them (Year
 * 12 is not converted into a graduation date or a US grade).
 */
export function opportunisticFacts(text: string, ctx: InterpretContext, alreadyAsked: ReadonlySet<string>): FactDraft[] {
  const out: FactDraft[] = [];
  if (nonLatinLetterShare(text) > 0.5 || P.controlAnswer(text) !== null) return out;
  const base = { lifecycle: 'current' as Lifecycle, tentative: false, confirmed: false, recognitionUncertain: recognitionUncertain(ctx.turn), questionId: ctx.question.questionId };
  const label = P.findYearLabel(text);
  if (label && !alreadyAsked.has('education.current_year')) {
    out.push({ ...base, field: studentField('education.current_year_label'), value: { label, systemContext: ctx.knownSystemLabel }, quote: label, display: `Current year: ${label} (as your school calls it)` });
  }
  const q = P.findQualificationSystem(text);
  if (q && !alreadyAsked.has('education.system')) {
    const at = text.search(/\b(ib|international baccalaureate|a[- ]?levels?|gce|apolytirio|panhellenic|lykeio|lyceum|bac(calaur[ée]at)?|high school diploma|ap courses)\b/i);
    const quote = P.clauseAt(text, Math.max(0, at));
    if (!UNKNOWN_PHRASES.test(quote) && !P.isTentative(quote)) out.push({ ...base, field: studentField('education.qualification_system'), value: q, quote, display: q.label });
  }
  return out;
}

/** Ordinary admissions stress gets a supportive reply; nothing about it is recorded (02 privacy rules). */
export function supportNotices(text: string): { notices: Notice[]; crisis: boolean } {
  if (/\b(kill myself|suicid\w*|self[- ]harm|hurt(ing)? myself|end my life|don'?t want to (live|be alive|be here anymore))\b/i.test(text)) {
    return {
      crisis: true,
      notices: [
        {
          code: 'support_referral',
          message: 'Thank you for telling me. This is more important than any application question. Please reach out now to someone you trust, such as a parent, a teacher or your school counselor, or a local crisis line. If you might be in immediate danger, contact your local emergency number. I have paused these questions.',
        },
      ],
    };
  }
  if (P.expressesStress(text)) {
    return {
      crisis: false,
      notices: [{ code: 'stress_support', message: 'That sounds like a lot, and many students feel this way during applications. We can take it one small step at a time, and you can skip anything or stop and come back later.' }],
    };
  }
  return { notices: [], crisis: false };
}

export { parseForQuestion as parseAnswerForQuestion };
