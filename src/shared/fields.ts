import { z } from 'zod';
import { TestScoreRecordSchema, TestFamilySchema } from './assessments.js';
import { CreditValueSchema, GradeValueSchema } from './grades.js';
import { BudgetSchema } from './money.js';
import type { Origin } from './facts.js';
import type { DataCategory } from './permissions.js';
import { AcademicPeriodSchema, CalendarDateSchema, DateIntervalSchema, LocalTimeSchema, PartialDateSchema, TimezoneSchema } from './time.js';

/**
 * The field catalog: every attribute the student record can hold, with its
 * value schema, data category, conflict policy and consequence. Agent 04
 * rejects any claim whose field is not in the catalog, which is how a model
 * cannot insert a recommendation into a factual field (04T11).
 *
 * Conflict policies (04R05 "Assess conflicts by field"):
 * - owner_latest: the holder's latest statement is current (preferences, constraints).
 * - planning_latest_statement: a newer student statement becomes the planning value
 *   while earlier documentary assertions are preserved (e.g. expected graduation).
 * - evidence_reconcile: differing values from different sources stay in conflict
 *   until resolved by evidence or review (grades, course levels, scores).
 */

export type ConflictPolicy = 'owner_latest' | 'planning_latest_statement' | 'evidence_reconcile';

export interface FieldDefinition {
  entity: string;
  attribute: string;
  schema: z.ZodType;
  category: DataCategory;
  conflictPolicy: ConflictPolicy;
  /** A critical field: errors could materially alter a decision (glossary). Needs confirmation before consequential use. */
  consequential: boolean;
  /** Fields in the same group on the same entity are reviewed jointly under concurrent edits (04R04). */
  jointReviewGroup?: string;
  /** Holder is part of the field identity (preferences). */
  holderScoped?: boolean;
  /** Origins that may assert this field. Undefined means any origin. */
  allowedOrigins?: readonly Origin[];
  /** Short plain-language label used in student-facing summaries. */
  label: string;
}

const COUNTRY = z.string().regex(/^[A-Z]{2}$/, 'Expected an ISO 3166-1 alpha-2 country code');
const STATEMENT_ORIGINS: readonly Origin[] = ['student_statement', 'supporter_statement', 'counselor_statement'];

const HoursRangeSchema = z
  .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .strict()
  .refine((r) => r.max >= r.min, 'max must be >= min');

export const TimeEstimateSchema = z
  .object({
    hoursPerWeek: HoursRangeSchema,
    weeksPerYear: HoursRangeSchema.optional(),
    pattern: z.enum(['school_term', 'holidays', 'year_round', 'seasonal', 'irregular', 'one_off']),
    basis: z.enum(['student_estimate', 'records', 'document', 'supervisor_statement']),
  })
  .strict();
export type TimeEstimate = z.infer<typeof TimeEstimateSchema>;

export const MeasureSchema = z
  .object({
    value: z.union([z.number(), HoursRangeSchema]).nullable(),
    unit: z.string().min(1),
    kind: z.enum([
      'invited',
      'attended',
      'participants',
      'people_served',
      'page_views',
      'unique_visitors',
      'subscribers',
      'money_raised',
      'items_produced',
      'hours',
      'other',
    ]),
    method: z.enum(['counted', 'estimated', 'platform_metric', 'records', 'unknown']),
    period: z.string().optional(),
  })
  .strict();
export type Measure = z.infer<typeof MeasureSchema>;

export const OutcomeSchema = z
  .object({
    description: z.string().min(1),
    attribution: z.enum(['individual', 'team']),
    measure: MeasureSchema.nullable(),
    evidence: z.enum(['self_reported', 'document_supported', 'verified', 'qualitative_feedback']),
  })
  .strict();
export type Outcome = z.infer<typeof OutcomeSchema>;

export const WeeklySlotSchema = z
  .object({
    /** ISO weekday: 1 = Monday ... 7 = Sunday. */
    weekday: z.number().int().min(1).max(7),
    start: LocalTimeSchema,
    end: LocalTimeSchema,
  })
  .strict();
export type WeeklySlot = z.infer<typeof WeeklySlotSchema>;

