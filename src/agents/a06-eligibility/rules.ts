import { z } from 'zod';
import { TestFamilySchema } from '../../shared/assessments.js';
import { COURSE_LEVELS } from '../../shared/fields.js';
import { ApplicantCategorySchema, DECISION_STAGES, DecisionStageSchema, type DecisionStage } from '../../shared/scope.js';
import { SourceRecordSchema } from '../../shared/sources.js';
import { CalendarDateSchema, PartialDateSchema } from '../../shared/time.js';

/**
 * Rule packages (spec 06 "Rule acquisition and normalization").
 *
 * "Represent requirements as structured logic with readable source text. A rule
 * can require all conditions, at least one alternative, a minimum count, a
 * subject-specific threshold, or an exception with its own conditions. Store
 * units, grade scales, course levels, timing, and evidence requirements.
 * Version every rule package."
 *
 * A package becomes operational only after an admissions-qualified reviewer has
 * validated source, scope, logic, exceptions and boundary tests (06 release
 * gate). Drafts can never affirm or exclude eligibility.
 */

export const EvidenceRequirementSchema = z.enum(['self_report_ok', 'document_ok', 'official_required']);
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

export const SourceCitationSchema = z
  .object({
    sourceId: z.string().min(1),
    section: z.string().optional(),
    /** Verbatim passage the rule was derived from. */
    quote: z.string().min(1),
  })
  .strict();
export type SourceCitation = z.infer<typeof SourceCitationSchema>;

const GradeThresholdSchema = z.object({ scaleRef: z.string().min(1), original: z.string().min(1) }).strict();

export const PredicateSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('qualification'),
      /** Any of these credential ids satisfies the credential part. */
      credentialIds: z.array(z.string().min(1)).min(1),
      minimumTotal: GradeThresholdSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('subject_result'),
      /** Credential-specific subject keys; broad taxonomy matches never satisfy this (06T05). */
      subjectKeys: z.array(z.string().min(1)).min(1),
      levels: z.array(z.enum(COURSE_LEVELS)).optional(),
      minimumGrade: GradeThresholdSchema.optional(),
      /** How repeated attempts are treated; 'unspecified' means the institution decides and conflicting attempts stay unresolved. */
      attemptPolicy: z.enum(['any', 'latest', 'first', 'unspecified']).default('unspecified'),
    })
    .strict(),
  z
    .object({
      type: z.literal('course_count'),
      subjectKeys: z.array(z.string().min(1)).optional(),
      levels: z.array(z.enum(COURSE_LEVELS)).optional(),
      minimumGrade: GradeThresholdSchema.optional(),
      minCount: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('test_score'),
      family: TestFamilySchema,
      /** Registry versions the institution lists. A report on another scale is never converted. */
      acceptedVersions: z.array(z.string().min(1)).min(1),
      /** 'total' or a section key. */
      component: z.string().min(1),
      minimum: z.number(),
      sectionMinimums: z.array(z.object({ section: z.string().min(1), minimum: z.number() }).strict()).default([]),
      acceptsIssuerSuperscore: z.boolean().default(false),
      administeredOnOrAfter: PartialDateSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('category'),
      fact: z.enum(['citizenship', 'residence_country', 'school_country', 'schooling_language', 'applicant_category', 'postsecondary_enrollment', 'qualification_system']),
      operator: z.enum(['in', 'not_in']),
      values: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('schooling_language_years'),
      languages: z.array(z.string().min(2)).min(1),
      minimumYears: z.number().positive(),
    })
    .strict(),
  z.object({ type: z.literal('waiver_approved'), waiverRef: z.string().min(1) }).strict(),
  z.object({ type: z.literal('institution_gpa'), calculationRef: z.string().min(1), minimum: z.number() }).strict(),
  z.object({ type: z.literal('contextual_criterion'), criteriaRef: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('age'),
      minimumAge: z.number().int().nonnegative().optional(),
      maximumAgeInclusive: z.number().int().nonnegative().optional(),
      referenceDate: CalendarDateSchema,
    })
    .strict(),
  z.object({ type: z.literal('completion_by'), latestDate: PartialDateSchema }).strict(),
]);
export type Predicate = z.infer<typeof PredicateSchema>;

