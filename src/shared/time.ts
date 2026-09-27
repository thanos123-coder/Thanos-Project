import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';

/**
 * Dates with explicit precision.
 *
 * Data dictionary (spec): "Date: ISO date plus precision and timezone when time
 * matters. Invalid shortcut: invented day for a month-only source."
 *
 * A PartialDate is one of `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. The precision is
 * encoded by the form itself, so a month-only source can never silently acquire
 * a day. All comparisons between partial dates are three-valued: when the
 * precision does not allow a definite answer the result is `unknown`.
 */

export type DatePrecision = 'year' | 'month' | 'day';

const PARTIAL_DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

export interface ParsedPartialDate {
  year: number;
  month?: number;
  day?: number;
  precision: DatePrecision;
}

export function parsePartialDate(value: string): ParsedPartialDate | null {
  const m = PARTIAL_DATE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1900 || year > 2200) return null;
  if (m[2] === undefined) return { year, precision: 'year' };
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (m[3] === undefined) return { year, month, precision: 'month' };
  const day = Number(m[3]);
  const dt = DateTime.fromObject({ year, month, day }, { zone: 'UTC' });
  if (!dt.isValid) return null;
  return { year, month, day, precision: 'day' };
}

export const PartialDateSchema = z
  .string()
  .refine((s) => parsePartialDate(s) !== null, { message: 'Expected YYYY, YYYY-MM or YYYY-MM-DD with a valid calendar value' });
export type PartialDate = z.infer<typeof PartialDateSchema>;

/** A full calendar date (day precision), `YYYY-MM-DD`. */
export const CalendarDateSchema = z
  .string()
  .refine((s) => parsePartialDate(s)?.precision === 'day', { message: 'Expected a valid YYYY-MM-DD calendar date' });
export type CalendarDate = z.infer<typeof CalendarDateSchema>;

export function precisionOf(value: PartialDate): DatePrecision {
  const p = parsePartialDate(value);
  if (!p) throw new Error(`Invalid partial date: ${value}`);
  return p.precision;
}

/** Inclusive calendar-date bounds covered by a partial date. */
export function partialDateBounds(value: PartialDate): { start: CalendarDate; end: CalendarDate } {
  const p = parsePartialDate(value);
  if (!p) throw new Error(`Invalid partial date: ${value}`);
  if (p.precision === 'day') return { start: value, end: value };
  if (p.precision === 'month') {
    const start = DateTime.fromObject({ year: p.year, month: p.month!, day: 1 }, { zone: 'UTC' });
    return { start: toCalendarDate(start), end: toCalendarDate(start.endOf('month')) };
  }
  return { start: `${p.year}-01-01`, end: `${p.year}-12-31` };
}

function toCalendarDate(dt: DateTime): CalendarDate {
  const iso = dt.toISODate();
  if (iso === null) throw new Error('Invalid DateTime');
  return iso;
}

function calendar(value: CalendarDate): DateTime {
  const dt = DateTime.fromISO(value, { zone: 'UTC' });
  if (!dt.isValid) throw new Error(`Invalid calendar date: ${value}`);
  return dt;
}

export type TemporalOrder = 'before' | 'after' | 'equal' | 'overlapping';

/**
 * Compare two partial dates. `equal` only when both have the same value and
 * precision; `overlapping` when the precision prevents a definite ordering
 * (e.g. `2027-06` versus `2027-06-15`).
 */
export function comparePartialDates(a: PartialDate, b: PartialDate): TemporalOrder {
  const A = partialDateBounds(a);
  const B = partialDateBounds(b);
  if (A.end < B.start) return 'before';
  if (A.start > B.end) return 'after';
  if (a === b && precisionOf(a) === 'day') return 'equal';
  if (a === b) return 'overlapping';
  return 'overlapping';
}

export type TriState = true | false | 'unknown';

/** Is `a` definitely on or before `b`? Three-valued. */
export function isOnOrBefore(a: PartialDate, b: PartialDate): TriState {
  const A = partialDateBounds(a);
  const B = partialDateBounds(b);
  if (A.end <= B.start) return true;
  if (A.start > B.end) return false;
  return 'unknown';
}

