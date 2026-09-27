import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { AbsenceSchema, type Absence } from './absence.js';
import { CalendarDateSchema } from './time.js';

/**
 * Money is a decimal amount plus an ISO 4217 currency. Arithmetic is exact
 * (decimal.js); amounts in different currencies are never combined without an
 * explicit, dated exchange rate, and converted amounts are always estimates.
 *
 * Data dictionary: "Money: decimal amount, currency, component, estimate flag,
 * date. Invalid shortcut: comparing amounts in different currencies without
 * conversion context."
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Minor-unit exponents for currencies that differ from the default of 2. */
const CURRENCY_EXPONENTS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, UGX: 0, XAF: 0, XOF: 0, PYG: 0, RWF: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency] ?? 2;
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code such as EUR');

export const MoneySchema = z
  .object({
    /** Decimal string, e.g. "150.00". Never a float. */
    amount: z.string().regex(DECIMAL_RE, 'Expected a decimal string'),
    currency: CurrencySchema,
  })
  .strict();
export type Money = z.infer<typeof MoneySchema>;

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine ${a} and ${b} without an explicit exchange rate`);
    this.name = 'CurrencyMismatchError';
  }
}

export function money(amount: string | number, currency: string): Money {
  const d = new D(amount);
  if (!d.isFinite()) throw new Error(`Invalid amount ${amount}`);
  return { amount: d.toFixed(currencyExponent(currency)), currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: new D(a.amount).plus(b.amount).toFixed(currencyExponent(a.currency)), currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: new D(a.amount).minus(b.amount).toFixed(currencyExponent(a.currency)), currency: a.currency };
}

/** -1, 0, 1. Throws on currency mismatch. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  const c = new D(a.amount).comparedTo(b.amount);
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

export function isZero(m: Money): boolean {
  return new D(m.amount).isZero();
}

export function formatMoney(m: Money): string {
  const symbol: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' };
  const s = symbol[m.currency];
  const amount = new D(m.amount);
  const fixed = amount.isInteger() ? amount.toFixed(0) : amount.toFixed(currencyExponent(m.currency));
  const [intPart, frac] = fixed.split('.');
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${grouped}.${frac}` : grouped;
  return s ? `${s}${body}` : `${body} ${m.currency}`;
}

/** A dated exchange rate: 1 unit of `from` = `rate` units of `to`. */
export const ExchangeRateSchema = z
  .object({
    from: CurrencySchema,
    to: CurrencySchema,
    rate: z.string().regex(/^\d+(\.\d+)?$/),
    asOf: CalendarDateSchema,
    source: z.string().min(1),
  })
  .strict();
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

export interface ConvertedMoney {
  money: Money;
  estimate: true;
  basis: ExchangeRate;
}

export function convertMoney(m: Money, rate: ExchangeRate): ConvertedMoney {
  if (m.currency !== rate.from) throw new CurrencyMismatchError(m.currency, rate.from);
  const converted = new D(m.amount).times(rate.rate).toFixed(currencyExponent(rate.to));
  return { money: { amount: converted, currency: rate.to }, estimate: true, basis: rate };
}

export const COST_COMPONENTS = [
  'tuition',
  'application_fee',
  'registration_fee',
  'late_fee',
  'deposit',
  'housing',
  'meals',
  'travel',
  'local_transport',
  'equipment',
  'device',
  'insurance',
  'score_report',
  'preparation',
  'materials',
  'other',
] as const;
export type CostComponentKind = (typeof COST_COMPONENTS)[number];
export const CostComponentKindSchema = z.enum(COST_COMPONENTS);

