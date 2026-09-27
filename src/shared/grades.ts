import { z } from 'zod';

/**
 * Grades are stored exactly as issued. A value of 18.5 on a 20-point scale is
 * not a 3.7 GPA; there is deliberately no cross-scale conversion function in
 * this codebase (spec 03 "Academic representation rules", 03T11).
 *
 * A scale is a reference definition used only to validate ranges and to compare
 * two values on the *same* scale. Institution thresholds belong to rule packages.
 */

export const GRADE_RESULT_STATUSES = [
  'predicted',
  'provisional',
  'final',
  'remarked',
  'resit',
  'transfer_credit',
  'in_progress',
  'withdrawn',
  'incomplete',
  'exempt',
  'unknown',
] as const;
export type GradeResultStatus = (typeof GRADE_RESULT_STATUSES)[number];
export const GradeResultStatusSchema = z.enum(GRADE_RESULT_STATUSES);

/** Statuses that represent an achieved (issued) result rather than a forecast or placeholder. */
export const ACHIEVED_STATUSES: ReadonlySet<GradeResultStatus> = new Set(['final', 'remarked', 'resit', 'transfer_credit']);
/** Statuses that represent a future or forecast result. */
export const FUTURE_STATUSES: ReadonlySet<GradeResultStatus> = new Set(['predicted', 'provisional', 'in_progress']);

export const GradingScaleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['numeric', 'ordinal', 'pass_fail', 'percentage']),
    /** Numeric scales: inclusive bounds. */
    min: z.number().optional(),
    max: z.number().optional(),
    /** Smallest meaningful increment on numeric scales, if known (e.g. 1 or 0.5). */
    step: z.number().positive().optional(),
    direction: z.enum(['higher_is_better', 'lower_is_better']),
    /** Ordinal scales: values from best to worst, exactly as printed. */
    ordinalValues: z.array(z.string()).optional(),
    /** Documented pass threshold, if one exists for the scale in general. */
    passThreshold: z.union([z.number(), z.string()]).optional(),
    /** Whether the scale's definition came from a reference or from a specific document legend. */
    origin: z.enum(['reference', 'document_legend', 'school_profile', 'institution_source']),
    note: z.string().optional(),
  })
  .strict();
export type GradingScale = z.infer<typeof GradingScaleSchema>;

/**
 * Reference scales. These describe the general structure of well-known scales
 * so that out-of-range values can be flagged; they are not institution rules.
 */
export const REFERENCE_SCALES: Readonly<Record<string, GradingScale>> = {
  ib_subject_1_7: {
    id: 'ib_subject_1_7',
    name: 'IB Diploma Programme subject grade (1-7)',
    kind: 'numeric',
    min: 1,
    max: 7,
    step: 1,
    direction: 'higher_is_better',
    origin: 'reference',
    note: 'Subject grades 1-7; predicted grades must stay labelled predicted until results are issued.',
  },
  ib_diploma_points_0_45: {
    id: 'ib_diploma_points_0_45',
    name: 'IB Diploma total points (0-45)',
    kind: 'numeric',
    min: 0,
    max: 45,
    step: 1,
    direction: 'higher_is_better',
    origin: 'reference',
  },
  a_level_letter: {
    id: 'a_level_letter',
    name: 'A level grade (A* to E, U)',
    kind: 'ordinal',
    ordinalValues: ['A*', 'A', 'B', 'C', 'D', 'E', 'U'],
    direction: 'higher_is_better',
    passThreshold: 'E',
    origin: 'reference',
  },
  as_level_letter: {
    id: 'as_level_letter',
    name: 'AS level grade (A to E, U)',
    kind: 'ordinal',
    ordinalValues: ['A', 'B', 'C', 'D', 'E', 'U'],
    direction: 'higher_is_better',
    passThreshold: 'E',
    origin: 'reference',
  },
  percentage_0_100: {
    id: 'percentage_0_100',
    name: 'Percentage mark (0-100)',
    kind: 'percentage',
    min: 0,
    max: 100,
    direction: 'higher_is_better',
    origin: 'reference',
    note: 'A percentage label alone does not establish that the value is a mark (it could be attendance or a percentile).',
  },
  twenty_point_0_20: {
    id: 'twenty_point_0_20',
    name: 'Twenty-point scale (0-20)',
    kind: 'numeric',
    min: 0,
    max: 20,
    direction: 'higher_is_better',
    origin: 'reference',
    note: 'Used in several national systems; the pass threshold and rounding vary by system and must come from the document or school context.',
  },
  us_letter_plus_minus: {
    id: 'us_letter_plus_minus',
    name: 'US letter grade (A+ to F)',
    kind: 'ordinal',
    ordinalValues: ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'],
    direction: 'higher_is_better',
    origin: 'reference',
    note: 'Schools differ in which letters they use and how they weight them.',
  },
  pass_fail: {
    id: 'pass_fail',
    name: 'Pass / fail',
    kind: 'pass_fail',
    ordinalValues: ['Pass', 'Fail'],
    direction: 'higher_is_better',
    origin: 'reference',
  },
};

export const GradeValueSchema = z
  .object({
    /** Exactly as printed or reported, e.g. "18,5", "A*", "6", "-". */
    original: z.string(),
    /** Reference to a known scale, or null when the scale is not established. */
    scaleRef: z.string().nullable(),
    status: GradeResultStatusSchema,
    /** Weighting label as printed (e.g. "weighted", "honors"), if any. */
    weighting: z.string().nullable().default(null),
  })
  .strict();
export type GradeValue = z.infer<typeof GradeValueSchema>;

export type GradeParse =
  | { ok: true; kind: 'numeric'; value: number }
  | { ok: true; kind: 'ordinal'; rank: number; label: string }
  | { ok: false; reason: 'scale_unknown' | 'unparseable' | 'out_of_range' | 'ambiguous_decimal_separator' | 'symbol_without_legend' };

