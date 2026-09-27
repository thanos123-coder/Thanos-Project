import { z } from 'zod';

/**
 * Explicit representation of a missing value.
 *
 * Spec (Shared operating rules / Facts need more than a confidence score):
 * "Unknown", "not supplied", "not applicable", "declined" and "confirmed
 * absent" must be distinct. A blank test field is not a score of zero, and a
 * student who declines to discuss family finances has not reported unlimited
 * funds. Agent 04 additionally distinguishes "not yet asked", "student does not
 * know" and "source unreadable" because each has a different next step.
 */
export const ABSENCE_REASONS = [
  /** Nobody has asked for this information yet. */
  'not_asked',
  /** Asked or expected, but the information was not provided. */
  'not_supplied',
  /** The student was asked and does not know. */
  'unknown_to_student',
  /** The student has not decided yet (a choice, not a missing fact). Never a negative answer. */
  'not_decided',
  /** The student chose not to share. Never interpreted as a positive or negative answer. */
  'declined',
  /** A document or source exists but could not be read for this field. */
  'source_unreadable',
  /** The field does not apply to this student or context. */
  'not_applicable',
  /** It has been confirmed that the thing does not exist (e.g. "I have not taken the SAT"). */
  'confirmed_absent',
  /** Evidence has been requested and is awaited (e.g. a school confirmation). */
  'pending_evidence',
  /** The value is generically unknown for a reason not listed above. */
  'unknown',
] as const;

export type AbsenceReason = (typeof ABSENCE_REASONS)[number];

export const AbsenceReasonSchema = z.enum(ABSENCE_REASONS);

export const AbsenceSchema = z
  .object({
    kind: z.literal('absent'),
    reason: AbsenceReasonSchema,
    /** Optional human-readable resolution path, e.g. "Upload the latest transcript". */
    resolution: z.string().optional(),
  })
  .strict();

export type Absence = z.infer<typeof AbsenceSchema>;

export function absent(reason: AbsenceReason, resolution?: string): Absence {
  return resolution === undefined ? { kind: 'absent', reason } : { kind: 'absent', reason, resolution };
}

export function isAbsence(value: unknown): value is Absence {
  return AbsenceSchema.safeParse(value).success;
}

/**
 * How a rule engine or planner must treat an absence.
 * - `known_negative`: the thing is confirmed not to exist (e.g. no SAT taken).
 * - `excluded`: the field does not apply, so dependent logic is not applicable.
 * - `unknown`: everything else. Unknown is never converted to false or zero.
 */
export type AbsenceInterpretation = 'known_negative' | 'excluded' | 'unknown';

export function interpretAbsence(reason: AbsenceReason): AbsenceInterpretation {
  switch (reason) {
    case 'confirmed_absent':
      return 'known_negative';
    case 'not_applicable':
      return 'excluded';
    default:
      return 'unknown';
  }
}

/** User-facing wording that never implies a value. */
export function describeAbsence(reason: AbsenceReason): string {
  switch (reason) {
    case 'not_asked':
      return 'not yet asked';
    case 'not_supplied':
      return 'not provided';
    case 'unknown_to_student':
      return 'not known yet';
    case 'not_decided':
      return 'not decided yet';
    case 'declined':
      return 'chose not to share';
    case 'source_unreadable':
      return 'could not be read from the document';
    case 'not_applicable':
      return 'not applicable';
    case 'confirmed_absent':
      return 'confirmed as none';
    case 'pending_evidence':
      return 'waiting for evidence';
    case 'unknown':
      return 'unknown';
  }
}
