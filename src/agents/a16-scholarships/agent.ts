import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import { type OperationDecision } from '../../policy/assistance.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { RoleIdSchema, type AnyRoleId, type Handoff } from '../../shared/envelopes.js';
import { SCHOLARSHIP_TRACKING_STAGES, type FundingAward } from '../../shared/fields.js';
import { isAbsence } from '../../shared/absence.js';
import { MoneySchema, formatMoney, type Money } from '../../shared/money.js';
import { diffDays, type CalendarDate, type PartialDate } from '../../shared/time.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import type { DerivedArtifact, MutationResponse } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import type { FetchOutcome } from '../a09-opportunities/research.js';
import { normName } from '../a15-affordability/ledger.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import { scholarshipRef, type Lead, type Scholarship, type Stage } from './catalog.js';
import { catalogKeysFor, evaluateRule, type EligibilityFacts, type LeafResult } from './rules.js';

/**
 * Agent 16 — Scholarship eligibility and matching advisor.
 *
 * Finds credible opportunities in a maintained catalog, evaluates the
 * sponsor's rules clause by clause (true, false or unknown), builds the
 * nomination, admission, reference and interview dependencies, and ranks
 * actionable opportunities by transparent practical factors. It never
 * promises an award, never invents a chance of winning, and never counts an
 * advertised amount as money until an award letter is recorded; the net
 * financial effect belongs to Agent 15 and the schedule to Agent 14.
 */

const DIMENSIONS = ['eligibility', 'interest_fit', 'deadline_feasibility', 'effort', 'nomination_access', 'restrictions', 'value_clarity'] as const;
type Dimension = (typeof DIMENSIONS)[number];
const DEFAULT_WEIGHTS: Record<Dimension, number> = { eligibility: 3, interest_fit: 2, deadline_feasibility: 2, effort: 2, nomination_access: 1, restrictions: 1, value_clarity: 1 };

const EFFORT_HOURS: Record<Stage['kind'], number> = { nomination: 1, admission_application: 0, reference: 1, award_application: 2, essay: 4, video: 5, financial_documents: 2, interview: 3 };

// ---------------------------------------------------------------- scope

const AnswersSchema = z.record(z.string().regex(/^[a-z0-9_]+$/), z.boolean()).default({});
const DeclinedSchema = z.array(z.string().min(1).max(80)).max(20).default([]);

export const ScholarshipScopeSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('shortlist'),
      cycle: z.string().regex(/^\d{4}$/),
      topics: z.array(z.string().regex(/^[a-z_]+$/)).max(10).default([]),
      weights: z.partialRecord(z.enum(DIMENSIONS), z.number().int().min(0).max(5)).default({}),
      /** Hours the student can give to scholarship work before the earliest deadline, from the portfolio strategist. */
      availableHours: z.number().nonnegative().nullable().default(null),
      answers: AnswersSchema,
      declined: DeclinedSchema,
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('check'), scholarshipId: z.string().min(1), answers: AnswersSchema, declined: DeclinedSchema, requester: RoleIdSchema.default('01') }).strict(),
  z
    .object({
      action: z.literal('submit_lead'),
      name: z.string().min(1).max(200),
      providerName: z.string().min(1).max(200),
      url: z.string().url().nullable().default(null),
      listingText: z.string().max(20000).default(''),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('track'),
      scholarshipId: z.string().min(1),
      stage: z.enum(SCHOLARSHIP_TRACKING_STAGES),
      evidence: z
        .object({
          kind: z.enum(['student_report', 'provider_message', 'award_letter']),
          quote: z.string().min(1).max(500),
          conversationId: z.string().min(1).default('conv_scholarships'),
          turnId: z.string().min(1).default('t_scholarship'),
          documentId: z.string().min(1).nullable().default(null),
          documentVersion: z.number().int().positive().nullable().default(null),
        })
        .strict(),
      award: z.object({ amount: MoneySchema, period: z.enum(['one_term', 'one_academic_year', 'full_degree', 'one_time']), coveredCosts: z.array(z.string()).nullable().default(null), renewal: z.object({ renewable: z.boolean(), conditions: z.array(z.string()), maxYears: z.number().int().positive().nullable().default(null) }).strict().nullable().default(null), optionRef: z.string().nullable().default(null) }).strict().nullable().default(null),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('assist'),
      scholarshipId: z.string().min(1),
      operation: z.enum(['tailored_brainstorming', 'editing', 'prose_generation', 'interview_preparation', 'answer_assessed_interview']),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
]);
export type ScholarshipScope = z.infer<typeof ScholarshipScopeSchema>;

// ---------------------------------------------------------------- payload

const ClauseOutSchema = z.object({ clauseId: z.string(), text: z.string(), reason: z.string(), sourceRef: z.string(), fact: z.string(), sensitive: z.boolean(), declined: z.boolean() }).strict();

const OpportunitySchema = z
  .object({
    scholarshipId: z.string(),
    version: z.number().int(),
    name: z.string(),
    provider: z.string(),
    applicationUrl: z.string().nullable(),
    trust: z.object({ status: z.enum(['verified_provider', 'unresolved', 'suspicious']), evidence: z.array(z.string()) }).strict(),
    eligibility: z.object({ status: z.enum(['eligible_within_checked_scope', 'potentially_eligible', 'ineligible']), failed: z.array(ClauseOutSchema), unknown: z.array(ClauseOutSchema), satisfied: z.array(ClauseOutSchema), evaluatedOn: z.string() }).strict(),
    selectionCriteria: z.array(z.string()),
    award: z.object({ kind: z.string(), display: z.string(), guaranteedAmount: MoneySchema.nullable(), maximum: MoneySchema.nullable(), duration: z.string().nullable(), renewal: z.string().nullable(), coveredCosts: z.array(z.string()).nullable(), portability: z.string(), restrictions: z.array(z.string()) }).strict(),
    affordabilityCredit: z.enum(['zero_in_confirmed_funding_scenario', 'offered_pending_reconciliation']),
    dependencies: z
      .object({
        applicationPath: z.enum(['direct', 'automatic_with_admission', 'requires_nomination_first', 'requires_admission_first']),
        stages: z.array(z.object({ stageId: z.string(), kind: z.string(), label: z.string(), owner: z.string(), deadline: z.string().nullable(), time: z.string().nullable(), timezone: z.string().nullable(), internalDeadline: z.string().nullable(), dependsOn: z.array(z.string()) }).strict()),
        earliest: z.object({ stageId: z.string(), label: z.string(), date: z.string().nullable(), note: z.string() }).strict().nullable(),
      })
      .strict(),
    deadlineStatus: z.enum(['open', 'tight', 'closed', 'unknown']),
    effortHours: z.number(),
    trackingStage: z.string().nullable(),
    exclusiveWith: z.array(z.object({ scholarshipId: z.string(), text: z.string() }).strict()),
    ranking: z.object({ rank: z.number().int().positive(), score: z.number(), dimensions: z.record(z.string(), z.object({ value: z.number(), why: z.string() }).strict()) }).strict().nullable(),
  })
  .strict();
