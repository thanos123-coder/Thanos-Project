import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { FUNDING_KINDS, FUNDING_PERIODS, FUNDING_STAGES } from '../../shared/fields.js';
import { currencyExponent, CurrencySchema, MoneySchema, type Money } from '../../shared/money.js';
import { CalendarDateSchema, type CalendarDate } from '../../shared/time.js';

/**
 * The affordability ledger (15 "Cost ledger construction", "Calculations and
 * labels", "Multi year and currency scenarios").
 *
 * Every figure is computed in code with decimal arithmetic, in the ledger's
 * own currency, from explicit lines. The sequence is fixed: total cost, minus
 * applicable gift aid (after verified stacking or displacement rules), is the
 * net educational cost; confirmed resources are compared with it at the times
 * they are needed; the gap is shown before any loan or work income, which are
 * listed as ways of paying, never as price reductions. A missing amount is
 * missing, not zero, and a line already included in another total is not
 * counted twice.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
type Dec = InstanceType<typeof D>;

export const LINE_COMPONENTS = [
  'tuition',
  'mandatory_fees',
  'cost_of_attendance',
  'housing',
  'meals',
  'books_supplies',
  'equipment',
  'health_insurance',
  'transport',
  'travel_home',
  'personal',
  'application_fee',
  'enrollment_deposit',
  'housing_deposit',
  'relocation',
  'documentation',
  'other',
] as const;
export type LineComponent = (typeof LINE_COMPONENTS)[number];

export const LINE_PERIODS = ['academic_year', 'semester', 'term', 'quarter', 'month', 'credit', 'one_time', 'program_total'] as const;
export type LinePeriod = (typeof LINE_PERIODS)[number];

/** Components that grow with tuition in a scenario; everything else grows with living costs. */
const TUITION_LIKE = new Set<LineComponent>(['tuition', 'mandatory_fees', 'cost_of_attendance']);
const CERTAINTY_RANK = { official: 3, student_supplied: 2, estimate: 1, historical: 0 } as const;

export const CostLineSchema = z
  .object({
    lineId: z.string().min(1).max(120),
    component: z.enum(LINE_COMPONENTS),
    label: z.string().min(1).max(200),
    /** Null: the amount is not known. It is never treated as zero. */
    amount: MoneySchema.nullable(),
    /** Null: the source did not say which period the amount covers; the line cannot be totalled (15T03). */
    period: z.enum(LINE_PERIODS).nullable(),
    certainty: z.enum(['official', 'estimate', 'student_supplied', 'historical']),
    /** Billed by the institution (owed on its bill) versus a living cost the student pays as it arises. */
    billed: z.boolean().nullable(),
    /** Components this line already contains, e.g. a published total that includes mandatory fees (15T04). */
    includes: z.array(z.enum(LINE_COMPONENTS)).default([]),
    sourceRef: z.string().max(200).nullable(),
    dueDate: CalendarDateSchema.nullable().default(null),
    required: z.boolean().default(true),
  })
  .strict();
export type CostLine = z.infer<typeof CostLineSchema>;
export type CostLineInput = z.input<typeof CostLineSchema>;

export const FundingItemSchema = z
  .object({
    fundingId: z.string().min(1).max(200),
    provider: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    kind: z.enum(FUNDING_KINDS),
    basis: z.enum(['need_based', 'merit', 'other', 'unknown']).default('unknown'),
    amount: MoneySchema,
    period: z.enum(FUNDING_PERIODS),
    stage: z.enum(FUNDING_STAGES),
    coveredCosts: z.array(z.string()).nullable().default(null),
    renewal: z.object({ renewable: z.boolean(), conditions: z.array(z.string()), maxYears: z.number().int().positive().nullable().default(null) }).strict().nullable().default(null),
    eligibilityProgram: z.string().nullable().default(null),
    disbursesOn: CalendarDateSchema.nullable().default(null),
    externalRefs: z.array(z.string()).default([]),
    sourceRef: z.string().max(200).nullable().default(null),
  })
  .strict();
export type FundingItem = z.infer<typeof FundingItemSchema>;
export type FundingItemInput = z.input<typeof FundingItemSchema>;

export const ResourceSchema = z
  .object({
    resourceId: z.string().min(1).max(200),
    /** student: the student's own money; supporter: a supporter's own statement; reported_other: the student's estimate of someone else's help. */
    holder: z.enum(['student', 'supporter', 'reported_other']),
    label: z.string().min(1).max(120),
    min: MoneySchema.nullable(),
    max: MoneySchema,
    period: z.enum(['annual', 'total_degree']),
    /** A supporter's confirmed commitment, or the student's own money; anything else is an estimate. */
    confirmed: z.boolean(),
    availableFrom: CalendarDateSchema.nullable().default(null),
    includesTravelAndPersonal: z.boolean().nullable().default(null),
  })
  .strict();
export type Resource = z.infer<typeof ResourceSchema>;
export type ResourceInput = z.input<typeof ResourceSchema>;

/** The institution's verified rule for outside awards (from an official claim); without one the interaction is unresolved (15T06). */
export const InteractionRuleSchema = z
  .object({
    rule: z.enum(['reduce_student_contribution_first', 'reduce_institutional_grant', 'no_displacement', 'case_by_case']),
    studentContributionFirst: MoneySchema.nullable(),
    sourceRef: z.string().min(1),
  })
  .strict();
export type InteractionRule = z.infer<typeof InteractionRuleSchema>;