export const SUBJECT_MAPPING_BASES = ['verified_mapping', 'broad_taxonomy', 'student_stated'] as const;
export const SubjectMappingSchema = z
  .object({
    /** Taxonomy key, e.g. 'mathematics' (broad) or 'ib.math_aa' (credential-specific). */
    key: z.string().min(1),
    basis: z.enum(SUBJECT_MAPPING_BASES),
    label: z.string().optional(),
  })
  .strict();
export type SubjectMapping = z.infer<typeof SubjectMappingSchema>;

export const COURSE_LEVELS = ['IB_HL', 'IB_SL', 'AP', 'honors', 'A_LEVEL', 'AS_LEVEL', 'standard', 'dual_enrollment', 'other'] as const;
export const CourseLevelSchema = z
  .object({
    /** Level exactly as printed; null when the record shows none. */
    original: z.string().nullable(),
    /** Normalized level only when established; null when unknown. */
    normalized: z.enum(COURSE_LEVELS).nullable(),
  })
  .strict();
export type CourseLevel = z.infer<typeof CourseLevelSchema>;

export const EXPERIENCE_CATEGORIES = [
  'paid_work',
  'caregiving',
  'household_responsibility',
  'hobby',
  'creative_practice',
  'community',
  'volunteering',
  'sport',
  'club',
  'research',
  'independent_learning',
  'independent_project',
  'faith_or_cultural',
  'program_or_course',
  'other',
] as const;

export const AWARD_STAGES = [
  'nominee',
  'applicant',
  'participant',
  'certificate_of_participation',
  'semifinalist',
  'finalist',
  'selected',
  'honorable_mention',
  'placed',
  'winner',
] as const;
export const AWARD_SCOPES = ['school', 'local', 'regional', 'national', 'international', 'unknown'] as const;

/** Work that normally needs supervision or prior review before it begins (08 "Research and independent projects"). */
export const OVERSIGHT_AREAS = ['human_participants', 'animals', 'hazardous_materials', 'none_known'] as const;

export const RESEARCH_STATUSES = [
  'in_progress',
  'literature_review',
  'supervised_data_analysis',
  'original_experiment',
  'poster',
  'preprint',
  'submitted_manuscript',
  'accepted_paper',
  'published_article',
] as const;

