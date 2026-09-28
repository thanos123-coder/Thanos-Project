import { z } from 'zod';
import { sha256Hex, stableStringify } from '../../shared/hash.js';
import { MoneySchema, type Money } from '../../shared/money.js';
import { addDays, CalendarDateSchema, diffDays, LocalTimeSchema, TimezoneSchema, type CalendarDate } from '../../shared/time.js';
import { OFFICES } from './entities.js';

/**
 * Atomic institutional claims (11 "Claim level evidence procedure" and "Data
 * contract and presentation").
 *
 * One rule or fact per record, with its conditions, exceptions, units and
 * dates attached; the narrowest scope its source supports; a source anchor
 * verified against the retrieved text; four dates; and a status that
 * separates authority and freshness from extraction confidence. Consequential
 * predicate values are typed, so a rule that is reused repeatedly has been
 * compiled into a versioned representation rather than re-read from prose.
 */

// ---------------------------------------------------------------- predicate values

export const DeadlineValueSchema = z
  .object({
    /** Exact date when the source gives one. */
    date: CalendarDateSchema.nullable(),
    /** A month-only statement ("applications close in November") is kept, but is not an exact date. */
    month: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
    /** Null when the source states no time: never an invented 23:59 (11 "Dates and freshness"). */
    time: LocalTimeSchema.nullable(),
    timezone: TimezoneSchema.nullable(),
    /** The source's own wording of the zone, e.g. "Eastern Time" or "UK time". */
    timezoneLabel: z.string().max(60).nullable(),
    receipt: z.enum(['submitted_by', 'received_by', 'postmarked_by']).nullable(),
    originalText: z.string().min(1).max(500),
  })
  .strict()
  .refine((d) => d.date !== null || d.month !== null, 'a deadline needs at least a month');
export type DeadlineValue = z.infer<typeof DeadlineValueSchema>;

export const COST_PERIODS = ['academic_year', 'term', 'semester', 'quarter', 'month', 'credit', 'one_time', 'program_total'] as const;
export const FEE_CATEGORIES = ['all', 'domestic', 'international', 'in_state', 'out_of_state', 'home', 'overseas'] as const;

export const CostValueSchema = z
  .object({
    amount: MoneySchema,
    /** A cost missing its period is rejected, never guessed (11 step 4). */
    period: z.enum(COST_PERIODS),
    feeCategory: z.enum(FEE_CATEGORIES),
    /** Component keys already included in this amount, so they are never added twice (15T04). */
    includes: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
    billed: z.boolean().nullable(),
  })
  .strict();
export type CostValue = z.infer<typeof CostValueSchema>;

export const STAT_MEASURES = ['applicants', 'admits', 'enrolled', 'admit_rate', 'yield', 'score_25th', 'score_50th', 'score_75th', 'gpa_average', 'average_net_price', 'graduation_rate', 'other'] as const;
export const STAT_POPULATIONS = [
  'first_year_applicants',
  'first_year_admits',
  'first_year_enrolled',
  'enrolled_score_submitters',
  'transfer_applicants',
  'transfer_admits',
  'program_applicants',
  'program_admits',
  'aided_first_year_students',
  'all_undergraduates',
] as const;

export const StatisticValueSchema = z
  .object({
    measure: z.enum(STAT_MEASURES),
    cohort: z
      .object({
        population: z.enum(STAT_POPULATIONS),
        /** The reporting year exactly as the source states it, e.g. "fall 2025" or "2025-26". */
        year: z.string().min(4).max(20),
        applicantCategory: z.string().max(60).nullable(),
      })
      .strict(),
    /** What the value is a share of, when it is a rate. */
    denominator: z.string().max(200).nullable(),
    /** Suppressed, unavailable and zero are different states (11T08). */
    value: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('number'), value: z.number(), unit: z.enum(['count', 'percent', 'score', 'gpa', 'money']), currency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null) }).strict(),
      z.object({ kind: z.literal('suppressed') }).strict(),
      z.object({ kind: z.literal('not_reported') }).strict(),
    ]),
    scoreType: z.string().max(40).nullable(),
    methodology: z.string().max(200).nullable(),
    /** A statistic describes a historical group; it is never an admissions cutoff or a probability (11T09). */
    notAThreshold: z.literal(true),
  })
  .strict();
export type StatisticValue = z.infer<typeof StatisticValueSchema>;

export const RequirementValueSchema = z
  .object({
    text: z.string().min(1).max(600),
    normalized: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  })
  .strict();

export const AccessValueSchema = z
  .object({
    route: z.enum(['direct_entry', 'later_competitive_selection', 'open_after_prerequisites', 'unknown']),
    /** Whether the source says entry to the field is guaranteed; null when it does not say. */
    guaranteed: z.boolean().nullable(),
    text: z.string().min(1).max(600),
  })
  .strict();