export const WorkScenarioSchema = z
  .object({
    hoursPerWeek: z.number().positive().max(40),
    hourlyRate: MoneySchema,
    weeks: z.number().int().positive().max(52),
    /** Whether the student may legally work, and under what limit; never assumed from admission or a broad label. */
    eligibility: z.enum(['verified', 'unknown', 'not_permitted']),
    maxHoursPerWeekAllowed: z.number().positive().nullable().default(null),
    /** The most hours the student chose to work alongside study. */
    studentChosenMaxHours: z.number().positive().nullable().default(null),
    firstPayDate: CalendarDateSchema.nullable().default(null),
  })
  .strict();
export type WorkScenario = z.infer<typeof WorkScenarioSchema>;

/** One unit of `from` equals `rate` units of `to`, as an explicit pair (15 "Multi year and currency scenarios"). */
export const RateAssumptionSchema = z
  .object({
    from: CurrencySchema,
    to: CurrencySchema,
    rate: z.string().regex(/^\d+(\.\d+)?$/),
    asOf: CalendarDateSchema,
    source: z.enum(['user_scenario', 'provider']),
  })
  .strict();
export type RateAssumption = z.infer<typeof RateAssumptionSchema>;

export const CostBasisSchema = z
  .object({
    optionRef: z.string().min(1).max(200),
    institutionId: z.string().min(1),
    campusId: z.string().nullable(),
    programId: z.string().nullable(),
    cycle: z.string().regex(/^\d{4}$/),
    enrollment: z.enum(['full_time', 'part_time']),
    currency: CurrencySchema,
    /** Verified mandatory years; null when the program's length is not verified. */
    durationYears: z.number().int().min(1).max(8).nullable(),
    /** Optional or uncertain years (a placement year, an extension), shown separately. */
    optionalYears: z.number().int().min(0).max(3).default(0),
    /** How many of each period make an academic year, when the institution says so; never guessed. */
    calendar: z
      .object({
        semestersPerYear: z.number().int().positive().nullable().default(null),
        termsPerYear: z.number().int().positive().nullable().default(null),
        quartersPerYear: z.number().int().positive().nullable().default(null),
        monthsPerYear: z.number().int().positive().nullable().default(null),
        creditsPerYear: z.number().int().positive().nullable().default(null),
      })
      .strict()
      .default({ semestersPerYear: null, termsPerYear: null, quartersPerYear: null, monthsPerYear: null, creditsPerYear: null }),
  })
  .strict();
export type CostBasis = z.infer<typeof CostBasisSchema>;
export type CostBasisInput = z.input<typeof CostBasisSchema>;

export interface Ledger {
  basis: CostBasis;
  lines: CostLine[];
  funding: FundingItem[];
  resources: Resource[];
  interaction: InteractionRule | null;
  /** Government programs whose eligibility is confirmed for this student (e.g. 'us_federal'). */
  confirmedEligibility: string[];
  work: WorkScenario | null;
  /** Conversion for resources in another currency and for display: one unit of the ledger currency in the family currency. */
  rate: RateAssumption | null;
}

export const SCENARIO_KINDS = ['base', 'conditional', 'stress'] as const;

export const ScenarioSpecSchema = z
  .object({
    scenarioId: z.string().min(1).max(80),
    kind: z.enum(SCENARIO_KINDS),
    view: z.enum(['annual', 'full_degree']),
    /** Base: only aid for its confirmed period. Conditional: renewable aid assumed renewed, with its requirements stated. */
    renewal: z.enum(['confirmed_only', 'assume_renewed']).default('confirmed_only'),
    /** Include aid that is estimated, not yet offered. */
    includeEstimatedAid: z.boolean().default(false),
    /** Include optional or uncertain years. */
    includeOptionalYears: z.boolean().default(false),
    extraYears: z.number().int().min(0).max(3).default(0),
    /** Annual growth for years after the first, as a decimal percentage string; an assumption, not a forecast. */
    tuitionGrowthPct: z.string().regex(/^-?\d+(\.\d+)?$/).default('0'),
    livingGrowthPct: z.string().regex(/^-?\d+(\.\d+)?$/).default('0'),
    /** Multiplier on travel costs for a stress case. */
    travelMultiplier: z.string().regex(/^\d+(\.\d+)?$/).default('1'),
    /** A renewal that is lost after year 1 (stress). */
    renewalLoss: z.boolean().default(false),
    /** A replacement rate for a currency-movement stress case. */
    rateOverride: RateAssumptionSchema.nullable().default(null),
  })
  .strict();
export type ScenarioSpec = z.infer<typeof ScenarioSpecSchema>;
export type ScenarioSpecInput = z.input<typeof ScenarioSpecSchema>;

// ---------------------------------------------------------------- results

export type LineStatus = 'counted' | 'included_elsewhere' | 'duplicate' | 'missing_amount' | 'missing_period' | 'period_conversion_unknown' | 'whole_program_amount' | 'not_required' | 'currency_mismatch';

export interface LineResult {
  lineId: string;
  component: LineComponent;
  label: string;
  status: LineStatus;
  amount: string | null;
  billed: boolean | null;
  certainty: CostLine['certainty'];
  note: string | null;
}

export type GiftStatus = 'applied' | 'reduced_by_interaction' | 'capped_by_covered_costs' | 'not_offered' | 'estimated_only' | 'withdrawn' | 'eligibility_unknown' | 'renewal_conditional' | 'renewal_not_assumed' | 'renewal_ended' | 'unclassified' | 'currency_mismatch';

export interface GiftResult {
  fundingId: string;
  name: string;
  kind: FundingItem['kind'];
  status: GiftStatus;
  offered: string;
  applied: string;
  note: string | null;
}

