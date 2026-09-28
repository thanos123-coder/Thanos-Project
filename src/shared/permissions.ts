import { z } from 'zod';

/**
 * Permission vocabulary. Access decisions combine actor, relationship, object
 * (data category), purpose and current policy (spec 04 "Permissions and shared
 * accounts"). A generic "family access" toggle is too vague for sensitive
 * records, so categories are fine-grained.
 */

export const DATA_CATEGORIES = [
  'identity_contact',
  'identity_birthdate',
  'citizenship_residency',
  'education_context',
  'academic_record',
  'test_scores',
  'application_scope',
  'goals_preferences',
  'exploration_reflections',
  'practical_constraints',
  'financial',
  'family_context',
  'health_accessibility',
  'experiences',
  'documents_raw',
  'voice_audio',
  'conversation_transcripts',
  'plans_tasks',
  'findings',
  'interaction_preferences',
  'third_party_private',
  // Volume two. Individual amounts and raw aid documents (tax returns, income, assets, award letter lines);
  // other roles normally see only an affordability state or a budget range (15 "Intake with minimum necessary data").
  'financial_detail',
  // Private story-bank notes from essay exploration, under their own permissions (17 "Story bank structure").
  'story_bank',
  // Student drafts of application responses and their assistance history (18 "Artifact and destination model").
  'writing_drafts',
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];
export const DataCategorySchema = z.enum(DATA_CATEGORIES);

/**
 * Relative sensitivity used when a derived artifact combines several inputs:
 * derived data inherits the most restrictive category of its inputs (04R07).
 */
export const CATEGORY_SENSITIVITY: Readonly<Record<DataCategory, number>> = {
  interaction_preferences: 1,
  plans_tasks: 1,
  application_scope: 2,
  education_context: 2,
  findings: 2,
  goals_preferences: 3,
  practical_constraints: 3,
  experiences: 3,
  academic_record: 3,
  test_scores: 3,
  exploration_reflections: 4,
  conversation_transcripts: 4,
  documents_raw: 4,
  financial: 5,
  family_context: 5,
  citizenship_residency: 5,
  identity_contact: 5,
  identity_birthdate: 5,
  health_accessibility: 6,
  voice_audio: 6,
  third_party_private: 6,
  writing_drafts: 4,
  story_bank: 5,
  financial_detail: 6,
};

export function mostRestrictive(categories: readonly DataCategory[]): DataCategory {
  if (categories.length === 0) return 'findings';
  return categories.reduce((a, b) => (CATEGORY_SENSITIVITY[b] > CATEGORY_SENSITIVITY[a] ? b : a));
}

export const ACTOR_KINDS = ['student', 'supporter', 'school_counselor', 'institution_admin', 'internal_support', 'agent'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const ActorSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(ACTOR_KINDS),
    tenantId: z.string().min(1),
    /** For agents: the specialist role, e.g. '06'. */
    role: z.string().optional(),
  })
  .strict();
export type Actor = z.infer<typeof ActorSchema>;

export const PURPOSES = [
  'counseling',
  'intake',
  'document_import',
  'record_maintenance',
  'exploration',
  'eligibility_check',
  'academic_planning',
  'experience_review',
  'opportunity_research',
  // Volume two: one purpose per specialist role 10-18.
  'project_mentoring',
  'college_research',
  'fit_matching',
  'admissions_context',
  'application_strategy',
  'financial_planning',
  'scholarship_matching',
  'essay_exploration',
  'narrative_review',
  'schedule_view',
  'progress_view',
  'human_review',
  'account_support',
  'export',
  'deletion',
] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PurposeSchema = z.enum(PURPOSES);

export const AccessSchema = z.enum(['read', 'write', 'delete', 'share']);
export type Access = z.infer<typeof AccessSchema>;

export const PermissionGrantSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    studentId: z.string().min(1),
    granteeActorId: z.string().min(1),
    relationship: z.enum(['supporter', 'school_counselor', 'internal_support']),
    purposes: z.array(PurposeSchema).min(1),
    categories: z.array(DataCategorySchema).min(1),
    access: z.array(AccessSchema).min(1),
    grantedBy: z.string().min(1),
    grantedAt: z.string().min(1),
    expiresAt: z.string().optional(),
    revokedAt: z.string().optional(),
    /** Why the grant exists: student invitation, school contract policy, support ticket, ... */
    policyBasis: z.string().min(1),
  })
  .strict();
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

/**
 * Categories each specialist role may place into a *model context* (prompt),
 * before any actor-specific restriction. The view builder intersects these with
 * what the acting person may see. Anything not listed is excluded, which is how
 * the opportunity scout never sends grades or an exact address to a model or a
 * search provider (spec 04 "Retrieval and memory design", 09 "Search brief and
 * minimum personal data").
 */