const StageEvidenceSchema = z
  .object({
    application: EvidenceRequirementSchema.optional(),
    offer: EvidenceRequirementSchema.optional(),
    enrollment: EvidenceRequirementSchema.optional(),
    credit_or_placement: EvidenceRequirementSchema.optional(),
  })
  .strict();

export interface PredicateNode {
  kind: 'predicate';
  id: string;
  label: string;
  predicate: Predicate;
  /** Stages at which this condition applies. */
  stages: DecisionStage[];
  mandatory: boolean;
  /** Whether a planned, in-progress or predicted result may satisfy the rule conditionally at the listed stages. */
  futureCompletionPermittedAt: DecisionStage[];
  evidence: z.infer<typeof StageEvidenceSchema>;
  source: SourceCitation;
  /** Published remedy or alternative route, in the institution's terms. */
  publishedRemedy?: string;
  applicability?: Condition;
}

export interface GroupNode {
  kind: 'all' | 'any' | 'at_least';
  id: string;
  label: string;
  n?: number;
  children: RuleNode[];
  stages?: DecisionStage[];
  applicability?: Condition;
  source?: SourceCitation;
}

export interface NotNode {
  kind: 'not';
  id: string;
  label: string;
  child: RuleNode;
}

export type RuleNode = PredicateNode | GroupNode | NotNode;

/** Applicability conditions reuse predicates; they decide whether a rule applies before it is evaluated. */
export type Condition = { kind: 'predicate'; predicate: Predicate } | { kind: 'all' | 'any'; children: Condition[] } | { kind: 'not'; child: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('predicate'), predicate: PredicateSchema }).strict(),
    z.object({ kind: z.enum(['all', 'any']), children: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ kind: z.literal('not'), child: ConditionSchema }).strict(),
  ]),
) as z.ZodType<Condition>;

export const RuleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([
    z
      .object({
        kind: z.literal('predicate'),
        id: z.string().min(1),
        label: z.string().min(1),
        predicate: PredicateSchema,
        stages: z.array(DecisionStageSchema).min(1).default([...DECISION_STAGES]),
        mandatory: z.boolean().default(true),
        futureCompletionPermittedAt: z.array(DecisionStageSchema).default([]),
        evidence: StageEvidenceSchema.default({}),
        source: SourceCitationSchema,
        publishedRemedy: z.string().optional(),
        applicability: ConditionSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.enum(['all', 'any', 'at_least']),
        id: z.string().min(1),
        label: z.string().min(1),
        n: z.number().int().positive().optional(),
        children: z.array(RuleNodeSchema).min(1),
        stages: z.array(DecisionStageSchema).optional(),
        applicability: ConditionSchema.optional(),
        source: SourceCitationSchema.optional(),
      })
      .strict(),
    z.object({ kind: z.literal('not'), id: z.string().min(1), label: z.string().min(1), child: RuleNodeSchema }).strict(),
  ]),
) as z.ZodType<RuleNode>;

export const TestingPolicySchema = z
  .object({
    family: TestFamilySchema,
    purpose: z.enum(['admission', 'scholarship', 'placement', 'credit', 'language_proficiency']),
    applicantCategories: z.array(ApplicantCategorySchema).min(1),
    policy: z.enum(['required', 'recommended', 'optional', 'not_considered', 'unresolved']),
    acceptedVersions: z.array(z.string()).default([]),
    reporting: z.enum(['self_report_then_official', 'official_only', 'not_applicable', 'unknown']).default('unknown'),
    superscore: z.enum(['accepted', 'not_accepted', 'unknown']).default('unknown'),
    lastAcceptedTestDate: z.string().nullable().default(null),
    receiptDeadline: z.string().nullable().default(null),
    /** Policies sharing a group are alternatives: any one satisfies the requirement ("ACT or SAT"). */
    alternativeGroup: z.string().min(1).nullable().default(null),
    source: SourceCitationSchema,
  })
  .strict();