export interface YearResult {
  year: number;
  optional: boolean;
  totalCost: string;
  billedCost: string;
  nonBilledCost: string;
  lines: LineResult[];
  giftAid: string;
  gifts: GiftResult[];
  netCost: string;
  confirmedResources: string;
  estimatedResources: string;
  /** Null when no budget is recorded: a gap is never computed against an invented contribution (15T12). */
  gapBeforeFinancing: string | null;
  gapIfEstimatesHold: string | null;
  loans: string;
  conditionalWork: string;
}

export type AffordabilityState = 'supported' | 'conditional' | 'gap_identified' | 'unknown';

export interface ScenarioResult {
  scenarioId: string;
  kind: (typeof SCENARIO_KINDS)[number];
  view: 'annual' | 'full_degree';
  optionRef: string;
  currency: string;
  years: YearResult[];
  totals: {
    totalCost: string;
    giftAid: string;
    netEducationalCost: string;
    confirmedResources: string;
    estimatedResources: string;
    gapBeforeFinancing: string | null;
    gapIfEstimatesHold: string | null;
    optionalLoan: string;
    conditionalWorkIncome: string;
  };
  /** In the family's currency, when a valid rate is available; null otherwise. */
  display: { currency: string; netEducationalCost: string; gapBeforeFinancing: string | null; rate: RateAssumption } | null;
  state: AffordabilityState;
  /** Reasons the state is not "supported", in plain words. */
  conditions: string[];
  unresolved: string[];
  assumptions: string[];
  notes: string[];
  apparentSurplus: string | null;
  financing: Array<{ fundingId: string; name: string; amount: string; note: string }>;
  work: { amount: string; timing: string; status: 'conditional' | 'unresolved'; note: string } | null;
}

// ---------------------------------------------------------------- helpers

const fix = (d: Dec, currency: string) => d.toFixed(currencyExponent(currency));
const dec = (m: Money | string) => new D(typeof m === 'string' ? m : m.amount);
const ZERO = new D(0);
const max0 = (d: Dec) => (d.isNegative() ? ZERO : d);

export const GIFT_KINDS = new Set<FundingItem['kind']>(['institutional_grant', 'external_scholarship', 'government_grant', 'tuition_waiver']);
const OFFERED = new Set<FundingItem['stage']>(['offered', 'accepted', 'confirmed_for_disbursement', 'disbursed', 'revised']);
const ENDED = new Set<FundingItem['stage']>(['withdrawn', 'declined', 'not_selected']);

export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(the|scholarship|award|grant|fund|program|programme|outside|external|private|estimated)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The same award from two sources (a scholarship record and an award-letter
 * line) is one funding item (15T05). Items match on a shared external
 * reference, or on provider, name and amount; the most advanced stage wins.
 */
export function reconcileFunding(items: readonly FundingItem[]): { items: FundingItem[]; merged: Array<{ kept: string; merged: string; reason: string }> } {
  const out: FundingItem[] = [];
  const merged: Array<{ kept: string; merged: string; reason: string }> = [];
  const stageRank = (s: FundingItem['stage']) => FUNDING_STAGES.indexOf(s);
  for (const it of items) {
    const refs = new Set([it.fundingId, ...it.externalRefs]);
    const same = out.find((o) => {
      if ([o.fundingId, ...o.externalRefs].some((r) => refs.has(r))) return true;
      // An outside award listed on a college's letter names the college as the sender, so its provider is not compared.
      const providerMatches = it.kind === 'external_scholarship' || normName(o.provider) === normName(it.provider);
      return o.kind === it.kind && normName(o.name) === normName(it.name) && providerMatches && o.amount.currency === it.amount.currency && dec(o.amount).equals(dec(it.amount));
    });
    if (!same) {
      out.push({ ...it, externalRefs: [...it.externalRefs] });
      continue;
    }
    const reason = [same.fundingId, ...same.externalRefs].some((r) => refs.has(r)) ? 'shared reference' : 'same provider, name and amount';
    // Keep the record with the more advanced stage; the other becomes a reference of it.
    if (!ENDED.has(it.stage) && stageRank(it.stage) > stageRank(same.stage)) {
      const keep = { ...it, externalRefs: [...new Set([...it.externalRefs, same.fundingId, ...same.externalRefs])] };
      out[out.indexOf(same)] = keep;
      merged.push({ kept: keep.fundingId, merged: same.fundingId, reason });
    } else {
      same.externalRefs = [...new Set([...same.externalRefs, it.fundingId, ...it.externalRefs])];
      merged.push({ kept: same.fundingId, merged: it.fundingId, reason });
    }
  }
  return { items: out, merged };
}

/** A rate is usable only in the direction the ledger needs: one unit of the ledger currency in the family currency (15T10). */
export function checkRate(rate: RateAssumption, ledgerCurrency: string, familyCurrency: string, reference: RateAssumption | null): { ok: true } | { ok: false; problem: 'direction_mismatch' | 'looks_inverted' | 'wrong_pair'; message: string } {
  if (rate.from === familyCurrency && rate.to === ledgerCurrency && ledgerCurrency !== familyCurrency) {
    return { ok: false, problem: 'direction_mismatch', message: `The rate is stated as 1 ${rate.from} = ${rate.rate} ${rate.to}, but the costs are in ${ledgerCurrency}. It needs to say how many ${familyCurrency} one ${ledgerCurrency} is worth; it was not flipped automatically.` };
  }
  if (rate.from !== ledgerCurrency || rate.to !== familyCurrency) return { ok: false, problem: 'wrong_pair', message: `The rate is for ${rate.from} to ${rate.to}, not ${ledgerCurrency} to ${familyCurrency}.` };
  if (reference && reference.from === ledgerCurrency && reference.to === familyCurrency) {
    const r = dec(rate.rate);
    const ref = dec(reference.rate);
    if (!ref.isZero() && !r.isZero()) {
      const inverse = new D(1).div(ref);
      const nearInverse = r.minus(inverse).abs().div(inverse).lessThan('0.05');
      const farFromRef = r.minus(ref).abs().div(ref).greaterThan('0.2');
      if (nearInverse && farFromRef) return { ok: false, problem: 'looks_inverted', message: `1 ${ledgerCurrency} = ${rate.rate} ${familyCurrency} is close to the inverse of the reference rate (${reference.rate} on ${reference.asOf}); it looks reversed. Please check which way round it is.` };
    }
  }
  return { ok: true };
}