export const ROUND_KINDS = ['early_action', 'restrictive_early_action', 'early_decision', 'regular', 'rolling', 'ucas', 'other'] as const;
export const ROUND_TARGETS = [
  'private_early_action',
  'public_early_action',
  'any_early_action',
  'early_decision',
  'restrictive_early_action',
  'binding_round',
  'foreign_early_round',
  'rolling_admission',
] as const;
export const EXCEPTION_CONDITIONS = ['public_institution', 'foreign_institution', 'scholarship_requires_early', 'nonbinding_rolling', 'after_denial', 'after_deferral', 'other'] as const;

export const RoundRuleValueSchema = z
  .object({
    round: z.string().regex(/^[a-z0-9_]+$/).max(60),
    kind: z.enum(ROUND_KINDS),
    binding: z.boolean(),
    /** What applying in this round forbids elsewhere at the same time, with the exact exceptions (14 "Round rules as a constraint system"). */
    restrictions: z
      .array(
        z
          .object({
            target: z.enum(ROUND_TARGETS),
            exceptions: z.array(z.object({ condition: z.enum(EXCEPTION_CONDITIONS), text: z.string().min(1).max(400) }).strict()).default([]),
          })
          .strict(),
      )
      .default([]),
    /** This round becomes available only after an outcome elsewhere (e.g. after a denial). */
    requiresOutcome: z.array(z.enum(['denied_elsewhere', 'deferred_elsewhere', 'released_from_binding'])).default([]),
    decisionRelease: CalendarDateSchema.nullable(),
    replyBy: CalendarDateSchema.nullable(),
    /** The cycle of the binding agreement text itself, which can differ from the page footer (14T03). */
    agreementCycle: z.string().min(4).max(20).nullable(),
    commitmentText: z.string().max(800).nullable(),
    text: z.string().min(1).max(800),
  })
  .strict();
export type RoundRuleValue = z.infer<typeof RoundRuleValueSchema>;

export const PROMPT_ARTIFACT_KINDS = ['personal_essay', 'supplement', 'short_answer', 'personal_statement', 'insight_question', 'scholarship_essay'] as const;

