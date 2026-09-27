import type { TestAdministrationInput } from '../../src/agents/a07-planner/calendars.js';
import type { SourceRecord } from '../../src/shared/sources.js';

/**
 * Synthetic test calendars. Dates, fees and deadlines are invented for tests
 * and marked as coming from a fictional testing organization; they are not
 * real administrations.
 */

export function calendarSource(id: string, family: string): SourceRecord {
  return {
    id,
    version: `${id}_v1`,
    publisher: 'Example Testing Organization (synthetic)',
    canonicalUrl: `https://tests.example.org/${family.toLowerCase()}/dates`,
    title: `${family} dates and deadlines (synthetic)`,
    sourceType: 'testing_organization',
    scope: {},
    retrievedAt: '2026-09-20T09:00:00.000Z',
    contentHash: 'b'.repeat(64),
    permittedUse: 'quote_only',
    reviewStatus: 'verified',
  };
}

const usd = (amount: string) => ({ amount, currency: 'USD' });
const deadline = (date: string, originalText: string) => ({ date, time: '23:59', timezone: 'America/New_York', originalText });

export const SAT_NOV: TestAdministrationInput = {
  id: 'sat_2026_11_07',
  family: 'SAT',
  testDate: '2026-11-07',
  geography: 'GLOBAL',
  deliveryFormat: 'test_center',
  registrationDeadline: deadline('2026-10-23', 'Register by October 23, 11:59 p.m. ET'),
  lateRegistrationDeadline: deadline('2026-10-27', 'Late registration by October 27'),
  accommodationRequestDeadline: deadline('2026-10-09', 'Accommodation requests by October 9'),
  deviceLoanDeadline: deadline('2026-10-02', 'Device loan requests by October 2'),
  scoreRelease: { earliest: '2026-11-20', latest: '2026-11-27', estimate: true },
  fees: { registration: usd('68.00'), lateFee: usd('31.00'), scoreReport: usd('14.00') },
  sourceId: 'src_cal_sat',
};

export const SAT_DEC: TestAdministrationInput = {
  ...SAT_NOV,
  id: 'sat_2026_12_05',
  testDate: '2026-12-05',
  registrationDeadline: deadline('2026-11-20', 'Register by November 20, 11:59 p.m. ET'),
  lateRegistrationDeadline: deadline('2026-11-24', 'Late registration by November 24'),
  accommodationRequestDeadline: deadline('2026-11-06', 'Accommodation requests by November 6'),
  deviceLoanDeadline: deadline('2026-10-30', 'Device loan requests by October 30'),
  scoreRelease: { earliest: '2026-12-18', latest: '2026-12-26', estimate: true },
};

export const SAT_MAR: TestAdministrationInput = {
  ...SAT_NOV,
  id: 'sat_2027_03_13',
  testDate: '2027-03-13',
  registrationDeadline: deadline('2027-02-26', 'Register by February 26, 11:59 p.m. ET'),
  lateRegistrationDeadline: null,
  accommodationRequestDeadline: deadline('2027-02-12', 'Accommodation requests by February 12'),
  deviceLoanDeadline: deadline('2027-02-05', 'Device loan requests by February 5'),
  scoreRelease: { earliest: '2027-03-26', latest: '2027-04-02', estimate: true },
};

export const ACT_DEC: TestAdministrationInput = {
  id: 'act_2026_12_12',
  family: 'ACT',
  testDate: '2026-12-12',
  geography: 'GLOBAL',
  deliveryFormat: 'test_center',
  registrationDeadline: deadline('2026-11-06', 'Register by November 6'),
  scoreRelease: { earliest: '2026-12-22', latest: '2027-01-09', estimate: true },
  fees: { registration: usd('69.00') },
  sourceId: 'src_cal_act',
};