function periodFactor(period: LinePeriod, cal: CostBasis['calendar']): Dec | null {
  switch (period) {
    case 'academic_year':
      return new D(1);
    case 'semester':
      return cal.semestersPerYear ? new D(cal.semestersPerYear) : null;
    case 'term':
      return cal.termsPerYear ? new D(cal.termsPerYear) : null;
    case 'quarter':
      return cal.quartersPerYear ? new D(cal.quartersPerYear) : null;
    case 'month':
      return cal.monthsPerYear ? new D(cal.monthsPerYear) : null;
    case 'credit':
      return cal.creditsPerYear ? new D(cal.creditsPerYear) : null;
    default:
      return null;
  }
}

interface LinePlan {
  line: CostLine;
  status: LineStatus;
  /** Annual amount at year 1 prices, for every-year lines. */
  annual: Dec | null;
  /** One-time amount, counted in year 1. */
  once: Dec | null;
  note: string | null;
}

/** Decide once, for all years, which lines count and how (duplicates, inclusions, periods). */
function planLines(basis: CostBasis, lines: readonly CostLine[]): LinePlan[] {
  const cur = basis.currency;
  const included = new Set<LineComponent>();
  for (const l of lines) if (l.amount !== null && l.period !== null) for (const c of l.includes) if (c !== l.component) included.add(c);
  // Among lines for the same component, the most authoritative is used and the rest are duplicates.
  const best = new Map<LineComponent, CostLine>();
  for (const l of lines) {
    if (l.component === 'other') continue;
    const b = best.get(l.component);
    const usable = (x: CostLine) => (x.amount !== null && x.period !== null ? 1 : 0);
    if (!b || usable(l) > usable(b) || (usable(l) === usable(b) && CERTAINTY_RANK[l.certainty] > CERTAINTY_RANK[b.certainty])) best.set(l.component, l);
  }
  return lines.map((line): LinePlan => {
    const base = { line, annual: null, once: null };
    if (!line.required) return { ...base, status: 'not_required', note: 'Optional; not in the base total.' };
    if (line.component !== 'other' && best.get(line.component) !== line) return { ...base, status: 'duplicate', note: `Another ${line.component.replace(/_/g, ' ')} line is used instead.` };
    if (included.has(line.component)) return { ...base, status: 'included_elsewhere', note: 'Already included in a published total; not added again.' };
    if (line.amount === null) return { ...base, status: 'missing_amount', note: 'The amount is not known yet; it is not treated as zero.' };
    if (line.amount.currency !== cur) return { ...base, status: 'currency_mismatch', note: `The amount is in ${line.amount.currency}, not ${cur}.` };
    if (line.period === null) return { ...base, status: 'missing_period', note: 'The source does not say which period this amount covers, so no confident total can include it.' };
    if (line.period === 'one_time') return { ...base, once: dec(line.amount), status: 'counted', note: null };
    if (line.period === 'program_total') return { ...base, status: 'whole_program_amount', note: 'A whole-program amount is not split into years without the program’s own schedule.' };
    const f = periodFactor(line.period, basis.calendar);
    if (!f) return { ...base, status: 'period_conversion_unknown', note: `The number of ${line.period}s in an academic year is not confirmed.` };
    return { ...base, annual: dec(line.amount).times(f), status: 'counted', note: line.period === 'academic_year' ? null : `${line.period} amount × ${f.toString()} per academic year` };
  });
}

