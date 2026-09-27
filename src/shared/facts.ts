import { z } from 'zod';
import { AbsenceSchema } from './absence.js';
import { EvidenceRefSchema } from './evidence.js';
import { PartialDateSchema } from './time.js';

/**
 * Facts need more than a confidence score (spec, Shared operating rules).
 * Separate dimensions: origin, confirmation, lifecycle, validity and dispute.
 * "Collapsing these into '87 percent confidence' makes downstream decisions
 * unsafe."
 */

export const ORIGINS = [
  'student_statement',
  'supporter_statement',
  'counselor_statement',
  'document_extraction',
  'school_feed',
  'issuer_report',
  'institution_source',
  'derived_calculation',
  'model_interpretation',
  'reviewer_decision',
] as const;
export type Origin = (typeof ORIGINS)[number];
export const OriginSchema = z.enum(ORIGINS);

export const CONFIRMATIONS = ['unreviewed', 'student_confirmed', 'counselor_confirmed', 'issuer_verified', 'human_reviewed'] as const;
export type Confirmation = (typeof CONFIRMATIONS)[number];
export const ConfirmationSchema = z.enum(CONFIRMATIONS);

export const LIFECYCLES = ['considering', 'planned', 'enrolled', 'in_progress', 'completed', 'cancelled', 'current'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];
export const LifecycleSchema = z.enum(LIFECYCLES);

/** Lifecycles that describe something that has not happened yet. A planned entry must never become an award. */
export const FUTURE_LIFECYCLES: ReadonlySet<Lifecycle> = new Set(['considering', 'planned']);

export const DISPUTES = ['none', 'conflicting_evidence', 'correction_requested', 'unresolved'] as const;
export type Dispute = (typeof DISPUTES)[number];
export const DisputeSchema = z.enum(DISPUTES);

export const ValiditySchema = z
  .object({
    /** When the fact started to apply in the real world (valid time). */
    validFrom: PartialDateSchema.optional(),
    /** When it stopped applying, if known. */
    validTo: PartialDateSchema.optional(),
    /** Admissions or program cycle the fact is scoped to, if any. */
    cycle: z.string().optional(),
  })
  .strict();
export type Validity = z.infer<typeof ValiditySchema>;

/**
 * Whose statement or preference this is. "My parents want medicine" is a claim
 * about the parents' preference, asserted by the student. A supporter using
 * their own account produces a supporter-held claim.
 */
export const HolderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('student') }).strict(),
  z.object({ kind: z.literal('supporter'), actorId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('reported_other'),
      /** Broad relationship label as the student described it, e.g. "parents", "teacher". */
      label: z.string().min(1).max(40),
    })
    .strict(),
]);
export type Holder = z.infer<typeof HolderSchema>;

export function holderKey(h: Holder | undefined): string {
  if (!h || h.kind === 'student') return 'student';
  if (h.kind === 'supporter') return `supporter:${h.actorId}`;
  return `other:${h.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

export const FieldRefSchema = z
  .object({
    entity: z.string().min(1),
    /** 'self' for singleton student-level fields; an opaque id for collection items. */
    entityId: z.string().min(1),
    attribute: z.string().min(1),
  })
  .strict();
export type FieldRef = z.infer<typeof FieldRefSchema>;

/** Stable string key for a field instance, including the holder for holder-scoped fields. */
export function fieldKey(ref: FieldRef, holder?: Holder): string {
  const base = `${ref.entity}:${ref.entityId}.${ref.attribute}`;
  const h = holderKey(holder);
  return h === 'student' ? base : `${base}@${h}`;
}

/** Catalog key (entity type + attribute) used to look up the field definition. */
export function catalogKey(ref: FieldRef): string {
  return `${ref.entity}.${ref.attribute}`;
}

export const ExtractionReviewSchema = z
  .object({
    state: z.enum(['clean', 'needs_confirmation', 'ambiguous', 'unreadable']),
    /** Alternative readings when ambiguous, exactly as they could be read. Never averaged. */
    candidates: z.array(z.string()).default([]),
    note: z.string().optional(),
  })
  .strict();
export type ExtractionReview = z.infer<typeof ExtractionReviewSchema>;

/** Who supplied the claim to the system. */
export const AssertedBySchema = z
  .object({
    actorId: z.string().min(1),
    actorKind: z.enum(['student', 'supporter', 'school_counselor', 'institution_admin', 'internal_support', 'agent']),
    /** Agent role that processed the input, e.g. '02' or '03'. */
    viaRole: z.string().optional(),
  })
  .strict();
export type AssertedBy = z.infer<typeof AssertedBySchema>;

/** A proposed claim, as sent by a specialist to Agent 04. The value is validated against the field catalog. */
export const ClaimInputSchema = z
  .object({
    field: FieldRefSchema,
    value: z.unknown(),
    holder: HolderSchema.optional(),
    origin: OriginSchema,
    confirmation: ConfirmationSchema,
    lifecycle: LifecycleSchema,
    validity: ValiditySchema.default({}),
    dispute: DisputeSchema.default('none'),
    evidence: z.array(EvidenceRefSchema).min(1),
    assertedBy: AssertedBySchema,
    extractionReview: ExtractionReviewSchema.optional(),
    /** Claim ids that this claim explicitly supersedes (e.g. a corrected extraction). */
    supersedes: z.array(z.string()).default([]),
    /** Optional stricter visibility category for this claim. */
    restrictToCategory: z.string().optional(),
  })
  .strict();
export type ClaimInput = z.input<typeof ClaimInputSchema>;
export type ClaimInputParsed = z.output<typeof ClaimInputSchema>;

export const ValueOrAbsence = <T extends z.ZodType>(schema: T) => z.union([schema, AbsenceSchema]);