export type OpportunityOut = z.infer<typeof OpportunitySchema>;

export const ScholarshipPayloadSchema = z
  .object({
    action: z.string(),
    opportunities: z.array(OpportunitySchema),
    excluded: z.array(z.object({ scholarshipId: z.string(), name: z.string(), reason: z.string() }).strict()),
    leads: z.array(z.object({ leadId: z.string().nullable(), scholarshipId: z.string().nullable(), name: z.string(), trust: z.enum(['verified_provider', 'unresolved', 'suspicious']), message: z.string(), signals: z.array(z.object({ code: z.string(), evidence: z.string() }).strict()), missing: z.array(z.string()) }).strict()),
    choices: z.array(z.object({ scholarshipIds: z.array(z.string()).min(2), text: z.string() }).strict()),
    capacity: z.object({ availableHours: z.number(), requiredHours: z.number(), conflict: z.boolean() }).strict().nullable(),
    packet: z
      .object({
        scholarshipId: z.string(),
        officialLinks: z.array(z.string()),
        checklist: z.array(z.object({ stageId: z.string(), label: z.string(), owner: z.string(), due: z.string(), timezone: z.string().nullable() }).strict()),
        preparedRequests: z.array(z.object({ to: z.string(), purpose: z.string(), text: z.string(), sent: z.literal(false) }).strict()),
        assistance: z.array(z.object({ operation: z.string(), decision: z.enum(['allowed', 'prohibited', 'unclear']), explanation: z.string() }).strict()),
      })
      .strict()
      .nullable(),
    tracking: z.object({ scholarshipId: z.string(), stage: z.string(), fundingRecorded: z.boolean(), duplicateOf: z.string().nullable(), note: z.string() }).strict().nullable(),
    assistance: z.object({ operation: z.string(), decision: z.enum(['allowed', 'prohibited', 'unclear', 'refused']), explanation: z.string(), contentProduced: z.literal(false) }).strict().nullable(),
    questions: z.array(z.object({ code: z.string(), question: z.string(), why: z.string(), canSkip: z.boolean() }).strict()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    refusals: z.array(z.string()),
  })
  .strict();
export type ScholarshipPayload = z.infer<typeof ScholarshipPayloadSchema>;

export const SCHOLARSHIP_CONTRACT: ContractDefinition<ScholarshipPayload> = {
  id: 'scholarship_matches_v1',
  role: '16',
  payload: ScholarshipPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    for (const o of p.opportunities) {
      const e = o.eligibility;
      if (e.status === 'eligible_within_checked_scope' && (e.failed.length > 0 || e.unknown.length > 0)) issues.push(`${o.scholarshipId}: eligible despite open or failed clauses`);
      if (e.status === 'potentially_eligible' && (e.unknown.length === 0 || e.failed.length > 0)) issues.push(`${o.scholarshipId}: potentially eligible needs an open clause and no failed one`);
      if (e.status === 'ineligible' && e.failed.length === 0) issues.push(`${o.scholarshipId}: ineligible without a failed clause`);
      if (o.ranking && (o.trust.status !== 'verified_provider' || e.status === 'ineligible' || o.deadlineStatus === 'closed')) issues.push(`${o.scholarshipId}: only verified, open, not-ineligible opportunities are ranked`);
      if (o.award.guaranteedAmount && o.award.kind !== 'fixed') issues.push(`${o.scholarshipId}: only a fixed award has a guaranteed amount`);
      if (o.affordabilityCredit !== 'zero_in_confirmed_funding_scenario' && o.trackingStage !== 'offered') issues.push(`${o.scholarshipId}: funding credit without an offer`);
    }
    if (/\b(chance|probability|odds|likel(y|ihood)) (of|to) (win|winning|receive|receiving|get|getting)\b/i.test(JSON.stringify(p))) issues.push('no chance of winning may be stated');
    return issues;
  },
};

// ---------------------------------------------------------------- facts

function factsFrom(view: RecordView, answers: Record<string, boolean>, declined: readonly string[]): { facts: EligibilityFacts; claimIds: string[] } {
  const claimIds: string[] = [];
  const recordedAbsent = new Set<string>();
  const get = <T>(attr: string): T | undefined => {
    const f = view.student(attr);
    if (f?.current) {
      claimIds.push(f.current.claimId);
      if (isAbsence(f.current.value)) recordedAbsent.add(attr);
    }
    return view.studentValue<T>(attr);
  };
  const facts: EligibilityFacts = { applications: [], answers, declined: new Set(declined), recordedAbsent };
  const g = get<PartialDate>('education.expected_graduation');
  if (g) facts.expectedGraduation = g;
  const st = get<string>('education.stage');
  if (st) facts.educationStage = st;
  const pe = get<EligibilityFacts['postsecondaryEnrollment']>('education.postsecondary_enrollment');
  if (pe) facts.postsecondaryEnrollment = pe;
  const c = get<string[]>('identity.citizenships');
  if (c) facts.citizenships = c;
  const r = get<string>('identity.residence_country');
  if (r) facts.residenceCountry = r;
  const sc = get<string>('education.school_country');
  if (sc) facts.schoolCountry = sc;
  const b = get<CalendarDate>('identity.birth_date');
  if (b) facts.birthDate = b;
  const a = get<'yes' | 'no' | 'unsure'>('finance.aid_needed');
  if (a) facts.aidNeeded = a;
  for (const id of view.entityIds('application')) {
    const d = view.value<{ institutionRef: string; programRef: string | null }>('application', id, 'definition');
    if (!d) continue;
    const df = view.field('application', id, 'definition');
    if (df?.current) claimIds.push(df.current.claimId);
    const rk = view.value<{ rank: number; label: string | null }>('application', id, 'choice_rank');
    const rf = view.field('application', id, 'choice_rank');
    if (rf?.current) claimIds.push(rf.current.claimId);
    facts.applications.push({ institutionRef: d.institutionRef, programRef: d.programRef, rank: rk?.rank ?? null, rankLabel: rk?.label ?? null });
  }
  return { facts, claimIds };
}