function giftStatusFor(item: FundingItem, year: number, spec: ScenarioSpec, ledger: Ledger): { status: GiftStatus; amount: Dec; note: string | null } {
  const zero = { amount: ZERO };
  if (!GIFT_KINDS.has(item.kind)) return { ...zero, status: 'unclassified', note: 'Not yet classified as a grant, loan or work; please confirm what it is.' };
  if (ENDED.has(item.stage)) return { ...zero, status: 'withdrawn', note: `This award is ${item.stage.replace(/_/g, ' ')}.` };
  if (item.stage === 'estimated') {
    if (!spec.includeEstimatedAid) return { ...zero, status: 'estimated_only', note: 'An estimate, not an offer; shown only in the conditional scenario.' };
  } else if (!OFFERED.has(item.stage)) return { ...zero, status: 'not_offered', note: `Not offered yet (${item.stage.replace(/_/g, ' ')}).` };
  if (item.amount.currency !== ledger.basis.currency) return { ...zero, status: 'currency_mismatch', note: `The award is in ${item.amount.currency}; the costs are in ${ledger.basis.currency}.` };
  if (item.eligibilityProgram && !ledger.confirmedEligibility.includes(item.eligibilityProgram)) {
    return { ...zero, status: 'eligibility_unknown', note: `Eligibility for ${item.eligibilityProgram.replace(/_/g, ' ')} aid is not confirmed; admission alone does not establish it.` };
  }
  const years = (ledger.basis.durationYears ?? 1) + spec.extraYears;
  if (item.period === 'full_degree') return { amount: dec(item.amount).div(years), status: 'applied', note: `A whole-degree award spread evenly over ${years} years for comparison; the provider’s schedule may differ.` };
  if (item.period === 'one_time' || item.period === 'one_term') return year === 1 ? { amount: dec(item.amount), status: 'applied', note: null } : { ...zero, status: 'renewal_ended', note: 'A one-time award.' };
  if (year === 1) return { amount: dec(item.amount), status: 'applied', note: null };
  // Later years of an annual award (15T09).
  if (!item.renewal?.renewable) return { ...zero, status: 'renewal_ended', note: 'The offer covers one academic year and states no renewal.' };
  if (item.renewal.maxYears !== null && year > item.renewal.maxYears) return { ...zero, status: 'renewal_ended', note: `Renewable for at most ${item.renewal.maxYears} years.` };
  const req = item.renewal.conditions.length > 0 ? item.renewal.conditions.join('; ') : 'renewal terms not stated';
  if (spec.renewalLoss || spec.renewal === 'confirmed_only') return { ...zero, status: 'renewal_not_assumed', note: `Renewal is conditional (${req}); not counted in this scenario.` };
  return { amount: dec(item.amount), status: 'renewal_conditional', note: `Counted only if renewed: ${req}.` };
}

/** Sum of the year's cost lines that a restricted award may pay for. */
function coveredTotal(covered: readonly string[] | null, yearLines: ReadonlyArray<{ component: LineComponent; amount: Dec }>): Dec | null {
  if (covered === null) return null;
  const map: Record<string, LineComponent[]> = { tuition: ['tuition'], fees: ['mandatory_fees'], housing: ['housing'], meals: ['meals'], materials: ['books_supplies'], equipment: ['equipment'], insurance: ['health_insurance'], travel: ['travel_home', 'transport'], local_transport: ['transport'] };
  const comps = new Set<LineComponent>(covered.flatMap((c) => map[c] ?? ((LINE_COMPONENTS as readonly string[]).includes(c) ? [c as LineComponent] : [])));
  return yearLines.filter((l) => comps.has(l.component)).reduce((a, l) => a.plus(l.amount), ZERO);
}

// ---------------------------------------------------------------- the calculation

/**
 * Compute one scenario. Years are calculated separately; totals are the sums
 * at full precision, rounded only for display (15 "Multi year and currency
 * scenarios").
 */
