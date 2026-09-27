import { z } from 'zod';
import { AbsenceSchema } from './absence.js';

/**
 * Eligibility scope (spec 06 "Scope must be fixed before evaluation").
 * Residency for tuition, nationality, school location and curriculum are
 * separate concepts; they are read from the record as separate facts and are
 * never collapsed into one "international" label.
 */

export const DECISION_STAGES = ['application', 'offer', 'enrollment', 'credit_or_placement'] as const;
export type DecisionStage = (typeof DECISION_STAGES)[number];
export const DecisionStageSchema = z.enum(DECISION_STAGES);

export const APPLICANT_CATEGORIES = ['first_year', 'transfer', 'visiting', 'mature', 'returning', 'other'] as const;
export type ApplicantCategory = (typeof APPLICANT_CATEGORIES)[number];
export const ApplicantCategorySchema = z.enum(APPLICANT_CATEGORIES);

export const DEGREE_LEVELS = ['undergraduate_first_degree', 'foundation', 'associate', 'graduate', 'other'] as const;

export const EligibilityScopeSchema = z
  .object({
    institutionRef: z.string().min(1),
    campusRef: z.string().nullable().default(null),
    programRef: z.string().min(1),
    degreeLevel: z.enum(DEGREE_LEVELS),
    entryCycle: z.string().min(4),
    /** When unknown, findings stay conditional on each candidate category (06T14). */
    applicantCategory: z.union([ApplicantCategorySchema, AbsenceSchema]),
    decisionStage: DecisionStageSchema,
  })
  .strict();
export type EligibilityScope = z.infer<typeof EligibilityScopeSchema>;
export type EligibilityScopeInput = z.input<typeof EligibilityScopeSchema>;

export function scopeKey(s: EligibilityScope): string {
  const cat = typeof s.applicantCategory === 'string' ? s.applicantCategory : `unknown(${s.applicantCategory.reason})`;
  return [s.institutionRef, s.campusRef ?? '-', s.programRef, s.degreeLevel, s.entryCycle, cat, s.decisionStage].join('|');
}