/** Is `a` definitely strictly before `b`? Three-valued. */
export function isStrictlyBefore(a: PartialDate, b: PartialDate): TriState {
  const A = partialDateBounds(a);
  const B = partialDateBounds(b);
  if (A.end < B.start) return true;
  if (A.start >= B.end) return false;
  return 'unknown';
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!Number.isInteger(days)) throw new Error('addDays requires an integer');
  return toCalendarDate(calendar(date).plus({ days }));
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: CalendarDate, to: CalendarDate): number {
  return Math.round(calendar(to).diff(calendar(from), 'days').days);
}

/** Calendar date of an instant as seen in a timezone. */
export function calendarDateInZone(instantIso: string, zone: string): CalendarDate {
  const dt = DateTime.fromISO(instantIso, { zone: 'UTC' }).setZone(zone);
  if (!dt.isValid) throw new Error(`Invalid instant or zone: ${instantIso} ${zone}`);
  return toCalendarDate(dt);
}

/**
 * Age range on a reference date given a partial birth date.
 * With a month-precision birth date, a person may or may not have had their
 * birthday yet, so the result is a range. The caller must not guess.
 */
export function ageRangeOn(birth: PartialDate, reference: CalendarDate): { min: number; max: number } {
  const b = partialDateBounds(birth);
  const ageForBirthDay = (birthDay: CalendarDate): number => {
    const bd = calendar(birthDay);
    const ref = calendar(reference);
    let age = ref.year - bd.year;
    if (ref.month < bd.month || (ref.month === bd.month && ref.day < bd.day)) age -= 1;
    return age;
  };
  // Later birth days give younger ages.
  return { min: ageForBirthDay(b.end), max: ageForBirthDay(b.start) };
}

/**
 * Minimum-age check at the organizer's reference date (not today).
 * Returns 'unknown' whenever birth-date precision cannot settle the question.
 */
export function meetsMinimumAge(birth: PartialDate, reference: CalendarDate, minimumAge: number): TriState {
  const { min, max } = ageRangeOn(birth, reference);
  if (min >= minimumAge) return true;
  if (max < minimumAge) return false;
  return 'unknown';
}

/** Maximum-age check ("must be under 19 on 1 June"). `maxAge` is inclusive. */
export function meetsMaximumAge(birth: PartialDate, reference: CalendarDate, maximumAgeInclusive: number): TriState {
  const { min, max } = ageRangeOn(birth, reference);
  if (max <= maximumAgeInclusive) return true;
  if (min > maximumAgeInclusive) return false;
  return 'unknown';
}

export function isValidTimezone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

export const TimezoneSchema = z.string().refine(isValidTimezone, { message: 'Expected an IANA timezone such as Europe/Athens' });

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const LocalTimeSchema = z.string().regex(TIME_RE, 'Expected HH:mm (24-hour)');

/**
 * A published deadline exactly as the source states it.
 * `timezone: null` is a material issue when exact timing matters; it must never
 * silently become the student's local timezone (spec 09 data contract).
 */
export const PublishedDeadlineSchema = z
  .object({
    date: CalendarDateSchema,
    time: LocalTimeSchema.nullable(),
    timezone: TimezoneSchema.nullable(),
    /** Original published wording, e.g. "Applications close 15 March 2027". */
    originalText: z.string().min(1),
  })
  .strict();
export type PublishedDeadline = z.infer<typeof PublishedDeadlineSchema>;

export type InstantResolution =
  | { ok: true; instantUtc: string }
  | { ok: false; reason: 'timezone_missing' | 'time_missing' | 'timezone_and_time_missing' };

/** Resolve a published deadline to an exact UTC instant, or explain why that is impossible. */
export function resolveDeadlineInstant(deadline: PublishedDeadline): InstantResolution {
  if (deadline.timezone === null && deadline.time === null) return { ok: false, reason: 'timezone_and_time_missing' };
  if (deadline.timezone === null) return { ok: false, reason: 'timezone_missing' };
  if (deadline.time === null) return { ok: false, reason: 'time_missing' };
  const [hh, mm] = deadline.time.split(':').map(Number);
  const local = DateTime.fromISO(deadline.date, { zone: deadline.timezone }).set({ hour: hh!, minute: mm!, second: 0, millisecond: 0 });
  if (!local.isValid) return { ok: false, reason: 'timezone_missing' };
  return { ok: true, instantUtc: local.toUTC().toISO()! };
}