export function computeScenario(ledger: Ledger, specInput: ScenarioSpecInput): ScenarioResult {
  const spec = ScenarioSpecSchema.parse(specInput);
  const cur = ledger.basis.currency;
  const plans = planLines(ledger.basis, ledger.lines);
  const unresolved: string[] = [];
  const assumptions: string[] = [];
  const notes: string[] = [];
  const conditions: string[] = [];

  const mandatory = ledger.basis.durationYears;
  if (spec.view === 'full_degree' && mandatory === null) unresolved.push('The program’s length is not verified, so a whole-degree total cannot be calculated.');
  const optional = spec.includeOptionalYears ? ledger.basis.optionalYears : 0;
  const yearsCount = spec.view === 'annual' ? 1 : (mandatory ?? 1) + spec.extraYears + optional;
  if (spec.extraYears > 0) assumptions.push(`${spec.extraYears} additional year${spec.extraYears === 1 ? '' : 's'} of study.`);
  if (optional > 0) assumptions.push(`${optional} optional year${optional === 1 ? '' : 's'} included (not required by the program).`);
  const tg = new D(spec.tuitionGrowthPct).div(100);
  const lg = new D(spec.livingGrowthPct).div(100);
  if (!tg.isZero() || !lg.isZero()) assumptions.push(`Costs after the first year change by ${spec.tuitionGrowthPct}% a year (tuition and fees) and ${spec.livingGrowthPct}% a year (living costs). This is a scenario assumption, not a forecast.`);
  const travelX = new D(spec.travelMultiplier);
  if (!travelX.equals(1)) assumptions.push(`Travel costs × ${spec.travelMultiplier}.`);

  for (const p of plans) {
    if (!p.line.required) continue;
    if (p.status === 'missing_amount' || p.status === 'missing_period' || p.status === 'period_conversion_unknown' || p.status === 'currency_mismatch') unresolved.push(`${p.line.label}: ${p.note}`);
    if (p.status === 'whole_program_amount' && spec.view === 'annual') unresolved.push(`${p.line.label}: ${p.note}`);
    if (p.status === 'counted' && p.line.certainty === 'historical') conditions.push(`${p.line.label} uses an earlier published figure; the current one has not been found.`);
  }

  // Resources in the ledger currency (a rate converts others; without one they stay unresolved).
  const rate = spec.rateOverride ?? ledger.rate;
  const toLedger = (m: Money): Dec | null => {
    if (m.currency === cur) return dec(m);
    if (rate && rate.from === cur && rate.to === m.currency) return dec(m).div(rate.rate);
    return null;
  };
  const resourceYear = (r: Resource, which: 'min' | 'max'): Dec | null => {
    const m = which === 'min' ? r.min ?? r.max : r.max;
    const v = toLedger(m);
    if (v === null) return null;
    if (r.period === 'annual') return v;
    const years = spec.view === 'annual' ? (mandatory ?? null) : yearsCount;
    return years ? v.div(years) : null;
  };
  for (const r of ledger.resources) {
    if (toLedger(r.max) === null) unresolved.push(`${r.label} is in ${r.max.currency} and no usable exchange rate to ${cur} is available, so it cannot be compared with the costs.`);
    if (r.period === 'total_degree') assumptions.push(`${r.label} is a whole-degree amount, compared as an equal share per year.`);
    if (!r.confirmed) conditions.push(`${r.label} is an estimate, not a confirmed commitment.`);
    if (r.includesTravelAndPersonal === false) notes.push(`${r.label} is not meant to cover travel and personal costs; those still need a source.`);
  }
  const hasResources = ledger.resources.length > 0;
  if (!hasResources) unresolved.push('No family or personal budget is recorded, so the gap cannot be calculated. Costs and aid are still shown.');

  // Interaction between outside awards and institutional grants (15T06).
  const outside = ledger.funding.filter((f) => f.kind === 'external_scholarship');
  const institutional = ledger.funding.filter((f) => f.kind === 'institutional_grant');

  const years: YearResult[] = [];
  let tCost = ZERO;
  let tGift = ZERO;
  let tConf = ZERO;
  let tEst = ZERO;
  let tLoan = ZERO;
  let tWork = ZERO;
  for (let y = 1; y <= yearsCount; y += 1) {
    const isOptional = spec.view === 'full_degree' && mandatory !== null && y > mandatory + spec.extraYears;
    const lines: LineResult[] = [];
    const counted: Array<{ component: LineComponent; amount: Dec; billed: boolean | null }> = [];
    for (const p of plans) {
      let amount: Dec | null = null;
      if (p.status === 'counted') {
        if (p.annual) {
          const g = TUITION_LIKE.has(p.line.component) ? tg : lg;
          amount = p.annual.times(new D(1).plus(g).pow(y - 1));
          if (p.line.component === 'travel_home' || p.line.component === 'transport') amount = amount.times(travelX);
        } else if (p.once) amount = y === 1 ? p.once : null;
      } else if (p.status === 'whole_program_amount' && spec.view === 'full_degree' && y === 1) {
        amount = dec(p.line.amount!);
      }
      if (amount !== null) counted.push({ component: p.line.component, amount, billed: p.line.billed });
      lines.push({ lineId: p.line.lineId, component: p.line.component, label: p.line.label, status: p.status, amount: amount === null ? null : fix(amount, cur), billed: p.line.billed, certainty: p.line.certainty, note: p.once && y > 1 ? 'One-time; counted in the first year.' : p.note });
    }
    const total = counted.reduce((a, l) => a.plus(l.amount), ZERO);
    const billed = counted.filter((l) => l.billed === true).reduce((a, l) => a.plus(l.amount), ZERO);

    // Gift aid, before interaction.
    const gifts = new Map<string, { status: GiftStatus; amount: Dec; note: string | null }>();
    for (const f of ledger.funding) {
      if (!GIFT_KINDS.has(f.kind) && f.kind !== 'other') continue;
      const g = giftStatusFor(f, y, spec, ledger);
      const cap = GIFT_KINDS.has(f.kind) ? coveredTotal(f.coveredCosts, counted) : null;
      if (cap !== null && g.amount.greaterThan(cap)) gifts.set(f.fundingId, { status: 'capped_by_covered_costs', amount: cap, note: `May pay only for ${f.coveredCosts!.join(', ')}; the rest cannot be applied to other costs.` });
      else gifts.set(f.fundingId, g);
    }
    const outsideSum = outside.reduce((a, f) => a.plus(gifts.get(f.fundingId)?.amount ?? ZERO), ZERO);
    const instApplied = institutional.filter((f) => (gifts.get(f.fundingId)?.amount ?? ZERO).greaterThan(0));
    if (outsideSum.greaterThan(0) && instApplied.length > 0) {
      const rule = ledger.interaction;
      let reduction: Dec | null = null;
      if (rule?.rule === 'no_displacement') reduction = ZERO;
      else if (rule?.rule === 'reduce_institutional_grant') reduction = outsideSum;
      else if (rule?.rule === 'reduce_student_contribution_first') reduction = rule.studentContributionFirst ? max0(outsideSum.minus(toLedger(rule.studentContributionFirst) ?? ZERO)) : null;
      if (reduction === null) {
        // Without a verified rule, the outside award is assumed to replace institutional aid: no improvement is promised.
        reduction = outsideSum;
        if (y === 1) conditions.push(`How outside scholarships affect ${instApplied.map((f) => f.name).join(', ')} is not verified; the scholarship could improve the result by up to ${fix(outsideSum, cur)} ${cur}, but none of that is counted until the aid office confirms.`);
      }
      // Need-based institutional aid is reduced first.
      let left = reduction;
      for (const f of [...instApplied].sort((a, b) => (a.basis === 'need_based' ? 0 : 1) - (b.basis === 'need_based' ? 0 : 1))) {
        if (left.lessThanOrEqualTo(0)) break;
        const g = gifts.get(f.fundingId)!;
        const cut = D.min(left, g.amount);
        gifts.set(f.fundingId, { status: 'reduced_by_interaction', amount: g.amount.minus(cut), note: `Reduced by ${fix(cut, cur)} ${cur} because of outside awards (${ledger.interaction ? ledger.interaction.rule.replace(/_/g, ' ') : 'rule not verified'}).` });
        left = left.minus(cut);
      }
    }
    const giftResults: GiftResult[] = [];
    let gift = ZERO;
    for (const f of ledger.funding) {
      const g = gifts.get(f.fundingId);
      if (!g) continue;
      gift = gift.plus(g.amount);
      giftResults.push({ fundingId: f.fundingId, name: f.name, kind: f.kind, status: g.status, offered: fix(dec(f.amount), f.amount.currency), applied: fix(g.amount, cur), note: g.note });
      if (g.status === 'renewal_conditional') conditions.push(`${f.name} continues only if renewed.`);
      if (g.status === 'eligibility_unknown' && y === 1) notes.push(g.note!);
      if (g.status === 'unclassified' && y === 1) unresolved.push(`${f.name}: ${g.note}`);
      if (g.status === 'estimated_only' && y === 1) notes.push(`${f.name} is an estimate and is not counted in this scenario.`);
      if (g.status === 'renewal_conditional' && y === 2) assumptions.push(`${f.name} is assumed to be renewed each year.`);
    }
    const net = total.minus(gift);
    let conf = ZERO;
    let est = ZERO;
    for (const r of ledger.resources) {
      const lo = resourceYear(r, 'min');
      const hi = resourceYear(r, 'max');
      if (lo === null || hi === null) continue;
      if (r.confirmed) conf = conf.plus(lo);
      else est = est.plus(lo);
    }
    const loans = ledger.funding.filter((f) => f.kind === 'loan' && !ENDED.has(f.stage) && f.amount.currency === cur && (y === 1 || f.renewal?.renewable)).reduce((a, f) => a.plus(dec(f.amount)), ZERO);
    const work = workIncome(ledger);
    years.push({
      year: y,
      optional: isOptional,
      totalCost: fix(total, cur),
      billedCost: fix(billed, cur),
      nonBilledCost: fix(total.minus(billed), cur),
      lines,
      giftAid: fix(gift, cur),
      gifts: giftResults,
      netCost: fix(net, cur),
      confirmedResources: fix(conf, cur),
      estimatedResources: fix(est, cur),
      gapBeforeFinancing: hasResources ? fix(net.minus(conf), cur) : null,
      gapIfEstimatesHold: hasResources ? fix(net.minus(conf).minus(est), cur) : null,
      loans: fix(loans, cur),
      conditionalWork: fix(work.amount, cur),
    });
    tCost = tCost.plus(total);
    tGift = tGift.plus(gift);
    tConf = tConf.plus(conf);
    tEst = tEst.plus(est);
    tLoan = tLoan.plus(loans);
    tWork = tWork.plus(work.amount);
  }

  const netTotal = tCost.minus(tGift);
  const gap = netTotal.minus(tConf);
  const gapEst = gap.minus(tEst);
  const financing = ledger.funding
    .filter((f) => f.kind === 'loan' && !ENDED.has(f.stage))
    .map((f) => ({ fundingId: f.fundingId, name: f.name, amount: fix(dec(f.amount), f.amount.currency), note: 'Borrowed money that must be repaid; it pays part of the cost but does not reduce it.' }));
  const w = ledger.work ?? ledger.funding.some((f) => f.kind === 'work') ? workSummary(ledger, fix(tWork, cur)) : null;

  let state: AffordabilityState;
  if (unresolved.length > 0) state = 'unknown';
  else if (gap.greaterThan(0)) state = gapEst.lessThanOrEqualTo(0) ? 'conditional' : 'gap_identified';
  else state = conditions.length > 0 ? 'conditional' : 'supported';
  if (state === 'conditional' && gap.greaterThan(0)) conditions.push('The gap closes only if the estimated amounts are confirmed.');

  let display: ScenarioResult['display'] = null;
  if (rate && rate.from === cur && rate.to !== cur) {
    display = { currency: rate.to, netEducationalCost: new D(netTotal).times(rate.rate).toFixed(currencyExponent(rate.to)), gapBeforeFinancing: hasResources ? gap.times(rate.rate).toFixed(currencyExponent(rate.to)) : null, rate };
    assumptions.push(`Converted at 1 ${rate.from} = ${rate.rate} ${rate.to} (${rate.source === 'user_scenario' ? 'your scenario rate' : 'reference rate'} as of ${rate.asOf}).`);
  }
  const apparentSurplus = hasResources && gap.isNegative() && state !== 'unknown' ? fix(gap.negated(), cur) : null;
  if (apparentSurplus) notes.push(`Resources exceed the net cost by ${apparentSurplus} ${cur}. Some awards can only pay for particular costs, so this is not money free to spend; check each award’s conditions.`);

  return {
    scenarioId: spec.scenarioId,
    kind: spec.kind,
    view: spec.view,
    optionRef: ledger.basis.optionRef,
    currency: cur,
    years,
    totals: {
      totalCost: fix(tCost, cur),
      giftAid: fix(tGift, cur),
      netEducationalCost: fix(netTotal, cur),
      confirmedResources: fix(tConf, cur),
      estimatedResources: fix(tEst, cur),
      gapBeforeFinancing: hasResources ? fix(gap, cur) : null,
      gapIfEstimatesHold: hasResources ? fix(gapEst, cur) : null,
      optionalLoan: fix(tLoan, cur),
      conditionalWorkIncome: fix(tWork, cur),
    },
    display,
    state,
    conditions: [...new Set(conditions)],
    unresolved: [...new Set(unresolved)],
    assumptions: [...new Set(assumptions)],
    notes: [...new Set(notes)],
    apparentSurplus,
    financing,
    work: w,
  };
}

