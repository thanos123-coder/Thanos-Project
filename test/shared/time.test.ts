import { describe, expect, it } from 'vitest';
import {
  addDays,
  ageRangeOn,
  comparePartialDates,
  diffDays,
  earliestPossibleInstant,
  instantToLocal,
  intervalsOverlap,
  isOnOrBefore,
  isStrictlyBefore,
  localToInstant,
  meetsMaximumAge,
  meetsMinimumAge,
  parsePartialDate,
  partialDateBounds,
  precisionOf,
  PartialDateSchema,
  resolveDeadlineInstant,
} from '../../src/shared/time.js';

describe('partial dates keep their precision', () => {
  it('parses year, month and day forms', () => {
    expect(parsePartialDate('2027')).toEqual({ year: 2027, precision: 'year' });
    expect(parsePartialDate('2027-06')).toEqual({ year: 2027, month: 6, precision: 'month' });
    expect(parsePartialDate('2027-06-15')).toEqual({ year: 2027, month: 6, day: 15, precision: 'day' });
  });

  it('rejects invalid calendar values instead of rolling them over', () => {
    expect(parsePartialDate('2027-02-30')).toBeNull();
    expect(parsePartialDate('2027-13')).toBeNull();
    expect(parsePartialDate('27-06')).toBeNull();
    expect(parsePartialDate('2028-02-29')).not.toBeNull(); // leap year
    expect(parsePartialDate('2027-02-29')).toBeNull();
    expect(PartialDateSchema.safeParse('June 2027').success).toBe(false);
  });

  it('a month-only date never acquires an invented day', () => {
    expect(precisionOf('2027-06')).toBe('month');
    expect(partialDateBounds('2027-06')).toEqual({ start: '2027-06-01', end: '2027-06-30' });
    expect(partialDateBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(partialDateBounds('2027')).toEqual({ start: '2027-01-01', end: '2027-12-31' });
  });

  it('comparisons are three-valued when precision is insufficient', () => {
    expect(comparePartialDates('2027-05', '2027-06-15')).toBe('before');
    expect(comparePartialDates('2027-06', '2027-06-15')).toBe('overlapping');
    expect(comparePartialDates('2027-06-15', '2027-06-15')).toBe('equal');
    expect(comparePartialDates('2027-06', '2027-06')).toBe('overlapping');
    expect(isOnOrBefore('2027-06', '2027-06-15')).toBe('unknown');
    expect(isOnOrBefore('2027-06', '2027-07-01')).toBe(true);
    expect(isOnOrBefore('2027-08', '2027-07-31')).toBe(false);
    expect(isStrictlyBefore('2027-06-15', '2027-06-15')).toBe(false);
    expect(isStrictlyBefore('2027-06-14', '2027-06-15')).toBe(true);
  });
});

describe('age at the organizer reference date', () => {
  it('computes an exact age from a full birth date', () => {
    expect(ageRangeOn('2011-06-02', '2027-06-01')).toEqual({ min: 15, max: 15 });
    expect(ageRangeOn('2011-06-01', '2027-06-01')).toEqual({ min: 16, max: 16 });
  });

  it('returns a range, never a guess, for a month-only birth date', () => {
    expect(ageRangeOn('2011-06', '2027-06-15')).toEqual({ min: 15, max: 16 });
    expect(meetsMinimumAge('2011-06', '2027-06-15', 16)).toBe('unknown');
    expect(meetsMinimumAge('2011-06', '2027-07-01', 16)).toBe(true);
    expect(meetsMinimumAge('2011-06', '2027-05-31', 16)).toBe(false);
  });

  it('handles a 29 February birthday deterministically', () => {
    expect(meetsMinimumAge('2012-02-29', '2028-02-28', 16)).toBe(false);
    expect(meetsMinimumAge('2012-02-29', '2028-02-29', 16)).toBe(true);
  });

  it('checks maximum ages inclusively', () => {
    expect(meetsMaximumAge('2008-09-01', '2027-06-01', 18)).toBe(true);
    expect(meetsMaximumAge('2008-05-01', '2027-06-01', 18)).toBe(false);
  });
});

describe('deadlines never guess a timezone', () => {
  it('refuses to resolve an instant without a timezone', () => {
    expect(resolveDeadlineInstant({ date: '2027-03-15', time: '23:59', timezone: null, originalText: 'by 15 March' })).toEqual({ ok: false, reason: 'timezone_missing' });
    expect(resolveDeadlineInstant({ date: '2027-03-15', time: null, timezone: null, originalText: 'by 15 March' })).toEqual({ ok: false, reason: 'timezone_and_time_missing' });
    expect(resolveDeadlineInstant({ date: '2027-03-15', time: null, timezone: 'Europe/Athens', originalText: '15 March' })).toEqual({ ok: false, reason: 'time_missing' });
  });

  it('resolves across daylight-saving changes correctly', () => {
    // US DST begins 2027-03-14; 23:59 in New York on 15 March is UTC-4.
    const r = resolveDeadlineInstant({ date: '2027-03-15', time: '23:59', timezone: 'America/New_York', originalText: '11:59 pm ET' });
    expect(r).toEqual({ ok: true, instantUtc: '2027-03-16T03:59:00.000Z' });
    const winter = resolveDeadlineInstant({ date: '2027-01-15', time: '23:59', timezone: 'America/New_York', originalText: '11:59 pm ET' });
    expect(winter).toEqual({ ok: true, instantUtc: '2027-01-16T04:59:00.000Z' });
  });

  it('the conservative planning instant is the earliest the deadline could be anywhere', () => {
    const earliest = earliestPossibleInstant({ date: '2027-03-15', time: null, timezone: null, originalText: '15 March' });
    expect(earliest).toBe('2027-03-14T10:00:00.000Z');
  });

  it('converts local times and back', () => {
    const instant = localToInstant('2027-07-05', '19:00', 'America/Los_Angeles');
    expect(instant).toBe('2027-07-06T02:00:00.000Z');
    expect(instantToLocal(instant, 'Europe/Athens')).toEqual({ date: '2027-07-06', time: '05:00', weekday: 2 });
  });
});

describe('calendar arithmetic', () => {
  it('adds and diffs whole days across month and year boundaries', () => {
    expect(addDays('2027-12-30', 3)).toBe('2028-01-02');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(diffDays('2027-01-01', '2027-03-01')).toBe(59);
    expect(diffDays('2027-03-01', '2027-01-01')).toBe(-59);
  });
});

describe('interval overlap', () => {
  it('is three-valued with coarse precision', () => {
    expect(intervalsOverlap({ start: '2026-09', end: '2027-06', ongoing: false }, { start: '2027-01', end: '2027-03', ongoing: false }, '2027-09-01')).toBe(true);
    expect(intervalsOverlap({ start: '2026-09', end: '2026-12', ongoing: false }, { start: '2027-01', end: '2027-03', ongoing: false }, '2027-09-01')).toBe(false);
    expect(intervalsOverlap({ start: '2026-09', end: '2027-01', ongoing: false }, { start: '2027-01', end: '2027-03', ongoing: false }, '2027-09-01')).toBe('unknown');
  });
});
