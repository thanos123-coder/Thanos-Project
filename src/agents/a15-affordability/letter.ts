import { Decimal } from 'decimal.js';
import type { FUNDING_KINDS } from '../../shared/fields.js';
import { currencyExponent, type Money } from '../../shared/money.js';
import { normName, type FundingItem } from './ledger.js';

/**
 * Award letter review (15 "Award letter review and reconciliation").
 *
 * Lines are read by code from the letter text and classified by their own
 * wording. A line whose wording does not say whether it is a grant, a loan or
 * work is left unclassified and turned into a question; it is never assumed
 * to be a grant (15T13). Loans and work allocations are recognized and kept
 * out of gift aid (15T01, 15T02). The letter's own total is checked against
 * its lines, and the letter is compared with what the ledger already holds.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export const LETTER_CATEGORIES = ['gift', 'loan', 'work', 'cost', 'total', 'contribution', 'unclear'] as const;
export type LetterCategory = (typeof LETTER_CATEGORIES)[number];

export interface LetterLine {
  index: number;
  label: string;
  amount: Money;
  raw: string;
  page: number;
  category: LetterCategory;
  fundingKind: (typeof FUNDING_KINDS)[number] | null;
  basis: FundingItem['basis'];
  stage: 'offered' | 'estimated';
  eligibilityProgram: string | null;
  /** Why the line was put in its category, in plain words. */
  reason: string;
}