/**
 * The earliest instant a deadline could possibly fall on, over every timezone
 * on Earth (UTC+14) and, if no time is published, the start of the day.
 * Useful only as a conservative *planning* target; it is labelled as such and
 * never presented as the official deadline.
 */
export function earliestPossibleInstant(deadline: PublishedDeadline): string {
  const exact = resolveDeadlineInstant(deadline);
  if (exact.ok) return exact.instantUtc;
  if (deadline.timezone !== null) {
    // time is missing: earliest is start of that local day
    return DateTime.fromISO(deadline.date, { zone: deadline.timezone }).startOf('day').toUTC().toISO()!;
  }
  const time = deadline.time ?? '00:00';
  const [hh, mm] = time.split(':').map(Number);
  return DateTime.fromISO(deadline.date, { zone: 'UTC+14' })
    .set({ hour: hh!, minute: mm!, second: 0, millisecond: 0 })
    .toUTC()
    .toISO()!;
}

/** Convert a local wall-clock time on a date in a zone to a UTC instant (DST-aware). */
export function localToInstant(date: CalendarDate, time: string, zone: string): string {
  if (!TIME_RE.test(time)) throw new Error(`Invalid time ${time}`);
  if (!isValidTimezone(zone)) throw new Error(`Invalid timezone ${zone}`);
  const [hh, mm] = time.split(':').map(Number);
  const dt = DateTime.fromISO(date, { zone }).set({ hour: hh!, minute: mm!, second: 0, millisecond: 0 });
  return dt.toUTC().toISO()!;
}

/** Wall-clock view of an instant in a zone. */
export function instantToLocal(instantIso: string, zone: string): { date: CalendarDate; time: string; weekday: number } {
  const dt = DateTime.fromISO(instantIso, { zone: 'UTC' }).setZone(zone);
  if (!dt.isValid) throw new Error(`Invalid instant or zone ${instantIso} ${zone}`);
  return { date: toCalendarDate(dt), time: dt.toFormat('HH:mm'), weekday: dt.weekday };
}

/** Academic period exactly as the source names it, with optional known bounds. */
export const AcademicPeriodSchema = z
  .object({
    /** Original label, e.g. "2025-2026", "Year 11", "Spring term". */
    label: z.string().min(1),
    kind: z.enum(['school_year', 'semester', 'trimester', 'term', 'quarter', 'summer', 'multi_term', 'unknown']),
    start: PartialDateSchema.optional(),
    end: PartialDateSchema.optional(),
  })
  .strict();
export type AcademicPeriod = z.infer<typeof AcademicPeriodSchema>;

/** A closed interval of partial dates, open-ended when `end` is absent (ongoing). */
export const DateIntervalSchema = z
  .object({
    start: PartialDateSchema,
    end: PartialDateSchema.optional(),
    ongoing: z.boolean().default(false),
  })
  .strict();
export type DateInterval = z.infer<typeof DateIntervalSchema>;

/**
 * Do two intervals definitely overlap? Three-valued. An ongoing interval is
 * treated as extending to `asOf`.
 */
export function intervalsOverlap(a: DateInterval, b: DateInterval, asOf: CalendarDate): TriState {
  const aEnd = a.end ?? (a.ongoing ? asOf : a.start);
  const bEnd = b.end ?? (b.ongoing ? asOf : b.start);
  const A = { start: partialDateBounds(a.start), end: partialDateBounds(aEnd) };
  const B = { start: partialDateBounds(b.start), end: partialDateBounds(bEnd) };
  // Definitely overlapping: latest possible start <= earliest possible end for both.
  const definitelyOverlap = A.start.end <= B.end.start && B.start.end <= A.end.start;
  if (definitelyOverlap) return true;
  // Definitely disjoint: one ends (latest possible) before other starts (earliest possible).
  const definitelyDisjoint = A.end.end < B.start.start || B.end.end < A.start.start;
  if (definitelyDisjoint) return false;
  return 'unknown';
}