export type TestingPolicy = z.infer<typeof TestingPolicySchema>;

export const SourceConflictSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    sourceIds: z.array(z.string()).min(2),
    affectedRuleIds: z.array(z.string()).min(1),
    status: z.enum(['unresolved', 'resolved']),
    /** A precise question for the institution, including both source sections and the applicant scope. */
    question: z.string().min(10),
  })
  .strict();
export type SourceConflict = z.infer<typeof SourceConflictSchema>;

export const RulePackageSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    institutionRef: z.string().min(1),
    institutionName: z.string().min(1),
    programRef: z.string().min(1),
    programName: z.string().min(1),
    campusRef: z.string().nullable().default(null),
    degreeLevel: z.enum(['undergraduate_first_degree', 'foundation', 'associate', 'graduate', 'other']),
    entryCycle: z.string().min(4),
    applicantCategories: z.array(ApplicantCategorySchema).min(1),
    /** Qualification systems this package has been validated for. Others are outside supported coverage. */
    qualificationSystems: z.array(z.string().min(1)).min(1),
    stagesCovered: z.array(DecisionStageSchema).min(1),
    sources: z.array(SourceRecordSchema).min(1),
    reviewStatus: z.enum(['draft', 'reviewed', 'retired']),
    reviewedBy: z.string().optional(),
    reviewedAt: z.string().optional(),
    rules: RuleNodeSchema,
    testingPolicies: z.array(TestingPolicySchema).default([]),
    sourceConflicts: z.array(SourceConflictSchema).default([]),
    /** True for fictional fixtures; such packages must never be shown as real institutions. */
    synthetic: z.boolean().default(false),
  })
  .strict();
export type RulePackage = z.infer<typeof RulePackageSchema>;
export type RulePackageInput = z.input<typeof RulePackageSchema>;

export function packageVersionRef(p: Pick<RulePackage, 'id' | 'version'>): string {
  return `${p.id}@${p.version}`;
}

/** Structural checks beyond the schema: unique ids, known sources, sane counts. */
export function packageStructureIssues(p: RulePackage): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const sourceIds = new Set(p.sources.map((s) => s.id));
  const visit = (n: RuleNode): void => {
    if (ids.has(n.id)) issues.push(`duplicate rule id ${n.id}`);
    ids.add(n.id);
    if (n.kind === 'predicate') {
      if (!sourceIds.has(n.source.sourceId)) issues.push(`rule ${n.id} cites unknown source ${n.source.sourceId}`);
      for (const st of n.futureCompletionPermittedAt) if (!n.stages.includes(st)) issues.push(`rule ${n.id} permits future completion at a stage it does not apply to`);
    } else if (n.kind === 'not') {
      visit(n.child);
    } else {
      if (n.kind === 'at_least' && (n.n === undefined || n.n > n.children.length)) issues.push(`rule ${n.id}: at_least needs 1 <= n <= children`);
      if (n.kind !== 'at_least' && n.n !== undefined) issues.push(`rule ${n.id}: n is only valid for at_least`);
      n.children.forEach(visit);
    }
  };
  visit(p.rules);
  for (const c of p.sourceConflicts) {
    for (const r of c.affectedRuleIds) if (!ids.has(r)) issues.push(`conflict ${c.id} references unknown rule ${r}`);
    for (const s of c.sourceIds) if (!sourceIds.has(s)) issues.push(`conflict ${c.id} references unknown source ${s}`);
  }
  for (const t of p.testingPolicies) if (!sourceIds.has(t.source.sourceId)) issues.push(`testing policy for ${t.family} cites unknown source`);
  if (p.reviewStatus === 'reviewed' && (!p.reviewedBy || !p.reviewedAt)) issues.push('a reviewed package must record its reviewer and review time');
  return issues;
}
