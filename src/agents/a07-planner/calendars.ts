import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { TestFamilySchema, type TestFamily } from '../../shared/assessments.js';
import { MoneySchema } from '../../shared/money.js';
import { SourceRecordSchema, canEstablishConsequentialClaim, type SourceRecord } from '../../shared/sources.js';
import { CalendarDateSchema, PublishedDeadlineSchema } from '../../shared/time.js';

/**
 * Verified test calendars (07R10, 07R11). Official administrations as the
 * testing organization publishes them: dates, deadlines with their stated
 * time and timezone, score-release windows (marked as estimates when the
 * organization only gives typical timing), fees, and device or accommodation
 * steps that have their own earlier deadlines.
 *
 * A listed date is not a seat: availability is never known from a calendar
 * (07T11). Coverage records say how far ahead dates are published, so an
 * unpublished future window is reported as provisional instead of invented
 * (07T15).
 */

export const TestAdministrationSchema = z
  .object({
    id: z.string().min(1),
    family: TestFamilySchema,
    testDate: CalendarDateSchema,
    /** Countries covered (ISO alpha-2), or 'GLOBAL' when the organization lists the date worldwide. */
    geography: z.union([z.literal('GLOBAL'), z.array(z.string().regex(/^[A-Z]{2}$/)).min(1)]),
    deliveryFormat: z.enum(['test_center', 'at_home', 'school_day']),
    registrationDeadline: PublishedDeadlineSchema,
    lateRegistrationDeadline: PublishedDeadlineSchema.nullable().default(null),
    /** Deadline for requesting testing accommodations for this date, if published separately. */
    accommodationRequestDeadline: PublishedDeadlineSchema.nullable().default(null),
    /** Deadline to request a loaned device for digital tests, if the organization offers one. */
    deviceLoanDeadline: PublishedDeadlineSchema.nullable().default(null),
    scoreRelease: z.object({ earliest: CalendarDateSchema, latest: CalendarDateSchema, estimate: z.boolean() }).strict(),
    fees: z
      .object({
        registration: MoneySchema,
        lateFee: MoneySchema.nullable().default(null),
        /** Fee per additional score report, when published. */
        scoreReport: MoneySchema.nullable().default(null),
      })
      .strict(),
    status: z.enum(['scheduled', 'cancelled']).default('scheduled'),
    sourceId: z.string().min(1),
  })
  .strict();
export type TestAdministration = z.infer<typeof TestAdministrationSchema>;
export type TestAdministrationInput = z.input<typeof TestAdministrationSchema>;

export const CalendarCoverageSchema = z
  .object({
    family: TestFamilySchema,
    /** The last date for which the organization has published administrations. */
    publishedThrough: CalendarDateSchema,
    sourceId: z.string().min(1),
  })
  .strict();
export type CalendarCoverage = z.infer<typeof CalendarCoverageSchema>;

export interface CalendarQueryResult {
  administrations: TestAdministration[];
  coverage: Array<{ family: TestFamily; publishedThrough: string | null; sourceId: string | null }>;
  sources: SourceRecord[];
}

export class TestCalendarRegistry {
  private readonly administrations = new Map<string, TestAdministration>();
  private readonly coverage = new Map<TestFamily, CalendarCoverage>();
  private readonly sources = new Map<string, SourceRecord>();

  addSource(s: SourceRecord): void {
    this.sources.set(s.id, SourceRecordSchema.parse(s));
  }

  addAdministration(a: TestAdministrationInput): void {
    this.administrations.set(a.id, TestAdministrationSchema.parse(a));
  }

  setCoverage(c: CalendarCoverage): void {
    this.coverage.set(c.family, CalendarCoverageSchema.parse(c));
  }

  /** The testing organization cancelled an administration. */
  cancel(id: string): void {
    const a = this.administrations.get(id);
    if (a) a.status = 'cancelled';
  }

  query(families: readonly TestFamily[], country: string | null, from: string, to: string): CalendarQueryResult {
    const usable = (id: string) => {
      const s = this.sources.get(id);
      return s && canEstablishConsequentialClaim(s) ? s : undefined;
    };
    const administrations = [...this.administrations.values()]
      .filter((a) => families.includes(a.family) && a.testDate >= from && a.testDate <= to)
      .filter((a) => a.geography === 'GLOBAL' || (country !== null && a.geography.includes(country)))
      .filter((a) => usable(a.sourceId))
      .sort((a, b) => a.testDate.localeCompare(b.testDate) || a.id.localeCompare(b.id))
      .map((a) => structuredClone(a));
    const coverage = families.map((f) => {
      const c = this.coverage.get(f);
      return c && usable(c.sourceId) ? { family: f, publishedThrough: c.publishedThrough, sourceId: c.sourceId } : { family: f, publishedThrough: null, sourceId: null };
    });
    const sourceIds = new Set([...administrations.map((a) => a.sourceId), ...coverage.flatMap((c) => (c.sourceId ? [c.sourceId] : []))]);
    return { administrations, coverage, sources: [...sourceIds].map((id) => structuredClone(this.sources.get(id)!)) };
  }
}

/** Public calendar data; the arguments carry only a test family, a country and a date window. */
export function registerCalendarTools(gateway: ToolGateway, registry: TestCalendarRegistry): void {
  gateway.register({
    name: 'calendars.read_verified',
    description: 'Read official test administrations, deadlines, score-release windows and fees from verified testing-organization sources.',
    kind: 'read',
    args: z
      .object({
        families: z.array(TestFamilySchema).min(1).max(8),
        country: z.string().regex(/^[A-Z]{2}$/).nullable(),
        from: CalendarDateSchema,
        to: CalendarDateSchema,
      })
      .strict(),
    handler: async (inv, args): Promise<CalendarQueryResult> => {
      const r = registry.query(args.families, args.country, args.from, args.to);
      for (const s of r.sources) inv.context.servedSourceIds.add(s.id);
      return r;
    },
  });
}