function levelsOf(stage: string | undefined): string[] | null {
  if (!stage) return null;
  if (stage === 'secondary') return ['secondary', 'undergraduate_incoming'];
  if (stage === 'completed_secondary' || stage === 'gap_year') return ['undergraduate_incoming'];
  if (stage === 'postsecondary') return ['undergraduate_current'];
  return null;
}

const out = (l: LeafResult) => ({ clauseId: l.clauseId, text: l.text, reason: l.reason, sourceRef: l.sourceRef, fact: l.fact, sensitive: l.sensitive, declined: l.declined });

function awardView(s: Scholarship): OpportunityOut['award'] {
  const a = s.award;
  const money = (m: Money | null) => (m ? formatMoney(m) : 'an amount not stated');
  const display =
    a.kind === 'fixed'
      ? money(a.amount)
      : a.kind === 'up_to'
        ? `up to ${money(a.max)}; not every recipient receives the maximum`
        : a.kind === 'range'
          ? `${money(a.min)} to ${money(a.max)}`
          : a.kind === 'tuition_waiver'
            ? 'tuition only; living costs, travel and insurance are not covered'
            : a.kind === 'percentage'
              ? `${a.percentage ?? '?'}% of tuition`
              : a.kind === 'reimbursement'
                ? `reimbursement of ${a.coveredCosts?.join(', ') ?? 'named costs'} after they are paid`
                : `covers ${a.coveredCosts?.join(', ') ?? 'named costs'}`;
  const restrictions = a.portability === 'destination_restricted' ? a.destinations.map((d) => `only at ${d.programRef ? `${d.programRef} at ` : ''}${d.institutionRef}`) : [];
  return {
    kind: a.kind,
    display,
    guaranteedAmount: a.kind === 'fixed' ? a.amount : null,
    maximum: a.max ?? (a.kind === 'fixed' ? a.amount : null),
    duration: a.duration,
    renewal: a.renewal ? (a.renewal.renewable ? `renewable${a.renewal.maxYears ? ` for up to ${a.renewal.maxYears} years` : ''} if ${a.renewal.conditions.join('; ') || 'the sponsor’s conditions are met'}` : 'not renewable') : null,
    coveredCosts: a.coveredCosts,
    portability: a.portability,
    restrictions,
  };
}

function dependencies(s: Scholarship, today: CalendarDate): { deps: OpportunityOut['dependencies']; status: OpportunityOut['deadlineStatus']; questions: ScholarshipPayload['questions'] } {
  const questions: ScholarshipPayload['questions'] = [];
  const stages = s.stages.map((st) => ({ stageId: st.stageId, kind: st.kind, label: st.label, owner: st.owner, deadline: st.deadline?.date ?? null, time: st.deadline?.time ?? null, timezone: st.deadline?.timezone ?? null, internalDeadline: st.internalDeadline ?? null, dependsOn: st.dependsOn }));
  // The earliest controlling requirement: an internal cutoff counts before the sponsor's date, and an unknown one is asked about (16T03, 16T04).
  const dated = stages.map((st) => ({ st, date: st.internalDeadline && st.internalDeadline !== 'unknown' ? st.internalDeadline : st.deadline })).filter((x) => x.date !== null).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  const unknownInternal = stages.filter((st) => st.internalDeadline === 'unknown');
  for (const st of unknownInternal) questions.push({ code: `internal_deadline_${s.scholarshipId}_${st.stageId}`, question: `Your school may set its own earlier deadline for ${st.label.toLowerCase()} for ${s.name}. Could you check with your counselor? The sponsor’s date is ${st.deadline ?? 'not published'}.`, why: 'A school usually needs time to choose a nominee or write a reference.', canSkip: true });
  const nomination = stages.find((st) => st.kind === 'nomination');
  let earliest: OpportunityOut['dependencies']['earliest'] = null;
  const first = dated[0];
  if (nomination && nomination.internalDeadline === 'unknown') earliest = { stageId: nomination.stageId, label: nomination.label, date: nomination.deadline, note: 'Nomination comes first; the school’s internal deadline is unknown and may be earlier.' };
  else if (first) earliest = { stageId: first.st.stageId, label: first.st.label, date: first.date, note: first.st.kind === 'nomination' ? 'Nomination comes before the application.' : 'The earliest dated step.' };
  const path: OpportunityOut['dependencies']['applicationPath'] = s.consideration === 'automatic_with_admission' ? 'automatic_with_admission' : nomination ? 'requires_nomination_first' : stages.some((st) => st.kind === 'admission_application') ? 'requires_admission_first' : 'direct';
  const future = dated.filter((x) => x.date! >= today);
  const status: OpportunityOut['deadlineStatus'] = dated.length === 0 ? 'unknown' : future.length < dated.length && dated.some((x) => x.date! < today && x.st.kind !== 'admission_application') ? 'closed' : future.length > 0 && diffDays(today, future[0]!.date! as CalendarDate) < 7 ? 'tight' : 'open';
  return { deps: { applicationPath: path, stages, earliest }, status, questions };
}

function effortOf(s: Scholarship): number {
  let h = 0;
  for (const st of s.stages) {
    h += EFFORT_HOURS[st.kind];
    h += (st.details.essays ?? 0) * EFFORT_HOURS.essay + (st.details.shortAnswers ?? 0) * 1 + (st.details.references ?? 0) * EFFORT_HOURS.reference;
  }
  return h;
}

// ---------------------------------------------------------------- the agent

type Scope<A extends ScholarshipScope['action']> = Extract<ScholarshipScope, { action: A }>;

export class ScholarshipAdvisorAgent implements SpecialistAgent {
  readonly role = '16' as const;
  readonly contracts = [SCHOLARSHIP_CONTRACT];

  /** Eligibility runs in code on reviewed rules; a model is not needed for any decision here. */
  constructor(private readonly model: ModelGateway) {}

  get modelConfigured(): boolean {
    return this.model.configured;
  }