export const CostComponentSchema = z
  .object({
    component: CostComponentKindSchema,
    /** A known amount, or an explicit absence (e.g. travel not yet estimated). */
    amount: z.union([MoneySchema, AbsenceSchema]),
    /** True when the amount is an estimate rather than a published figure. */
    estimate: z.boolean(),
    /** True when this cost is required to participate (vs optional add-on). */
    required: z.boolean().default(true),
    sourceRef: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
export type CostComponent = z.infer<typeof CostComponentSchema>;

/**
 * A budget as the student expressed it. "Up to €200 including transport"
 * differs from "up to €200 tuition"; a hard cap differs from a preference.
 */
export const BudgetSchema = z
  .object({
    amount: MoneySchema,
    kind: z.enum(['hard_cap', 'preference']),
    /** Which cost components the budget must cover; `all` means every required cost. */
    covers: z.union([z.literal('all'), z.array(CostComponentKindSchema).min(1)]),
    /** What the budget applies to, e.g. a single opportunity or a whole summer. */
    appliesTo: z.enum(['per_opportunity', 'total_period', 'per_month', 'per_test']).default('per_opportunity'),
  })
  .strict();
export type Budget = z.infer<typeof BudgetSchema>;

export interface CostTotal {
  /** Sum of all known required components in the budget currency. */
  known: Money;
  /** Required components whose amount is unknown. */
  unknownComponents: CostComponentKind[];
  /** True when any included amount is an estimate or a currency conversion. */
  includesEstimates: boolean;
  /** Required components in another currency for which no rate was supplied. */
  unconvertibleComponents: CostComponentKind[];
}

/**
 * Total the required cost components that a budget covers. Unknown amounts are
 * reported, never treated as zero; foreign-currency amounts are converted only
 * with a supplied dated rate and then flagged as estimates.
 */
export function totalCoveredCosts(
  components: readonly CostComponent[],
  budget: Budget,
  rates: readonly ExchangeRate[] = [],
): CostTotal {
  const currency = budget.amount.currency;
  let known = money(0, currency);
  const unknownComponents: CostComponentKind[] = [];
  const unconvertibleComponents: CostComponentKind[] = [];
  let includesEstimates = false;
  for (const c of components) {
    if (!c.required) continue;
    if (budget.covers !== 'all' && !budget.covers.includes(c.component)) continue;
    const amount = c.amount as Money | Absence;
    if ('kind' in amount) {
      if (amount.reason === 'not_applicable' || amount.reason === 'confirmed_absent') continue;
      unknownComponents.push(c.component);
      continue;
    }
    if (c.estimate) includesEstimates = true;
    if (amount.currency === currency) {
      known = addMoney(known, amount);
    } else {
      const rate = rates.find((r) => r.from === amount.currency && r.to === currency);
      if (!rate) {
        unconvertibleComponents.push(c.component);
        continue;
      }
      known = addMoney(known, convertMoney(amount, rate).money);
      includesEstimates = true;
    }
  }
  return { known, unknownComponents, includesEstimates, unconvertibleComponents };
}

export type AffordabilityVerdict =
  | { verdict: 'within_budget'; total: CostTotal }
  | { verdict: 'over_budget'; total: CostTotal; overBy: Money }
  | { verdict: 'unresolved'; total: CostTotal; reason: 'unknown_components' | 'unconvertible_currency' };

/**
 * Deterministic affordability check against a budget. A known total already
 * above the cap is `over_budget` even if other components are unknown; if the
 * known total is within the cap but anything is unknown the verdict is
 * `unresolved` (never "affordable").
 */
export function checkAffordability(
  components: readonly CostComponent[],
  budget: Budget,
  rates: readonly ExchangeRate[] = [],
): AffordabilityVerdict {
  const total = totalCoveredCosts(components, budget, rates);
  if (compareMoney(total.known, budget.amount) > 0) {
    return { verdict: 'over_budget', total, overBy: subtractMoney(total.known, budget.amount) };
  }
  if (total.unconvertibleComponents.length > 0) return { verdict: 'unresolved', total, reason: 'unconvertible_currency' };
  if (total.unknownComponents.length > 0) return { verdict: 'unresolved', total, reason: 'unknown_components' };
  return { verdict: 'within_budget', total };
}
