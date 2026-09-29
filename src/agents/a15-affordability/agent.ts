import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { RoleIdSchema, type Handoff, type RoleId, type Uncertainty } from '../../shared/envelopes.js';
import type { AttendanceBudget, FundingAward } from '../../shared/fields.js';
import { CurrencySchema, MoneySchema, type Money } from '../../shared/money.js';
import { CalendarDateSchema, partialDateBounds, type CalendarDate } from '../../shared/time.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import type { DerivedArtifact, MutationResponse } from '../a04-record-steward/types.js';
import { artifactRef } from '../a04-record-steward/service.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { claimRef, type ClaimRecord, type CostValue, type EstimatorScopeValueSchema, type OutsideAwardPolicyValueSchema } from '../a11-research/claims.js';
import type { Resolution } from '../a11-research/entities.js';
import type { ReadClaimsResult } from '../a11-research/tools.js';
import type { ParsedLayout } from '../a03-document-interpreter/tools.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import {
  cashFlow,
  checkRate,
  computeScenario,
  CostBasisSchema,
  GIFT_KINDS,
  LINE_COMPONENTS,
  LINE_PERIODS,
  RateAssumptionSchema,
  reconcileFunding,
  WorkScenarioSchema,
  type CashFlow,
  type CostLine,
  type FundingItem,
  type Ledger,
  type LineComponent,
  type RateAssumption,
  type Resource,
  type ScenarioResult,
  type ScenarioSpecInput,
} from './ledger.js';
import { parseLetterLines, reviewLetter, type LetterReview } from './letter.js';
import type { ExchangeRateOutcome } from './tools.js';

/**
 * Agent 15 — Affordability and financial aid planner.
 *
 * Owns the calculation ledger and its assumptions: cost, gift aid, resources,
 * financing and work are kept apart, every total is computed in code from
 * explicit lines, and an option is called affordable only when an auditable
 * scenario supports it. It does not assess an institution's need analysis,
 * guarantee aid, recommend a loan product, or give tax, borrowing or
 * immigration advice. Other roles receive affordability states and gaps, not
 * raw financial documents.
 */

const COST_PREDICATES = ['tuition', 'mandatory_fees', 'housing', 'meals', 'books_supplies', 'health_insurance', 'transport', 'personal', 'cost_of_attendance', 'application_fee', 'enrollment_deposit'] as const;
/** Categories a comparison needs; each is either published, estimated by the student, or visibly missing. */
const ESSENTIAL: readonly LineComponent[] = ['tuition', 'mandatory_fees', 'housing', 'meals', 'books_supplies', 'transport', 'personal'];
const LABELS: Record<LineComponent, string> = {
  tuition: 'Tuition',
  mandatory_fees: 'Mandatory fees',
  cost_of_attendance: 'Published cost of attendance',
  housing: 'Housing',
  meals: 'Meals',
  books_supplies: 'Books and supplies',
  equipment: 'Required equipment',
  health_insurance: 'Health insurance',
  transport: 'Local transport',
  travel_home: 'Travel home',
  personal: 'Personal costs',
  application_fee: 'Application fee',
  enrollment_deposit: 'Enrollment deposit',
  housing_deposit: 'Housing deposit',
  relocation: 'Relocation',
  documentation: 'Required documents',
  other: 'Other cost',
};
const COUNTRY_CURRENCY: Record<string, string> = { US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IE: 'EUR', NL: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', GR: 'EUR', CH: 'CHF', JP: 'JPY', SG: 'SGD', HK: 'HKD' };
const FEE_STATUSES = ['home', 'in_state', 'out_of_state', 'overseas', 'international'] as const;

// ---------------------------------------------------------------- scope

const ExtraLineSchema = z
  .object({
    component: z.enum(LINE_COMPONENTS),
    label: z.string().min(1).max(200).optional(),
    amount: MoneySchema.nullable(),
    period: z.enum(LINE_PERIODS).nullable(),
    billed: z.boolean().nullable().default(null),
    dueDate: CalendarDateSchema.nullable().default(null),
    includes: z.array(z.enum(LINE_COMPONENTS)).default([]),
    /** The student's own estimate, or a figure they copied from a document. */
    certainty: z.enum(['estimate', 'student_supplied']).default('estimate'),
  })
  .strict();

const OptionSchema = z
  .object({
    optionRef: z.string().min(1).max(200),
    institution: z.string().min(1).max(200),
    campus: z.string().max(200).nullable().default(null),
    program: z.string().max(200).nullable().default(null),
    cycle: z.string().regex(/^\d{4}$/),
    enrollment: z.enum(['full_time', 'part_time']).default('full_time'),
    /** Verified mandatory years, if known; otherwise the program's published length is used. */
    durationYears: z.number().int().min(1).max(8).nullable().default(null),
    optionalYears: z.number().int().min(0).max(3).default(0),
    calendar: CostBasisSchema.shape.calendar.optional(),
    extraLines: z.array(ExtraLineSchema).max(20).default([]),
    /** When bills are due, for the cash view. */
    dueDates: z.partialRecord(z.enum(LINE_COMPONENTS), CalendarDateSchema).default({}),
  })
  .strict();
export type AffordabilityOption = z.input<typeof OptionSchema>;

const StressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('renewal_loss') }).strict(),
  z.object({ kind: z.literal('extra_year') }).strict(),
  z.object({ kind: z.literal('higher_travel'), multiplier: z.string().regex(/^\d+(\.\d+)?$/) }).strict(),
  z.object({ kind: z.literal('currency_move'), rate: RateAssumptionSchema }).strict(),
  z.object({ kind: z.literal('delayed_disbursement'), days: z.number().int().positive().max(180) }).strict(),
]);

const EstimateSchema = z
  .object({
    optionRef: z.string().min(1),
    kind: z.enum(['net_price_calculator', 'published_average', 'institution_individual']),
    netPrice: MoneySchema,
    producedOn: CalendarDateSchema,
    familyLivesOrWorksAbroad: z.boolean().nullable().default(null),
  })
  .strict();

const LetterLineInputSchema = z.object({ label: z.string().min(1).max(200), amount: MoneySchema }).strict();

export const AffordabilityScopeSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('compare'),
      options: z.array(OptionSchema).min(1).max(6),
      view: z.enum(['annual', 'full_degree', 'upfront_cash']).default('annual'),
      familyCurrency: CurrencySchema.nullable().default(null),
      /** A rate the student chose as a scenario assumption: one unit of the institution's currency in the family's. */
      exchange: RateAssumptionSchema.nullable().default(null),
      growth: z.object({ tuitionPct: z.string().regex(/^-?\d+(\.\d+)?$/), livingPct: z.string().regex(/^-?\d+(\.\d+)?$/) }).strict().nullable().default(null),
      work: WorkScenarioSchema.nullable().default(null),
      stress: z.array(StressSchema).max(5).default([]),
      estimates: z.array(EstimateSchema).max(6).default([]),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('review_award_letter'),
      option: OptionSchema,
      documentId: z.string().min(1).nullable().default(null),
      version: z.number().int().positive().nullable().default(null),
      /** Lines the student typed in when the letter could not be read. */
      lines: z.array(LetterLineInputSchema).max(40).nullable().default(null),
      /** The student's answers for lines the letter left unclear. */
      confirmations: z.array(z.object({ label: z.string().min(1), category: z.enum(['grant', 'scholarship', 'loan', 'work', 'not_aid']) }).strict()).max(20).default([]),
      conversationId: z.string().min(1).default('conv_letter'),
      turnId: z.string().min(1).default('t_letter'),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('explore_budget'),
      options: z.array(OptionSchema).max(6).default([]),
      /** A range the student chose to share after the worksheet; recorded as a worksheet estimate, never as a commitment. */
      range: z.object({ min: MoneySchema.nullable(), max: MoneySchema, period: z.enum(['annual', 'total_degree']), includesTravelAndPersonal: z.boolean().nullable() }).strict().nullable().default(null),
      conversationId: z.string().min(1).default('conv_budget'),
      turnId: z.string().min(1).default('t_budget'),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('appeal_help'), institution: z.string().min(1).max(200), text: z.string().min(1).max(2000), requester: RoleIdSchema.default('01') }).strict(),
  z
    .object({
      action: z.literal('share_summary'),
      requester: RoleIdSchema,
      requested: z.array(z.string().regex(/^[a-z_]+$/)).min(1).max(20),
    })
    .strict(),
]);
export type AffordabilityScope = z.infer<typeof AffordabilityScopeSchema>;