  async handle(ctx: TaskContext) {
    const parsed = ScholarshipScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The scholarship request was incomplete.', 'invalid_scope');
    const s = parsed.data;
    switch (s.action) {
      case 'shortlist':
        return this.shortlist(ctx, s);
      case 'check':
        return this.check(ctx, s);
      case 'submit_lead':
        return this.submitLead(ctx, s);
      case 'track':
        return this.track(ctx, s);
      case 'assist':
        return this.assist(ctx, s);
    }
  }

  private empty(action: string): ScholarshipPayload {
    return { action, opportunities: [], excluded: [], leads: [], choices: [], capacity: null, packet: null, tracking: null, assistance: null, questions: [], notices: [], refusals: [] };
  }

  private today(ctx: TaskContext): CalendarDate {
    return ctx.clock.nowIso().slice(0, 10) as CalendarDate;
  }

  /** Read only the facts the rules need, plus tracking stages and recorded awards. */
  private async read(ctx: TaskContext, items: readonly Scholarship[]) {
    // The applicant level is always needed (a graduate award is never on an undergraduate shortlist, 16T05).
    const keys = new Set<string>(['scholarship_application.status', 'funding_award.definition', 'student.education.stage']);
    for (const s of items) for (const k of catalogKeysFor(s.rule)) keys.add(k);
    const view = await readView(ctx, 'local', { catalogKeys: [...keys] });
    const tracking = new Map<string, { stage: string; claimId: string }>();
    for (const id of view.entityIds('scholarship_application')) {
      const v = view.value<{ opportunityRef: string; stage: string }>('scholarship_application', id, 'status');
      const f = view.field('scholarship_application', id, 'status');
      if (v && f?.current) tracking.set(v.opportunityRef, { stage: v.stage, claimId: f.current.claimId });
    }
    return { view, tracking };
  }

  private evaluate(s: Scholarship, facts: EligibilityFacts, today: CalendarDate, trackingStage: string | null) {
    const ev = evaluateRule(s.rule, facts);
    const deps = dependencies(s, today);
    // A required nomination is a condition of applying at all: until the school nominates, the award is at most potentially available (16 "Worked case").
    const nomination = s.stages.find((st) => st.kind === 'nomination');
    if (nomination) {
      const base = { clauseId: 'nomination_available', kind: 'custom' as const, text: `${nomination.label} is required before applying.`, sourceRef: nomination.deadline?.sourceRef ?? s.sources[0]!.sourceRef, fact: 'scholarship_application.status', sensitive: false, declined: false };
      if (trackingStage === 'nominated' || (trackingStage !== null && ['applied', 'interview', 'semifinalist', 'finalist', 'offered'].includes(trackingStage))) ev.leaves.push({ ...base, truth: 'true', reason: 'You have been nominated.' });
      else if (trackingStage === 'not_nominated') {
        const r = { ...base, truth: 'false' as const, reason: 'Your school did not nominate you this cycle, so you cannot apply.' };
        ev.leaves.push(r);
        ev.failed.push(r);
      } else {
        const r = { ...base, truth: 'unknown' as const, reason: 'Whether your school will nominate you is not known yet.' };
        ev.leaves.push(r);
        ev.unknown.push(r);
      }
    }
    const status: OpportunityOut['eligibility']['status'] = ev.failed.length > 0 ? 'ineligible' : ev.unknown.length > 0 ? 'potentially_eligible' : 'eligible_within_checked_scope';
    const opp: OpportunityOut = {
      scholarshipId: s.scholarshipId,
      version: s.version,
      name: s.name,
      provider: s.provider.name,
      applicationUrl: s.applicationUrl,
      trust: { status: s.trust.status, evidence: s.trust.evidence },
      eligibility: { status, failed: ev.failed.map(out), unknown: ev.unknown.map(out), satisfied: ev.leaves.filter((l) => l.truth === 'true').map(out), evaluatedOn: today },
      selectionCriteria: s.selectionCriteria,
      award: awardView(s),
      affordabilityCredit: trackingStage === 'offered' ? 'offered_pending_reconciliation' : 'zero_in_confirmed_funding_scenario',
      dependencies: deps.deps,
      deadlineStatus: deps.status,
      effortHours: effortOf(s),
      trackingStage,
      exclusiveWith: s.exclusiveWith.map((x) => ({ scholarshipId: x.scholarshipId, text: x.text })),
      ranking: null,
    };
    // Ask only what could change the result; a declined question is never repeated.
    const questions: ScholarshipPayload['questions'] = [...deps.questions];
    for (const u of ev.unknown) {
      if (u.declined || u.clauseId === 'nomination_available') continue;
      questions.push({ code: `clause_${s.scholarshipId}_${u.clauseId}`, question: u.kind === 'custom' ? u.reason : `${s.name} requires: “${u.text}”. ${u.reason} Could you tell me?`, why: u.sensitive ? 'This is sensitive. It is asked only because this award depends on it; you can skip it and the award stays “potentially eligible”.' : 'The eligibility result depends on it.', canSkip: true });
    }
    return { opp, questions };
  }

  // ------------------------------------------------------------ shortlist (steps 1-5)