const LOAN = /\bloans?\b|\bdirect (?:subsidized|unsubsidized)\b|\bparent plus\b|\bgrad plus\b|\bperkins\b/i;
const WORK = /\bwork[- ]?study\b|\bstudent employment\b|\bwork (?:award|allocation|program|opportunity)\b|\bcampus (?:job|employment)\b/i;
const GIFT = /\b(grants?|scholarships?|bursary|bursaries|fellowships?|tuition waiver|tuition remission|gift aid)\b/i;
const COST = /\b(tuition|fees?|housing|room|board|meals?|books|supplies|transportation|travel|personal expenses|cost of attendance|direct costs?|indirect costs?|health insurance)\b/i;
const CONTRIBUTION = /\b(expected family contribution|family contribution|student aid index|sai|parent contribution|student contribution)\b/i;
const TOTAL = /\btotal\b/i;
const ESTIMATED = /\b(estimated|est\.|anticipated|expected|pending|tentative|projected)\b/i;
const FEDERAL = /\b(federal|pell|seog|fseog|direct (?:subsidized|unsubsidized)|parent plus)\b/i;
const GOVERNMENT = /\b(federal|pell|seog|state|government|national|provincial)\b/i;
const OUTSIDE = /\b(outside|external|private|non-institutional)\b/i;
const MERIT = /\b(merit|presidential|dean'?s|honou?rs?|achievement|excellence|academic)\b/i;
const NEED = /\bneed[- ]based\b|\bneed\b/i;

const AMOUNT_AT_END = /^(.*?[A-Za-z][^$£€]*?)[\s:.…-]*\s(US\$|\$|£|€|USD|GBP|EUR|CAD|AUD)?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s*(USD|GBP|EUR|CAD|AUD)?\s*$/;

const SYMBOL: Record<string, string> = { $: 'USD', US$: 'USD', '£': 'GBP', '€': 'EUR' };

/** Read "label ... amount" lines from the letter text. Lines without an amount are context (headings, notes). */
export function parseLetterLines(pages: ReadonlyArray<{ page: number; text: string }>, defaultCurrency: string): { lines: LetterLine[]; renewalMentioned: boolean; conditionalNotes: string[] } {
  const lines: LetterLine[] = [];
  let renewalMentioned = false;
  const conditionalNotes: string[] = [];
  for (const p of pages) {
    for (const rawLine of p.text.split('\n')) {
      const raw = rawLine.trim();
      if (raw.length === 0) continue;
      if (/\brenew/i.test(raw)) renewalMentioned = true;
      if (/\b(conditional|contingent|subject to|provided that)\b/i.test(raw) && !AMOUNT_AT_END.test(raw)) conditionalNotes.push(raw.slice(0, 300));
      const m = AMOUNT_AT_END.exec(raw);
      if (!m) continue;
      const label = m[1]!.replace(/[\s:.…-]+$/, '').trim();
      if (label.length < 3 || /^\d{4}\s*[–-]\s*\d{2,4}$/.test(label)) continue;
      const sym = m[2] ?? m[5];
      const currency = sym ? SYMBOL[sym] ?? sym : defaultCurrency;
      const amount = { amount: new D(`${m[3]!.replace(/,/g, '')}${m[4] ?? ''}`).toFixed(currencyExponent(currency)), currency };
      lines.push({ index: lines.length, label, amount, raw, page: p.page, ...classifyLetterLabel(label) });
    }
  }
  return { lines, renewalMentioned, conditionalNotes };
}

export function classifyLetterLabel(label: string): Pick<LetterLine, 'category' | 'fundingKind' | 'basis' | 'stage' | 'eligibilityProgram' | 'reason'> {
  const stage = ESTIMATED.test(label) ? 'estimated' : 'offered';
  const basis: FundingItem['basis'] = NEED.test(label) ? 'need_based' : MERIT.test(label) ? 'merit' : 'unknown';
  const eligibilityProgram = FEDERAL.test(label) ? 'us_federal' : null;
  const base = { basis, stage, eligibilityProgram } as const;
  if (TOTAL.test(label)) {
    if (COST.test(label) && !/\baid\b|\baward/i.test(label)) return { ...base, category: 'cost', fundingKind: null, reason: 'a total cost line' };
    return { ...base, category: 'total', fundingKind: null, reason: 'the letter’s own total' };
  }
  if (CONTRIBUTION.test(label)) return { ...base, category: 'contribution', fundingKind: null, reason: 'an eligibility or contribution figure, not a bill and not aid' };
  if (LOAN.test(label)) return { ...base, category: 'loan', fundingKind: 'loan', reason: 'the line says it is a loan, which must be repaid' };
  if (WORK.test(label)) return { ...base, category: 'work', fundingKind: 'work', reason: 'the line is a work allocation, earned by working' };
  if (GIFT.test(label)) {
    const kind = /\bwaiver|remission\b/i.test(label) ? 'tuition_waiver' : OUTSIDE.test(label) ? 'external_scholarship' : GOVERNMENT.test(label) ? 'government_grant' : 'institutional_grant';
    return { ...base, category: 'gift', fundingKind: kind, reason: 'the line says it is a grant or scholarship' };
  }
  if (COST.test(label)) return { ...base, category: 'cost', fundingKind: null, reason: 'a cost line' };
  return { ...base, category: 'unclear', fundingKind: null, reason: 'the wording does not say whether this is a grant, a loan or work' };
}

export interface LetterReview {
  lines: LetterLine[];
  totals: { gift: string; loan: string; work: string; unclear: string; sumOfAidLines: string; statedTotal: string | null; totalMatches: boolean | null; currency: string };
  questions: Array<{ lineIndex: number | null; question: string; for: 'student' | 'aid_office' }>;
  changes: Array<{ lineIndex: number | null; fundingId: string | null; name: string; change: 'new' | 'amount_changed' | 'stage_changed' | 'unchanged' | 'not_in_letter'; before: string | null; after: string | null; matchedBy: 'name' | 'only_item_of_kind' | null }>;
  notices: string[];
}

/** Compare the letter with itself and with the funding the ledger already holds for this option. */
export function reviewLetter(parsed: ReturnType<typeof parseLetterLines>, existing: readonly FundingItem[], currency: string): LetterReview {
  const cur = currency;
  const sum = (cat: LetterCategory) => parsed.lines.filter((l) => l.category === cat && l.amount.currency === cur).reduce((a, l) => a.plus(l.amount.amount), new D(0));
  const gift = sum('gift');
  const loan = sum('loan');
  const work = sum('work');
  const unclear = sum('unclear');
  const aid = gift.plus(loan).plus(work).plus(unclear);
  const totalLine = parsed.lines.find((l) => l.category === 'total');
  const stated = totalLine ? new D(totalLine.amount.amount) : null;
  const fx = (d: InstanceType<typeof D>) => d.toFixed(currencyExponent(cur));
  const questions: LetterReview['questions'] = [];
  const notices: string[] = [];
  for (const l of parsed.lines.filter((x) => x.category === 'unclear')) {
    questions.push({ lineIndex: l.index, for: 'student', question: `Is “${l.label}” (${l.amount.amount} ${l.amount.currency}) a grant or scholarship that does not need repaying, a loan, or money you earn by working? The letter does not say. Check its footnotes, or ask the aid office; until then it is not counted as a grant.` });
  }
  if (stated && !stated.equals(aid)) {
    questions.push({ lineIndex: totalLine!.index, for: 'aid_office', question: `The letter’s total (${fx(stated)} ${cur}) differs from the sum of its aid lines (${fx(aid)} ${cur}). Could you confirm which amounts are correct and whether any line is missing?` });
  }
  if (loan.greaterThan(0) || work.greaterThan(0)) {
    notices.push(`Of the aid listed, ${fx(gift)} ${cur} is grants and scholarships. ${loan.greaterThan(0) ? `${fx(loan)} ${cur} is loans, which must be repaid. ` : ''}${work.greaterThan(0) ? `${fx(work)} ${cur} is work you may earn over the year; it is not a discount.` : ''}`.trim());
  }
  if (!parsed.renewalMentioned && parsed.lines.some((l) => l.category === 'gift')) notices.push('The letter does not say whether the grants renew in later years; they are counted for this year only until the terms are known.');
  for (const n of parsed.conditionalNotes) notices.push(`The letter sets a condition: “${n}”.`);
  const contribution = parsed.lines.find((l) => l.category === 'contribution');
  if (contribution) notices.push(`“${contribution.label}” is an eligibility figure used to calculate aid, not your bill and not a guaranteed family payment.`);

  const changes: LetterReview['changes'] = [];
  const matched = new Map<number, { item: FundingItem; by: 'name' | 'only_item_of_kind' }>();
  const used = new Set<string>();
  const aidLines = parsed.lines.filter((x) => x.fundingKind !== null);
  // First by name; then, for a kind with exactly one unmatched line and one unmatched earlier item, as the same award updated.
  for (const l of aidLines) {
    const e = existing.find((x) => !used.has(x.fundingId) && x.kind === l.fundingKind && normName(x.name) === normName(l.label));
    if (e) {
      matched.set(l.index, { item: e, by: 'name' });
      used.add(e.fundingId);
    }
  }
  for (const kind of new Set(aidLines.map((l) => l.fundingKind!))) {
    if (kind === 'external_scholarship') continue;
    const lines = aidLines.filter((l) => l.fundingKind === kind && !matched.has(l.index));
    const items = existing.filter((x) => x.kind === kind && !used.has(x.fundingId));
    if (lines.length === 1 && items.length === 1) {
      matched.set(lines[0]!.index, { item: items[0]!, by: 'only_item_of_kind' });
      used.add(items[0]!.fundingId);
    }
  }
  for (const l of aidLines) {
    const m = matched.get(l.index);
    if (!m) {
      changes.push({ lineIndex: l.index, fundingId: null, name: l.label, change: 'new', before: null, after: l.amount.amount, matchedBy: null });
      continue;
    }
    const e = m.item;
    const change = e.amount.amount !== l.amount.amount ? 'amount_changed' : e.stage !== l.stage && !(e.stage !== 'estimated' && l.stage === 'offered') ? 'stage_changed' : 'unchanged';
    changes.push({ lineIndex: l.index, fundingId: e.fundingId, name: e.name, change, before: e.amount.amount, after: l.amount.amount, matchedBy: m.by });
    if (m.by === 'only_item_of_kind' && change !== 'unchanged') notices.push(`“${l.label}” on the letter is treated as the update of “${e.name}” (${e.amount.amount} → ${l.amount.amount} ${l.amount.currency}); tell me if they are different awards.`);
  }
  for (const e of existing) {
    if (used.has(e.fundingId) || e.kind === 'external_scholarship') continue;
    changes.push({ lineIndex: null, fundingId: e.fundingId, name: e.name, change: 'not_in_letter', before: e.amount.amount, after: null, matchedBy: null });
  }
  return {
    lines: parsed.lines,
    totals: { gift: fx(gift), loan: fx(loan), work: fx(work), unclear: fx(unclear), sumOfAidLines: fx(aid), statedTotal: stated ? fx(stated) : null, totalMatches: stated ? stated.equals(aid) : null, currency: cur },
    questions,
    changes,
    notices,
  };
}