// ---------------------------------------------------------------- payload

const NoticeSchema = z.object({ code: z.string(), message: z.string() }).strict();
const ScenarioOutSchema = z.custom<ScenarioResult>((v) => typeof v === 'object' && v !== null && 'scenarioId' in v && 'totals' in v);
const CashFlowOutSchema = z.custom<CashFlow>((v) => typeof v === 'object' && v !== null && 'events' in v);

const OptionResultSchema = z
  .object({
    optionRef: z.string(),
    resolution: z.object({ status: z.string(), entityId: z.string().nullable(), name: z.string().nullable(), question: z.string().nullable() }).strict(),
    currency: z.string().nullable(),
    durationYears: z.number().nullable(),
    feeCategoryUsed: z.string().nullable(),
    feeStatusBasis: z.enum(['institution_assessment', 'student_belief', 'not_recorded', 'not_applicable']),
    scenarios: z.array(ScenarioOutSchema),
    cashFlow: CashFlowOutSchema.nullable(),
    state: z.enum(['supported', 'conditional', 'gap_identified', 'unknown']),
    estimates: z.array(z.object({ kind: z.string(), netPrice: MoneySchema, producedOn: z.string(), reliability: z.enum(['exploration_only', 'not_reliable_for_this_family', 'scope_unverified', 'population_average_not_personal']), note: z.string() }).strict()),
    factsNeeded: z.array(z.object({ component: z.string(), reason: z.string() }).strict()),
    aidTiming: z.array(z.object({ text: z.string(), mustApplyWithAdmission: z.boolean(), sourceRef: z.string() }).strict()),
    mergedFunding: z.array(z.object({ kept: z.string(), merged: z.string(), reason: z.string() }).strict()),
    conversion: z.object({ status: z.enum(['not_needed', 'converted', 'unresolved']), message: z.string().nullable(), rate: RateAssumptionSchema.nullable() }).strict(),
    artifactId: z.string().nullable(),
  })
  .strict();
export type OptionResult = z.infer<typeof OptionResultSchema>;

export const AffordabilityPayloadSchema = z
  .object({
    action: z.string(),
    options: z.array(OptionResultSchema),
    letter: z.custom<LetterReview & { recorded: string[]; confirmedLines: string[] }>((v) => typeof v === 'object' && v !== null && 'lines' in v).nullable(),
    worksheet: z.object({ questions: z.array(z.string()), costRanges: z.array(z.object({ optionRef: z.string(), totalCost: z.string().nullable(), currency: z.string().nullable(), missing: z.array(z.string()) }).strict()), recordedRange: z.boolean() }).strict().nullable(),
    appeal: z.object({ refused: z.boolean(), questionsForAidOffice: z.array(z.string()), documentsToGather: z.array(z.string()), noGuarantee: z.string() }).strict().nullable(),
    shared: z.object({ requester: z.string(), provided: z.array(z.object({ optionRef: z.string(), state: z.string(), gapBand: z.enum(['none', 'under_2500', '2500_to_10000', 'over_10000', 'unknown']), stale: z.boolean() }).strict()), denied: z.array(z.string()) }).strict().nullable(),
    refusals: z.array(z.string()),
    questions: z.array(z.object({ code: z.string(), question: z.string(), for: z.enum(['student', 'supporter', 'aid_office']) }).strict()),
    notices: z.array(NoticeSchema),
    explanations: z.array(z.object({ term: z.string(), text: z.string() }).strict()),
  })
  .strict();
export type AffordabilityPayload = z.infer<typeof AffordabilityPayloadSchema>;

const d = (x: string) => Number(x);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

export const AFFORDABILITY_CONTRACT: ContractDefinition<AffordabilityPayload> = {
  id: 'affordability_ledger_v1',
  role: '15',
  payload: AffordabilityPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    // Arithmetic and labels are re-checked independently of the ledger that produced them.
    for (const o of p.options) {
      for (const s of o.scenarios) {
        const t = s.totals;
        if (!near(d(t.netEducationalCost), d(t.totalCost) - d(t.giftAid))) issues.push(`${o.optionRef}/${s.scenarioId}: net cost is not total cost minus gift aid`);
        if (t.gapBeforeFinancing !== null && !near(d(t.gapBeforeFinancing), d(t.netEducationalCost) - d(t.confirmedResources))) issues.push(`${o.optionRef}/${s.scenarioId}: gap is not net cost minus confirmed resources`);
        if (!near(s.years.reduce((a, y) => a + d(y.totalCost), 0), d(t.totalCost))) issues.push(`${o.optionRef}/${s.scenarioId}: yearly costs do not add up to the total`);
        for (const y of s.years) for (const g of y.gifts) if (!GIFT_KINDS.has(g.kind) && d(g.applied) !== 0) issues.push(`${o.optionRef}/${s.scenarioId}: ${g.name} is not gift aid but reduced the cost`);
        if (s.state === 'supported' && (t.gapBeforeFinancing === null || d(t.gapBeforeFinancing) > 0 || s.unresolved.length > 0)) issues.push(`${o.optionRef}/${s.scenarioId}: marked supported without a closed, resolved gap`);
        if (s.work && s.work.status !== 'conditional' && d(t.conditionalWorkIncome) !== 0) issues.push(`${o.optionRef}/${s.scenarioId}: unresolved work income was counted`);
      }
      const base = o.scenarios.find((s) => s.kind === 'base');
      if (base && base.state !== o.state) issues.push(`${o.optionRef}: the option's state must be its base scenario's state`);
    }
    if (/\bfull(y)?[- ]fund(ed|ing)\b/i.test(JSON.stringify(p))) issues.push('"full funding" is not a label this planner may use');
    return issues;
  },
};

// ---------------------------------------------------------------- reading the record

interface RecordInputs {
  view: RecordView;
  funding: Array<FundingItem & { optionRef: string | null; claimId: string }>;
  resources: Array<Resource & { claimId: string }>;
  eligibility: string[];
  eligibilityClaimIds: string[];
  feeStatus: Array<{ jurisdiction: string; institutionRef: string | null; status: string; basis: 'institution_assessment' | 'student_belief'; claimId: string }>;
}

const programKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function readInputs(view: RecordView): RecordInputs {
  const funding: RecordInputs['funding'] = [];
  for (const id of view.entityIds('funding_award')) {
    const f = view.field('funding_award', id, 'definition');
    const v = view.value<FundingAward>('funding_award', id, 'definition');
    if (!f?.current || !v) continue;
    funding.push({ fundingId: id, provider: v.provider, name: v.name, kind: v.kind, basis: v.basis, amount: v.amount, period: v.period, stage: v.stage, coveredCosts: v.coveredCosts, renewal: v.renewal ? { renewable: v.renewal.renewable, conditions: v.renewal.conditions, maxYears: v.renewal.maxYears ?? null } : null, eligibilityProgram: v.eligibilityProgram, disbursesOn: v.disbursesOn, externalRefs: v.externalRefs, sourceRef: f.current.claimId, optionRef: v.optionRef, claimId: f.current.claimId });
  }
  const resources: RecordInputs['resources'] = [];
  for (const f of view.view.fields) {
    if (f.field.entity !== 'attendance_budget' || f.field.attribute !== 'definition' || f.state !== 'current' || !f.current) continue;
    const v = f.current.value as AttendanceBudget;
    if (!v || typeof v !== 'object' || !('max' in v)) continue;
    const holder = f.holder?.kind ?? 'student';
    const confirmed = holder === 'student' || (holder === 'supporter' && v.basis === 'supporter_confirmed');
    const label = holder === 'student' ? 'Your own savings and funds' : holder === 'supporter' ? 'Family contribution (confirmed by your supporter)' : `Help you expect from ${f.holder && f.holder.kind === 'reported_other' ? f.holder.label : 'family'}`;
    resources.push({ resourceId: f.fieldKey, holder, label, min: v.min, max: v.max, period: v.period, confirmed, availableFrom: v.availableFrom ? partialDateBounds(v.availableFrom).end : null, includesTravelAndPersonal: v.includesTravelAndPersonal, claimId: f.current.claimId });
  }
  const eligibility: string[] = [];
  const eligibilityClaimIds: string[] = [];
  for (const id of view.entityIds('aid_eligibility')) {
    const f = view.field('aid_eligibility', id, 'status');
    const v = view.value<{ program: string; status: string }>('aid_eligibility', id, 'status');
    if (!f?.current || !v) continue;
    eligibilityClaimIds.push(f.current.claimId);
    if (v.status === 'confirmed_eligible') eligibility.push(programKey(v.program));
  }
  const feeStatus: RecordInputs['feeStatus'] = [];
  for (const id of view.entityIds('fee_status')) {
    const f = view.field('fee_status', id, 'assessment');
    const v = view.value<{ jurisdiction: string; institutionRef: string | null; status: string; basis: 'institution_assessment' | 'student_belief' }>('fee_status', id, 'assessment');
    if (f?.current && v) feeStatus.push({ ...v, claimId: f.current.claimId });
  }
  return { view, funding, resources, eligibility, eligibilityClaimIds, feeStatus };
}

// ---------------------------------------------------------------- the agent

type Scope<A extends AffordabilityScope['action']> = Extract<AffordabilityScope, { action: A }>;

interface OptionBuild {
  result: OptionResult;
  ledger: Ledger | null;
  sourceRefs: string[];
  recordClaimIds: string[];
  missingOfficial: LineComponent[];
}

export class AffordabilityPlannerAgent implements SpecialistAgent {
  readonly role = '15' as const;
  readonly contracts = [AFFORDABILITY_CONTRACT];

  /** A model may explain a result; every number is computed in code. It is not needed for any calculation. */
  constructor(private readonly model: ModelGateway) {}

  get modelConfigured(): boolean {
    return this.model.configured;
  }

  async handle(ctx: TaskContext) {
    const parsed = AffordabilityScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The affordability request was incomplete.', 'invalid_scope');
    const s = parsed.data;
    switch (s.action) {
      case 'compare':
        return this.compare(ctx, s);
      case 'review_award_letter':
        return this.reviewAwardLetter(ctx, s);
      case 'explore_budget':
        return this.exploreBudget(ctx, s);
      case 'appeal_help':
        return this.appealHelp(ctx, s);
      case 'share_summary':
        return this.shareSummary(ctx, s);
    }
  }

  private empty(action: string): AffordabilityPayload {
    return { action, options: [], letter: null, worksheet: null, appeal: null, shared: null, refusals: [], questions: [], notices: [], explanations: [] };
  }

  // ------------------------------------------------------------ compare (steps 1-7)

  private async compare(ctx: TaskContext, s: Scope<'compare'>) {
    const view = await readView(ctx, 'local', { entityTypes: ['attendance_budget', 'funding_award', 'aid_eligibility', 'fee_status'] });
    const inputs = readInputs(view);
    const payload = this.empty('compare');
    const builds: OptionBuild[] = [];
    for (const o of s.options) builds.push(await this.buildOption(ctx, o, inputs, s, payload));
    this.explain(payload, builds);
    this.questions(payload, builds, inputs);
    return this.finish(ctx, payload, builds, view.recordVersion, s.requester);
  }