/** Symbols whose meaning depends on a legend: never zero, never "fail" by default (03R08). */
const LEGEND_DEPENDENT_SYMBOLS = new Set(['-', '–', '—', '*', '', 'N/A', 'n/a', 'NA', '/', 'X', 'x', '?']);

/**
 * Parse a printed numeric string, handling a decimal comma. A value such as
 * "1,234" is ambiguous (thousands separator or decimal comma); on a bounded
 * scale only the interpretation inside the range is accepted, and if both fit
 * the result is ambiguous.
 */
export function parseLocalizedNumber(raw: string, bounds?: { min?: number; max?: number }): number | 'ambiguous' | null {
  const s = raw.trim().replace(/ /g, '');
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const inRange = (n: number): boolean =>
    Number.isFinite(n) && (bounds?.min === undefined || n >= bounds.min) && (bounds?.max === undefined || n <= bounds.max);
  const commaCount = (s.match(/,/g) ?? []).length;
  const dotCount = (s.match(/\./g) ?? []).length;
  if (commaCount === 0 && dotCount <= 1) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (commaCount === 1 && dotCount === 0) {
    const asDecimal = Number(s.replace(',', '.'));
    const asThousands = /^-?\d{1,3},\d{3}$/.test(s) ? Number(s.replace(',', '')) : Number.NaN;
    const decimalOk = inRange(asDecimal);
    const thousandsOk = inRange(asThousands);
    if (decimalOk && thousandsOk) return 'ambiguous';
    if (decimalOk) return asDecimal;
    if (thousandsOk) return asThousands;
    return Number.isFinite(asDecimal) ? asDecimal : null;
  }
  // Mixed separators, e.g. "1.234,5" (European) or "1,234.5" (US).
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (commaCount >= 1 && dotCount >= 1) {
    const normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse a grade against a known scale. Returns a reason instead of guessing. */
export function parseGrade(grade: GradeValue, scales: Readonly<Record<string, GradingScale>> = REFERENCE_SCALES): GradeParse {
  const raw = grade.original.trim();
  const scale = grade.scaleRef === null ? undefined : scales[grade.scaleRef];
  if (scale && (scale.kind === 'ordinal' || scale.kind === 'pass_fail')) {
    const values = scale.ordinalValues ?? [];
    const idx = values.findIndex((v) => v.toLowerCase() === raw.toLowerCase());
    if (idx >= 0) return { ok: true, kind: 'ordinal', rank: idx, label: values[idx]! };
  }
  if (LEGEND_DEPENDENT_SYMBOLS.has(raw)) return { ok: false, reason: 'symbol_without_legend' };
  if (!scale) return { ok: false, reason: 'scale_unknown' };
  if (scale.kind === 'ordinal' || scale.kind === 'pass_fail') return { ok: false, reason: 'unparseable' };
  const bounds: { min?: number; max?: number } = {};
  if (scale.min !== undefined) bounds.min = scale.min;
  if (scale.max !== undefined) bounds.max = scale.max;
  const n = parseLocalizedNumber(raw.replace(/%$/, ''), bounds);
  if (n === 'ambiguous') return { ok: false, reason: 'ambiguous_decimal_separator' };
  if (n === null) return { ok: false, reason: 'unparseable' };
  if ((scale.min !== undefined && n < scale.min) || (scale.max !== undefined && n > scale.max)) {
    return { ok: false, reason: 'out_of_range' };
  }
  return { ok: true, kind: 'numeric', value: n };
}

export type GradeComparison = -1 | 0 | 1 | 'incomparable';

/**
 * Compare two grades on the same scale: 1 when `a` is better than `b`.
 * Grades on different scales are always incomparable.
 */
export function compareGrades(
  a: GradeValue,
  b: GradeValue,
  scales: Readonly<Record<string, GradingScale>> = REFERENCE_SCALES,
): GradeComparison {
  if (a.scaleRef === null || b.scaleRef === null || a.scaleRef !== b.scaleRef) return 'incomparable';
  const scale = scales[a.scaleRef];
  if (!scale) return 'incomparable';
  const pa = parseGrade(a, scales);
  const pb = parseGrade(b, scales);
  if (!pa.ok || !pb.ok) return 'incomparable';
  if (pa.kind === 'numeric' && pb.kind === 'numeric') {
    const raw = pa.value === pb.value ? 0 : pa.value > pb.value ? 1 : -1;
    return (scale.direction === 'higher_is_better' ? raw : -raw) as -1 | 0 | 1;
  }
  if (pa.kind === 'ordinal' && pb.kind === 'ordinal') {
    // ordinalValues are best -> worst, so a lower rank is better.
    if (pa.rank === pb.rank) return 0;
    return pa.rank < pb.rank ? 1 : -1;
  }
  return 'incomparable';
}

/** Does `grade` meet or exceed `threshold` on the same scale? Three-valued. */
export function meetsGradeThreshold(
  grade: GradeValue,
  threshold: { original: string; scaleRef: string },
  scales: Readonly<Record<string, GradingScale>> = REFERENCE_SCALES,
): true | false | 'unknown' {
  const cmp = compareGrades(grade, { original: threshold.original, scaleRef: threshold.scaleRef, status: 'final', weighting: null }, scales);
  if (cmp === 'incomparable') return 'unknown';
  return cmp >= 0;
}

/** Credit or workload value with its unit exactly as the source uses it. Unlike units are never added. */
export const CreditValueSchema = z
  .object({
    original: z.string(),
    unit: z.string().nullable(),
  })
  .strict();
export type CreditValue = z.infer<typeof CreditValueSchema>;