/** Earnings count only in a verified, student-chosen work scenario within any legal limit. */
function workIncome(ledger: Ledger): { amount: Dec } {
  const s = ledger.work;
  if (!s || s.eligibility !== 'verified' || s.hourlyRate.currency !== ledger.basis.currency) return { amount: ZERO };
  const withinLimits = s.hoursPerWeek <= (s.maxHoursPerWeekAllowed ?? Infinity) && s.hoursPerWeek <= (s.studentChosenMaxHours ?? Infinity);
  return { amount: withinLimits ? dec(s.hourlyRate).times(s.hoursPerWeek).times(s.weeks) : ZERO };
}

/**
 * Work is income earned over time, not a discount: a job must be found and the
 * hours worked, and eligibility to work is never assumed (15T02).
 */
function workSummary(ledger: Ledger, amount: string): NonNullable<ScenarioResult['work']> {
  const s = ledger.work;
  const allocation = ledger.funding.filter((f) => f.kind === 'work').map((f) => `${f.name} (${f.amount.amount} ${f.amount.currency} maximum)`);
  const timing = s?.firstPayDate ? `Paid as hours are worked, starting no earlier than ${s.firstPayDate}; not available for bills due before then.` : 'Paid as hours are worked during the year, after a job is found; not available up front.';
  const none = (0).toFixed(currencyExponent(ledger.basis.currency));
  if (!s) return { amount: none, timing, status: 'unresolved', note: `${allocation.join('; ')} is an allocation you may earn by working, not a grant. No earnings are counted until you choose hours and your eligibility to work is confirmed.` };
  if (s.eligibility !== 'verified') return { amount: none, timing, status: 'unresolved', note: s.eligibility === 'not_permitted' ? 'Your status does not permit this work, so no earnings are counted.' : 'Your eligibility to work is not confirmed, so no earnings are counted.' };
  const over = (s.maxHoursPerWeekAllowed !== null && s.hoursPerWeek > s.maxHoursPerWeekAllowed) || (s.studentChosenMaxHours !== null && s.hoursPerWeek > s.studentChosenMaxHours);
  if (over) return { amount: none, timing, status: 'unresolved', note: `${s.hoursPerWeek} hours a week is more than ${s.maxHoursPerWeekAllowed !== null && s.hoursPerWeek > s.maxHoursPerWeekAllowed ? 'your status allows' : 'you chose to work alongside study'}; the earnings scenario is unresolved.` };
  return { amount, timing, status: 'conditional', note: `About ${amount} ${ledger.basis.currency} from ${s.hoursPerWeek} hours a week for ${s.weeks} weeks, if a job is found. Shown separately; it does not reduce the cost.` };
}