  private async buildOption(ctx: TaskContext, o: z.infer<typeof OptionSchema>, inputs: RecordInputs, s: Pick<Scope<'compare'>, 'view' | 'familyCurrency' | 'exchange' | 'growth' | 'work' | 'stress' | 'estimates'>, payload: AffordabilityPayload): Promise<OptionBuild> {
    const blank: OptionResult = {
      optionRef: o.optionRef,
      resolution: { status: 'unknown', entityId: null, name: null, question: null },
      currency: null,
      durationYears: null,
      feeCategoryUsed: null,
      feeStatusBasis: 'not_applicable',
      scenarios: [],
      cashFlow: null,
      state: 'unknown',
      estimates: [],
      factsNeeded: [],
      aidTiming: [],
      mergedFunding: [],
      conversion: { status: 'not_needed', message: null, rate: null },
      artifactId: null,
    };
    // Step 1: the comparison unit.
    const r = await ctx.call<Resolution>('institutions.read', { op: 'resolve', institution: o.institution, campus: o.campus, program: o.program });
    if (r.status !== 'resolved') {
      blank.resolution = { status: r.status, entityId: r.status === 'needs_campus' ? r.institution.id : null, name: r.status === 'needs_campus' ? r.institution.name : null, question: r.question };
      return { result: blank, ledger: null, sourceRefs: [], recordClaimIds: [], missingOfficial: [] };
    }
    blank.resolution = { status: 'resolved', entityId: r.entity.id, name: r.entity.name, question: null };
    const read = await ctx.call<ReadClaimsResult>('institutions.read', { op: 'claims', entityId: r.entity.id, predicates: [...COST_PREDICATES, 'estimator_scope', 'outside_award_policy', 'aid_application_timing', 'program_attribute'], cycle: o.cycle, includeHistorical: true });
    const sourceRefs: string[] = [];
    const use = (c: ClaimRecord) => {
      sourceRefs.push(claimRef(c.claimId));
      return claimRef(c.claimId);
    };
    const current = read.claims.filter((c) => c.status !== 'superseded' && c.visibility.kind === 'public');

    // Fee status decides which published fee applies; without an institutional assessment the higher fee is used.
    const fee = inputs.feeStatus.find((f) => f.institutionRef === r.institution.id) ?? inputs.feeStatus.find((f) => f.institutionRef === null && f.jurisdiction === r.institution.country);
    const costClaims = current.filter((c) => (COST_PREDICATES as readonly string[]).includes(c.predicate));
    const categories = new Set(costClaims.map((c) => (c.value as CostValue).feeCategory).filter((x) => x !== 'all'));
    let feeCategory: string | null = null;
    if (categories.size > 0) {
      if (fee?.basis === 'institution_assessment' && (FEE_STATUSES as readonly string[]).includes(fee.status)) {
        feeCategory = fee.status;
        blank.feeStatusBasis = 'institution_assessment';
      } else {
        blank.feeStatusBasis = fee ? 'student_belief' : 'not_recorded';
        payload.notices.push({ code: 'fee_status_unassessed', message: `${r.institution.name} charges different fees by fee status, and your status has not been assessed by the institution${fee ? ` (you believe it is ${fee.status.replace(/_/g, ' ')})` : ''}. Nationality alone does not decide it. The higher fee is used until the institution confirms; ask its admissions or fees office for an assessment.` });
      }
    }
    blank.feeCategoryUsed = feeCategory;

    // Step 2: the cost ledger.
    const lines: CostLine[] = [];
    const missingOfficial: LineComponent[] = [];
    for (const pred of COST_PREDICATES) {
      const all = costClaims.filter((c) => c.predicate === pred);
      const applicable = all.filter((c) => {
        const cat = (c.value as CostValue).feeCategory;
        return feeCategory === null ? true : cat === 'all' || cat === feeCategory;
      });
      const live = applicable.filter((c) => c.status === 'verified' || c.status === 'provisional' || c.status === 'conflicted');
      const cycleLive = live.filter((c) => c.cycle === null || c.cycle === o.cycle);
      if (cycleLive.length === 0) {
        const hist = applicable.filter((c) => c.status === 'historical').sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1))[0];
        if (hist) lines.push(this.lineFromClaim(hist, 'historical', o, use(hist)));
        else if ((ESSENTIAL as readonly string[]).includes(pred)) missingOfficial.push(pred as LineComponent);
        continue;
      }
      if (cycleLive.some((c) => c.status === 'conflicted')) {
        const c = cycleLive[0]!;
        for (const x of cycleLive) use(x);
        lines.push({ lineId: `claim_${c.claimId}`, component: pred as LineComponent, label: LABELS[pred as LineComponent], amount: null, period: (c.value as CostValue).period as CostLine['period'], certainty: 'official', billed: null, includes: [], sourceRef: claimRef(c.claimId), dueDate: o.dueDates[pred as LineComponent] ?? null, required: true });
        payload.notices.push({ code: 'cost_conflict', message: `Official sources disagree about ${LABELS[pred as LineComponent].toLowerCase()} at ${r.institution.name}; it is left unresolved until the financial aid office confirms.` });
        continue;
      }
      // The highest applicable fee when the fee status is not assessed.
      const pick = [...cycleLive].sort((a, b) => Number((b.value as CostValue).amount.amount) - Number((a.value as CostValue).amount.amount))[0]!;
      lines.push(this.lineFromClaim(pick, 'official', o, use(pick)));
    }
    for (const [i, x] of o.extraLines.entries()) {
      lines.push({ lineId: `student_${i}`, component: x.component, label: x.label ?? `${LABELS[x.component]} (your estimate)`, amount: x.amount, period: x.period, certainty: x.certainty, billed: x.billed, includes: x.includes, sourceRef: null, dueDate: x.dueDate ?? o.dueDates[x.component] ?? null, required: true });
    }
    // A category nobody has published or estimated is missing, never zero.
    const coveredBy = new Set<LineComponent>(lines.flatMap((l) => [l.component, ...(l.amount !== null ? l.includes : [])]));
    // A category already inside a published total is not missing.
    for (let i = missingOfficial.length - 1; i >= 0; i -= 1) if (coveredBy.has(missingOfficial[i]!)) missingOfficial.splice(i, 1);
    for (const c of ESSENTIAL) {
      if (coveredBy.has(c)) continue;
      lines.push({ lineId: `missing_${c}`, component: c, label: LABELS[c], amount: null, period: null, certainty: 'estimate', billed: null, includes: [], sourceRef: null, dueDate: null, required: true });
      blank.factsNeeded.push({ component: c, reason: missingOfficial.includes(c) ? 'No official figure is on file; it can be researched or you can add your own estimate.' : 'Not published; add your own estimate to include it.' });
    }

    const attr = current.find((c) => c.predicate === 'program_attribute' && (c.value as { attribute: string }).attribute === 'duration_years' && c.status !== 'historical');
    const duration = o.durationYears ?? (attr && typeof (attr.value as { value: unknown }).value === 'number' ? ((attr.value as { value: number }).value) : null);
    if (attr && o.durationYears === null) use(attr);
    blank.durationYears = duration;
    const currency = lines.find((l) => l.amount)?.amount?.currency ?? COUNTRY_CURRENCY[r.institution.country] ?? 'USD';
    blank.currency = currency;

    // Step 3: the funding ledger — gift aid, resources, financing and work kept apart; one identity per award.
    const optionFunding = inputs.funding.filter((f) => f.optionRef === null || f.optionRef === o.optionRef);
    const rec = reconcileFunding(optionFunding.map(({ optionRef: _o, claimId: _c, ...f }) => f));
    blank.mergedFunding = rec.merged;
    const policy = current.find((c) => c.predicate === 'outside_award_policy' && c.status === 'verified');
    const interaction = policy ? { ...(policy.value as z.infer<typeof OutsideAwardPolicyValueSchema>), sourceRef: use(policy) } : null;
    for (const t of current.filter((c) => c.predicate === 'aid_application_timing' && c.status !== 'historical')) {
      const v = t.value as { mustApplyWithAdmission: boolean; text: string };
      blank.aidTiming.push({ text: v.text, mustApplyWithAdmission: v.mustApplyWithAdmission, sourceRef: use(t) });
    }

    // Currency: an explicit, direction-checked rate, or an unresolved conversion (15T10, 15T18).
    const family = s.familyCurrency;
    const foreignResources = inputs.resources.some((x) => x.max.currency !== currency);
    let rate: RateAssumption | null = null;
    if ((family && family !== currency) || foreignResources) {
      const target = family && family !== currency ? family : inputs.resources.find((x) => x.max.currency !== currency)!.max.currency;
      const ref = await ctx.tryCall<ExchangeRateOutcome>('finance.exchange_rate', { from: currency, to: target });
      const reference = ref.ok && ref.value.available ? ref.value.rate : null;
      if (s.exchange) {
        const check = checkRate(s.exchange, currency, target, reference);
        if (check.ok) {
          rate = s.exchange;
          blank.conversion = { status: 'converted', message: `Using your scenario rate: 1 ${currency} = ${s.exchange.rate} ${target} (as of ${s.exchange.asOf}).`, rate };
        } else blank.conversion = { status: 'unresolved', message: check.message, rate: null };
      } else if (reference) {
        rate = reference;
        blank.conversion = { status: 'converted', message: `Using the reference rate 1 ${currency} = ${reference.rate} ${target} as of ${reference.asOf}; it will change.`, rate };
      } else {
        blank.conversion = { status: 'unresolved', message: `The exchange-rate service is unavailable, so amounts are shown in ${currency} only. You can give a rate to use as a stated scenario assumption.`, rate: null };
      }
    }

    const ledger: Ledger = {
      basis: CostBasisSchema.parse({ optionRef: o.optionRef, institutionId: r.institution.id, campusId: r.campus?.id ?? null, programId: r.program?.id ?? null, cycle: o.cycle, enrollment: o.enrollment, currency, durationYears: duration, optionalYears: o.optionalYears, calendar: o.calendar }),
      lines,
      funding: rec.items,
      resources: inputs.resources.map(({ claimId: _c, ...x }) => x),
      interaction,
      confirmedEligibility: inputs.eligibility,
      work: s.work,
      rate,
    };

    // Step 4: scenarios that answer a real decision.
    const view = s.view === 'full_degree' ? 'full_degree' : 'annual';
    const growth = s.growth ? { tuitionGrowthPct: s.growth.tuitionPct, livingGrowthPct: s.growth.livingPct } : {};
    const specs: ScenarioSpecInput[] = [{ scenarioId: 'base', kind: 'base', view, ...growth }];
    const renewable = rec.items.some((f) => GIFT_KINDS.has(f.kind) && f.renewal?.renewable && f.period === 'one_academic_year');
    if (view === 'full_degree' && renewable) specs.push({ scenarioId: 'renewed', kind: 'conditional', view, renewal: 'assume_renewed', ...growth });
    if (rec.items.some((f) => f.stage === 'estimated' && GIFT_KINDS.has(f.kind))) specs.push({ scenarioId: 'with_estimated_aid', kind: 'conditional', view, includeEstimatedAid: true, ...growth });
    if (o.optionalYears > 0 && view === 'full_degree') specs.push({ scenarioId: 'with_optional_years', kind: 'conditional', view, includeOptionalYears: true, ...growth });
    for (const st of s.stress) {
      if (st.kind === 'renewal_loss') specs.push({ scenarioId: 'stress_renewal_loss', kind: 'stress', view: 'full_degree', renewal: 'assume_renewed', renewalLoss: true, ...growth });
      if (st.kind === 'extra_year') specs.push({ scenarioId: 'stress_extra_year', kind: 'stress', view: 'full_degree', extraYears: 1, ...growth });
      if (st.kind === 'higher_travel') specs.push({ scenarioId: 'stress_higher_travel', kind: 'stress', view, travelMultiplier: st.multiplier, ...growth });
      if (st.kind === 'currency_move') {
        const check = checkRate(st.rate, currency, st.rate.to, null);
        if (check.ok) specs.push({ scenarioId: 'stress_currency_move', kind: 'stress', view, rateOverride: st.rate, ...growth });
        else payload.notices.push({ code: 'stress_rate_rejected', message: check.message });
      }
    }
    blank.scenarios = specs.map((sp) => computeScenario(ledger, sp));
    const base = blank.scenarios[0]!;
    blank.state = base.state;

    // Step 5: timing.
    if (s.view === 'upfront_cash' || lines.some((l) => l.dueDate) || rec.items.some((f) => f.disbursesOn)) {
      blank.cashFlow = cashFlow(ledger);
      const delay = s.stress.find((x) => x.kind === 'delayed_disbursement');
      if (delay && delay.kind === 'delayed_disbursement') {
        const late = cashFlow({ ...ledger, funding: ledger.funding.map((f) => (f.disbursesOn ? { ...f, disbursesOn: shift(f.disbursesOn, delay.days) } : f)) });
        const was = blank.cashFlow.upfrontShortfall;
        const now = late.upfrontShortfall;
        if (now && (!was || Number(now.amount) > Number(was.amount) || (now.coveredOn ?? '9999') > (was.coveredOn ?? '9999'))) {
          payload.notices.push({ code: 'delayed_disbursement', message: `If aid arrives ${delay.days} days late, you would be short ${now.amount} ${currency} from ${now.on}${now.coveredOn ? ` until ${now.coveredOn}` : ' with no later money to cover it'}.` });
        }
      }
    }

    // Estimates are checked against the estimator's stated population (15T07).
    const scope = current.find((c) => c.predicate === 'estimator_scope' && c.status !== 'historical');
    for (const e of s.estimates.filter((x) => x.optionRef === o.optionRef)) {
      if (e.kind === 'published_average') {
        blank.estimates.push({ kind: e.kind, netPrice: e.netPrice, producedOn: e.producedOn, reliability: 'population_average_not_personal', note: 'A published average net price describes a group of aided students; it is not what you would pay.' });
        continue;
      }
      if (e.kind === 'institution_individual') {
        blank.estimates.push({ kind: e.kind, netPrice: e.netPrice, producedOn: e.producedOn, reliability: 'exploration_only', note: `An individual estimate from the institution on ${e.producedOn}; useful for planning, but not an offer.` });
        continue;
      }
      if (!scope) {
        blank.estimates.push({ kind: e.kind, netPrice: e.netPrice, producedOn: e.producedOn, reliability: 'scope_unverified', note: 'Who this calculator is designed for has not been checked, so its result is for exploration only.' });
        continue;
      }
      const v = scope.value as z.infer<typeof EstimatorScopeValueSchema>;
      use(scope);
      if (e.familyLivesOrWorksAbroad && v.excludedSituations.includes('family_lives_or_works_abroad')) {
        blank.estimates.push({ kind: e.kind, netPrice: e.netPrice, producedOn: e.producedOn, reliability: 'not_reliable_for_this_family', note: `The institution says its calculator is not designed for families who live or work abroad (“${v.text.slice(0, 200)}”). Its result is not used; ask the financial aid office how they estimate aid for your situation.` });
        continue;
      }
      blank.estimates.push({ kind: e.kind, netPrice: e.netPrice, producedOn: e.producedOn, reliability: 'exploration_only', note: `A calculator estimate from ${e.producedOn}; not a commitment from the institution.` });
    }

    const recordClaimIds = [...optionFunding.map((f) => f.claimId), ...inputs.resources.map((x) => x.claimId), ...inputs.eligibilityClaimIds, ...(fee ? [fee.claimId] : [])];
    return { result: blank, ledger, sourceRefs: [...new Set(sourceRefs)], recordClaimIds, missingOfficial };
  }

  private lineFromClaim(c: ClaimRecord, certainty: CostLine['certainty'], o: z.infer<typeof OptionSchema>, ref: string): CostLine {
    const v = c.value as CostValue;
    const component = c.predicate as LineComponent;
    const period = (LINE_PERIODS as readonly string[]).includes(v.period) ? (v.period as CostLine['period']) : null;
    const includes = v.includes.filter((x): x is LineComponent => (LINE_COMPONENTS as readonly string[]).includes(x));
    const label = `${LABELS[component]}${v.feeCategory !== 'all' ? ` (${v.feeCategory.replace(/_/g, ' ')})` : ''}${certainty === 'historical' ? ` — ${c.cycle ?? 'earlier'} figure` : ''}`;
    return { lineId: `claim_${c.claimId}`, component, label, amount: v.amount, period, certainty, billed: v.billed, includes, sourceRef: ref, dueDate: o.dueDates[component] ?? null, required: true };
  }

  /** Short explanations near the figures (15 "Financial concepts the interface must keep separate"). */
  private explain(p: AffordabilityPayload, builds: OptionBuild[]): void {
    const results = builds.map((b) => b.result);
    p.explanations.push({ term: 'net educational cost', text: 'The cost after grants and scholarships. Loans and work do not reduce it; they are ways of paying it.' });
    if (results.some((r) => r.scenarios.some((s) => s.financing.length > 0))) p.explanations.push({ term: 'loan', text: 'Borrowed money that must be repaid, usually with interest. It is shown separately and never as a discount. Borrowing decisions belong with the adults responsible and qualified advice.' });
    if (results.some((r) => r.scenarios.some((s) => s.work))) p.explanations.push({ term: 'work allocation', text: 'The most you may earn from a campus job if you find one and work the hours. It arrives as pay over the year, not up front.' });
  }

  private questions(p: AffordabilityPayload, builds: OptionBuild[], inputs: RecordInputs): void {
    if (inputs.resources.length === 0) p.questions.push({ code: 'budget', question: 'Is there an amount your family could put toward college each year? A range is fine, and you can leave it out; costs and aid are shown either way.', for: 'student' });
    for (const b of builds) {
      if (b.result.resolution.question) p.questions.push({ code: `resolve_${b.result.optionRef}`, question: b.result.resolution.question, for: 'student' });
      for (const f of b.result.factsNeeded.slice(0, 3)) p.questions.push({ code: `estimate_${b.result.optionRef}_${f.component}`, question: `Do you have an estimate for ${LABELS[f.component as LineComponent].toLowerCase()} at ${b.result.resolution.name ?? b.result.optionRef}? It is not published, so it is shown as missing rather than zero.`, for: 'student' });
      if (b.ledger?.funding.some((f) => f.eligibilityProgram && !b.ledger!.confirmedEligibility.includes(f.eligibilityProgram))) {
        p.questions.push({ code: 'federal_eligibility', question: 'Federal student aid has citizenship or eligible-noncitizen rules. Do you know whether you qualify? Being admitted does not decide it, so that aid is left out until it is confirmed.', for: 'student' });
      }
    }
  }

  private async finish(ctx: TaskContext, p: AffordabilityPayload, builds: OptionBuild[], recordVersion: number, requester: RoleId) {
    // Step 6: store each option's result with every input it depends on, so a changed budget, award or source makes it stale (15T11).
    for (const b of builds) {
      if (!b.ledger) {
        p.options.push(b.result);
        continue;
      }
      const base = b.result.scenarios[0]!;
      const a = await ctx.call<DerivedArtifact>('artifacts.put_derived', {
        tenantId: ctx.request.tenantId,
        studentId: ctx.request.studentId,
        kind: 'affordability_scenario',
        scopeKey: b.result.optionRef,
        // The upfront cash position travels with the state, so a plan never reads "affordable" when money arrives after bills are due (XT16).
        payload: { optionRef: b.result.optionRef, state: base.state, currency: base.currency, netEducationalCost: base.totals.netEducationalCost, gapBeforeFinancing: base.totals.gapBeforeFinancing, assumptions: base.assumptions, conditions: base.conditions, cashShortfall: b.result.cashFlow?.upfrontShortfall ?? null },
        inputClaimIds: b.recordClaimIds,
        inputFieldKeys: ['attendance_budget:*.definition', 'funding_award:*.definition', 'aid_eligibility:*.status', 'fee_status:*.assessment'],
        sourceIds: b.sourceRefs,
        recordVersion,
      });
      b.result.artifactId = a.id;
      p.options.push(b.result);
    }
    const handoffs: Handoff[] = [];
    const artifacts = p.options.filter((o) => o.artifactId).map((o) => artifactRef(o.artifactId!));
    if (artifacts.length > 0) {
      for (const role of ['12', '14'] as const) {
        if (role === requester) continue;
        handoffs.push({ toRole: role, reason: 'Affordability states changed or were calculated.', requestedOutcome: role === '12' ? 'Use the affordability state and its conditions when matching; do not recalculate totals.' : 'Plan deposits and aid deadlines against the gap and cash timing.', inputRefs: artifacts, unresolved: p.options.filter((o) => o.state === 'unknown').map((o) => o.optionRef), completionCondition: 'The affordability state is attached to each option.' });
      }
    }
    const missing = builds.filter((b) => b.missingOfficial.length > 0);
    if (missing.length > 0) {
      handoffs.push({ toRole: '11', reason: 'Official cost figures are missing.', requestedOutcome: `Research ${[...new Set(missing.flatMap((b) => b.missingOfficial))].join(', ')} for ${missing.map((b) => b.result.resolution.name ?? b.result.optionRef).join(', ')}.`, inputRefs: missing.map((b) => b.result.resolution.entityId ?? b.result.optionRef), unresolved: [], completionCondition: 'Each missing cost has an official figure or a recorded gap.' });
    }
    if (builds.some((b) => b.ledger && b.ledger.interaction === null && b.ledger.funding.some((f) => f.kind === 'external_scholarship') && b.ledger.funding.some((f) => f.kind === 'institutional_grant'))) {
      handoffs.push({ toRole: '11', reason: 'How outside scholarships affect institutional aid is not verified.', requestedOutcome: 'Find the institution’s outside award policy.', inputRefs: builds.filter((b) => b.ledger).map((b) => b.result.resolution.entityId ?? b.result.optionRef), unresolved: [], completionCondition: 'The outside award policy is verified or recorded as unknown.' });
    }
    const uncertainties: Uncertainty[] = [];
    for (const o of p.options) {
      const base = o.scenarios[0];
      if (!base) continue;
      for (const u of base.unresolved.slice(0, 4)) uncertainties.push({ affects: `option:${o.optionRef}`, description: u, resolution: 'Add the missing figure, or ask the institution’s financial aid office.', consequence: 'changes_decision' });
    }
    const states = p.options.map((o) => `${o.resolution.name ?? o.optionRef}: ${o.state.replace(/_/g, ' ')}`);
    const summary = p.options.length === 0 ? 'No options were compared.' : `Affordability ${p.options.length === 1 ? 'result' : 'results'} — ${states.join('; ')}.`;
    const status = p.options.some((o) => o.resolution.status !== 'resolved') ? 'needs_student_input' : p.options.some((o) => o.state === 'unknown') ? 'partial' : 'completed';
    return makeResult(ctx, {
      status,
      summary,
      payload: p,
      claimIds: builds.flatMap((b) => b.recordClaimIds),
      recordVersion,
      sourceRefs: builds.flatMap((b) => b.sourceRefs),
      uncertainties,
      handoffs,
      completionReason: status === 'completed' ? 'scenarios_calculated' : status === 'partial' ? 'unresolved_inputs' : 'scope_question',
    });
  }

  // ------------------------------------------------------------ award letter

  private async reviewAwardLetter(ctx: TaskContext, s: Scope<'review_award_letter'>) {
    const view = await readView(ctx, 'local', { entityTypes: ['attendance_budget', 'funding_award', 'aid_eligibility', 'fee_status'] });
    const inputs = readInputs(view);
    const payload = this.empty('review_award_letter');
    const build = await this.buildOption(ctx, s.option, inputs, { view: 'annual', familyCurrency: null, exchange: null, growth: null, work: null, stress: [], estimates: [] }, payload);
    const currency = build.result.currency ?? 'USD';
    let pages: Array<{ page: number; text: string }> = [];
    let fromDocument = false;
    if (s.documentId && s.version) {
      const layout = await ctx.tryCall<ParsedLayout>('files.parse_sandboxed', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, documentId: s.documentId, version: s.version });
      if (layout.ok && layout.value.pagesNeedingTranscription.length < layout.value.pages.length) {
        pages = layout.value.pages.filter((pg) => pg.readable).map((pg) => ({ page: pg.page, text: pg.plainText ?? '' }));
        fromDocument = true;
      } else {
        payload.notices.push({ code: 'letter_unreadable', message: 'The letter could not be read reliably. You can type in its lines; they will be labeled as entered by you.' });
      }
    }
    if (!fromDocument && s.lines) pages = [{ page: 1, text: s.lines.map((l) => `${l.label} ${l.amount.amount} ${l.amount.currency}`).join('\n') }];
    if (pages.length === 0) {
      payload.options.push(build.result);
      payload.questions.push({ code: 'letter_lines', question: 'Could you type in each line of the award letter with its amount (for example “Aldermere Grant 20,000”)?', for: 'student' });
      return this.finishLetter(ctx, payload, build, view.recordVersion, []);
    }
    const parsed = parseLetterLines(pages, currency);
    // The student's answers settle lines the letter left unclear; nothing else is reclassified.
    const confirmedLines: string[] = [];
    for (const c of s.confirmations) {
      const line = parsed.lines.find((l) => l.label.toLowerCase() === c.label.toLowerCase());
      if (!line) continue;
      confirmedLines.push(line.label);
      if (c.category === 'not_aid') Object.assign(line, { category: 'contribution', fundingKind: null, reason: 'you said this is not aid' });
      else Object.assign(line, { category: c.category === 'grant' || c.category === 'scholarship' ? 'gift' : c.category, fundingKind: c.category === 'grant' ? 'institutional_grant' : c.category === 'scholarship' ? 'external_scholarship' : c.category, reason: 'as you confirmed' });
    }
    const existing = build.ledger?.funding ?? [];
    const review = reviewLetter(parsed, existing, currency);
    for (const q of review.questions) payload.questions.push({ code: q.lineIndex === null ? 'letter' : `letter_line_${q.lineIndex}`, question: q.question, for: q.for });
    for (const n of review.notices) payload.notices.push({ code: 'letter_note', message: n });
    const federal = parsed.lines.filter((l) => l.eligibilityProgram && !inputs.eligibility.includes(l.eligibilityProgram));
    if (federal.length > 0) payload.notices.push({ code: 'federal_eligibility_unconfirmed', message: `${federal.map((l) => l.label).join(', ')} depend${federal.length === 1 ? 's' : ''} on federal aid eligibility, which is not confirmed in your record; ${federal.length === 1 ? 'it is' : 'they are'} not counted until it is.` });
    // Record the lines whose category is clear, once each; the same award from another source keeps one identity (15T05).
    const recorded: string[] = [];
    const claims = [];
    for (const l of review.lines) {
      if (l.fundingKind === null || l.amount.currency !== currency) continue;
      const change = review.changes.find((c) => c.lineIndex === l.index);
      const already = change?.fundingId ? existing.find((e) => e.fundingId === change.fundingId) : undefined;
      if (change?.change === 'unchanged') continue;
      const entityId = already?.fundingId ?? `letter_${s.option.optionRef}_${l.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 120);
      const value: FundingAward = {
        provider: l.fundingKind === 'external_scholarship' ? (already?.provider ?? 'Named in the award letter') : (build.result.resolution.name ?? s.option.institution),
        name: l.label,
        kind: l.fundingKind,
        amount: l.amount,
        period: 'one_academic_year',
        coveredCosts: null,
        stage: l.stage,
        optionRef: s.option.optionRef,
        renewal: parsed.renewalMentioned ? null : { renewable: false, conditions: [], maxYears: null },
        basis: l.basis,
        eligibilityProgram: l.eligibilityProgram,
        disbursesOn: null,
        externalRefs: already ? [...already.externalRefs] : [],
      };
      const evidence = fromDocument
        ? [{ kind: 'document_anchor' as const, documentId: s.documentId!, documentVersion: s.version!, page: l.page, region: { kind: 'text_span' as const, blockIndex: l.index, start: 0, end: l.raw.length }, originalText: l.raw, method: 'text_layer' as const }]
        : [conversationEvidence(s.conversationId, s.turnId, l.raw.slice(0, 200), 'text', false)];
      // A letter line that updates an earlier record replaces it explicitly; the earlier value stays in the record's history.
      const supersedes = already?.sourceRef ? [already.sourceRef] : [];
      claims.push(buildClaim({ entity: 'funding_award', entityId, attribute: 'definition', value, origin: fromDocument ? 'document_extraction' : 'student_statement', confirmation: confirmedLines.includes(l.label) && ctx.request.actor.kind === 'student' ? 'student_confirmed' : 'unreviewed', evidence, actor: ctx.request.actor, viaRole: '15', supersedes }));
      recorded.push(l.label);
    }
    let fresh = view.recordVersion;
    if (claims.length > 0) {
      const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, 'award_letter'), operation: 'add_claims', claims, expectedRecordVersion: view.recordVersion, reason: `award_letter:${s.option.optionRef}` } });
      if (res.outcome !== 'accepted') {
        payload.notices.push({ code: 'letter_not_recorded', message: `The letter’s lines could not be saved to your record (${res.reasons.slice(0, 2).join('; ')}).` });
        recorded.length = 0;
      } else fresh = res.recordVersion ?? fresh;
    }
    payload.letter = { ...review, recorded, confirmedLines };
    payload.explanations.push({ term: 'award letter total', text: 'A headline total can include loans and work. Only grants and scholarships reduce the cost; the rest is shown as ways of paying.' });
    // Recalculate with the recorded lines so the comparison shows what changed.
    if (recorded.length > 0) {
      const again = readInputs(await readView(ctx, 'local', { entityTypes: ['attendance_budget', 'funding_award', 'aid_eligibility', 'fee_status'] }));
      const rebuilt = await this.buildOption(ctx, s.option, again, { view: 'annual', familyCurrency: null, exchange: null, growth: null, work: null, stress: [], estimates: [] }, { ...this.empty('x') });
      payload.options.push(rebuilt.result);
      return this.finishLetter(ctx, payload, rebuilt, fresh, review.questions.map((q) => q.question));
    }
    payload.options.push(build.result);
    return this.finishLetter(ctx, payload, build, fresh, review.questions.map((q) => q.question));
  }

  private async finishLetter(ctx: TaskContext, p: AffordabilityPayload, build: OptionBuild, recordVersion: number, open: string[]) {
    const letter = p.letter;
    const summary = letter
      ? `Reviewed the award letter: ${letter.totals.gift} ${letter.totals.currency} in grants and scholarships, ${letter.totals.loan} ${letter.totals.currency} in loans and ${letter.totals.work} ${letter.totals.currency} in work${letter.questions.length > 0 ? `; ${letter.questions.length} item${letter.questions.length === 1 ? ' needs' : 's need'} confirming` : ''}.`
      : 'The award letter could not be read yet.';
    const claimIds = build.recordClaimIds;
    return makeResult(ctx, {
      status: open.length > 0 || !letter ? 'needs_student_input' : 'completed',
      summary,
      payload: p,
      claimIds,
      recordVersion,
      sourceRefs: build.sourceRefs,
      uncertainties: open.slice(0, 5).map((q, i) => ({ affects: `letter_line:${i}`, description: q, resolution: 'Confirm the line with the letter’s notes or the aid office.', consequence: 'changes_decision' as const })),
      completionReason: letter ? (open.length > 0 ? 'confirmation_needed' : 'letter_reviewed') : 'letter_unreadable',
    });
  }

  // ------------------------------------------------------------ budget worksheet (15T12)

  private async exploreBudget(ctx: TaskContext, s: Scope<'explore_budget'>) {
    const view = await readView(ctx, 'local', { entityTypes: ['attendance_budget', 'funding_award', 'aid_eligibility', 'fee_status'] });
    const inputs = readInputs(view);
    const payload = this.empty('explore_budget');
    const builds: OptionBuild[] = [];
    for (const o of s.options) builds.push(await this.buildOption(ctx, o, { ...inputs, resources: [] }, { view: 'annual', familyCurrency: null, exchange: null, growth: null, work: null, stress: [], estimates: [] }, payload));
    let recordedRange = false;
    let recordVersion = view.recordVersion;
    if (s.range) {
      const claim = buildClaim({ entity: 'attendance_budget', entityId: 'family', attribute: 'definition', value: { min: s.range.min, max: s.range.max, period: s.range.period, includesTravelAndPersonal: s.range.includesTravelAndPersonal, basis: 'worksheet', availableFrom: null } satisfies AttendanceBudget, origin: 'student_statement', confirmation: ctx.request.actor.kind === 'student' ? 'student_confirmed' : 'unreviewed', evidence: [conversationEvidence(s.conversationId, s.turnId, `${s.range.min?.amount ?? ''}-${s.range.max.amount} ${s.range.max.currency}`, 'text', false)], actor: ctx.request.actor, viaRole: '15', holder: { kind: 'reported_other', label: 'family' } });
      const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, 'budget_range'), operation: 'add_claims', claims: [claim], expectedRecordVersion: view.recordVersion, reason: 'budget_worksheet' } });
      recordedRange = res.outcome === 'accepted';
      if (recordedRange) recordVersion = res.recordVersion ?? recordVersion;
    }
    payload.worksheet = {
      questions: [
        'What could your family put toward college each year without taking on debt? A range is fine.',
        'Who would confirm that amount, and when would the money be available?',
        'Does the amount need to cover travel and personal costs too, or only the college bill?',
        'Are there savings of your own you plan to use?',
        'Which currency do you think in, and is the amount per year or for the whole degree?',
      ],
      costRanges: builds.map((b) => ({ optionRef: b.result.optionRef, totalCost: b.result.scenarios[0]?.totals.totalCost ?? null, currency: b.result.currency, missing: b.result.factsNeeded.map((f) => f.component) })),
      recordedRange,
    };
    payload.notices.push({ code: 'no_invented_budget', message: 'No family contribution is assumed. You do not need to share income or documents to see costs; a comfortable maximum is enough to start.' });
    this.explain(payload, builds);
    return this.finish(ctx, payload, builds, recordVersion, s.requester);
  }

  // ------------------------------------------------------------ appeals (15T15)

  private async appealHelp(ctx: TaskContext, s: Scope<'appeal_help'>) {
    const payload = this.empty('appeal_help');
    const fabricate = FABRICATION.test(s.text);
    if (fabricate) payload.refusals.push('I can’t help describe hardship that didn’t happen or leave out income or assets. That would be misreporting to the aid office, and aid given on false information can be withdrawn. I can help you ask about changes that are real.');
    payload.appeal = {
      refused: fabricate,
      questionsForAidOffice: [
        `Does ${s.institution} have a special circumstances or appeal process, and how do we start it?`,
        'Which changes since the year reported on the aid application can be reviewed (for example a job loss, reduced income, medical costs, or a change in household)?',
        'What documents do you need, and by when?',
        'Will a review affect any award already offered?',
      ],
      documentsToGather: ['Documents showing any real change, as the office requests them (for example a termination letter, recent pay statements, or bills).', 'The award letter being reviewed, with its date.'],
      noGuarantee: 'The institution decides its own process and outcome; a review can leave the offer unchanged.',
    };
    return makeResult(ctx, { status: 'completed', summary: fabricate ? 'I can’t help present false financial information, but here is how to ask about real changes.' : `Here is how to ask ${s.institution} to review your aid.`, payload, completionReason: fabricate ? 'refused_false_claims' : 'appeal_questions' });
  }

  // ------------------------------------------------------------ aggregates for other roles (15T16)

  private async shareSummary(ctx: TaskContext, s: Scope<'share_summary'>) {
    const payload = this.empty('share_summary');
    const denied = s.requested.filter((r) => RAW_FINANCIAL.has(r) || !PERMITTED_AGGREGATES.has(r));
    const artifacts = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'affordability_scenario' });
    const provided = artifacts
      .filter((a) => a.status === 'current' || a.status === 'stale')
      .map((a) => {
        const v = a.payload as { optionRef: string; state: string; gapBeforeFinancing: string | null };
        const gap = v.gapBeforeFinancing === null ? null : Number(v.gapBeforeFinancing);
        const gapBand = gap === null || v.state === 'unknown' ? 'unknown' : gap <= 0 ? 'none' : gap < 2500 ? 'under_2500' : gap <= 10000 ? '2500_to_10000' : 'over_10000';
        return { optionRef: v.optionRef, state: v.state, gapBand: gapBand as 'none', stale: a.status === 'stale' };
      });
    payload.shared = { requester: s.requester, provided, denied };
    if (denied.length > 0) payload.refusals.push(`${denied.map((x) => x.replace(/_/g, ' ')).join(', ')} ${denied.length === 1 ? 'is' : 'are'} not shared with other parts of the counselor. They receive affordability states and gap ranges only.`);
    return makeResult(ctx, { status: 'completed', summary: `Shared ${provided.length} affordability state${provided.length === 1 ? '' : 's'}; ${denied.length} raw item${denied.length === 1 ? ' was' : 's were'} withheld.`, payload, completionReason: denied.length > 0 ? 'aggregates_only' : 'aggregates_shared' });
  }
}

const FABRICATION =
  /\b(make up|invent|fake|fabricat\w*|pretend|lie about|lying about|exaggerat\w*|inflate)\b|\b(hide|conceal|not (?:report|mention|include|declare)|leave out|underreport|under-report|omit)\b[^.]{0,40}\b(income|assets?|savings|house|property|money|bonus|business|salary|earnings)\b|\bsay (?:that )?(?:my|our) (?:parents?|family|dad|mom|mum|mother|father)[^.]{0,40}\b(?:lost|lose|sick|ill)\b[^.]{0,40}\b(?:even though|but (?:they|he|she) (?:didn'?t|did not|still|have not|haven'?t))/i;

const RAW_FINANCIAL = new Set(['tax_return', 'bank_statement', 'household_income', 'household_assets', 'pay_stub', 'award_letter_document', 'account_number', 'fsa_credentials', 'raw_documents']);
const PERMITTED_AGGREGATES = new Set(['affordability_state', 'gap_band', 'conditions']);

function shift(date: CalendarDate, days: number): CalendarDate {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10) as CalendarDate;
}

export type { Money };
