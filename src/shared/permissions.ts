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
  '05': ['goals_preferences', 'exploration_reflections', 'education_context', 'practical_constraints', 'experiences', 'interaction_preferences'],
  '06': ['education_context', 'academic_record', 'test_scores', 'application_scope'],
  '07': ['education_context', 'academic_record', 'test_scores', 'application_scope', 'practical_constraints', 'plans_tasks', 'findings', 'goals_preferences'],
  '08': ['experiences', 'practical_constraints', 'goals_preferences', 'education_context'],
  '09': ['goals_preferences', 'practical_constraints', 'education_context', 'application_scope'],
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
  '05': [...ROLE_MODEL_CONTEXT_CATEGORIES['05']!, 'academic_record'],
  '06': [...ROLE_MODEL_CONTEXT_CATEGORIES['06']!, 'citizenship_residency', 'identity_birthdate'],
  '07': [...ROLE_MODEL_CONTEXT_CATEGORIES['07']!, 'health_accessibility', 'financial'],
  '08': [...ROLE_MODEL_CONTEXT_CATEGORIES['08']!, 'family_context'],
  '09': [...ROLE_MODEL_CONTEXT_CATEGORIES['09']!, 'financial', 'citizenship_residency', 'identity_birthdate', 'academic_record', 'experiences', 'health_accessibility'],
};