export const WritingPromptValueSchema = z
  .object({
    promptId: z.string().regex(/^[a-z0-9_]+$/).max(80),
    /** The application field the answer goes into. */
    field: z.string().min(1).max(120),
    text: z.string().min(1).max(2000),
    /** The prompt's explicit asks, in order, as the source states them (18 "Prompt manifest"). */
    asks: z.array(z.string().min(1).max(300)).min(1).max(8),
    required: z.boolean(),
    conditionalOn: z.string().max(200).nullable(),
    artifactKind: z.enum(PROMPT_ARTIFACT_KINDS),
    limit: z
      .object({
        unit: z.enum(['words', 'characters']),
        min: z.number().int().nonnegative().nullable(),
        max: z.number().int().positive().nullable(),
        /** Whether spaces count, when the source says (UCAS: including spaces). */
        countsSpaces: z.boolean().nullable(),
        /** A limit shared across several fields, e.g. UCAS's combined total. */
        groupId: z.string().max(80).nullable(),
        groupMax: z.number().int().positive().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type WritingPromptValue = z.infer<typeof WritingPromptValueSchema>;

export const EstimatorScopeValueSchema = z
  .object({
    estimatorUrl: z.string().url().nullable(),
    supportedPopulations: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
    excludedSituations: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
    text: z.string().min(1).max(800),
  })
  .strict();

export const OutsideAwardPolicyValueSchema = z
  .object({
    rule: z.enum(['reduce_student_contribution_first', 'reduce_institutional_grant', 'no_displacement', 'case_by_case']),
    /** Amount of outside funding applied to the student contribution before institutional aid is reduced. */
    studentContributionFirst: MoneySchema.nullable(),
    text: z.string().min(1).max(800),
  })
  .strict();

export const ChoiceLimitValueSchema = z
  .object({
    system: z.string().min(1).max(40),
    maxChoices: z.number().int().positive(),
    restrictions: z.array(z.object({ rule: z.string().regex(/^[a-z0-9_]+$/), max: z.number().int().nonnegative(), text: z.string().min(1).max(400) }).strict()).default([]),
    text: z.string().min(1).max(800),
  })
  .strict();

export const ScholarshipRestrictionValueSchema = z
  .object({
    restriction: z.enum(['first_choice_program', 'specific_programs', 'specific_campus', 'none']),
    programs: z.array(z.string().min(1)).default([]),
    text: z.string().min(1).max(600),
  })
  .strict();

export const NominationValueSchema = z
  .object({
    perSchool: z.number().int().positive().nullable(),
    nominator: z.string().max(200).nullable(),
    refereeMustDiffer: z.boolean().nullable(),
    text: z.string().min(1).max(600),
  })
  .strict();

export const AidTimingValueSchema = z
  .object({
    mustApplyWithAdmission: z.boolean(),
    text: z.string().min(1).max(600),
  })
  .strict();

export const PROGRAM_ATTRIBUTES = ['setting', 'city_size', 'teaching_format', 'subject_flexibility', 'support_service', 'language_of_instruction', 'duration_years', 'undergraduate_research', 'accreditation', 'housing_guarantee'] as const;

export const ProgramAttributeValueSchema = z
  .object({
    attribute: z.enum(PROGRAM_ATTRIBUTES),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
    text: z.string().min(1).max(600),
  })
  .strict();

/** The predicate catalog: every claim kind the store accepts, with its value schema and family. */
export const PREDICATES = {
  application_deadline: { family: 'deadline', schema: DeadlineValueSchema, office: 'admissions' },
  scholarship_deadline: { family: 'deadline', schema: DeadlineValueSchema, office: 'scholarship_office' },
  nomination_deadline: { family: 'deadline', schema: DeadlineValueSchema, office: 'scholarship_office' },
  financial_aid_deadline: { family: 'deadline', schema: DeadlineValueSchema, office: 'financial_aid' },
  recommendation_deadline: { family: 'deadline', schema: DeadlineValueSchema, office: 'admissions' },
  document_deadline: { family: 'deadline', schema: DeadlineValueSchema, office: 'admissions' },
  reply_deadline: { family: 'deadline', schema: DeadlineValueSchema, office: 'admissions' },
  tuition: { family: 'cost', schema: CostValueSchema, office: 'financial_aid' },
  mandatory_fees: { family: 'cost', schema: CostValueSchema, office: 'financial_aid' },
  housing: { family: 'cost', schema: CostValueSchema, office: 'housing' },
  meals: { family: 'cost', schema: CostValueSchema, office: 'housing' },
  books_supplies: { family: 'cost', schema: CostValueSchema, office: 'financial_aid' },
  health_insurance: { family: 'cost', schema: CostValueSchema, office: 'financial_aid' },
  transport: { family: 'cost', schema: CostValueSchema, office: 'financial_aid' },
  personal: { family: 'cost', schema: CostValueSchema, office: 'financial_aid' },
  cost_of_attendance: { family: 'cost', schema: CostValueSchema, office: 'financial_aid' },
  application_fee: { family: 'cost', schema: CostValueSchema, office: 'admissions' },
  enrollment_deposit: { family: 'cost', schema: CostValueSchema, office: 'admissions' },
  statistic: { family: 'statistic', schema: StatisticValueSchema, office: 'registrar' },
  english_language_requirement: { family: 'requirement', schema: RequirementValueSchema, office: 'admissions' },
  testing_policy: { family: 'requirement', schema: RequirementValueSchema, office: 'admissions' },
  subject_requirement: { family: 'requirement', schema: RequirementValueSchema, office: 'department' },
  portfolio_requirement: { family: 'requirement', schema: RequirementValueSchema, office: 'department' },
  additional_requirement: { family: 'requirement', schema: RequirementValueSchema, office: 'department' },
  program_access_route: { family: 'access', schema: AccessValueSchema, office: 'department' },
  round_rule: { family: 'round', schema: RoundRuleValueSchema, office: 'admissions' },
  application_choice_limit: { family: 'round', schema: ChoiceLimitValueSchema, office: 'application_platform' },
  writing_prompt: { family: 'prompt', schema: WritingPromptValueSchema, office: 'admissions' },
  estimator_scope: { family: 'aid_rule', schema: EstimatorScopeValueSchema, office: 'financial_aid' },
  outside_award_policy: { family: 'aid_rule', schema: OutsideAwardPolicyValueSchema, office: 'financial_aid' },
  aid_application_timing: { family: 'aid_rule', schema: AidTimingValueSchema, office: 'financial_aid' },
  scholarship_program_restriction: { family: 'scholarship_rule', schema: ScholarshipRestrictionValueSchema, office: 'scholarship_office' },
  nomination_limit: { family: 'scholarship_rule', schema: NominationValueSchema, office: 'scholarship_office' },
  program_attribute: { family: 'attribute', schema: ProgramAttributeValueSchema, office: 'department' },
} as const satisfies Record<string, { family: string; schema: z.ZodType; office: (typeof OFFICES)[number] }>;

export type Predicate = keyof typeof PREDICATES;
export const PREDICATE_NAMES = Object.keys(PREDICATES) as Predicate[];
export const PredicateSchema = z.enum(PREDICATE_NAMES as [Predicate, ...Predicate[]]);
export type PredicateFamily = (typeof PREDICATES)[Predicate]['family'];

export function familyOf(p: Predicate): PredicateFamily {
  return PREDICATES[p].family;
}

// ---------------------------------------------------------------- claim records

export const CLAIM_STATUSES = ['verified', 'provisional', 'historical', 'conflicted', 'superseded', 'unavailable'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Applicant categories claims are scoped to. "all" only when the source says it applies to every applicant. */
export const APPLICANT_CATEGORIES = ['all', 'first_year', 'first_year_international', 'first_year_domestic', 'transfer', 'transfer_international', 'visiting', 'graduate'] as const;
export type ApplicantCategory = (typeof APPLICANT_CATEGORIES)[number];

export const ClaimSubjectSchema = z
  .object({
    /** The narrowest entity the source supports: a program, campus, school or institution. */
    entityId: z.string().regex(/^[a-z0-9_]+$/),
    institutionId: z.string().regex(/^[a-z0-9_]+$/),
    campusId: z.string().regex(/^[a-z0-9_]+$/).nullable(),
    programId: z.string().regex(/^[a-z0-9_]+$/).nullable(),
  })
  .strict();
export type ClaimSubject = z.infer<typeof ClaimSubjectSchema>;

export const SourceAnchorSchema = z
  .object({
    sourceId: z.string().min(1),
    url: z.string().url(),
    finalUrl: z.string().url(),
    passageId: z.string().nullable(),
    section: z.string().max(200).nullable(),
    page: z.number().int().positive().nullable(),
    /** The passage that supports the claim, verbatim (restricted evidence record; the interface shows a paraphrase). */
    quote: z.string().min(1).max(1200),
  })
  .strict();
export type SourceAnchor = z.infer<typeof SourceAnchorSchema>;

export const ClaimVisibilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('public') }).strict(),
  // Student-supplied evidence (a portal screenshot, an email) stays with that student (11T16).
  z.object({ kind: z.literal('private'), tenantId: z.string().min(1), studentId: z.string().min(1), capturedAt: z.string().min(1), accountContext: z.string().max(200) }).strict(),
]);
export type ClaimVisibility = z.infer<typeof ClaimVisibilitySchema>;

export const ClaimInputSchema = z
  .object({
    subject: ClaimSubjectSchema,
    cycle: z.string().regex(/^\d{4}$/).nullable(),
    applicantCategory: z.enum(APPLICANT_CATEGORIES),
    predicate: PredicateSchema,
    /** Distinguishes several claims of one predicate for one scope, e.g. a statistic's measure or a prompt id. */
    qualifier: z.string().max(120).default(''),
    value: z.unknown(),
    /** Other values the same source states for this same fact (an internally inconsistent page): the claim is then conflicted. */
    alternatives: z.array(z.object({ value: z.unknown(), quote: z.string().min(1).max(1200) }).strict()).max(5).default([]),
    conditions: z.array(z.string().min(1).max(400)).max(12).default([]),
    exceptions: z.array(z.string().min(1).max(400)).max(12).default([]),
    /** An explicit exception to an inherited rule, and why it overrides it (11 "Entity resolution and coverage"). */
    overrides: z.object({ claimId: z.string().min(1), reason: z.string().min(1).max(400) }).strict().nullable().default(null),
    sourceOwner: z.object({ entityId: z.string().regex(/^[a-z0-9_]+$/), office: z.enum(OFFICES), name: z.string().min(1).max(200) }).strict(),
    anchor: SourceAnchorSchema,
    publishedOn: CalendarDateSchema.nullable().default(null),
    effectiveCycle: z.string().regex(/^\d{4}$/).nullable().default(null),
    retrievedAt: z.string().min(1),
    status: z.enum(CLAIM_STATUSES),
    statusReason: z.string().max(400).nullable().default(null),
    missing: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
    extraction: z.enum(['curated', 'deterministic', 'model', 'student_supplied']),
    extractionConfidence: z.enum(['high', 'low']),
    visibility: ClaimVisibilitySchema.default({ kind: 'public' }),
  })
  .strict();
export type ClaimInput = z.input<typeof ClaimInputSchema>;
type ClaimInputParsed = z.infer<typeof ClaimInputSchema>;

export interface ClaimRecord extends ClaimInputParsed {
  /** Stable id for one fact from one source; never reused for a different claim. */
  claimId: string;
  version: number;
  /** Claims about the same fact and scope from other sources that disagree with this one. */
  conflictLinks: string[];
  nextReviewDue: string;
  recordedAt: string;
  /** Roles whose outputs depend on this claim; they are told when it changes. */
  dependents: string[];
}

/** The reference a derived artifact records for a claim; a new version invalidates every artifact citing it. */
export function claimRef(claimId: string): string {
  return `iclaim:${claimId}`;
}

/** The scope and fact a claim is about (without its source): claims sharing it are about the same thing. */
export function identityKey(c: Pick<ClaimInputParsed, 'subject' | 'cycle' | 'applicantCategory' | 'predicate' | 'qualifier'>): string {
  return stableStringify({ e: c.subject.entityId, y: c.cycle, a: c.applicantCategory, p: c.predicate, q: c.qualifier });
}

function claimIdFor(c: ClaimInputParsed): string {
  const vis = c.visibility.kind === 'private' ? `${c.visibility.tenantId}:${c.visibility.studentId}` : 'public';
  return `ic_${sha256Hex(stableStringify({ k: identityKey(c), src: c.anchor.finalUrl.replace(/[#?].*$/, ''), vis })).slice(0, 16)}`;
}

/** The content that matters when deciding whether a claim changed: not page chrome, anchors or retrieval time (11 "Dates and freshness"). */
function materialContent(c: Pick<ClaimInputParsed, 'value' | 'alternatives' | 'conditions' | 'exceptions' | 'cycle' | 'applicantCategory' | 'overrides'>): string {
  return stableStringify({ v: c.value, alt: c.alternatives.map((a) => a.value), c: [...c.conditions].sort(), x: [...c.exceptions].sort(), y: c.cycle, a: c.applicantCategory, o: c.overrides?.claimId ?? null });
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

// ---------------------------------------------------------------- validation (step 4)

/** Categories that change what a rule means, so a claim of these families must say which applicants it covers. */
const CATEGORY_SENSITIVE_FAMILIES = new Set<PredicateFamily>(['deadline', 'cost', 'requirement', 'round', 'prompt', 'aid_rule', 'scholarship_rule']);

export interface StructureCheck {
  ok: boolean;
  issues: string[];
  /** Components the claim lacks, added to `missing` (e.g. an official cutoff time). */
  missing: string[];
  value?: unknown;
}

/**
 * Code checks formats, units, ranges, impossible values and missing category
 * fields before any claim is stored. "A model's formatted citation is not proof
 * that the cited text supports the claim": the anchor quote must occur in the
 * retrieved passage (11 step 4).
 */
export function checkClaimStructure(c: ClaimInputParsed, passageText: string | null): StructureCheck {
  const issues: string[] = [];
  const missing: string[] = [];
  const def = PREDICATES[c.predicate];
  const parsed = def.schema.safeParse(c.value);
  if (!parsed.success) {
    issues.push(...parsed.error.issues.map((i) => `value.${i.path.join('.')}: ${i.message}`));
    return { ok: false, issues, missing };
  }
  const v = parsed.data as Record<string, unknown>;
  if (def.family === 'deadline') {
    const d = v as unknown as DeadlineValue;
    if (d.date === null) missing.push('exact_date');
    if (d.time === null) missing.push('official_cutoff_time');
    if (d.time !== null && d.timezone === null) missing.push('timezone');
  }
  if (def.family === 'cost') {
    const m = (v as { amount: Money }).amount;
    if (Number(m.amount) < 0) issues.push('a cost cannot be negative');
  }
  if (def.family === 'statistic') {
    const s = v as unknown as StatisticValue;
    if (s.value.kind === 'number') {
      if (s.value.unit === 'percent' && (s.value.value < 0 || s.value.value > 100)) issues.push(`a percentage must be between 0 and 100 (got ${s.value.value})`);
      if (s.value.unit === 'count' && (!Number.isInteger(s.value.value) || s.value.value < 0)) issues.push('a count must be a non-negative whole number');
      if (['admit_rate', 'yield', 'graduation_rate'].includes(s.measure) && s.value.unit !== 'percent') issues.push(`${s.measure} must be a percentage`);
      if (['admit_rate', 'yield', 'graduation_rate'].includes(s.measure) && s.denominator === null) issues.push(`${s.measure} needs its denominator`);
    }
  }
  if (CATEGORY_SENSITIVE_FAMILIES.has(def.family) && c.cycle === null) issues.push('the claim must state the entry cycle it applies to');
  for (const [i, alt] of c.alternatives.entries()) {
    if (!def.schema.safeParse(alt.value).success) issues.push(`alternatives[${i}]: value does not match the ${c.predicate} schema`);
  }
  if (c.visibility.kind === 'public') {
    if (passageText === null) issues.push('no retrieved passage supports this claim');
    else {
      if (!normalizeSpace(passageText).includes(normalizeSpace(c.anchor.quote))) issues.push('the anchor quote does not occur in the retrieved passage');
      for (const [i, alt] of c.alternatives.entries()) if (!normalizeSpace(passageText).includes(normalizeSpace(alt.quote))) issues.push(`alternatives[${i}]: the quote does not occur in the retrieved source`);
    }
  }
  // A claim with missing components is never stored as verified: the store records it as provisional (see upsert).
  if (c.status === 'verified' && c.extraction === 'model') issues.push('a model extraction is provisional until reviewed');
  return { ok: issues.length === 0, issues, missing, value: parsed.data };
}

export function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------- freshness

/**
 * When a claim should be checked again (11 "Dates and freshness"): active
 * prompts and round rules weekly in season, imminent consequential deadlines
 * within 72 hours, stable costs and descriptions monthly, statistics each
 * quarter. Operational defaults to evaluate, not guarantees.
 */
export function nextReviewDue(predicate: Predicate, value: unknown, retrievedAt: string): string {
  const day = retrievedAt.slice(0, 10) as CalendarDate;
  const family = familyOf(predicate);
  if (family === 'deadline') {
    const date = (value as DeadlineValue).date;
    const days = date ? diffDays(day, date) : null;
    return `${addDays(day, days !== null && days >= 0 && days <= 30 ? 3 : 7)}T00:00:00.000Z`;
  }
  if (family === 'round' || family === 'prompt') return `${addDays(day, 7)}T00:00:00.000Z`;
  if (family === 'statistic') return `${addDays(day, 90)}T00:00:00.000Z`;
  return `${addDays(day, 30)}T00:00:00.000Z`;
}

/** A consequential action revalidates its critical dependencies; a claim older than 72 hours is not fresh enough for one. */
export function freshEnoughFor(claim: Pick<ClaimRecord, 'retrievedAt' | 'nextReviewDue'>, nowIso: string, consequence: 'exploratory' | 'comparison' | 'binding' | 'imminent'): boolean {
  if (consequence === 'binding' || consequence === 'imminent') return Date.parse(nowIso) - Date.parse(claim.retrievedAt) <= 72 * 3600 * 1000;
  return Date.parse(nowIso) <= Date.parse(claim.nextReviewDue);
}

// ---------------------------------------------------------------- independence

/**
 * "Two copies of the same source do not count as two independent authorities"
 * (11 step 5, 11T17). Claims whose supporting passages are the same text count
 * once, whatever pages carry them.
 */
export function independentSourceCount(claims: ReadonlyArray<Pick<ClaimRecord, 'anchor' | 'sourceOwner'>>): number {
  const origins = new Set(claims.map((c) => sha256Hex(normalizeSpace(c.anchor.quote).replace(/[^a-z0-9 ]/g, ''))));
  return origins.size;
}

// ---------------------------------------------------------------- the store

export interface SourceSnapshot {
  sourceId: string;
  url: string;
  finalUrl: string;
  ownerEntityId: string;
  office: (typeof OFFICES)[number];
  retrievedAt: string;
  contentHash: string;
  archived: boolean;
  passages: Array<{ passageId: string; heading: string | null; cycle: string | null; text: string }>;
}

export type UpsertOutcome =
  | { status: 'created' | 'new_version' | 'unchanged'; claim: ClaimRecord; previous: ClaimRecord | null; changed: string[] }
  | { status: 'rejected'; issues: string[] };

export interface ClaimChange {
  claimId: string;
  previousVersion: number;
  version: number;
  changed: string[];
  before: unknown;
  after: unknown;
  dependents: string[];
}

export interface ClaimQuery {
  entityIds: readonly string[];
  predicates?: readonly Predicate[];
  cycle?: string | null;
  includeHistorical?: boolean;
  /** Private claims are visible only to tasks for their own student. */
  viewer?: { tenantId: string; studentId: string };
}

export class InstitutionClaimStore {
  private readonly versions = new Map<string, ClaimRecord[]>();
  private readonly snapshots = new Map<string, SourceSnapshot>();
  private readonly listeners: Array<(c: ClaimChange) => void> = [];

  constructor(private readonly now: () => string) {}

  onChange(listener: (c: ClaimChange) => void): void {
    this.listeners.push(listener);
  }

  recordSnapshot(s: SourceSnapshot): SourceSnapshot {
    this.snapshots.set(s.sourceId, structuredClone(s));
    return structuredClone(s);
  }

  /** When a page was last retrieved, by its requested or final URL. */
  lastRetrieval(url: string): { sourceId: string; retrievedAt: string } | null {
    let best: SourceSnapshot | null = null;
    for (const s of this.snapshots.values()) if ((s.url === url || s.finalUrl === url) && (best === null || s.retrievedAt > best.retrievedAt)) best = s;
    return best ? { sourceId: best.sourceId, retrievedAt: best.retrievedAt } : null;
  }

  snapshot(sourceId: string): SourceSnapshot | undefined {
    const s = this.snapshots.get(sourceId);
    return s ? structuredClone(s) : undefined;
  }

  /**
   * Store a claim. The same fact from the same source becomes a new version
   * when its material content changes; the prior version is kept (superseded,
   * or historical when the new reading is conflicted). The same fact from a
   * different source that disagrees becomes a linked conflict: both are kept,
   * neither is chosen (11 "Conflicts and incomplete pages").
   */
  upsert(input: ClaimInput): UpsertOutcome {
    const parsed = ClaimInputSchema.safeParse(input);
    if (!parsed.success) return { status: 'rejected', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    const c = parsed.data;
    const snap = c.visibility.kind === 'public' ? this.snapshots.get(c.anchor.sourceId) : undefined;
    const passage = snap ? (c.anchor.passageId ? snap.passages.find((p) => p.passageId === c.anchor.passageId)?.text ?? null : snap.passages.map((p) => p.text).join('\n')) : null;
    const check = checkClaimStructure(c, c.visibility.kind === 'public' ? passage : null);
    if (!check.ok) return { status: 'rejected', issues: check.issues };
    const missing = [...new Set([...c.missing, ...check.missing])];
    // A page that states one fact two ways is conflicted with itself; neither reading is chosen.
    const status: ClaimStatus = c.alternatives.length > 0 && ['verified', 'provisional'].includes(c.status) ? 'conflicted' : c.status === 'verified' && missing.length > 0 ? 'provisional' : c.status;
    const claimId = claimIdFor(c);
    const history = this.versions.get(claimId) ?? [];
    const latest = history[history.length - 1];
    const now = this.now();
    const base: ClaimRecord = {
      ...c,
      value: check.value,
      missing,
      status,
      claimId,
      version: latest ? latest.version : 1,
      conflictLinks: latest?.conflictLinks ?? [],
      nextReviewDue: nextReviewDue(c.predicate, check.value, c.retrievedAt),
      recordedAt: now,
      dependents: latest?.dependents ?? [],
    };
    if (latest && materialContent(latest) === materialContent(base)) {
      // Same content re-read: refresh the dates, keep the version.
      const refreshed: ClaimRecord = { ...latest, retrievedAt: c.retrievedAt, nextReviewDue: base.nextReviewDue, anchor: c.anchor, status: latest.status === 'conflicted' ? 'conflicted' : status, missing };
      history[history.length - 1] = refreshed;
      this.versions.set(claimId, history);
      return { status: 'unchanged', claim: structuredClone(refreshed), previous: null, changed: [] };
    }
    if (latest) {
      base.version = latest.version + 1;
      latest.status = status === 'conflicted' || status === 'unavailable' ? 'historical' : 'superseded';
      latest.statusReason = `replaced by version ${base.version} on ${now.slice(0, 10)}`;
    }
    history.push(base);
    this.versions.set(claimId, history);
    this.linkConflicts(base);
    if (latest) {
      const changed = changedParts(latest, base);
      const change: ClaimChange = { claimId, previousVersion: latest.version, version: base.version, changed, before: latest.value, after: base.value, dependents: [...base.dependents] };
      for (const l of this.listeners) l(change);
      return { status: 'new_version', claim: structuredClone(base), previous: structuredClone(latest), changed };
    }
    return { status: 'created', claim: structuredClone(base), previous: null, changed: [] };
  }

  /** Two current claims about the same fact and scope, from different sources, with different content: both become conflicted and linked. */
  private linkConflicts(c: ClaimRecord): void {
    if (c.status === 'historical' || c.status === 'superseded' || c.status === 'unavailable') return;
    const key = identityKey(c);
    for (const [id, history] of this.versions) {
      if (id === c.claimId) continue;
      const other = history[history.length - 1]!;
      if (identityKey(other) !== key || !visibleTogether(other, c)) continue;
      if (other.status === 'historical' || other.status === 'superseded' || other.status === 'unavailable') continue;
      if (materialContent(other) === materialContent(c)) continue;
      const before = other.status;
      other.status = 'conflicted';
      other.statusReason = 'another official source states this differently';
      if (!other.conflictLinks.includes(c.claimId)) other.conflictLinks.push(c.claimId);
      // A claim others relied on is now disputed: its dependents are told, as for a new version.
      if (before !== 'conflicted') for (const l of this.listeners) l({ claimId: id, previousVersion: other.version, version: other.version, changed: ['status'], before, after: 'conflicted', dependents: [...other.dependents] });
      c.status = 'conflicted';
      c.statusReason = 'another official source states this differently';
      if (!c.conflictLinks.includes(id)) c.conflictLinks.push(id);
    }
  }

  /**
   * Change a claim's status without a new value: an official page that no
   * longer states a fact makes the earlier claim historical (never deleted);
   * an unreachable source makes it unavailable until checked again.
   */
  markStatus(claimId: string, status: Extract<ClaimStatus, 'historical' | 'unavailable'>, reason: string): ClaimRecord | undefined {
    const history = this.versions.get(claimId);
    const latest = history?.[history.length - 1];
    if (!latest) return undefined;
    const before = latest.status;
    latest.status = status;
    latest.statusReason = reason;
    if (before !== status) for (const l of this.listeners) l({ claimId, previousVersion: latest.version, version: latest.version, changed: ['status'], before: before, after: status, dependents: [...latest.dependents] });
    return structuredClone(latest);
  }

  /** Register that a role's output depends on a claim, so it is told when the claim changes. */
  subscribe(claimId: string, role: string): void {
    const history = this.versions.get(claimId);
    const latest = history?.[history.length - 1];
    if (latest && !latest.dependents.includes(role)) latest.dependents.push(role);
  }

  get(claimId: string, version?: number): ClaimRecord | undefined {
    const history = this.versions.get(claimId);
    if (!history) return undefined;
    const c = version === undefined ? history[history.length - 1] : history.find((x) => x.version === version);
    return c ? structuredClone(c) : undefined;
  }

  history(claimId: string): ClaimRecord[] {
    return (this.versions.get(claimId) ?? []).map((c) => structuredClone(c));
  }

  /** Latest versions of claims about the given entities (and their lineage, supplied by the caller). */
  query(q: ClaimQuery): ClaimRecord[] {
    const entities = new Set(q.entityIds);
    const out: ClaimRecord[] = [];
    for (const history of this.versions.values()) {
      const latest = history[history.length - 1]!;
      if (!entities.has(latest.subject.entityId)) continue;
      if (q.predicates && !q.predicates.includes(latest.predicate)) continue;
      if (q.cycle !== undefined && q.cycle !== null && latest.cycle !== null && latest.cycle !== q.cycle && !q.includeHistorical) continue;
      if (!q.includeHistorical && (latest.status === 'superseded' || latest.status === 'historical')) continue;
      if (latest.visibility.kind === 'private' && !(q.viewer && latest.visibility.tenantId === q.viewer.tenantId && latest.visibility.studentId === q.viewer.studentId)) continue;
      out.push(structuredClone(latest));
      if (q.includeHistorical) for (const older of history.slice(0, -1)) out.push(structuredClone(older));
    }
    return out.sort((a, b) => a.claimId.localeCompare(b.claimId) || b.version - a.version);
  }

  /** Remove a student's private evidence captured from one uploaded document. */
  purgeDocument(tenantId: string, studentId: string, documentId: string): number {
    let n = 0;
    for (const [id, history] of [...this.versions]) {
      const first = history[0]!;
      const v = first.visibility;
      if (v.kind === 'private' && v.tenantId === tenantId && v.studentId === studentId && first.anchor.sourceId === `student_evidence:${documentId}`) {
        this.versions.delete(id);
        n += 1;
      }
    }
    return n;
  }

  /** Remove a student's private evidence (deletion reaches the claim store like any derivative store). */
  purgeStudent(tenantId: string, studentId: string): number {
    let n = 0;
    for (const [id, history] of [...this.versions]) {
      const v = history[0]!.visibility;
      if (v.kind === 'private' && v.tenantId === tenantId && v.studentId === studentId) {
        this.versions.delete(id);
        n += 1;
      }
    }
    return n;
  }
}

function visibleTogether(a: ClaimRecord, b: ClaimRecord): boolean {
  // A private screenshot never puts a public claim into conflict: one applicant's view is not general evidence (11T16).
  return a.visibility.kind === 'public' && b.visibility.kind === 'public';
}

function changedParts(a: ClaimRecord, b: ClaimRecord): string[] {
  const out: string[] = [];
  if (!valuesEqual(a.value, b.value)) out.push('value');
  if (!valuesEqual([...a.conditions].sort(), [...b.conditions].sort())) out.push('conditions');
  if (!valuesEqual([...a.exceptions].sort(), [...b.exceptions].sort())) out.push('exceptions');
  if (a.cycle !== b.cycle) out.push('cycle');
  if (a.applicantCategory !== b.applicantCategory) out.push('applicant_category');
  if ((a.overrides?.claimId ?? null) !== (b.overrides?.claimId ?? null)) out.push('overrides');
  return out;
}