// ---------------------------------------------------------------- cash flow

export interface CashEvent {
  date: CalendarDate;
  amount: string;
  direction: 'out' | 'in';
  label: string;
}

export interface CashFlow {
  events: CashEvent[];
  /** The largest shortfall before later money arrives, and when it happens (15T08). */
  upfrontShortfall: { amount: string; on: CalendarDate; coveredOn: CalendarDate | null } | null;
  timingUnknown: string[];
}

/**
 * First-year cash timing: bills, deposits and travel against money as it
 * actually arrives. A shortfall in the month the student must pay is shown
 * even when the annual totals balance. Payments due on a day are taken before
 * money that arrives the same day.
 */
export function cashFlow(ledger: Ledger): CashFlow {
  const cur = ledger.basis.currency;
  const events: Array<{ date: CalendarDate; amount: Dec; direction: 'out' | 'in'; label: string }> = [];
  const timingUnknown: string[] = [];
  const plans = planLines(ledger.basis, ledger.lines);
  for (const p of plans) {
    if (p.status !== 'counted' || !p.line.amount) continue;
    if (p.line.dueDate) events.push({ date: p.line.dueDate, amount: dec(p.line.amount), direction: 'out', label: p.line.label });
    else if (p.line.billed !== false) timingUnknown.push(`${p.line.label}: due date not known`);
  }
  for (const r of ledger.resources) {
    if (!r.confirmed) continue;
    const m = r.min ?? r.max;
    if (m.currency !== cur) continue;
    if (r.availableFrom) events.push({ date: r.availableFrom, amount: dec(m), direction: 'in', label: r.label });
    else timingUnknown.push(`${r.label}: when it is available is not known`);
  }
  for (const f of ledger.funding) {
    if (!GIFT_KINDS.has(f.kind) || !OFFERED.has(f.stage) || f.amount.currency !== cur) continue;
    if (f.eligibilityProgram && !ledger.confirmedEligibility.includes(f.eligibilityProgram)) continue;
    if (f.disbursesOn) events.push({ date: f.disbursesOn, amount: dec(f.amount), direction: 'in', label: `${f.name} disbursement` });
    else timingUnknown.push(`${f.name}: disbursement date not known`);
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.direction === b.direction ? 0 : a.direction === 'out' ? -1 : 1));
  let bal = ZERO;
  let worst: { amount: Dec; on: CalendarDate } | null = null;
  let coveredOn: CalendarDate | null = null;
  for (const e of events) {
    bal = e.direction === 'in' ? bal.plus(e.amount) : bal.minus(e.amount);
    if (bal.isNegative() && (worst === null || bal.negated().greaterThan(worst.amount))) {
      worst = { amount: bal.negated(), on: e.date };
      coveredOn = null;
    }
    if (worst && !bal.isNegative() && coveredOn === null && e.date >= worst.on) coveredOn = e.date;
  }
  return {
    events: events.map((e) => ({ date: e.date, amount: fix(e.amount, cur), direction: e.direction, label: e.label })),
    upfrontShortfall: worst ? { amount: fix(worst.amount, cur), on: worst.on, coveredOn } : null,
    timingUnknown,
  };
}