const defs: FieldDefinition[] = [
  // ---- Education context -------------------------------------------------
  { entity: 'student', attribute: 'education.stage', schema: z.enum(['secondary', 'completed_secondary', 'gap_year', 'postsecondary', 'other']), category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'education stage' },
  { entity: 'student', attribute: 'education.school_country', schema: COUNTRY, category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'school country' },
  { entity: 'student', attribute: 'education.qualification_system', schema: z.object({ id: z.string().min(1), label: z.string().min(1) }).strict(), category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'qualification system' },
  { entity: 'student', attribute: 'education.current_year_label', schema: z.object({ label: z.string().min(1), systemContext: z.string().nullable() }).strict(), category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: false, label: 'current school year' },
  { entity: 'student', attribute: 'education.expected_graduation', schema: PartialDateSchema, category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'expected graduation' },
  { entity: 'student', attribute: 'education.schooling_language', schema: z.object({ language: z.string().min(2), yearsOfInstruction: z.number().nonnegative().nullable() }).strict(), category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'language of instruction' },
  { entity: 'student', attribute: 'education.postsecondary_enrollment', schema: z.enum(['none', 'dual_enrollment_while_in_secondary', 'enrolled_after_secondary']), category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'college enrollment history' },
  { entity: 'student', attribute: 'education.school_name', schema: z.string().min(1), category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: false, label: 'school name' },
  // Whether the recorded course list is complete for a period. Only a confirmed complete list lets a missing subject count as "not taken".
  { entity: 'student', attribute: 'education.course_list_complete', schema: z.object({ complete: z.boolean(), throughPeriod: z.string().min(1) }).strict(), category: 'academic_record', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'course list completeness' },

  // ---- Application scope ---------------------------------------------------
  { entity: 'student', attribute: 'application.destination_countries', schema: z.array(COUNTRY), category: 'application_scope', conflictPolicy: 'owner_latest', consequential: false, label: 'destination countries' },
  { entity: 'student', attribute: 'application.entry_cycle', schema: z.string().regex(/^\d{4}([-_][a-z0-9]+)?$/i), category: 'application_scope', conflictPolicy: 'owner_latest', consequential: true, label: 'intended entry year' },
  { entity: 'student', attribute: 'application.applicant_category', schema: z.enum(['first_year', 'transfer', 'visiting', 'mature', 'returning', 'other']), category: 'application_scope', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'applicant category' },

  // ---- Identity (minimized) ------------------------------------------------
  { entity: 'student', attribute: 'identity.legal_name', schema: z.string().min(1), category: 'identity_contact', conflictPolicy: 'owner_latest', consequential: true, label: 'legal name', allowedOrigins: ['student_statement', 'counselor_statement', 'school_feed'] },
  { entity: 'student', attribute: 'identity.preferred_name', schema: z.string().min(1), category: 'identity_contact', conflictPolicy: 'owner_latest', consequential: false, label: 'preferred name' },
  { entity: 'student', attribute: 'identity.citizenships', schema: z.array(COUNTRY), category: 'citizenship_residency', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'citizenship' },
  { entity: 'student', attribute: 'identity.residence_country', schema: COUNTRY, category: 'citizenship_residency', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'country of residence' },
  { entity: 'student', attribute: 'identity.birth_date', schema: PartialDateSchema, category: 'identity_birthdate', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'date of birth' },

  // A yes/no answer to "Will you be at least N years old on DATE?" (spec 02: a threshold check may be sufficient).
  { entity: 'age_attestation', attribute: 'minimum_age', schema: z.number().int().min(0).max(120), category: 'identity_birthdate', conflictPolicy: 'owner_latest', consequential: true, label: 'age threshold' },
  { entity: 'age_attestation', attribute: 'reference_date', schema: CalendarDateSchema, category: 'identity_birthdate', conflictPolicy: 'owner_latest', consequential: true, label: 'age reference date' },
  { entity: 'age_attestation', attribute: 'meets', schema: z.boolean(), category: 'identity_birthdate', conflictPolicy: 'owner_latest', consequential: true, label: 'meets age threshold' },

  // ---- Practical constraints ---------------------------------------------
  { entity: 'student', attribute: 'constraints.weekly_hours_available', schema: HoursRangeSchema, category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: true, label: 'weekly time available' },
  { entity: 'student', attribute: 'constraints.opportunity_budget', schema: BudgetSchema, category: 'financial', conflictPolicy: 'owner_latest', consequential: true, label: 'budget for opportunities' },
  { entity: 'student', attribute: 'constraints.test_budget', schema: BudgetSchema, category: 'financial', conflictPolicy: 'owner_latest', consequential: true, label: 'budget for testing' },
  { entity: 'student', attribute: 'constraints.travel', schema: z.object({ overnightTravelPossible: z.boolean().nullable(), maxTravelMinutes: z.number().int().positive().nullable(), travelDuringTermPossible: z.boolean().nullable() }).strict(), category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: true, label: 'travel limits' },
  { entity: 'student', attribute: 'constraints.location_broad', schema: z.object({ country: COUNTRY, region: z.string().nullable(), city: z.string().nullable() }).strict(), category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: true, label: 'broad location' },
  { entity: 'student', attribute: 'constraints.timezone', schema: TimezoneSchema, category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: true, label: 'timezone' },
  { entity: 'student', attribute: 'constraints.availability_windows', schema: z.array(DateIntervalSchema), category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: true, label: 'available dates' },
  { entity: 'student', attribute: 'constraints.daily_available_hours', schema: z.object({ start: LocalTimeSchema, end: LocalTimeSchema }).strict(), category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: false, label: 'hours of the day available' },
  { entity: 'student', attribute: 'constraints.remote_preference', schema: z.enum(['remote_only', 'prefer_remote', 'no_preference', 'prefer_in_person', 'in_person_only']), category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: false, label: 'online or in person' },
  { entity: 'student', attribute: 'constraints.device_access', schema: z.enum(['reliable_own_device', 'shared_device', 'limited', 'none']), category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: false, label: 'device access' },
  { entity: 'student', attribute: 'finance.aid_needed', schema: z.enum(['yes', 'no', 'unsure']), category: 'financial', conflictPolicy: 'owner_latest', consequential: false, label: 'needs financial help' },
  { entity: 'student', attribute: 'support.family_responsibilities', schema: z.object({ hasRegularResponsibilities: z.boolean(), broadDescription: z.string().nullable(), hoursPerWeek: HoursRangeSchema.nullable() }).strict(), category: 'family_context', conflictPolicy: 'owner_latest', consequential: false, label: 'family responsibilities' },

  // ---- Interaction and accessibility -------------------------------------
  { entity: 'student', attribute: 'preferences.interaction_mode', schema: z.enum(['text', 'voice']), category: 'interaction_preferences', conflictPolicy: 'owner_latest', consequential: false, label: 'text or voice' },
  { entity: 'student', attribute: 'preferences.language', schema: z.string().min(2), category: 'interaction_preferences', conflictPolicy: 'owner_latest', consequential: false, label: 'language' },
  { entity: 'student', attribute: 'accessibility.preferences', schema: z.array(z.string().min(1)), category: 'health_accessibility', conflictPolicy: 'owner_latest', consequential: false, label: 'accessibility preferences' },

  // ---- Goals and exploration (student owned) -----------------------------
  { entity: 'student', attribute: 'goals.current_objective', schema: z.string().min(1), category: 'goals_preferences', conflictPolicy: 'owner_latest', consequential: false, label: 'current goal' },
  { entity: 'student', attribute: 'goals.decision_horizon', schema: z.enum(['broad_exploration', 'school_course_choice', 'university_subject_choice', 'comparing_narrowed_options']), category: 'goals_preferences', conflictPolicy: 'owner_latest', consequential: false, label: 'decision horizon' },
  { entity: 'preference', attribute: 'statement', schema: z.object({ text: z.string().min(1), topic: z.string().min(1), normalized: z.array(z.string()).default([]) }).strict(), category: 'goals_preferences', conflictPolicy: 'owner_latest', consequential: false, holderScoped: true, allowedOrigins: STATEMENT_ORIGINS, label: 'stated preference' },
  { entity: 'preference', attribute: 'strength', schema: z.enum(['tentative', 'moderate', 'strong']), category: 'goals_preferences', conflictPolicy: 'owner_latest', consequential: false, holderScoped: true, allowedOrigins: STATEMENT_ORIGINS, label: 'preference strength' },
  { entity: 'interest', attribute: 'description', schema: z.object({ text: z.string().min(1), lens: z.enum(['interest', 'value', 'learning_condition', 'preparation']) }).strict(), category: 'goals_preferences', conflictPolicy: 'owner_latest', consequential: false, allowedOrigins: STATEMENT_ORIGINS, label: 'interest or value' },
  { entity: 'interest', attribute: 'status', schema: z.enum(['active', 'retired']), category: 'goals_preferences', conflictPolicy: 'owner_latest', consequential: false, allowedOrigins: STATEMENT_ORIGINS, label: 'interest status' },
  { entity: 'reflection', attribute: 'text', schema: z.object({ text: z.string().min(1), about: z.string().nullable() }).strict(), category: 'exploration_reflections', conflictPolicy: 'owner_latest', consequential: false, allowedOrigins: ['student_statement'], label: 'reflection' },
  // An interpretation proposed by the app. Always labelled; the student can reject it (05T12).
  { entity: 'hypothesis', attribute: 'statement', schema: z.object({ text: z.string().min(1), commitmentLevel: z.literal('tentative'), evidenceClaimIds: z.array(z.string()), subjectKeys: z.array(z.string()).default([]), taskFocus: z.array(z.string()).default([]) }).strict(), category: 'goals_preferences', conflictPolicy: 'owner_latest', consequential: false, allowedOrigins: ['model_interpretation'], label: 'exploration hypothesis' },
  { entity: 'hypothesis', attribute: 'student_response', schema: z.enum(['accepted_as_tentative', 'rejected', 'edited']), category: 'goals_preferences', conflictPolicy: 'owner_latest', consequential: false, allowedOrigins: ['student_statement'], label: 'your response to a suggestion' },
  // An interest inventory result. "Validated" only when the original licensed instrument was administered unmodified (05T05).
  { entity: 'assessment', attribute: 'result', schema: z.object({ instrument: z.string().min(1), version: z.string().nullable(), language: z.string().min(2), administeredOn: CalendarDateSchema, scoringMethod: z.string().min(1), validationStatus: z.enum(['validated_original', 'modified_not_validated', 'exploratory_prompts']), consentContext: z.string().min(1), results: z.array(z.object({ scale: z.string().min(1), value: z.union([z.number(), z.string()]) }).strict()) }).strict(), category: 'exploration_reflections', conflictPolicy: 'owner_latest', consequential: false, label: 'interest inventory result' },

  // ---- Academic record ----------------------------------------------------
  { entity: 'course', attribute: 'name_original', schema: z.string().min(1), category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: false, label: 'course name' },
  { entity: 'course', attribute: 'code_local', schema: z.string().min(1), category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: false, label: 'course code' },
  { entity: 'course', attribute: 'course_key', schema: z.string().min(1), category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: false, label: 'course identity' },
  { entity: 'course', attribute: 'subject_mapping', schema: SubjectMappingSchema, category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'subject' },
  { entity: 'course', attribute: 'level', schema: CourseLevelSchema, category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: true, jointReviewGroup: 'course_result', label: 'course level' },
  { entity: 'course', attribute: 'period', schema: AcademicPeriodSchema, category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'course period' },
  { entity: 'course', attribute: 'grade', schema: GradeValueSchema, category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: true, jointReviewGroup: 'course_result', label: 'grade' },
  { entity: 'course', attribute: 'credit', schema: CreditValueSchema, category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: false, label: 'credits' },
  { entity: 'course', attribute: 'enrollment_status', schema: z.enum(['planned', 'enrolled', 'in_progress', 'completed', 'withdrawn', 'cancelled']), category: 'academic_record', conflictPolicy: 'planning_latest_statement', consequential: true, jointReviewGroup: 'course_result', label: 'course status' },
  { entity: 'course', attribute: 'attempt', schema: z.object({ number: z.number().int().positive(), kind: z.enum(['first', 'resit', 'retake', 'remark']) }).strict(), category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: true, jointReviewGroup: 'course_result', label: 'attempt' },
  { entity: 'course', attribute: 'school_ref', schema: z.string().min(1), category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: false, label: 'school' },

  { entity: 'qualification', attribute: 'credential', schema: z.object({ id: z.string().min(1), label: z.string().min(1) }).strict(), category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'qualification' },
  { entity: 'qualification', attribute: 'status', schema: z.enum(['planned', 'in_progress', 'completed', 'awarded', 'withdrawn']), category: 'academic_record', conflictPolicy: 'planning_latest_statement', consequential: true, jointReviewGroup: 'qualification_result', label: 'qualification status' },
  { entity: 'qualification', attribute: 'total', schema: GradeValueSchema, category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: true, jointReviewGroup: 'qualification_result', label: 'qualification total' },
  { entity: 'qualification', attribute: 'expected_completion', schema: PartialDateSchema, category: 'academic_record', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'expected completion' },

  { entity: 'test_attempt', attribute: 'record', schema: TestScoreRecordSchema, category: 'test_scores', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'test result' },
  { entity: 'test_attempt', attribute: 'plan', schema: z.object({ family: TestFamilySchema, targetWindow: PartialDateSchema.nullable(), purpose: z.string().nullable() }).strict(), category: 'test_scores', conflictPolicy: 'owner_latest', consequential: false, label: 'planned test' },

  { entity: 'gpa_calculation', attribute: 'result', schema: z.object({ calculationRef: z.string().min(1), value: z.number(), scaleNote: z.string().nullable() }).strict(), category: 'academic_record', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'institution-specific GPA' },
  { entity: 'waiver', attribute: 'state', schema: z.object({ waiverRef: z.string().min(1), institutionRef: z.string().min(1), state: z.enum(['not_requested', 'pending', 'approved', 'denied']) }).strict(), category: 'application_scope', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'waiver status' },
  { entity: 'contextual_criterion', attribute: 'result', schema: z.object({ criteriaRef: z.string().min(1), meets: z.boolean() }).strict(), category: 'application_scope', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'published contextual criterion' },
  { entity: 'accommodation', attribute: 'status', schema: z.object({ organization: z.string().min(1), status: z.enum(['not_requested', 'pending', 'approved', 'denied']) }).strict(), category: 'health_accessibility', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'testing accommodation status' },

  // ---- School context (from school profile / counselor) -------------------
  { entity: 'school_offering', attribute: 'course', schema: z.object({ name: z.string().min(1), subjectKey: z.string().nullable(), level: z.enum(COURSE_LEVELS).nullable(), termsOffered: z.array(z.string()), prerequisites: z.array(z.string()), availability: z.enum(['catalog_listed', 'confirmed_running', 'not_offered', 'unknown']) }).strict(), category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: true, label: 'school course offering' },
  { entity: 'school_context', attribute: 'note', schema: z.object({ topic: z.string().min(1), text: z.string().min(1) }).strict(), category: 'education_context', conflictPolicy: 'planning_latest_statement', consequential: false, label: 'school context' },

  // ---- Commitments --------------------------------------------------------
  { entity: 'commitment', attribute: 'definition', schema: z.object({ label: z.string().min(1), kind: z.enum(['paid_work', 'caregiving', 'school', 'activity', 'faith_or_cultural', 'other']), weekly: z.array(WeeklySlotSchema), period: DateIntervalSchema.nullable() }).strict(), category: 'practical_constraints', conflictPolicy: 'owner_latest', consequential: true, label: 'regular commitment' },

  // ---- Experiences (Agent 08) --------------------------------------------
  { entity: 'experience', attribute: 'identity', schema: z.object({ titleStudentSupplied: z.string().min(1), organization: z.string().nullable(), organizationKind: z.enum(['formal_organization', 'school', 'employer', 'family', 'informal', 'self_directed', 'unknown']), category: z.enum(EXPERIENCE_CATEGORIES) }).strict(), category: 'experiences', conflictPolicy: 'owner_latest', consequential: false, label: 'activity' },
  { entity: 'episode', attribute: 'definition', schema: z.object({ experienceRef: z.string().min(1), roleTitle: z.string().nullable(), titleIsOfficial: z.boolean(), period: DateIntervalSchema, time: TimeEstimateSchema.nullable() }).strict(), category: 'experiences', conflictPolicy: 'owner_latest', consequential: true, label: 'activity period and role' },
  { entity: 'episode', attribute: 'contribution', schema: z.object({ personalTasks: z.array(z.string().min(1)), decisionsInfluenced: z.array(z.string().min(1)), teamOutcomes: z.array(OutcomeSchema), personalOutcomes: z.array(OutcomeSchema), supervision: z.enum(['supervised', 'independent', 'mixed', 'unknown']) }).strict(), category: 'experiences', conflictPolicy: 'owner_latest', consequential: true, label: 'contribution' },
  { entity: 'episode', attribute: 'learning', schema: z.object({ studentWords: z.string().min(1) }).strict(), category: 'experiences', conflictPolicy: 'owner_latest', consequential: false, allowedOrigins: ['student_statement'], label: 'what you learned' },
  { entity: 'award', attribute: 'definition', schema: z.object({ title: z.string().min(1), organizer: z.string().nullable(), date: PartialDateSchema.nullable(), scope: z.enum(AWARD_SCOPES), stage: z.enum(AWARD_STAGES), attribution: z.enum(['individual', 'team']), experienceRef: z.string().nullable(), selectionNote: z.string().nullable() }).strict(), category: 'experiences', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'award or distinction' },
  { entity: 'research_output', attribute: 'definition', schema: z.object({ experienceRef: z.string().min(1), questionSummary: z.string().nullable(), status: z.enum(RESEARCH_STATUSES), studentTasks: z.array(z.string()), supervision: z.enum(['supervised', 'independent', 'unknown']), approvalStatus: z.enum(['not_required', 'approved_before_work', 'pending', 'unknown']), authorship: z.string().nullable(), oversight: z.array(z.enum(OVERSIGHT_AREAS)).default([]) }).strict(), category: 'experiences', conflictPolicy: 'evidence_reconcile', consequential: true, label: 'research output' },
];

export const FIELD_CATALOG: ReadonlyMap<string, FieldDefinition> = new Map(defs.map((d) => [`${d.entity}.${d.attribute}`, d]));

export function getFieldDefinition(entity: string, attribute: string): FieldDefinition | undefined {
  return FIELD_CATALOG.get(`${entity}.${attribute}`);
}

export const ENTITY_TYPES: ReadonlySet<string> = new Set(defs.map((d) => d.entity));
