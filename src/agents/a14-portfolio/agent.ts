import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { RoleIdSchema, type Handoff } from '../../shared/envelopes.js';
import { APPLICATION_ITEM_STATES, APPLICATION_OUTCOMES, APPLICATION_SYSTEMS } from '../../shared/fields.js';
import { addMoney, compareMoney, MoneySchema, type Money } from '../../shared/money.js';
import { diffDays, instantToLocal, isValidTimezone, localToInstant, type CalendarDate } from '../../shared/time.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import { artifactRef } from '../a04-record-steward/service.js';
import type { DerivedArtifact, MutationResponse } from '../a04-record-steward/types.js';
import { claimRef, type ClaimRecord, type DeadlineValue, type RoundRuleValue, type WritingPromptValue } from '../a11-research/claims.js';
import type { Resolution } from '../a11-research/entities.js';
import type { ReadClaimsResult } from '../a11-research/tools.js';
import type { Scholarship } from '../a16-scholarships/catalog.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import { checkRounds, type ProposedApplication, type RoundCheck } from './rounds.js';
import { applyTargets, feasibility, FORM_HOURS, PLATFORM_SETUP_HOURS, resolveControllingDates, scale, sharedDependencies, WRITING_HOURS, type Deadline, type Feasibility, type Task, type TaskKind } from './workload.js';

/**
 * Agent 14 — Application portfolio and round strategist.
 *
 * Turns possible destinations into a plan the student can afford, complete
 * and defend. It integrates fit (12), uncertainty (13), affordability (15),
 * scholarships (16) and verified rules (11) without overriding any of them;
 * checks the whole set of rounds in code; schedules real work with owners and
 * lead times; names coverage gaps before approval; and never submits, pays
 * or messages anyone. An approved plan is not a submitted application, and a
 * submitted application is not complete until every required item is
 * confirmed received.
 */

const LeadTimesSchema = z.object({ recommendation_request: z.number().int().min(0).max(120).default(21), school_report_request: z.number().int().min(0).max(120).default(14), transcript_request: z.number().int().min(0).max(120).default(10), nomination_request: z.number().int().min(0).max(120).default(21) }).strict();

const PlanOptionSchema = z
  .object({
    optionRef: z.string().min(1).max(200),
    institution: z.string().min(1).max(200),
    campus: z.string().max(200).nullable().default(null),
    program: z.string().max(200).nullable().default(null),
    round: z.string().regex(/^[a-z0-9_]+$/),
    system: z.enum(APPLICATION_SYSTEMS).default('direct'),
    /** A platform entity (for shared essays and choice limits), e.g. the common application platform. */
    platform: z.string().regex(/^[a-z0-9_]+$/).nullable().default(null),
    /** Would the student actually attend if admitted? A fallback they would not attend is not an outcome (14T17). */
    studentWouldAttend: z.boolean().nullable().default(null),
    priority: z.number().int().min(1).max(50).optional(),
    applicationFee: MoneySchema.nullable().default(null),
    feeWaiver: z.boolean().default(false),
    firstChoiceConfirmed: z.boolean().default(false),
    supportersReviewedFinances: z.boolean().default(false),
    exceptionEvidence: z.array(z.object({ condition: z.enum(['scholarship_requires_early', 'other']), scholarshipId: z.string().nullable().default(null), note: z.string().max(300).nullable().default(null) }).strict()).default([]),
    platformTags: z.array(z.string().regex(/^[a-z0-9_]+$/)).default([]),
    /** External items and who provides them; the same key on several options is one shared dependency. */
    externalItems: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]+$/), label: z.string().min(1).max(200), kind: z.enum(['recommendation_request', 'school_report_request', 'transcript_request']), owner: z.enum(['school', 'recommender']) }).strict()).default([]),
  })
  .strict();
export type PlanOption = z.input<typeof PlanOptionSchema>;

const EvidenceSchema = z.object({ kind: z.enum(['portal_receipt', 'portal_notice', 'student_report']), quote: z.string().min(1).max(500), documentId: z.string().nullable().default(null), documentVersion: z.number().int().positive().nullable().default(null), conversationId: z.string().default('conv_plan'), turnId: z.string().default('t_plan') }).strict();

export const PortfolioScopeSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('plan'),
      cycle: z.string().regex(/^\d{4}$/),
      goal: z.enum(['initial_plan', 'round_decision', 'repair']).default('initial_plan'),
      options: z.array(PlanOptionSchema).min(1).max(10),
      scholarships: z.array(z.string().min(1)).max(6).default([]),
      applicationBudget: MoneySchema.nullable().default(null),
      /** The student's own pace setting for writing (e.g. 1.5 when writing in an additional language); not a deficit label. */
      paceMultiplier: z.number().min(0.5).max(3).default(1),
      bufferDays: z.number().int().min(0).max(30).default(7),
      leadTimes: LeadTimesSchema.default({ recommendation_request: 21, school_report_request: 14, transcript_request: 10, nomination_request: 21 }),
      weeklyHours: z.object({ min: z.number().min(0), max: z.number().min(0) }).strict().nullable().default(null),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('approve'), planVersion: z.number().int().positive(), cycle: z.string().regex(/^\d{4}$/), confirmedByStudent: z.boolean(), requester: RoleIdSchema.default('01') }).strict(),
  z
    .object({
      action: z.literal('record_status'),
      optionRef: z.string().min(1),
      state: z.enum(['initiated', 'submitted', 'received', 'complete']),
      evidence: EvidenceSchema,
      items: z.array(z.object({ item: z.string().min(1).max(160), owner: z.enum(['student', 'school', 'recommender', 'testing_agency', 'institution', 'supporter', 'other']), status: z.enum(APPLICATION_ITEM_STATES), required: z.boolean().default(true) }).strict()).max(20).default([]),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('report_outcome'), optionRef: z.string().min(1), institution: z.string().min(1), cycle: z.string().regex(/^\d{4}$/), outcome: z.enum(APPLICATION_OUTCOMES), evidence: EvidenceSchema, candidates: z.array(PlanOptionSchema).max(10).default([]), requester: RoleIdSchema.default('01') }).strict(),
  z.object({ action: z.literal('missed_deadline'), option: PlanOptionSchema, cycle: z.string().regex(/^\d{4}$/), requester: RoleIdSchema.default('01') }).strict(),
]);
export type PortfolioScope = z.infer<typeof PortfolioScopeSchema>;

// ---------------------------------------------------------------- payload

const OptionOutSchema = z
  .object({
    optionRef: z.string(),
    name: z.string(),
    round: z.string(),
    system: z.string(),
    resolved: z.boolean(),
    acceptable: z.boolean(),
    fit: z.string().nullable(),
    selection: z.string(),
    affordability: z.string(),
    programAccess: z.enum(['with_admission', 'separate_competitive', 'unknown']),
    binding: z.boolean(),
    bindingReadiness: z.object({ ready: z.boolean(), unmet: z.array(z.string()) }).strict().nullable(),
    deadline: z.object({ official: z.string().nullable(), timezone: z.string().nullable(), yourLocalTime: z.string().nullable(), sourceRef: z.string().nullable() }).strict(),
    fee: MoneySchema.nullable(),
    notes: z.array(z.string()),
  })
  .strict();

const TaskOutSchema = z.custom<Task>((v) => typeof v === 'object' && v !== null && 'taskId' in v);

