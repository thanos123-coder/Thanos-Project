import { z } from 'zod';
import { AWARD_SCOPES, AWARD_STAGES, EXPERIENCE_CATEGORIES, MeasureSchema, OVERSIGHT_AREAS, RESEARCH_STATUSES } from '../../shared/fields.js';
import { DateIntervalSchema, PartialDateSchema } from '../../shared/time.js';

/**
 * Agent 08 input: the student's own account of an experience, entered through
 * the activity form (or structured from their free-text description). The shape
 * follows the spec's experience inventory: identity, episodes (role, period,
 * time), contribution (personal tasks separate from team results), outcomes
 * with explicit measures, learning in the student's words, awards and research.
 * Nothing here is a score.
 */

const HoursRangeSchema = z
  .object({ min: z.number().nonnegative().max(168), max: z.number().nonnegative().max(168) })
  .strict()
  .refine((r) => r.max >= r.min, 'max must be >= min');

export const OutcomeInputSchema = z
  .object({
    description: z.string().min(1).max(300),
    attribution: z.enum(['individual', 'team']),
    measure: MeasureSchema.nullable().default(null),
    evidence: z.enum(['self_reported', 'document_supported', 'verified', 'qualitative_feedback']).default('self_reported'),
  })
  .strict();
export type OutcomeInput = z.infer<typeof OutcomeInputSchema>;

export const EpisodeInputSchema = z
  .object({
    /** An existing episode being updated. */
    episodeId: z.string().min(1).optional(),
    roleTitle: z.string().min(1).max(80).nullable().default(null),
    /** True only when the organization actually uses this title. */
    titleIsOfficial: z.boolean().default(false),
    period: DateIntervalSchema,
    lifecycle: z.enum(['considering', 'planned', 'in_progress', 'completed']),
    time: z
      .object({
        hoursPerWeek: HoursRangeSchema,
        weeksPerYear: z.object({ min: z.number().nonnegative().max(53), max: z.number().nonnegative().max(53) }).strict().optional(),
        pattern: z.enum(['school_term', 'holidays', 'year_round', 'seasonal', 'irregular', 'one_off']),
        basis: z.enum(['student_estimate', 'records', 'document', 'supervisor_statement']),
      })
      .strict()
      .nullable()
      .default(null),
    personalTasks: z.array(z.string().min(1).max(200)).max(15).default([]),
    decisionsInfluenced: z.array(z.string().min(1).max(200)).max(10).default([]),
    teamOutcomes: z.array(OutcomeInputSchema).max(10).default([]),
    personalOutcomes: z.array(OutcomeInputSchema).max(10).default([]),
    supervision: z.enum(['supervised', 'independent', 'mixed', 'unknown']).default('unknown'),
    /** What the student learned, in their own words. Never generated. */
    learning: z.string().min(1).max(1000).nullable().default(null),
    /** For programs: how the student got in. An acceptance is not the completed experience (08T02). */
    selection: z.enum(['none', 'applied_and_accepted', 'selected', 'invited']).default('none'),
  })
  .strict();
export type EpisodeInput = z.infer<typeof EpisodeInputSchema>;

export const AwardInputSchema = z
  .object({
    awardId: z.string().min(1).optional(),
    title: z.string().min(1).max(160),
    organizer: z.string().min(1).max(160).nullable().default(null),
    date: PartialDateSchema.nullable().default(null),
    /** As the student states it; 'unknown' unless they know. Never inferred from an impressive title (08T08). */
    scope: z.enum(AWARD_SCOPES).default('unknown'),
    stage: z.enum(AWARD_STAGES),
    attribution: z.enum(['individual', 'team']),
    selectionNote: z.string().max(300).nullable().default(null),
    /** A verified source for the organizer and competition structure, when one exists. */
    scopeSourceId: z.string().min(1).optional(),
    /** How the scope was established. A scope read from the title alone is not used. */
    scopeBasis: z.enum(['student_stated', 'verified_source', 'inferred_from_title']).default('student_stated'),
  })
  .strict();
export type AwardInput = z.infer<typeof AwardInputSchema>;

export const ResearchInputSchema = z
  .object({
    researchId: z.string().min(1).optional(),
    questionSummary: z.string().min(1).max(300).nullable().default(null),
    status: z.enum(RESEARCH_STATUSES),
    studentTasks: z.array(z.string().min(1).max(200)).max(15).default([]),
    supervision: z.enum(['supervised', 'independent', 'unknown']).default('unknown'),
    approvalStatus: z.enum(['not_required', 'approved_before_work', 'pending', 'unknown']).default('unknown'),
    authorship: z.string().min(1).max(200).nullable().default(null),
    oversight: z.array(z.enum(OVERSIGHT_AREAS)).default([]),
    /** Whether work has already started (matters when approval was needed first). */
    workStarted: z.boolean().default(false),
  })
  .strict();
export type ResearchInput = z.infer<typeof ResearchInputSchema>;

export const ExperienceInputSchema = z
  .object({
    /** An existing experience being updated. */
    experienceId: z.string().min(1).optional(),
    title: z.string().min(1).max(120),
    organization: z.string().min(1).max(120).nullable().default(null),
    organizationKind: z.enum(['formal_organization', 'school', 'employer', 'family', 'informal', 'self_directed', 'unknown']).default('unknown'),
    category: z.enum(EXPERIENCE_CATEGORIES),
    /** Used only when no dated episode is known yet (a planned or considered activity stays so). */
    lifecycle: z.enum(['considering', 'planned', 'in_progress', 'completed']).optional(),
    episodes: z.array(EpisodeInputSchema).max(12).default([]),
    awards: z.array(AwardInputSchema).max(10).default([]),
    research: z.array(ResearchInputSchema).max(5).default([]),
  })
  .strict();
export type ExperienceInput = z.infer<typeof ExperienceInputSchema>;

/** A targeted question for a consequential missing or ambiguous detail (08R05, 08R07). */
export interface Clarification {
  id: string;
  experienceRef: string;
  episodeRef: string | null;
  kind: 'measure' | 'personal_contribution' | 'overlap' | 'dates' | 'lifecycle' | 'award_scope' | 'approval' | 'time';
  question: string;
  options: string[];
}