export const ROLE_MODEL_CONTEXT_CATEGORIES: Readonly<Record<string, readonly DataCategory[]>> = {
  '01': ['application_scope', 'education_context', 'plans_tasks', 'findings', 'interaction_preferences', 'goals_preferences', 'practical_constraints'],
  '02': ['education_context', 'application_scope', 'practical_constraints', 'interaction_preferences', 'goals_preferences', 'plans_tasks', 'experiences'],
  '03': ['education_context'],
  '04': [],
  '05': ['goals_preferences', 'exploration_reflections', 'education_context', 'application_scope', 'practical_constraints', 'experiences', 'interaction_preferences'],
  '06': ['education_context', 'academic_record', 'test_scores', 'application_scope'],
  '07': ['education_context', 'academic_record', 'test_scores', 'application_scope', 'practical_constraints', 'plans_tasks', 'findings', 'goals_preferences'],
  '08': ['experiences', 'practical_constraints', 'goals_preferences', 'education_context'],
  '09': ['goals_preferences', 'practical_constraints', 'education_context', 'application_scope'],
  '10': ['goals_preferences', 'practical_constraints', 'plans_tasks', 'experiences', 'education_context', 'interaction_preferences'],
  // Public research: the applicant category and cycle only; never names, stories or finances (11 "Research request contract").
  '11': ['application_scope', 'education_context'],
  '12': ['goals_preferences', 'practical_constraints', 'application_scope', 'education_context', 'findings', 'interaction_preferences'],
  '13': ['application_scope', 'education_context', 'findings'],
  '14': ['application_scope', 'plans_tasks', 'findings', 'goals_preferences', 'practical_constraints', 'education_context'],
  '15': ['application_scope', 'financial'],
  '16': ['application_scope', 'education_context', 'goals_preferences'],
  '17': ['story_bank', 'experiences', 'exploration_reflections', 'goals_preferences', 'interaction_preferences', 'application_scope'],
  '18': ['writing_drafts', 'story_bank', 'experiences', 'application_scope'],
};

/**
 * Categories each role's *deterministic code* may read for local evaluation
 * (rule matching, date checks, cost totals). A superset of the model context:
 * e.g. role 09 checks a citizenship condition locally after retrieving the
 * official eligibility page, without broadcasting the student's status.
 */
export const ROLE_LOCAL_CATEGORIES: Readonly<Record<string, readonly DataCategory[]>> = {
  '01': [...ROLE_MODEL_CONTEXT_CATEGORIES['01']!],
  '02': [...ROLE_MODEL_CONTEXT_CATEGORIES['02']!, 'academic_record', 'test_scores', 'financial', 'citizenship_residency', 'family_context', 'health_accessibility', 'identity_birthdate'],
  '03': ['education_context', 'academic_record', 'test_scores', 'identity_contact', 'documents_raw'],
  '04': [...DATA_CATEGORIES],
  // Budget is read only by deterministic code, to filter out paid experiments (05T09); it never enters a prompt.
  '05': [...ROLE_MODEL_CONTEXT_CATEGORIES['05']!, 'academic_record', 'financial'],
  '06': [...ROLE_MODEL_CONTEXT_CATEGORIES['06']!, 'citizenship_residency', 'identity_birthdate'],
  '07': [...ROLE_MODEL_CONTEXT_CATEGORIES['07']!, 'health_accessibility', 'financial'],
  '08': [...ROLE_MODEL_CONTEXT_CATEGORIES['08']!, 'family_context'],
  '09': [...ROLE_MODEL_CONTEXT_CATEGORIES['09']!, 'financial', 'citizenship_residency', 'identity_birthdate', 'academic_record', 'experiences', 'health_accessibility'],
  // Academic deadlines from the planner shape the project schedule (10 "Planning procedure", step 1).
  '10': [...ROLE_MODEL_CONTEXT_CATEGORIES['10']!, 'findings', 'third_party_private'],
  // A requirement that depends on sensitive context is compared privately, inside the authorized environment.
  '11': [...ROLE_MODEL_CONTEXT_CATEGORIES['11']!, 'citizenship_residency'],
  // Budget and a student-described support need are hard constraints evaluated in code, never in a prompt.
  '12': [...ROLE_MODEL_CONTEXT_CATEGORIES['12']!, 'financial', 'health_accessibility', 'plans_tasks'],
  '13': [...ROLE_MODEL_CONTEXT_CATEGORIES['13']!, 'academic_record', 'test_scores', 'plans_tasks'],
  '14': [...ROLE_MODEL_CONTEXT_CATEGORIES['14']!, 'financial'],
  // Raw amounts and award documents stay in the affordability planner's local view (15T16).
  '15': [...ROLE_MODEL_CONTEXT_CATEGORIES['15']!, 'financial_detail', 'citizenship_residency', 'documents_raw', 'practical_constraints', 'plans_tasks'],
  '16': [...ROLE_MODEL_CONTEXT_CATEGORIES['16']!, 'citizenship_residency', 'identity_birthdate', 'academic_record', 'test_scores', 'financial', 'experiences', 'plans_tasks'],
  '17': [...ROLE_MODEL_CONTEXT_CATEGORIES['17']!, 'conversation_transcripts', 'plans_tasks'],
  '18': [...ROLE_MODEL_CONTEXT_CATEGORIES['18']!, 'plans_tasks', 'education_context', 'interaction_preferences'],
};