export const PortfolioPayloadSchema = z
  .object({
    action: z.string(),
    version: z.number().int().nonnegative(),
    status: z.enum(['proposed', 'blocked', 'approved', 'updated', 'not_applicable']),
    options: z.array(OptionOutSchema),
    rounds: z.object({ conflicts: z.array(z.custom<RoundCheck['conflicts'][number]>(() => true)), exceptionsApplied: z.array(z.custom<RoundCheck['exceptionsApplied'][number]>(() => true)), unverifiedRules: z.array(z.string()), choiceLimit: z.array(z.string()) }).strict().nullable(),
    coverage: z.object({ acceptableOutcomes: z.number(), confirmedAffordablePath: z.boolean(), credibleAffordablePath: z.boolean(), gaps: z.array(z.object({ code: z.string(), message: z.string() }).strict()), sharedDependencies: z.array(z.object({ label: z.string(), owner: z.string(), optionRefs: z.array(z.string()) }).strict()), combinedChance: z.null() }).strict().nullable(),
    tasks: z.array(TaskOutSchema),
    workload: z.custom<Feasibility>(() => true).nullable(),
    fees: z.object({ total: MoneySchema.nullable(), budget: MoneySchema.nullable(), withinBudget: z.boolean().nullable(), waived: z.array(z.string()) }).strict().nullable(),
    alternatives: z.array(z.object({ plan: z.string(), optionRefs: z.array(z.string()), why: z.string() }).strict()),
    changes: z.array(z.string()),
    applicationStates: z.array(z.object({ optionRef: z.string(), submission: z.string(), completeness: z.enum(['complete', 'incomplete', 'unknown']), missing: z.array(z.string()), confirmedBy: z.string().nullable() }).strict()),
    nextDecision: z.string().nullable(),
    questions: z.array(z.object({ code: z.string(), question: z.string(), for: z.enum(['student', 'admissions_office', 'aid_office', 'school']) }).strict()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    actionsTaken: z.array(z.string()).max(0),
  })
  .strict();
export type PortfolioPayload = z.infer<typeof PortfolioPayloadSchema>;

export const PORTFOLIO_CONTRACT: ContractDefinition<PortfolioPayload> = {
  id: 'portfolio_plan_v1',
  role: '14',
  payload: PortfolioPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    if (p.rounds && p.rounds.conflicts.length > 0 && p.status === 'proposed') issues.push('a plan with a round conflict must be blocked, not proposed');
    if (p.coverage?.confirmedAffordablePath && !p.options.some((o) => o.acceptable && o.affordability === 'supported')) issues.push('an affordable path needs an acceptable option that is affordable on confirmed resources');
    for (const o of p.options) {
      if (o.binding && o.bindingReadiness === null) issues.push(`${o.optionRef}: a binding round needs a readiness check`);
    }
    for (const t of p.tasks) if (t.internalTarget && t.controllingDate && t.internalTarget > t.controllingDate) issues.push(`${t.taskId}: internal target after the official date`);
    const text = JSON.stringify(p);
    if (/\bchance of at least one\b|\bat least one (offer|admission) is \d/i.test(text)) issues.push('no combined chance may be stated');
    if (/\b(free option|can (just )?back out)\b/i.test(text)) issues.push('a binding round is never described as a free option');
    return issues;
  },
};

// ---------------------------------------------------------------- helpers

interface Built {
  opt: z.infer<typeof PlanOptionSchema>;
  resolution: Resolution;
  name: string;
  claims: ClaimRecord[];
  rule: ClaimRecord | null;
  deadline: ClaimRecord | null;
  prompts: ClaimRecord[];
  selection: string;
  affordability: string;
  fit: string | null;
  programAccess: 'with_admission' | 'separate_competitive' | 'unknown';
  artifacts: string[];
  deadlineUnresolved: string | null;
  cashNote: string | null;
}

const latest = (xs: readonly DerivedArtifact[], scopeKey: string) => xs.filter((x) => x.scopeKey === scopeKey && (x.status === 'current' || x.status === 'stale')).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

function localTime(d: DeadlineValue, zone: string | null): string | null {
  if (!d.date || !d.time || !d.timezone || !zone || !isValidTimezone(zone) || !isValidTimezone(d.timezone)) return null;
  const l = instantToLocal(localToInstant(d.date as CalendarDate, d.time, d.timezone), zone);
  return `${l.date} ${l.time} (${zone})`;
}

type Scope<A extends PortfolioScope['action']> = Extract<PortfolioScope, { action: A }>;

export class PortfolioStrategistAgent implements SpecialistAgent {
  readonly role = '14' as const;
  readonly contracts = [PORTFOLIO_CONTRACT];

  /** Round checks and scheduling are code; a model would only explain tradeoffs. */
  constructor(private readonly model: ModelGateway) {}

  get modelConfigured(): boolean {
    return this.model.configured;
  }

  async handle(ctx: TaskContext) {
    const parsed = PortfolioScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The planning request was incomplete.', 'invalid_scope');
    const s = parsed.data;
    switch (s.action) {
      case 'plan':
        return this.plan(ctx, s);
      case 'approve':
        return this.approve(ctx, s);
      case 'record_status':
        return this.recordStatus(ctx, s);
      case 'report_outcome':
        return this.reportOutcome(ctx, s);
      case 'missed_deadline':
        return this.missedDeadline(ctx, s);
    }
  }

  private empty(action: string): PortfolioPayload {
    return { action, version: 0, status: 'proposed', options: [], rounds: null, coverage: null, tasks: [], workload: null, fees: null, alternatives: [], changes: [], applicationStates: [], nextDecision: null, questions: [], notices: [], actionsTaken: [] };
  }

  private today(ctx: TaskContext): CalendarDate {
    return ctx.clock.nowIso().slice(0, 10) as CalendarDate;
  }