  private async shortlist(ctx: TaskContext, s: Scope<'shortlist'>) {
    const p = this.empty('shortlist');
    const items = await ctx.call<Scholarship[]>('scholarships.read', { op: 'search', cycle: s.cycle, includePastCycles: true });
    const { view, tracking } = await this.read(ctx, items);
    const { facts, claimIds } = factsFrom(view, s.answers, s.declined);
    const today = this.today(ctx);
    const levels = levelsOf(facts.educationStage);
    if (!levels) p.notices.push({ code: 'level_unknown', message: 'Your stage of education is not recorded, so awards for every applicant level are shown.' });
    const weights = { ...DEFAULT_WEIGHTS, ...s.weights };
    const candidates: OpportunityOut[] = [];
    for (const sch of items) {
      const stage = tracking.get(sch.scholarshipId)?.stage ?? null;
      if (stage === 'stopped' || stage === 'not_selected') {
        p.excluded.push({ scholarshipId: sch.scholarshipId, name: sch.name, reason: stage === 'stopped' ? 'You stopped pursuing this; it is no longer in your plan.' : 'Not selected this cycle.' });
        continue;
      }
      if (levels && !sch.applicantLevels.some((l) => levels.includes(l))) {
        p.excluded.push({ scholarshipId: sch.scholarshipId, name: sch.name, reason: `This award is for ${sch.applicantLevels.map((l) => l.replace(/_/g, ' ')).join(' or ')} applicants, not your level.` });
        continue;
      }
      if (sch.cycleStatus !== 'current') {
        p.excluded.push({ scholarshipId: sch.scholarshipId, name: sch.name, reason: sch.cycleStatus === 'past' ? 'This listing is for a cycle that has ended; the next one has not been announced.' : 'The current cycle has not been announced.' });
        continue;
      }
      const { opp, questions } = this.evaluate(sch, facts, today, stage);
      if (opp.trust.status !== 'verified_provider') {
        p.leads.push({ leadId: null, scholarshipId: sch.scholarshipId, name: sch.name, trust: opp.trust.status, message: opp.trust.status === 'suspicious' ? 'This listing shows warning signs. Do not pay anything or share account details; check with the provider directly.' : 'Not yet verified; kept apart from your actionable list until it is checked.', signals: opp.trust.evidence.map((e) => ({ code: 'catalog_note', evidence: e })), missing: [] });
        continue;
      }
      candidates.push(opp);
      p.questions.push(...questions.filter((q) => !p.questions.some((x) => x.code === q.code)));
    }
    // Mutually exclusive routes are a choice; both are never assumed together (16T07).
    for (const o of candidates) {
      for (const x of o.exclusiveWith) {
        if (!candidates.some((c) => c.scholarshipId === x.scholarshipId)) continue;
        const ids = [o.scholarshipId, x.scholarshipId].sort();
        if (!p.choices.some((c) => c.scholarshipIds.join('|') === ids.join('|'))) p.choices.push({ scholarshipIds: ids, text: `${x.text} You can hold only one of these, so they are compared as a choice and never counted together.` });
      }
    }
    // Rank the actionable ones by practical factors the student can change; no probability of winning (16 "Ranking and effort decisions").
    const actionable = candidates.filter((o) => o.eligibility.status !== 'ineligible' && o.deadlineStatus !== 'closed');
    const interests = new Set(s.topics);
    const catalogById = new Map(items.map((i) => [i.scholarshipId, i]));
    for (const o of actionable) {
      const sch = catalogById.get(o.scholarshipId)!;
      const fit = sch.topics.filter((t) => interests.has(t)).length;
      const dims: Record<Dimension, { value: number; why: string }> = {
        eligibility: { value: o.eligibility.status === 'eligible_within_checked_scope' ? 2 : 1, why: o.eligibility.status === 'eligible_within_checked_scope' ? 'All checked requirements are met.' : `${o.eligibility.unknown.length} requirement${o.eligibility.unknown.length === 1 ? ' is' : 's are'} still open.` },
        interest_fit: { value: Math.min(2, fit), why: fit > 0 ? `Matches ${fit} of your interests.` : 'No stated interest in common.' },
        deadline_feasibility: { value: o.deadlineStatus === 'open' ? 2 : o.deadlineStatus === 'tight' ? 1 : 0, why: o.deadlineStatus === 'tight' ? 'The earliest step is less than a week away.' : o.deadlineStatus === 'open' ? 'There is time before the earliest step.' : 'The dates are not published.' },
        effort: { value: o.effortHours <= 4 ? 2 : o.effortHours <= 12 ? 1 : 0, why: `About ${o.effortHours} hours of work.` },
        nomination_access: { value: o.dependencies.applicationPath === 'requires_nomination_first' ? 0 : 2, why: o.dependencies.applicationPath === 'requires_nomination_first' ? 'Needs a school nomination first.' : 'No nomination needed.' },
        restrictions: { value: o.award.portability === 'portable' ? 2 : 1, why: o.award.portability === 'portable' ? 'Usable at any eligible college.' : o.award.restrictions.join('; ') },
        value_clarity: { value: o.award.guaranteedAmount ? 2 : o.award.maximum ? 1 : 0, why: o.award.guaranteedAmount ? `A fixed ${formatMoney(o.award.guaranteedAmount)} if awarded.` : o.award.display },
      };
      const score = DIMENSIONS.reduce((a, d) => a + dims[d].value * weights[d], 0);
      o.ranking = { rank: 1, score, dimensions: dims };
    }
    actionable.sort((a, b) => b.ranking!.score - a.ranking!.score || (a.dependencies.earliest?.date ?? '9999').localeCompare(b.dependencies.earliest?.date ?? '9999'));
    actionable.forEach((o, i) => (o.ranking!.rank = i + 1));
    p.opportunities = [...actionable, ...candidates.filter((o) => !actionable.includes(o))];
    if (s.availableHours !== null) {
      const required = actionable.reduce((a, o) => a + o.effortHours, 0);
      p.capacity = { availableHours: s.availableHours, requiredHours: required, conflict: required > s.availableHours };
      if (p.capacity.conflict) p.notices.push({ code: 'capacity', message: `These applications need about ${required} hours and about ${s.availableHours} are available before the deadlines. Choosing which to pursue is a decision for you and your plan, not something to squeeze in.` });
    }
    if (actionable.length > 0) p.notices.push({ code: 'not_funding', message: 'None of these is money yet. An award counts toward your budget only after an award letter is recorded.' });

    const sourceRefs = items.filter((i) => p.opportunities.some((o) => o.scholarshipId === i.scholarshipId)).flatMap((i) => [scholarshipRef(i.scholarshipId, i.version)]);
    const artifact = await ctx.call<DerivedArtifact>('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind: 'scholarship_shortlist',
      scopeKey: `cycle_${s.cycle}`,
      payload: { ranked: actionable.map((o) => ({ scholarshipId: o.scholarshipId, rank: o.ranking!.rank, eligibility: o.eligibility.status })) },
      inputClaimIds: [...new Set([...claimIds, ...[...tracking.values()].map((t) => t.claimId)])],
      sourceIds: [...sourceRefs, ...p.opportunities.map((o) => scholarshipRef(o.scholarshipId))],
      recordVersion: view.recordVersion,
    });
    const handoffs: Handoff[] = [];
    if (actionable.length > 0 && s.requester !== '14') {
      handoffs.push({ toRole: '14', reason: p.capacity?.conflict ? 'Scholarship work exceeds the time available.' : 'Scholarship steps need scheduling.', requestedOutcome: p.capacity?.conflict ? 'Help the student choose which scholarships to pursue within the time available, alongside admissions work.' : 'Schedule the earliest controlling step of each pursued scholarship, nominations first.', inputRefs: [`artifact:${artifact.id}`, ...actionable.map((o) => scholarshipRef(o.scholarshipId, o.version))], unresolved: actionable.filter((o) => o.dependencies.earliest?.note.includes('unknown')).map((o) => o.scholarshipId), completionCondition: 'Each pursued scholarship has its steps in the plan or has been set aside.' });
    }
    if (actionable.length > 0 && s.requester !== '15') {
      handoffs.push({ toRole: '15', reason: 'Potential awards exist but none is offered.', requestedOutcome: 'Keep these at zero in the confirmed funding scenario; show a conditional scenario only if the student asks.', inputRefs: actionable.map((o) => scholarshipRef(o.scholarshipId, o.version)), unresolved: [], completionCondition: 'The confirmed scenario has no unoffered awards.' });
    }
    return makeResult(ctx, {
      status: p.questions.length > 0 ? 'partial' : 'completed',
      summary: `${actionable.length} scholarship${actionable.length === 1 ? '' : 's'} to consider, ${p.opportunities.length - actionable.length} not actionable, ${p.leads.length} awaiting verification and ${p.excluded.length} set aside.`,
      payload: p,
      claimIds: [...new Set([...claimIds, ...[...tracking.values()].map((t) => t.claimId)])],
      recordVersion: view.recordVersion,
      sourceRefs,
      handoffs,
      uncertainties: p.opportunities.flatMap((o) => o.eligibility.unknown.slice(0, 2).map((u) => ({ affects: `scholarship:${o.scholarshipId}`, description: u.reason || `Open requirement: ${u.text}`, resolution: u.declined ? 'You can answer later if you choose.' : 'Answer the eligibility question or check with the sponsor.', consequence: 'changes_decision' as const }))).slice(0, 10),
      completionReason: 'shortlist_ranked',
    });
  }

  // ------------------------------------------------------------ one award: check and action packet (step 6)

  private async check(ctx: TaskContext, s: Scope<'check'>) {
    const p = this.empty('check');
    const [sch] = await ctx.call<Scholarship[]>('scholarships.read', { op: 'get', scholarshipId: s.scholarshipId });
    if (!sch) return failedResult(ctx, 'failed', 'That scholarship is not in the catalog.', 'unknown_scholarship');
    const { view, tracking } = await this.read(ctx, [sch]);
    const { facts, claimIds } = factsFrom(view, s.answers, s.declined);
    const { opp, questions } = this.evaluate(sch, facts, this.today(ctx), tracking.get(sch.scholarshipId)?.stage ?? null);
    p.opportunities.push(opp);
    p.questions.push(...questions);
    if (opp.trust.status !== 'verified_provider') p.notices.push({ code: 'trust', message: opp.trust.status === 'suspicious' ? 'This listing shows warning signs; do not pay or share account details. Check with the provider directly.' : 'The provider has not been verified yet; eligibility below does not mean the listing is genuine.' });
    // The assistance decision is per operation and per destination (16 "Authorship essays and interviews").
    const assistance: NonNullable<ScholarshipPayload['packet']>['assistance'] = [];
    const policySources: string[] = [];
    for (const operation of ['tailored_brainstorming', 'editing', 'prose_generation', 'interview_preparation'] as const) {
      const d = await ctx.call<OperationDecision>('policy.check_operation', { operation, destinations: [{ kind: 'scholarship', ref: sch.scholarshipId, cycle: sch.cycle }] });
      assistance.push({ operation, decision: d.decision, explanation: d.explanation });
      for (const x of d.perDestination) if (x.sourceId) policySources.push(x.sourceId);
    }
    const nomination = sch.stages.find((st) => st.kind === 'nomination');
    const preparedRequests: NonNullable<ScholarshipPayload['packet']>['preparedRequests'] = [];
    if (nomination) {
      preparedRequests.push({ to: nomination.details.nominator ?? 'your school counselor', purpose: 'nomination', text: `I would like to be considered for the school’s nomination for the ${sch.name} (${sch.cycle}). Could you tell me the school’s internal process and deadline, and whether you need anything from me?`, sent: false });
      if (nomination.details.perSchoolLimit) p.notices.push({ code: 'nomination_limit', message: `${sch.provider.name} lets each school nominate ${nomination.details.perSchoolLimit} student${nomination.details.perSchoolLimit === 1 ? '' : 's'}. The school decides who; the app does not.` });
      if (nomination.details.refereeMustDiffer) p.notices.push({ code: 'referee_differs', message: 'Your referee must be a different person from your nominator.' });
    }
    const interview = sch.stages.find((st) => st.kind === 'interview');
    if (interview?.details.assessed) p.notices.push({ code: 'assessed_interview', message: 'The interview is part of selection. The app can help you prepare beforehand where the sponsor allows it, but it will never answer during the interview for you.' });
    const checklist = [...opp.dependencies.stages]
      .sort((a, b) => ((a.internalDeadline && a.internalDeadline !== 'unknown' ? a.internalDeadline : a.deadline) ?? '9999').localeCompare((b.internalDeadline && b.internalDeadline !== 'unknown' ? b.internalDeadline : b.deadline) ?? '9999'))
      .map((st) => ({ stageId: st.stageId, label: st.label, owner: st.owner, due: st.internalDeadline === 'unknown' ? `school deadline unknown (sponsor: ${st.deadline ?? 'not published'})` : (st.internalDeadline ?? st.deadline) ?? 'not published', timezone: st.timezone }));
    // A nomination with an unknown internal deadline is listed first: it controls everything after it.
    checklist.sort((a, b) => (a.due.startsWith('school deadline unknown') ? -1 : b.due.startsWith('school deadline unknown') ? 1 : 0));
    p.packet = { scholarshipId: sch.scholarshipId, officialLinks: [...new Set([...(sch.applicationUrl ? [sch.applicationUrl] : []), ...sch.sources.map((x) => x.url)])], checklist, preparedRequests, assistance };
    const handoffs: Handoff[] = [];
    if (assistance.some((a) => a.decision !== 'allowed' && a.operation !== 'prose_generation')) handoffs.push({ toRole: '22', reason: 'The sponsor’s assistance policy needs a decision for this award.', requestedOutcome: 'Confirm which kinds of help the sponsor permits for this application.', inputRefs: [scholarshipRef(sch.scholarshipId, sch.version)], unresolved: assistance.filter((a) => a.decision === 'unclear').map((a) => a.operation), completionCondition: 'Each operation has a reviewed decision.' });
    if (opp.eligibility.status !== 'ineligible' && s.requester !== '14') handoffs.push({ toRole: '14', reason: 'An award’s steps need scheduling.', requestedOutcome: `Schedule ${opp.dependencies.earliest?.label ?? 'the first step'} first${opp.dependencies.applicationPath === 'requires_nomination_first' ? ', including a check of the school’s internal nomination deadline' : ''}.`, inputRefs: [scholarshipRef(sch.scholarshipId, sch.version)], unresolved: [], completionCondition: 'The steps are in the plan.' });
    return makeResult(ctx, {
      status: opp.eligibility.status === 'potentially_eligible' || p.questions.length > 0 ? 'partial' : 'completed',
      summary: `${sch.name}: ${opp.eligibility.status.replace(/_/g, ' ')}; the first step is ${opp.dependencies.earliest?.label.toLowerCase() ?? 'not dated'}.`,
      payload: p,
      claimIds,
      recordVersion: view.recordVersion,
      sourceRefs: [scholarshipRef(sch.scholarshipId, sch.version), ...policySources],
      handoffs,
      completionReason: 'award_checked',
    });
  }

  // ------------------------------------------------------------ student-submitted leads (16T09, 16T10)

  private async submitLead(ctx: TaskContext, s: Scope<'submit_lead'>) {
    const p = this.empty('submit_lead');
    let text = s.listingText;
    if (s.url) {
      // The page is read as untrusted text; nothing is submitted to it.
      const f = await ctx.tryCall<FetchOutcome>('research.fetch_public', { url: s.url });
      if (f.ok && f.value.accessible) text = `${text}\n${f.value.text}`.trim();
      else p.notices.push({ code: 'page_unreadable', message: 'The page could not be read; only the text you provided was checked.' });
    }
    const year = Number(ctx.clock.nowIso().slice(0, 4));
    const currentCycleStated = [year, year + 1].some((y) => new RegExp(`\\b${y}\\b`).test(text)) && /\b(apply|application|deadline|closes)\b/i.test(text);
    const out2 = await ctx.call<{ lead: Lead }>('scholarships.write', { kind: 'submit_lead', name: s.name, providerName: s.providerName, url: s.url, listingText: text.slice(0, 20000), currentCycleStated, officialDomains: [] });
    const lead = out2.lead;
    p.leads.push({ leadId: lead.leadId, scholarshipId: null, name: lead.name, trust: lead.screening.status, message: lead.screening.message, signals: lead.screening.signals, missing: lead.screening.missing });
    if (lead.screening.status === 'suspicious') p.refusals.push('I will not help pay a fee or send account, card or identity numbers to this organizer. If you already did, contact your bank and report it.');
    return makeResult(ctx, { status: 'completed', summary: lead.screening.status === 'suspicious' ? `${s.name} shows warning signs and was not added to your options.` : `${s.name} was submitted for checking; it stays separate from your options until it is verified.`, payload: p, completionReason: `lead_${lead.screening.status}` });
  }

  // ------------------------------------------------------------ outcomes (step 7; 16T11-16T13, 16T18)

  private async track(ctx: TaskContext, s: Scope<'track'>) {
    const p = this.empty('track');
    const [sch] = await ctx.call<Scholarship[]>('scholarships.read', { op: 'get', scholarshipId: s.scholarshipId });
    if (!sch) return failedResult(ctx, 'failed', 'That scholarship is not in the catalog.', 'unknown_scholarship');
    const { view } = await this.read(ctx, [sch]);
    const ev = s.evidence;
    const evidence = ev.documentId && ev.documentVersion ? [{ kind: 'document_anchor' as const, documentId: ev.documentId, documentVersion: ev.documentVersion, page: 1, region: { kind: 'text_span' as const, blockIndex: 0, start: 0, end: ev.quote.length }, originalText: ev.quote, method: 'text_layer' as const }] : [conversationEvidence(ev.conversationId, ev.turnId, ev.quote, 'text', false)];
    const origin = ev.documentId ? 'document_extraction' : 'student_statement';
    const claims = [buildClaim({ entity: 'scholarship_application', entityId: sch.scholarshipId, attribute: 'status', value: { opportunityRef: sch.scholarshipId, stage: s.stage }, origin, confirmation: ctx.request.actor.kind === 'student' ? 'student_confirmed' : 'unreviewed', evidence, actor: ctx.request.actor, viaRole: '16' })];
    let fundingRecorded = false;
    let duplicateOf: string | null = null;
    let note: string;
    const handoffs: Handoff[] = [];
    if (s.stage === 'offered') {
      // Only an award letter becomes funding; a message saying "congratulations" is not one (16 "Opportunity taxonomy").
      if (ev.kind !== 'award_letter' || !s.award) {
        note = 'Recorded as offered. It is not counted as funding until the award letter with its amount and terms is added.';
        p.questions.push({ code: 'award_letter', question: `Could you add the award letter for ${sch.name}, with the amount, the period it covers and any conditions?`, why: 'An award counts toward your budget only from its letter.', canSkip: true });
      } else {
        // The same award already counted inside an institutional aid package is not credited again (16T13).
        const existing = this.fundingIn(view).find((f) => f.value.externalRefs.includes(scholarshipRef(sch.scholarshipId)) || f.value.externalRefs.includes(sch.scholarshipId) || (normName(f.value.name) === normName(sch.name) && f.value.amount.amount === s.award!.amount.amount));
        if (existing) {
          duplicateOf = existing.id;
          note = `Already counted as “${existing.value.name}” in your aid; it is not added a second time.`;
        } else {
          const value: FundingAward = { provider: sch.provider.name, name: sch.name, kind: sch.origin === 'institutional' ? 'institutional_grant' : 'external_scholarship', amount: s.award.amount, period: s.award.period, coveredCosts: (s.award.coveredCosts ?? sch.award.coveredCosts) as FundingAward['coveredCosts'], stage: 'offered', optionRef: s.award.optionRef, renewal: s.award.renewal ?? (sch.award.renewal ? { ...sch.award.renewal } : null), basis: sch.basis === 'need' ? 'need_based' : sch.basis === 'merit' ? 'merit' : 'other', eligibilityProgram: null, disbursesOn: null, externalRefs: [scholarshipRef(sch.scholarshipId)] };
          claims.push(buildClaim({ entity: 'funding_award', entityId: `scholarship_${sch.scholarshipId}`, attribute: 'definition', value, origin, confirmation: ctx.request.actor.kind === 'student' ? 'student_confirmed' : 'unreviewed', evidence, actor: ctx.request.actor, viaRole: '16' }));
          fundingRecorded = true;
          note = `Recorded the offer of ${formatMoney(s.award.amount)} with its terms; the affordability planner will check how it interacts with other aid.`;
        }
        handoffs.push({ toRole: '15', reason: 'A scholarship offer arrived.', requestedOutcome: 'Reconcile the offer with the ledger, including any displacement of institutional aid.', inputRefs: [scholarshipRef(sch.scholarshipId, sch.version)], unresolved: [], completionCondition: 'The award is in the ledger once, with its restrictions.' });
      }
    } else if (['semifinalist', 'finalist', 'interview', 'nominated'].includes(s.stage)) {
      note = `Recorded that you are ${s.stage === 'interview' ? 'at the interview stage' : s.stage}. This is progress, not an award: it is not counted as funding (16T11).`;
    } else if (s.stage === 'stopped' || s.stage === 'not_selected') {
      note = s.stage === 'stopped' ? 'Stopped. Reminders for this scholarship are removed and it leaves your active plan; only this status is kept.' : 'Recorded as not selected; it leaves your active plan.';
      handoffs.push({ toRole: '14', reason: `The student is no longer pursuing ${sch.name}.`, requestedOutcome: 'Remove its tasks and reminders from the active plan.', inputRefs: [scholarshipRef(sch.scholarshipId)], unresolved: [], completionCondition: 'No reminders remain for it.' });
    } else note = `Recorded as ${s.stage.replace(/_/g, ' ')}.`;
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `track:${sch.scholarshipId}:${s.stage}`), operation: 'add_claims', claims, expectedRecordVersion: view.recordVersion, reason: `scholarship_stage:${sch.scholarshipId}` } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', 'The update could not be recorded.', `record_${res.outcome}`);
    p.tracking = { scholarshipId: sch.scholarshipId, stage: s.stage, fundingRecorded, duplicateOf, note };
    return makeResult(ctx, { status: p.questions.length > 0 ? 'needs_student_input' : 'completed', summary: note, payload: p, recordVersion: res.recordVersion ?? view.recordVersion, sourceRefs: [scholarshipRef(sch.scholarshipId, sch.version)], handoffs, completionReason: `tracked_${s.stage}` });
  }

  private fundingIn(view: RecordView): Array<{ id: string; value: FundingAward }> {
    return view.entityIds('funding_award').flatMap((id) => {
      const v = view.value<FundingAward>('funding_award', id, 'definition');
      return v ? [{ id, value: v }] : [];
    });
  }

  // ------------------------------------------------------------ assistance gate (16T08, 16T17)

  private async assist(ctx: TaskContext, s: Scope<'assist'>) {
    const p = this.empty('assist');
    const [sch] = await ctx.call<Scholarship[]>('scholarships.read', { op: 'get', scholarshipId: s.scholarshipId });
    if (!sch) return failedResult(ctx, 'failed', 'That scholarship is not in the catalog.', 'unknown_scholarship');
    const handoffs: Handoff[] = [];
    if (s.operation === 'answer_assessed_interview') {
      p.assistance = { operation: s.operation, decision: 'refused', explanation: 'The interview is part of how the sponsor selects recipients, so the answers must be yours. I can help you prepare before it, where the sponsor allows.', contentProduced: false };
      p.refusals.push('I won’t answer a selection interview on your behalf.');
      return makeResult(ctx, { status: 'completed', summary: 'Answering a selection interview for you is not something I can do; preparing beforehand can be.', payload: p, sourceRefs: [scholarshipRef(sch.scholarshipId, sch.version)], completionReason: 'assessed_interview_refused' });
    }
    const d = await ctx.call<OperationDecision>('policy.check_operation', { operation: s.operation, destinations: [{ kind: 'scholarship', ref: sch.scholarshipId, cycle: sch.cycle }] });
    p.assistance = { operation: s.operation, decision: d.decision, explanation: d.explanation, contentProduced: false };
    if (d.decision === 'prohibited') p.refusals.push(`That kind of help is not permitted for ${sch.name}, so none is given. I can still explain the logistics and requirements.`);
    else if (d.decision === 'unclear') {
      p.notices.push({ code: 'policy_unclear', message: `The sponsor’s policy does not clearly say whether ${s.operation.replace(/_/g, ' ')} is allowed. Until it is confirmed, only logistics are offered; you may want to ask the sponsor.` });
      handoffs.push({ toRole: '22', reason: 'An assistance decision is unclear for a scholarship.', requestedOutcome: `Decide whether ${s.operation.replace(/_/g, ' ')} is permitted for this award.`, inputRefs: [scholarshipRef(sch.scholarshipId, sch.version)], unresolved: [s.operation], completionCondition: 'A reviewed decision exists.' });
    } else {
      // Interview practice belongs to the interview studio (role 25); writing help to the brainstorming interviewer (role 17).
      const to: AnyRoleId = s.operation === 'interview_preparation' ? '25' : '17';
      handoffs.push({ toRole: to, reason: `${s.operation.replace(/_/g, ' ')} is permitted for ${sch.name}.`, requestedOutcome: s.operation === 'interview_preparation' ? 'Prepare practice for the verified interview format, before the interview.' : 'Help the student develop their own material within the permitted operation.', inputRefs: [scholarshipRef(sch.scholarshipId, sch.version)], unresolved: [], completionCondition: 'Help stays within the permitted operation.' });
    }
    return makeResult(ctx, { status: 'completed', summary: `${s.operation.replace(/_/g, ' ')} for ${sch.name}: ${d.decision}.`, payload: p, sourceRefs: [scholarshipRef(sch.scholarshipId, sch.version), ...d.perDestination.filter((x) => x.sourceId).map((x) => x.sourceId!)], handoffs, completionReason: `assistance_${d.decision}` });
  }
}
