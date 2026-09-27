import { z } from 'zod';
import { PartialDateSchema } from './time.js';

/**
 * Source registry records (blueprint: "Build a maintained source registry").
 *
 * An institution is authoritative about its own published requirements; a
 * search snippet or third-party list is a discovery aid only and can never
 * establish a high-consequence requirement (spec 06R03/09R03).
 */

export const SOURCE_TYPES = [
  'official_institution',
  'official_program',
  'application_platform',
  'awarding_body',
  'testing_organization',
  'government',
  'standards_body',
  'organizer_official',
  'school_official',
  'third_party_listing',
  'search_snippet',
  'student_supplied',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_REVIEW_STATUSES = ['unreviewed', 'verified', 'expert_reviewed', 'stale', 'retracted'] as const;
export type SourceReviewStatus = (typeof SOURCE_REVIEW_STATUSES)[number];

export const SourceRecordSchema = z
  .object({
    id: z.string().min(1),
    /** Content version, e.g. a fingerprint-derived label; changes when content changes. */
    version: z.string().min(1),
    publisher: z.string().min(1),
    canonicalUrl: z.string().url(),
    title: z.string().min(1),
    sourceType: z.enum(SOURCE_TYPES),
    scope: z
      .object({
        institutionRef: z.string().optional(),
        programRef: z.string().optional(),
        organizerRef: z.string().optional(),
        cycle: z.string().optional(),
        applicantCategory: z.string().optional(),
        geography: z.string().optional(),
      })
      .strict()
      .default({}),
    retrievedAt: z.string().min(1),
    publishedAt: PartialDateSchema.optional(),
    effectiveFrom: PartialDateSchema.optional(),
    effectiveTo: PartialDateSchema.optional(),
    /** SHA-256 of the retrieved content (or permitted snapshot). */
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    permittedUse: z.enum(['snapshot_allowed', 'quote_only', 'link_only', 'unknown']),
    reviewStatus: z.enum(SOURCE_REVIEW_STATUSES),
    parserVersion: z.string().optional(),
  })
  .strict();
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

/** Source types that may establish a consequential claim about their own publisher's rules. */
const AUTHORITATIVE_TYPES: ReadonlySet<SourceType> = new Set([
  'official_institution',
  'official_program',
  'application_platform',
  'awarding_body',
  'testing_organization',
  'government',
  'organizer_official',
  'school_official',
]);

export function isAuthoritativeSourceType(t: SourceType): boolean {
  return AUTHORITATIVE_TYPES.has(t);
}

/**
 * Can this source establish a consequential claim (deadline, eligibility, cost)?
 * It must be an authoritative type and not stale or retracted.
 */
export function canEstablishConsequentialClaim(source: SourceRecord): boolean {
  return isAuthoritativeSourceType(source.sourceType) && source.reviewStatus !== 'stale' && source.reviewStatus !== 'retracted';
}