  private async build(ctx: TaskContext, o: z.infer<typeof PlanOptionSchema>, cycle: string, arts: { afford: DerivedArtifact[]; assess: DerivedArtifact[]; fit: DerivedArtifact[] }, sources: Set<string>): Promise<Built> {
    const resolution = await ctx.call<Resolution>('institutions.read', { op: 'resolve', institution: o.institution, campus: o.campus, program: o.program });
    const b: Built = { opt: o, resolution, name: o.program ? `${o.program} at ${o.institution}` : o.institution, claims: [], rule: null, deadline: null, prompts: [], selection: 'not_assessed', affordability: 'not_calculated', fit: null, programAccess: 'unknown', artifacts: [], deadlineUnresolved: null, cashNote: null };
    if (resolution.status !== 'resolved') return b;
    b.name = resolution.program ? `${resolution.program.name} at ${resolution.institution.name}` : resolution.institution.name;
    const read = await ctx.call<ReadClaimsResult>('institutions.read', { op: 'claims', entityId: resolution.entity.id, predicates: ['round_rule', 'application_deadline', 'writing_prompt', 'program_access_route'], cycle, includeHistorical: false });
    b.claims = read.claims.filter((c) => c.status !== 'superseded' && c.status !== 'historical');
    b.rule = b.claims.find((c) => c.predicate === 'round_rule' && (c.qualifier === o.round || (c.value as RoundRuleValue).round === o.round)) ?? null;
    const deadlineClaim = b.claims.find((c) => c.predicate === 'application_deadline' && c.qualifier === o.round) ?? null;
    // A conflicted or unverified date is not an official deadline; the decision stays unresolved (XT07).
    b.deadline = deadlineClaim && deadlineClaim.status === 'verified' ? deadlineClaim : null;
    b.deadlineUnresolved = deadlineClaim && deadlineClaim.status !== 'verified' ? deadlineClaim.status : null;
    if (deadlineClaim) sources.add(claimRef(deadlineClaim.claimId));
    b.prompts = b.claims.filter((c) => c.predicate === 'writing_prompt');
    const access = b.claims.find((c) => c.predicate === 'program_access_route');
    const route = access ? (access.value as { route: string }).route : resolution.program?.attributes.accessRoute ?? null;
    // With no program named, admission to the institution is itself the outcome.
    b.programAccess = route === 'later_competitive_selection' ? 'separate_competitive' : route || !resolution.program ? 'with_admission' : 'unknown';
    for (const c of [b.rule, b.deadline, access, ...b.prompts]) if (c) sources.add(claimRef(c.claimId));
    const af = latest(arts.afford, o.optionRef);
    if (af) {
      const v = af.payload as { state: string; cashShortfall?: { amount: string; on: string; coveredOn: string | null } | null; currency?: string };
      b.affordability = af.status === 'stale' ? 'unknown' : v.state;
      // Enough over the year but short when the first bills are due is not unconditional affordability (XT16).
      if (b.affordability === 'supported' && v.cashShortfall) {
        b.affordability = 'cash_timing_gap';
        b.cashNote = `Affordable over the year, but ${v.cashShortfall.amount} ${v.currency ?? ''} is due on ${v.cashShortfall.on} before the funding arrives${v.cashShortfall.coveredOn ? ` on ${v.cashShortfall.coveredOn}` : ''}.`.replace(/\s+/g, ' ');
      }
      b.artifacts.push(artifactRef(af.id));
    }
    const as = latest(arts.assess, o.optionRef);
    if (as) {
      b.selection = (as.payload as { state: string }).state;
      b.artifacts.push(artifactRef(as.id));
    }
    const fit = arts.fit.filter((x) => x.status === 'current').sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1))[0];
    const card = fit ? (fit.payload as { cards?: Array<{ optionRef: string; rank: number | null }> }).cards?.find((c) => c.optionRef === o.optionRef) : undefined;
    if (fit && card) {
      b.fit = card.rank ? `rank ${card.rank} in the fit shortlist` : 'on the fit shortlist';
      b.artifacts.push(artifactRef(fit.id));
    }
    return b;
  }

  // ------------------------------------------------------------ plan (steps 1-6)

  private async plan(ctx: TaskContext, s: Scope<'plan'>) {
    const p = this.empty('plan');
    const today = this.today(ctx);
    const view = await readView(ctx, 'local', { entityTypes: ['application', 'application_item', 'option_decision', 'scholarship_application', 'student'] });
    const weekly = s.weeklyHours ?? view.studentValue<{ min: number; max: number }>('constraints.weekly_hours_available') ?? null;
    const zone = view.studentValue<string>('constraints.timezone') ?? null;
    const [afford, assess, fit, previous, approvals] = await Promise.all([
      ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'affordability_scenario' }),
      ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'admissions_assessment' }),
      ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'fit_shortlist' }),
      ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'portfolio_plan' }),
      ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'portfolio_approval' }),
    ]);
    const sources = new Set<string>();
    const built: Built[] = [];
    for (const o of s.options) built.push(await this.build(ctx, o, s.cycle, { afford, assess, fit }, sources));
    const rejected = new Map<string, string>();
    for (const id of view.entityIds('option_decision')) {
      const v = view.value<{ optionRef: string; decision: string; reason: string | null }>('option_decision', id, 'definition');
      if (v?.decision === 'reject') rejected.set(v.optionRef, v.reason ?? 'you set it aside');
    }

    // Step 2: inputs must share the cycle and scope; a stale or mismatched rule is not used.
    for (const b of built) {
      if (b.resolution.status !== 'resolved') p.questions.push({ code: `resolve_${b.opt.optionRef}`, question: b.resolution.question, for: 'student' });
      if (b.rule && b.rule.cycle !== null && b.rule.cycle !== s.cycle) {
        p.notices.push({ code: 'input_mismatch', message: `The round rule on file for ${b.name} is for the ${b.rule.cycle} cycle, not ${s.cycle}; it is not used.` });
        b.rule = null;
      }
    }

    // Step 3: round constraints across the full set (14T01, 14T02).
    const control = (inst: Resolution) => (inst.status === 'resolved' ? inst.institution.attributes.control ?? 'unknown' : 'unknown');
    const scholarshipCache = new Map<string, Scholarship | null>();
    const apps: ProposedApplication[] = [];
    for (const b of built) {
      if (b.resolution.status !== 'resolved') continue;
      const evidence: ProposedApplication['exceptionEvidence'] = [];
      for (const ev of b.opt.exceptionEvidence) {
        if (ev.condition === 'scholarship_requires_early') {
          if (!ev.scholarshipId) {
            evidence.push({ condition: ev.condition, verified: false, detail: 'no scholarship was named' });
            continue;
          }
          if (!scholarshipCache.has(ev.scholarshipId)) scholarshipCache.set(ev.scholarshipId, (await ctx.call<Scholarship[]>('scholarships.read', { op: 'get', scholarshipId: ev.scholarshipId }))[0] ?? null);
          const sch = scholarshipCache.get(ev.scholarshipId);
          const req = sch?.requiresAdmissionRound;
          const ok = !!sch && sch.trust.status === 'verified_provider' && !!req && req.institutionRef === b.resolution.institution.id && req.round === b.opt.round;
          if (sch) sources.add(`scholarship:${sch.scholarshipId}@${sch.version}`);
          evidence.push({ condition: ev.condition, verified: ok, detail: ok ? `${sch!.name} requires applying to ${b.resolution.institution.name} in ${b.opt.round.replace(/_/g, ' ')}` : sch ? `${sch.name} does not state that it requires this round` : 'the named scholarship is not in the catalog' });
        } else evidence.push({ condition: ev.condition, verified: false, detail: ev.note ? `“${ev.note}” needs confirmation from the institution` : 'the exception needs confirmation from the institution' });
      }
      apps.push({ optionRef: b.opt.optionRef, institutionId: b.resolution.institution.id, institutionName: b.resolution.institution.name, country: b.resolution.institution.country, control: control(b.resolution), round: b.opt.round, rule: b.rule ? { ...(b.rule.value as RoundRuleValue), claimId: b.rule.claimId, status: b.rule.status, retrievedAt: b.rule.retrievedAt } : null, exceptionEvidence: evidence });
    }
    const rc = checkRounds(apps);
    // A system's own choice limit (e.g. five choices) applies to the whole set (14T14).
    const choiceLimit: string[] = [];
    for (const platform of new Set(built.map((b) => b.opt.platform).filter((x): x is string => x !== null))) {
      const pr = await ctx.call<ReadClaimsResult>('institutions.read', { op: 'claims', entityId: platform, predicates: ['application_choice_limit', 'writing_prompt'], cycle: s.cycle, includeHistorical: false });
      for (const lim of pr.claims.filter((c) => c.predicate === 'application_choice_limit' && c.status === 'verified')) {
        sources.add(claimRef(lim.claimId));
        const v = lim.value as { system: string; maxChoices: number; restrictions: Array<{ rule: string; max: number; text: string }>; text: string };
        const using = built.filter((b) => b.opt.platform === platform && b.opt.system === v.system);
        if (using.length > v.maxChoices) choiceLimit.push(`${pr.lineage[0]?.name ?? v.system} allows ${v.maxChoices} choices in one application and ${using.length} are proposed (“${v.text}”). Choose which to keep; these are not ${using.length} independent applications.`);
        for (const r of v.restrictions) {
          const n = using.filter((b) => b.opt.platformTags.includes(r.rule)).length;
          if (n > r.max) choiceLimit.push(`${r.text} (${n} proposed).`);
        }
      }
      for (const c of pr.claims.filter((x) => x.predicate === 'writing_prompt')) {
        sources.add(claimRef(c.claimId));
        for (const b of built.filter((x) => x.opt.platform === platform)) b.prompts.push({ ...c, qualifier: `platform:${c.qualifier}` });
      }
    }
    p.rounds = { conflicts: rc.conflicts, exceptionsApplied: rc.exceptionsApplied, unverifiedRules: rc.unverifiedRules, choiceLimit };

    // Options with their states from the other roles, kept as they are.
    for (const b of built) {
      const rule = b.rule ? (b.rule.value as RoundRuleValue) : null;
      const binding = !!rule?.binding || b.opt.round.includes('early_decision');
      const d = b.deadline ? (b.deadline.value as DeadlineValue) : null;
      const notes: string[] = [];
      const acceptable = b.opt.studentWouldAttend !== false && !rejected.has(b.opt.optionRef);
      if (!acceptable) notes.push(b.opt.studentWouldAttend === false ? 'You said you would not attend, so it is not counted as an acceptable outcome.' : `You set this aside: ${rejected.get(b.opt.optionRef)}.`);
      if (b.programAccess === 'separate_competitive') notes.push('Admission does not secure the intended program: entry is a later competitive selection.');
      if (b.cashNote) notes.push(`${b.cashNote} The upfront cash needs a plan before this counts as affordable.`);
      let readiness: PortfolioPayload['options'][number]['bindingReadiness'] = null;
      if (binding) {
        // A binding round needs current terms, confirmed affordability and a genuine first choice (14T03, 14T04).
        const unmet: string[] = [];
        if (!rule || b.rule?.status !== 'verified') unmet.push('the current binding terms are not verified');
        else if (rule.agreementCycle !== s.cycle) unmet.push(`the agreement on file is for ${rule.agreementCycle ?? 'an unstated cycle'}, not ${s.cycle}`);
        if (b.affordability !== 'supported') unmet.push(b.affordability === 'not_calculated' || b.affordability === 'unknown' ? 'affordability has not been established on confirmed resources' : `affordability is ${b.affordability.replace(/_/g, ' ')}`);
        if (!b.opt.firstChoiceConfirmed) unmet.push('you have not confirmed it is your clear first choice');
        if (!b.opt.supportersReviewedFinances) unmet.push('the people paying or signing have not reviewed the financial assumptions');
        readiness = { ready: unmet.length === 0, unmet };
        if (unmet.length > 0) notes.push(`No definitive recommendation for this binding round yet: ${unmet.join('; ')}. A binding round commits you if admitted; it is not an option to abandon later.`);
        // The financial uncertainty is shown before the round is chosen, and the aid office is where it can be answered (14T04).
        if (b.affordability !== 'supported') p.questions.push({ code: `aid_review_${b.opt.optionRef}`, question: `Before choosing ${b.name}’s binding round, could the financial aid office give you an estimate based on your family’s actual information, and explain how the agreement handles aid concerns?`, for: 'aid_office' });
      }
      p.options.push({
        optionRef: b.opt.optionRef,
        name: b.name,
        round: b.opt.round,
        system: b.opt.system,
        resolved: b.resolution.status === 'resolved',
        acceptable,
        fit: b.fit,
        selection: b.selection,
        affordability: b.affordability,
        programAccess: b.programAccess,
        binding,
        bindingReadiness: readiness,
        deadline: { official: d?.date ? `${d.date}${d.time ? ` ${d.time}` : ''}${d.timezoneLabel ? ` ${d.timezoneLabel}` : ''}` : null, timezone: d?.timezone ?? null, yourLocalTime: d ? localTime(d, zone) : null, sourceRef: b.deadline ? claimRef(b.deadline.claimId) : null },
        fee: b.opt.applicationFee,
        notes,
      });
      if (b.deadlineUnresolved === 'conflicted') p.notices.push({ code: 'deadline_conflict', message: `Official sources disagree about the ${b.opt.round.replace(/_/g, ' ')} deadline for ${b.name}, so no date is treated as the deadline until that is resolved. You can set your own earlier target meanwhile; it is not the institution’s requirement.` });
      if (!b.deadline && b.resolution.status === 'resolved') p.questions.push({ code: `deadline_${b.opt.optionRef}`, question: `The ${b.opt.round.replace(/_/g, ' ')} deadline for ${b.name} is not verified yet; it has been sent for research.`, for: 'student' });
    }

    // Step 4: coverage, stated before approval (14T05, 14T06, 14T17, 14T18).
    const acceptable = p.options.filter((o) => o.acceptable && o.resolved);
    const affordable = acceptable.filter((o) => o.affordability === 'supported');
    const credible = affordable.filter((o) => o.selection === 'plausible_option_with_material_uncertainty' || o.selection === 'verified_open_admission');
    const gaps: Array<{ code: string; message: string }> = [];
    if (affordable.length === 0) gaps.push({ code: 'no_confirmed_affordable_alternative', message: acceptable.some((o) => o.affordability === 'conditional') ? 'No option is affordable on confirmed resources; the ones that might be depend on funding that is not awarded. Research into affordable options or pathways comes first.' : 'No option you would attend is affordable on confirmed resources. Research into affordable options or pathways comes first.' });
    for (const o of acceptable.filter((x) => (x.selection === 'plausible_option_with_material_uncertainty' || x.selection === 'verified_open_admission') && x.affordability !== 'supported')) gaps.push({ code: 'unaffordable_fallback', message: `${o.name} has clearer admission evidence but is not affordable on confirmed resources, so it is not a financial fallback.` });
    if (acceptable.length > 0 && acceptable.every((o) => o.selection === 'highly_uncertain_selection' || o.selection === 'selection_evidence_insufficient' || o.selection === 'not_assessed')) gaps.push({ code: 'all_selection_uncertain', message: 'Every option you would attend depends on uncertain or unassessed selection.' });
    if (acceptable.some((o) => o.programAccess === 'separate_competitive') && !acceptable.some((o) => o.programAccess === 'with_admission')) gaps.push({ code: 'program_access_uncertain', message: 'Every option needs a later competitive selection into your intended program.' });
    for (const o of p.options.filter((x) => !x.acceptable && x.resolved)) gaps.push({ code: 'not_an_outcome', message: `${o.name} is not counted: ${o.notes[0]}` });
    for (const o of acceptable.filter((x) => x.affordability === 'cash_timing_gap')) gaps.push({ code: 'cash_timing', message: `${o.name} is covered over the year but not when the first payments are due, so it is not yet a confirmed affordable path.` });

    // Tasks and schedule, working back from official deadlines.
    const tasks: Task[] = [];
    const add = (t: Omit<Task, 'controllingDate' | 'controlledBy' | 'requestBy' | 'internalTarget'>) => {
      const existing = tasks.find((x) => x.taskId === t.taskId);
      if (existing) {
        existing.optionRefs = [...new Set([...existing.optionRefs, ...t.optionRefs])];
        if (t.officialDeadline && (!existing.officialDeadline || t.officialDeadline.date < existing.officialDeadline.date)) existing.officialDeadline = t.officialDeadline;
        return existing;
      }
      const full: Task = { ...t, controllingDate: null, controlledBy: null, requestBy: null, internalTarget: null };
      tasks.push(full);
      return full;
    };
    const platformsSetup = new Set<string>();
    for (const b of built) {
      if (b.resolution.status !== 'resolved') continue;
      const d = b.deadline ? (b.deadline.value as DeadlineValue) : null;
      const dl: Deadline | null = d?.date ? { date: d.date as CalendarDate, time: d.time, timezone: d.timezone, sourceRef: claimRef(b.deadline!.claimId) } : null;
      const appTask = add({ taskId: `submit_${b.opt.optionRef}`, optionRefs: [b.opt.optionRef], label: `Submit the ${b.opt.round.replace(/_/g, ' ')} application to ${b.name}`, kind: 'form', owner: 'student', hours: scale(FORM_HOURS, 1), officialDeadline: dl, dependsOn: [] });
      if (b.opt.platform && !platformsSetup.has(b.opt.platform)) {
        platformsSetup.add(b.opt.platform);
        add({ taskId: `setup_${b.opt.platform}`, optionRefs: [], label: `Set up your ${b.opt.system.replace(/_/g, ' ')} account`, kind: 'platform_setup', owner: 'student', hours: scale(PLATFORM_SETUP_HOURS, 1), officialDeadline: null, dependsOn: [] });
      }
      if (b.opt.platform) {
        appTask.dependsOn.push(`setup_${b.opt.platform}`);
        tasks.find((t) => t.taskId === `setup_${b.opt.platform}`)!.optionRefs.push(b.opt.optionRef);
      }
      for (const pr of b.prompts) {
        const v = pr.value as WritingPromptValue;
        if (!v.required) continue;
        const shared = pr.qualifier.startsWith('platform:');
        const id = shared ? `write_${b.opt.platform}_${v.promptId}` : `write_${b.opt.optionRef}_${v.promptId}`;
        add({ taskId: id, optionRefs: [b.opt.optionRef], label: `Write: ${v.field}${shared ? ' (shared across applications on this platform)' : ` for ${b.name}`}`, kind: 'writing', owner: 'student', hours: scale(WRITING_HOURS[v.artifactKind] ?? [2, 4], s.paceMultiplier), officialDeadline: null, dependsOn: [] });
        if (!appTask.dependsOn.includes(id)) appTask.dependsOn.push(id);
      }
      for (const x of b.opt.externalItems) {
        const id = `external_${x.key}`;
        add({ taskId: id, optionRefs: [b.opt.optionRef], label: x.label, kind: x.kind, owner: x.owner, hours: { low: 0.5, high: 1 }, officialDeadline: null, dependsOn: [] });
        if (!appTask.dependsOn.includes(id)) appTask.dependsOn.push(id);
      }
    }
    // Pursued scholarships: their own deadlines can control the admission application (14T11).
    const nominations: Array<{ scholarshipId: string; name: string; internalKnown: boolean; perSchoolLimit: number | null }> = [];
    const pursued = new Set(s.scholarships);
    for (const id of view.entityIds('scholarship_application')) {
      const v = view.value<{ opportunityRef: string; stage: string }>('scholarship_application', id, 'status');
      if (v && ['considering', 'pursuing', 'nomination_requested', 'nominated', 'applied'].includes(v.stage)) pursued.add(v.opportunityRef);
      if (v && (v.stage === 'stopped' || v.stage === 'not_selected')) pursued.delete(v.opportunityRef);
    }
    for (const sid of [...pursued].sort()) {
      const sch = scholarshipCache.get(sid) ?? (await ctx.call<Scholarship[]>('scholarships.read', { op: 'get', scholarshipId: sid }))[0] ?? null;
      if (!sch) continue;
      sources.add(`scholarship:${sch.scholarshipId}@${sch.version}`);
      const linked = built.find((b) => {
        const r = b.resolution;
        return r.status === 'resolved' && sch.award.destinations.some((d) => d.institutionRef === r.institution.id);
      });
      for (const st of sch.stages) {
        if (!st.deadline && st.kind !== 'nomination') continue;
        if (st.kind === 'admission_application' && linked) {
          // The scholarship's own admission-application date controls the application task when it is earlier.
          const t = tasks.find((x) => x.taskId === `submit_${linked.opt.optionRef}`)!;
          if (st.deadline && (!t.officialDeadline || st.deadline.date < t.officialDeadline.date)) {
            // A milestone: the effort is already counted in the application task it controls.
            add({ taskId: `scholarship_${sch.scholarshipId}_${st.stageId}`, optionRefs: [linked.opt.optionRef], label: `${sch.name}: ${st.label} by the scholarship’s date`, kind: 'scholarship', owner: 'student', hours: { low: 0, high: 0 }, officialDeadline: { date: st.deadline.date, time: st.deadline.time, timezone: st.deadline.timezone, sourceRef: st.deadline.sourceRef }, dependsOn: [t.taskId] });
          }
          continue;
        }
        const kind: TaskKind = st.kind === 'nomination' ? 'nomination_request' : 'scholarship';
        const hours = st.kind === 'nomination' ? { low: 0.5, high: 1 } : scale([2 + (st.details.essays ?? 0) * 3, 3 + (st.details.essays ?? 0) * 6], s.paceMultiplier);
        // A school's own earlier cutoff controls the nomination; an unknown one is asked about, never assumed.
        const internal = typeof st.internalDeadline === 'string' && st.internalDeadline !== 'unknown' ? st.internalDeadline : null;
        const official: Deadline | null = internal && (!st.deadline || internal < st.deadline.date) ? { date: internal as CalendarDate, time: null, timezone: null, sourceRef: `your school’s internal deadline for ${sch.name}` } : st.deadline ? { date: st.deadline.date, time: st.deadline.time, timezone: st.deadline.timezone, sourceRef: st.deadline.sourceRef } : null;
        add({ taskId: `scholarship_${sch.scholarshipId}_${st.stageId}`, optionRefs: linked ? [linked.opt.optionRef] : [], label: `${sch.name}: ${st.label}`, kind, owner: st.kind === 'nomination' ? 'school' : 'student', hours, officialDeadline: official, dependsOn: st.dependsOn.map((d) => `scholarship_${sch.scholarshipId}_${d}`) });
        if (st.kind === 'nomination') {
          nominations.push({ scholarshipId: sch.scholarshipId, name: sch.name, internalKnown: internal !== null, perSchoolLimit: st.details.perSchoolLimit ?? null });
          if (!internal) p.questions.push({ code: `nomination_${sch.scholarshipId}`, question: `When is your school’s internal deadline to request a nomination for ${sch.name}, and how many students or awards can it nominate?`, for: 'school' });
        }
      }
    }
    resolveControllingDates(tasks);
    applyTargets(tasks, s.bufferDays, s.leadTimes);
    p.tasks = tasks.sort((a, b) => (a.controllingDate ?? '9999').localeCompare(b.controllingDate ?? '9999'));
    const work = feasibility(tasks, today, weekly);
    p.workload = work;
    for (const r of work.lateRequests) p.notices.push({ code: 'late_request', message: `${r.label} should have been requested by ${r.requestBy}. Ask as soon as you can, and check whether the deadline allows it.` });
    const shared = sharedDependencies(tasks);
    p.coverage = { acceptableOutcomes: acceptable.length, confirmedAffordablePath: affordable.length > 0, credibleAffordablePath: credible.length > 0, gaps, sharedDependencies: shared, combinedChance: null };
    for (const d of shared) gaps.push({ code: 'shared_dependency', message: `${d.label} is needed by ${d.optionRefs.length} applications (${d.optionRefs.join(', ')}); if it is late, all of them are affected, so they are not independent.` });
    // Several awards that each need a nomination from the same school compete for that one dependency (worked portfolio repair).
    if (nominations.length > 1) gaps.push({ code: 'nomination_competition', message: `${nominations.map((n) => n.name).join(' and ')} each need a nomination from your school. If the school can nominate you for only one, they compete for the same dependency; the nomination rules have been requested.` });
    // Program access and nomination feasibility come first when they could change coverage.
    for (const o of acceptable.filter((x) => x.programAccess !== 'with_admission')) {
      p.questions.push({ code: `program_access_${o.optionRef}`, question: o.programAccess === 'separate_competitive' ? `For ${o.name}: how many students who are admitted get a place in the intended program, and what happens if you are not selected?` : `For ${o.name}: does admission secure a place in the intended program, or is there a later selection?`, for: 'admissions_office' });
    }
    const accessFirst = affordable.some((o) => o.programAccess !== 'with_admission') || nominations.some((n) => !n.internalKnown) || nominations.length > 1;
    if (!weekly) p.questions.push({ code: 'weekly_hours', question: 'About how many hours a week can you give to applications? The plan checks whether the work fits.', for: 'student' });

    // Fees against the application budget.
    const payable = built.filter((b) => b.resolution.status === 'resolved' && b.opt.applicationFee && !b.opt.feeWaiver);
    let total: Money | null = null;
    for (const b of payable) total = total ? (total.currency === b.opt.applicationFee!.currency ? addMoney(total, b.opt.applicationFee!) : total) : b.opt.applicationFee!;
    p.fees = { total, budget: s.applicationBudget, withinBudget: total && s.applicationBudget && total.currency === s.applicationBudget.currency ? compareMoney(total, s.applicationBudget) <= 0 : null, waived: built.filter((b) => b.opt.feeWaiver).map((b) => b.opt.optionRef) };

    const nameOf = (ref: string) => p.options.find((o) => o.optionRef === ref)?.name ?? ref;
    const roundOf = (ref: string) => (p.options.find((o) => o.optionRef === ref)?.round ?? '').replace(/_/g, ' ');
    // Step 5: a manageable set of alternative plans; the student chooses the tradeoff (14T07).
    const byPriority = [...built].filter((b) => b.resolution.status === 'resolved').sort((a, b) => (a.opt.priority ?? 99) - (b.opt.priority ?? 99));
    if (work.status === 'infeasible' || work.status === 'tight') {
      // An infeasible plan is cut until it can fit; a tight one until it fits comfortably. In priority order.
      const acceptableStatus: ReadonlyArray<Feasibility['status']> = work.status === 'infeasible' ? ['comfortable', 'tight'] : ['comfortable'];
      const keep: string[] = [];
      for (const b of byPriority) {
        // The smaller set is scheduled on its own: a shared essay is due by the earliest deadline still in the set.
        const refs = [...keep, b.opt.optionRef];
        const trial = tasks.filter((t) => t.optionRefs.length === 0 || t.optionRefs.some((r) => refs.includes(r))).map((t) => ({ ...t, optionRefs: t.optionRefs.filter((r) => refs.includes(r)), dependsOn: [...t.dependsOn] }));
        resolveControllingDates(trial);
        if (acceptableStatus.includes(feasibility(trial, today, weekly).status)) keep.push(b.opt.optionRef);
      }
      const f = work.firstShortfall!;
      const pressure = work.status === 'infeasible' ? `By ${f.by} the plan needs at least ${f.needLow} hours of your own work and you have at most ${f.availableHigh}.` : `By ${f.by} the plan needs ${f.needLow}–${f.needHigh} hours of your own work and you have about ${f.availableLow}–${f.availableHigh}, so it fits only if the work goes quickly.`;
      if (keep.length < byPriority.length) p.alternatives.push({ plan: 'fits_your_time', optionRefs: keep, why: `${pressure} ${keep.length > 0 ? `This smaller set, in your priority order, ${work.status === 'infeasible' ? 'fits the hours you gave' : 'leaves room in the hours you gave'}.` : 'No option fits in its current round; a later round or cycle may.'} Using AI to write the essays is not a way to close the gap: the writing has to be yours.` });
      const early = byPriority.filter((b) => b.opt.round !== 'regular' && b.opt.round !== 'rolling').map((b) => b.opt.optionRef);
      if (early.length > 0) p.alternatives.push({ plan: 'later_rounds', optionRefs: byPriority.map((b) => b.opt.optionRef), why: `Moving ${early.map(nameOf).join(' and ')} to a later round, where one exists, spreads the work; check each later deadline and its conditions first.` });
    }
    const lowerCost = byPriority.filter((b) => p.options.find((o) => o.optionRef === b.opt.optionRef)!.affordability === 'supported' || b.opt.feeWaiver).map((b) => b.opt.optionRef);
    if ((p.fees.withinBudget === false || gaps.some((g) => g.code === 'no_confirmed_affordable_alternative')) && lowerCost.length > 0 && lowerCost.length < byPriority.length) {
      p.alternatives.push({ plan: 'lower_cost', optionRefs: lowerCost, why: 'Keeps the options that are affordable on confirmed resources or have a fee waiver.' });
    }
    if (rc.conflicts.length > 0) {
      const restricted = [...new Set(rc.conflicts.map((c) => c.restricted))].map(nameOf);
      p.alternatives.push({ plan: 'compatible_rounds', optionRefs: byPriority.map((b) => b.opt.optionRef), why: `Apply to ${restricted.join(' and ')} in a round the other institution’s rules allow (check that a later round exists and its deadline), or keep only one of the early rounds.` });
    }

    // Status and the next decision.
    const blocked = rc.conflicts.length > 0 || choiceLimit.length > 0;
    p.status = blocked ? 'blocked' : 'proposed';
    p.nextDecision = rc.conflicts.length > 0 ? 'choose compatible rounds' : choiceLimit.length > 0 ? 'choose which choices to keep within the system limit' : accessFirst ? 'resolve the program access question and nomination feasibility first' : work.status === 'infeasible' ? 'choose a plan that fits your time' : gaps.some((g) => g.code === 'no_confirmed_affordable_alternative') ? 'research an affordable option or pathway' : p.options.some((o) => o.bindingReadiness && !o.bindingReadiness.ready) ? 'settle the open questions before a binding round' : 'review and approve the plan';
    for (const c of rc.conflicts) p.notices.push({ code: 'round_conflict', message: `${nameOf(c.restricting)}’s ${roundOf(c.restricting)} rule does not allow ${nameOf(c.restricted)}’s ${roundOf(c.restricted)} (${c.target.replace(/_/g, ' ')}): “${c.rule}”${c.pendingException ? ` ${c.pendingException}` : ''}` });
    for (const o of p.options.filter((x) => x.bindingReadiness && !x.bindingReadiness.ready)) {
      if (o.bindingReadiness!.unmet.some((u) => /terms|agreement/.test(u))) p.questions.push({ code: `binding_terms_${o.optionRef}`, question: `Could the admissions office confirm the ${s.cycle} binding agreement for ${o.name} and how aid concerns are handled?`, for: 'admissions_office' });
    }

    // Versioning and changes since the last plan (14T13).
    const prior = previous.filter((x) => x.scopeKey === `plan_${s.cycle}`).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    p.version = ((prior?.payload as { version?: number } | undefined)?.version ?? 0) + 1;
    if (prior) {
      const before = prior.payload as { options?: Array<{ optionRef: string; affordability: string; selection: string; deadline?: string | null }>; confirmedAffordablePath?: boolean };
      for (const o of p.options) {
        const b = before.options?.find((x) => x.optionRef === o.optionRef);
        // An official date that changed: the rule, the tasks it moved and the decision now needed (XT02).
        if (b && b.deadline !== undefined && b.deadline !== o.deadline.official) {
          const moved = p.tasks.filter((t) => t.optionRefs.includes(o.optionRef)).map((t) => t.taskId);
          p.changes.push(`${o.name}: the official ${o.round.replace(/_/g, ' ')} deadline changed from ${b.deadline ?? 'unverified'} to ${o.deadline.official ?? 'unverified'}; ${moved.length} task${moved.length === 1 ? '' : 's'} moved (${moved.join(', ')}).`);
        }
        if (b && b.affordability !== o.affordability) p.changes.push(`${o.name}: affordability ${b.affordability.replace(/_/g, ' ')} → ${o.affordability.replace(/_/g, ' ')}.`);
        if (b && b.selection !== o.selection) p.changes.push(`${o.name}: admissions assessment ${b.selection.replace(/_/g, ' ')} → ${o.selection.replace(/_/g, ' ')}.`);
      }
      if (before.confirmedAffordablePath && !p.coverage.confirmedAffordablePath) p.changes.push('The plan no longer has an option you would attend that is affordable on confirmed resources.');
      if (prior.status === 'stale') p.notices.push({ code: 'plan_revised', message: `Inputs to plan version ${(prior.payload as { version?: number }).version ?? '?'} changed. It is kept as history; this is version ${p.version}.` });
      // A prior approval stays in the history; it does not carry over to a changed plan (worked portfolio repair).
      const approval = approvals.filter((x) => x.scopeKey === `plan_${s.cycle}`).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      const approvedVersion = (approval?.payload as { planVersion?: number } | undefined)?.planVersion;
      if (approval && approvedVersion !== undefined) p.notices.push({ code: 'prior_approval_historical', message: `You approved plan version ${approvedVersion}. That approval is kept as history and does not apply to version ${p.version}, which needs your review.` });
    }
    const allSources = [...sources, ...new Set(built.flatMap((b) => b.artifacts))];
    // The catalog invalidates by the unversioned scholarship reference, so a changed scholarship date makes this plan stale.
    const invalidationRefs = [...new Set([...allSources, ...[...sources].filter((x) => x.startsWith('scholarship:')).map((x) => x.replace(/@\d+$/, ''))])];
    await ctx.call<DerivedArtifact>('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind: 'portfolio_plan',
      scopeKey: `plan_${s.cycle}`,
      payload: { version: p.version, status: p.status, optionRefs: p.options.map((o) => o.optionRef), options: p.options.map((o) => ({ optionRef: o.optionRef, affordability: o.affordability, selection: o.selection, round: o.round, deadline: o.deadline.official })), confirmedAffordablePath: p.coverage.confirmedAffordablePath, nextDecision: p.nextDecision },
      inputClaimIds: view.view.fields.filter((f) => f.current && ['option_decision', 'scholarship_application'].includes(f.field.entity)).map((f) => f.current!.claimId),
      inputFieldKeys: ['option_decision:*.definition', 'scholarship_application:*.status', 'student:self.constraints.weekly_hours_available'],
      sourceIds: invalidationRefs,
      recordVersion: view.recordVersion,
    });

    const handoffs: Handoff[] = [];
    const needAfford = p.options.filter((o) => o.resolved && (o.affordability === 'not_calculated' || o.affordability === 'unknown' || (o.binding && o.affordability !== 'supported')));
    if (needAfford.length > 0 && s.requester !== '15') handoffs.push({ toRole: '15', reason: needAfford.some((o) => o.binding) ? 'A binding round is proposed without confirmed affordability.' : 'Some options have no current affordability result.', requestedOutcome: 'Calculate affordability on confirmed resources for these options before any binding choice.', inputRefs: needAfford.map((o) => o.optionRef), unresolved: [], completionCondition: 'Each option has a current affordability state.' });
    const missingRules = p.options.filter((o) => o.resolved && (!o.deadline.official || rc.unverifiedRules.includes(o.optionRef) || (o.bindingReadiness?.unmet.some((u) => /terms|agreement/.test(u)) ?? false)));
    if (missingRules.length > 0) handoffs.push({ toRole: '11', reason: 'Round rules, binding terms or deadlines are not verified for the current cycle.', requestedOutcome: `Verify the ${s.cycle} round rules, agreements and deadlines for ${missingRules.map((o) => o.name).join(', ')}.`, inputRefs: missingRules.map((o) => o.optionRef), unresolved: [], completionCondition: 'Each round has a verified, current rule and deadline.' });
    if (nominations.length > 1 || nominations.some((n) => !n.internalKnown)) handoffs.push({ toRole: '16', reason: 'Scholarship nominations from the same school may compete, or their internal dates are unknown.', requestedOutcome: `Confirm the nomination rules for ${nominations.map((n) => n.name).join(', ')}: how many nominations a school may make and any internal date.`, inputRefs: nominations.map((n) => `scholarship:${n.scholarshipId}`), unresolved: nominations.filter((n) => !n.internalKnown).map((n) => `internal_deadline:${n.scholarshipId}`), completionCondition: 'Each nomination has a known rule and date, or is recorded as unknown.' });
    if (gaps.some((g) => g.code === 'no_confirmed_affordable_alternative' || g.code === 'all_selection_uncertain')) handoffs.push({ toRole: '12', reason: 'The portfolio lacks a credible, affordable path the student would accept.', requestedOutcome: 'Look for options that could close the gap within the student’s priorities.', inputRefs: p.options.map((o) => o.optionRef), unresolved: gaps.map((g) => g.code), completionCondition: 'At least one acceptable option is affordable on confirmed resources, or the gap is understood.' });
    const status = p.status === 'blocked' ? 'partial' : p.questions.length > 0 ? 'partial' : 'completed';
    return makeResult(ctx, {
      status,
      summary: `Plan version ${p.version}: ${p.options.length} application${p.options.length === 1 ? '' : 's'}${rc.conflicts.length > 0 ? `, ${rc.conflicts.length} round conflict${rc.conflicts.length === 1 ? '' : 's'} to resolve` : ''}; next: ${p.nextDecision}.`,
      payload: p,
      claimIds: view.view.fields.filter((f) => f.current && ['option_decision', 'scholarship_application'].includes(f.field.entity)).map((f) => f.current!.claimId),
      recordVersion: view.recordVersion,
      sourceRefs: allSources.filter((x) => !x.startsWith('artifact:')),
      handoffs,
      completionReason: p.status === 'blocked' ? 'plan_blocked' : 'plan_proposed',
    });
  }

  // ------------------------------------------------------------ approval (14T09)

  private async approve(ctx: TaskContext, s: Scope<'approve'>) {
    const p = this.empty('approve');
    const plans = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'portfolio_plan' });
    const plan = plans.filter((x) => x.scopeKey === `plan_${s.cycle}` && x.status === 'current').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    const v = plan?.payload as { version: number; status: string; options: Array<{ optionRef: string; round: string }> } | undefined;
    if (!plan || !v || v.version !== s.planVersion) return failedResult(ctx, 'failed', 'That plan version is not the current one; please review the latest plan.', 'plan_version_mismatch');
    if (v.status === 'blocked') return failedResult(ctx, 'failed', 'This plan has unresolved conflicts and cannot be approved yet.', 'plan_blocked');
    if (!s.confirmedByStudent || ctx.request.actor.kind !== 'student') {
      p.status = 'proposed';
      p.notices.push({ code: 'approval_needs_student', message: 'Only you can approve your plan.' });
      return makeResult(ctx, { status: 'needs_student_input', summary: 'Please confirm the plan yourself.', payload: p, completionReason: 'confirmation_needed' });
    }
    const view = await readView(ctx, 'local', { entityTypes: ['application'] });
    const claims = v.options.flatMap((o) => {
      const entityId = o.optionRef.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 120);
      const ev = [conversationEvidence('conv_plan', `approve_${s.planVersion}`, `approve plan ${s.planVersion}: ${o.optionRef}`, 'text', false)];
      return [buildClaim({ entity: 'application', entityId, attribute: 'status', value: 'approved', origin: 'student_statement', confirmation: 'student_confirmed', evidence: ev, actor: ctx.request.actor, viaRole: '14' })];
    });
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `approve_${s.planVersion}`), operation: 'add_claims', claims, expectedRecordVersion: view.recordVersion, reason: `plan_approved:${s.planVersion}` } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', 'The approval could not be recorded.', `record_${res.outcome}`);
    await ctx.call<DerivedArtifact>('artifacts.put_derived', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'portfolio_approval', scopeKey: `plan_${s.cycle}`, payload: { planVersion: v.version, planArtifactId: plan.id, optionRefs: v.options.map((o) => o.optionRef) }, inputClaimIds: [], sourceIds: [artifactRef(plan.id)], recordVersion: res.recordVersion ?? view.recordVersion });
    p.status = 'approved';
    p.version = v.version;
    p.notices.push({ code: 'nothing_sent', message: 'Approving the plan does not submit an application, pay a fee or contact anyone. Each of those is a separate step that you authorize yourself.' });
    return makeResult(ctx, { status: 'completed', summary: `Plan version ${v.version} approved. Nothing has been submitted, paid or sent.`, payload: p, recordVersion: res.recordVersion ?? view.recordVersion, completionReason: 'plan_approved' });
  }

  // ------------------------------------------------------------ status with evidence (14T10)

  private async recordStatus(ctx: TaskContext, s: Scope<'record_status'>) {
    const p = this.empty('record_status');
    p.status = 'updated';
    const view = await readView(ctx, 'local', { entityTypes: ['application', 'application_item'] });
    const entityId = s.optionRef.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 120);
    const fromDocument = s.evidence.documentId !== null && s.evidence.documentVersion !== null;
    const evidence = fromDocument ? [{ kind: 'document_anchor' as const, documentId: s.evidence.documentId!, documentVersion: s.evidence.documentVersion!, page: 1, region: { kind: 'text_span' as const, blockIndex: 0, start: 0, end: s.evidence.quote.length }, originalText: s.evidence.quote, method: 'text_layer' as const }] : [conversationEvidence(s.evidence.conversationId, s.evidence.turnId, s.evidence.quote, 'text', false)];
    const origin = fromDocument ? 'document_extraction' : 'student_statement';
    const claims = [];
    // Submission, receipt and completeness are different states; marking a task done never creates a receipt.
    const receipt = fromDocument && s.evidence.kind === 'portal_receipt';
    // An item counts as received only when the portal document shows it.
    const missing = s.items.filter((i) => i.required && !((i.status === 'received' && fromDocument) || i.status === 'waived')).map((i) => i.item);
    const state = s.state === 'complete' && missing.length > 0 ? 'received' : s.state;
    if (s.state === 'complete' && missing.length > 0) p.notices.push({ code: 'not_complete', message: `The application cannot be marked complete: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not confirmed received.` });
    if ((state === 'received' || state === 'complete') && !receipt) {
      p.notices.push({ code: 'receipt_needed', message: 'A receipt from the portal is needed before the application is marked received; it is recorded as submitted by you until then.' });
    }
    const recorded = (state === 'received' || state === 'complete') && !receipt ? 'submitted' : state;
    claims.push(buildClaim({ entity: 'application', entityId, attribute: 'status', value: recorded, origin, confirmation: ctx.request.actor.kind === 'student' ? 'student_confirmed' : 'unreviewed', evidence, actor: ctx.request.actor, viaRole: '14' }));
    // An item shown as received on the portal document is anchored to it; a reported receipt stays "sent" until confirmed.
    const unconfirmedItems: string[] = [];
    for (const [i, it] of s.items.entries()) {
      const status = it.status === 'received' && !fromDocument ? 'sent' : it.status;
      if (status !== it.status) unconfirmedItems.push(it.item);
      const itemEvidence = fromDocument ? evidence : [conversationEvidence(s.evidence.conversationId, `${s.evidence.turnId}_item_${i}`, `${it.item}: ${it.status}`, 'text', false)];
      claims.push(buildClaim({ entity: 'application_item', entityId: `${entityId}_${it.item.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.slice(0, 120), attribute: 'definition', value: { applicationRef: s.optionRef, item: it.item, owner: it.owner, status }, origin: fromDocument ? 'document_extraction' : 'student_statement', confirmation: ctx.request.actor.kind === 'student' ? 'student_confirmed' : 'unreviewed', evidence: itemEvidence, actor: ctx.request.actor, viaRole: '14' }));
    }
    if (unconfirmedItems.length > 0) p.notices.push({ code: 'item_receipt_needed', message: `${unconfirmedItems.join(', ')} ${unconfirmedItems.length === 1 ? 'is' : 'are'} recorded as sent until the portal shows ${unconfirmedItems.length === 1 ? 'it' : 'them'} as received.` });
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `status_${entityId}_${recorded}`), operation: 'add_claims', claims, expectedRecordVersion: view.recordVersion, reason: `application_status:${s.optionRef}` } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', `The status could not be recorded: ${res.reasons.slice(0, 2).join('; ')}`, `record_${res.outcome}`);
    p.applicationStates.push({ optionRef: s.optionRef, submission: recorded, completeness: s.items.length === 0 ? 'unknown' : missing.length === 0 ? 'complete' : 'incomplete', missing, confirmedBy: receipt ? 'portal receipt' : null });
    return makeResult(ctx, { status: 'completed', summary: `${s.optionRef}: ${recorded}${missing.length > 0 ? `, still missing ${missing.join(', ')}` : ''}.`, payload: p, recordVersion: res.recordVersion ?? view.recordVersion, completionReason: 'status_recorded' });
  }

  // ------------------------------------------------------------ outcomes that change rounds (14T12)

  private async reportOutcome(ctx: TaskContext, s: Scope<'report_outcome'>) {
    const p = this.empty('report_outcome');
    p.status = 'updated';
    const view = await readView(ctx, 'local', { entityTypes: ['application'] });
    const entityId = s.optionRef.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 120);
    const fromDocument = s.evidence.documentId !== null && s.evidence.documentVersion !== null;
    const evidence = fromDocument ? [{ kind: 'document_anchor' as const, documentId: s.evidence.documentId!, documentVersion: s.evidence.documentVersion!, page: 1, region: { kind: 'text_span' as const, blockIndex: 0, start: 0, end: s.evidence.quote.length }, originalText: s.evidence.quote, method: 'text_layer' as const }] : [conversationEvidence(s.evidence.conversationId, s.evidence.turnId, s.evidence.quote, 'text', false)];
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `outcome_${entityId}`), operation: 'add_claims', claims: [buildClaim({ entity: 'application', entityId, attribute: 'outcome', value: s.outcome, origin: fromDocument ? 'document_extraction' : 'student_statement', confirmation: ctx.request.actor.kind === 'student' ? 'student_confirmed' : 'unreviewed', evidence, actor: ctx.request.actor, viaRole: '14' })], expectedRecordVersion: view.recordVersion, reason: `application_outcome:${s.optionRef}` } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', 'The outcome could not be recorded.', `record_${res.outcome}`);
    const confirmed = fromDocument && s.evidence.kind === 'portal_notice';
    const need = s.outcome === 'deferred' ? 'deferred_elsewhere' : s.outcome === 'denied' ? 'denied_elsewhere' : null;
    const handoffs: Handoff[] = [];
    const sources: string[] = [];
    for (const c of s.candidates) {
      const r = await ctx.call<Resolution>('institutions.read', { op: 'resolve', institution: c.institution, campus: c.campus, program: c.program });
      if (r.status !== 'resolved') continue;
      const read = await ctx.call<ReadClaimsResult>('institutions.read', { op: 'claims', entityId: r.entity.id, predicates: ['round_rule'], cycle: s.cycle, includeHistorical: false });
      const rule = read.claims.find((x) => x.predicate === 'round_rule' && (x.qualifier === c.round || (x.value as RoundRuleValue).round === c.round));
      if (!rule) continue;
      sources.push(claimRef(rule.claimId));
      const v = rule.value as RoundRuleValue;
      if (!need || !v.requiresOutcome.includes(need as RoundRuleValue['requiresOutcome'][number])) continue;
      const current = rule.status === 'verified' && diffDays(rule.retrievedAt.slice(0, 10) as CalendarDate, this.today(ctx)) <= 7;
      // The later round opens only when the outcome is confirmed and the rule is current (14T12).
      if (confirmed && current) {
        p.changes.push(`${r.entity.name} ${c.round.replace(/_/g, ' ')} is now open to you: “${v.text}”. It is proposed for your plan; nothing is submitted.`);
      } else {
        p.changes.push(`${r.entity.name} ${c.round.replace(/_/g, ' ')} may open after a ${s.outcome}, but it is not added yet.`);
        if (!confirmed) p.questions.push({ code: `confirm_outcome_${s.optionRef}`, question: `Could you add the decision notice from the portal? The ${s.outcome} needs to be confirmed before the plan changes.`, for: 'student' });
        if (!current) {
          p.questions.push({ code: `recheck_rule_${c.optionRef}`, question: `The ${c.round.replace(/_/g, ' ')} rule for ${r.entity.name} needs re-checking for this cycle before relying on it.`, for: 'student' });
          handoffs.push({ toRole: '11', reason: 'An outcome-dependent round needs its current rule.', requestedOutcome: `Re-verify the ${c.round.replace(/_/g, ' ')} rule for ${r.entity.name}.`, inputRefs: [claimRef(rule.claimId)], unresolved: [], completionCondition: 'The rule is verified for the current cycle.' });
        }
      }
    }
    return makeResult(ctx, { status: p.questions.length > 0 ? 'needs_student_input' : 'completed', summary: `Recorded the ${s.outcome} from ${s.institution}${confirmed ? ' (confirmed by the portal notice)' : ' (as you reported it)'}.`, payload: p, recordVersion: res.recordVersion ?? view.recordVersion, sourceRefs: sources, handoffs, completionReason: 'outcome_recorded' });
  }

  // ------------------------------------------------------------ a missed deadline (14T16)

  private async missedDeadline(ctx: TaskContext, s: Scope<'missed_deadline'>) {
    const p = this.empty('missed_deadline');
    p.status = 'updated';
    const r = await ctx.call<Resolution>('institutions.read', { op: 'resolve', institution: s.option.institution, campus: s.option.campus, program: s.option.program });
    const sources: string[] = [];
    if (r.status === 'resolved') {
      const read = await ctx.call<ReadClaimsResult>('institutions.read', { op: 'claims', entityId: r.entity.id, predicates: ['application_deadline'], cycle: s.cycle, includeHistorical: false });
      const today = this.today(ctx);
      const later = read.claims.filter((c) => c.predicate === 'application_deadline' && c.qualifier !== s.option.round && (c.value as DeadlineValue).date !== null && (c.value as DeadlineValue).date! >= today);
      for (const c of later) {
        sources.push(claimRef(c.claimId));
        const v = c.value as DeadlineValue;
        p.alternatives.push({ plan: `${c.qualifier || 'other'}_round`, optionRefs: [s.option.optionRef], why: `${r.entity.name}’s ${c.qualifier.replace(/_/g, ' ') || 'other'} deadline is ${v.date}${v.time ? ` ${v.time}` : ''}${v.timezoneLabel ? ` ${v.timezoneLabel}` : ''}; check its conditions before relying on it.` });
      }
    }
    p.notices.push({ code: 'no_exception_promised', message: 'Late submissions are the institution’s decision. The app will not promise an exception or suggest giving a reason that is not true; it can help you ask the admissions office directly and look at the options that remain.' });
    p.questions.push({ code: 'late_policy', question: `Could the admissions office tell you whether ${s.option.institution} accepts anything after the ${s.option.round.replace(/_/g, ' ')} deadline, and on what terms?`, for: 'admissions_office' });
    const handoffs: Handoff[] = [{ toRole: '11', reason: 'A deadline was missed.', requestedOutcome: `Find ${s.option.institution}’s published policy on late applications and any later routes for ${s.cycle}.`, inputRefs: [s.option.optionRef], unresolved: [], completionCondition: 'The late-application policy is verified or recorded as unknown.' }];
    return makeResult(ctx, { status: 'completed', summary: `The ${s.option.round.replace(/_/g, ' ')} deadline for ${s.option.institution} has passed; ${p.alternatives.length} later route${p.alternatives.length === 1 ? '' : 's'} found to check.`, payload: p, sourceRefs: sources, handoffs, completionReason: 'alternatives_researched' });
  }
}

