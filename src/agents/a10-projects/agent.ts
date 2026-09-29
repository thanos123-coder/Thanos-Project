import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import { AssistanceOperationSchema, DestinationRefSchema, type OperationDecision } from '../../policy/assistance.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { RoleIdSchema, type Handoff } from '../../shared/envelopes.js';
import { CONTRIBUTORS, MeasureSchema, PROJECT_CONTEXTS, PROJECT_OUTPUT_STATES, type ProjectCompletion } from '../../shared/fields.js';
import { CalendarDateSchema, diffDays, type CalendarDate } from '../../shared/time.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import type { DerivedArtifact, MutationResponse } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import { ADMISSIONS_FRAMING, CHARACTER_LANGUAGE, checkMeasure, OUTPUT_EVIDENCE, requestsFabrication, SAFE_ALTERNATIVES, SAFETY_AREAS, safetyAreas, supportedOutputState, type SafetyArea } from './checks.js';
import { MINIMAL_EVIDENCE_NOTE, type NotebookView } from './notebook.js';
import { affectedMilestones, ApprovalSchema, APPROVAL_STATUSES, capacityWindow, checkGraph, defaultReserve, HoursRangeSchema, MilestoneSchema, schedule, type Approval, type HoursRange, type Milestone, type Schedule, type ScheduledMilestone } from './schedule.js';

/**
 * Agent 10 — Project mentor and workload planner.
 *
 * Helps a student pursue a genuine project at a sustainable pace: a small
 * useful result, milestones with effort ranges and evidence, a schedule that
 * never exceeds the time the student has, and an honest record of what
 * happened. It does not invent an initiative, do the student's work, approve
 * research, certify participation or promise publication. Scheduling,
 * dependency checks, policy gates and output-state rules are code; the student
 * owns scope and commitments.
 */

const RangeInput = HoursRangeSchema;
const CapacityChangeSchema = z.object({ fromWeek: z.number().int().min(1).max(52), toWeek: z.number().int().min(1).max(52), hours: RangeInput, reason: z.string().min(1).max(120) }).strict();
const ContextRefSchema = DestinationRefSchema;

const BriefSchema = z
  .object({
    /** A neutral working title; planning notes, not application language. */
    title: z.string().min(1).max(120),
    goal: z.string().min(1).max(300),
    description: z.string().min(1).max(1500),
    audience: z.string().max(200).nullable().default(null),
    context: z.enum(PROJECT_CONTEXTS),
    contextRef: ContextRefSchema.nullable().default(null),
    learningQuestion: z.string().max(300).nullable().default(null),
    smallestResult: z.string().min(1).max(300),
    extension: z.string().max(300).nullable().default(null),
    /** Whether the result would be made public, and the approval that permits it. */
    publicRelease: z.object({ wanted: z.boolean(), approvalId: z.string().regex(/^[a-z0-9_]+$/).nullable() }).strict().default({ wanted: false, approvalId: null }),
  })
  .strict();

const TrackingSchema = z.enum(['approximate', 'detailed', 'none']);
const ProjectId = z.string().regex(/^[a-z0-9_]+$/).max(60);

const OutputInputSchema = z.object({ description: z.string().min(1).max(300), state: z.enum(PROJECT_OUTPUT_STATES), evidence: z.enum(OUTPUT_EVIDENCE).default('student_report') }).strict();
const ContributionInputSchema = z.object({ description: z.string().min(1).max(300), by: z.enum(CONTRIBUTORS), evidence: z.string().max(300).nullable().default(null) }).strict();
const MeasureInputSchema = z.object({ measure: MeasureSchema, statedAs: z.string().max(200).nullable().default(null) }).strict();

export const ProjectScopeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('explore'), interest: z.string().max(300).nullable().default(null), request: z.string().max(1500).nullable().default(null), requester: RoleIdSchema.default('01') }).strict(),
  z
    .object({
      action: z.literal('plan'),
      projectId: ProjectId,
      brief: BriefSchema,
      weeks: z.number().int().min(1).max(52),
      startDate: CalendarDateSchema.nullable().default(null),
      weeklyHours: RangeInput.nullable().default(null),
      reservePerWeek: z.number().min(0).max(20).nullable().default(null),
      capacityChanges: z.array(CapacityChangeSchema).max(20).default([]),
      milestones: z.array(MilestoneSchema).min(1).max(30),
      approvals: z.array(ApprovalSchema).max(10).default([]),
      safetyAreas: z.array(z.enum(SAFETY_AREAS)).default([]),
      scopeChoice: z.enum(['full', 'smallest']).default('full'),
      scopeChangeReason: z.string().max(300).nullable().default(null),
      tracking: TrackingSchema.default('approximate'),
      approve: z.boolean().default(false),
      reopen: z.boolean().default(false),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('check_in'),
      projectId: ProjectId,
      reports: z.array(z.object({ milestoneId: z.string().min(1), status: z.enum(['done', 'in_progress', 'not_started', 'took_longer', 'stuck']), actualHours: RangeInput.nullable().default(null), note: z.string().max(500).nullable().default(null) }).strict()).max(30).default([]),
      capacityChanges: z.array(CapacityChangeSchema).max(20).default([]),
      approvals: z.array(z.object({ id: z.string().min(1), status: z.enum(APPROVAL_STATUSES) }).strict()).max(10).default([]),
      tracking: TrackingSchema.nullable().default(null),
      /** The plan week this check-in is in, when the plan has no start date; earlier weeks are past and hold no new work. */
      currentWeek: z.number().int().min(1).max(52).nullable().default(null),
      note: z.string().max(1500).nullable().default(null),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('assist'), projectId: ProjectId.nullable().default(null), operation: AssistanceOperationSchema, destination: ContextRefSchema.nullable().default(null), requester: RoleIdSchema.default('01') }).strict(),
  z.object({ action: z.literal('add_evidence'), projectId: ProjectId, kind: z.enum(['link', 'note', 'photo', 'explanation']), text: z.string().min(1).max(4000), url: z.string().url().nullable().default(null), requester: RoleIdSchema.default('01') }).strict(),
  z
    .object({
      action: z.literal('close'),
      projectId: ProjectId,
      outcome: z.enum(['completed', 'paused', 'stopped']),
      reason: z.string().max(300).nullable().default(null),
      outputs: z.array(OutputInputSchema).max(20).default([]),
      contributions: z.array(ContributionInputSchema).max(40).default([]),
      measures: z.array(MeasureInputSchema).max(10).default([]),
      unfinished: z.array(z.string().min(1).max(300)).max(20).default([]),
      learned: z.string().max(1000).nullable().default(null),
      reflection: z.string().max(2000).nullable().default(null),
      confirmedByStudent: z.boolean().default(false),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('correct_completion'),
      projectId: ProjectId,
      outputs: z.array(OutputInputSchema).max(20).optional(),
      studentContribution: z.array(z.string().min(1).max(300)).max(30).optional(),
      teamContribution: z.array(z.string().min(1).max(300)).max(30).optional(),
      unfinished: z.array(z.string().min(1).max(300)).max(20).optional(),
      learned: z.string().max(1000).nullable().optional(),
      note: z.string().min(1).max(300),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
]);
export type ProjectScope = z.infer<typeof ProjectScopeSchema>;
type Scope<A extends ProjectScope['action']> = Extract<ProjectScope, { action: A }>;

// ---------------------------------------------------------------- payload

const MilestoneOutSchema = z
  .object({
    id: z.string(),
    purpose: z.string(),
    action: z.string(),
    effort: z.object({ low: z.number(), high: z.number() }).strict(),
    dependsOn: z.array(z.string()),
    evidence: z.string(),
    optional: z.boolean(),
    waitWeeks: z.number(),
    needsApproval: z.string().nullable(),
    needsSupervision: z.boolean(),
    due: z.string().nullable(),
    state: z.enum(['done', 'scheduled', 'blocked', 'does_not_fit', 'dropped']),
    weeks: z.array(z.object({ week: z.number(), hours: z.number() }).strict()),
    startWeek: z.number().nullable(),
    finishWeek: z.number().nullable(),
    availableFromWeek: z.number().nullable(),
    blockedBy: z.array(z.string()),
    late: z.boolean(),
  })
  .strict();
type MilestoneOut = z.infer<typeof MilestoneOutSchema>;

const CompletionOutSchema = z.custom<ProjectCompletion>((v) => typeof v === 'object' && v !== null && 'outputs' in v);

export const ProjectPayloadSchema = z
  .object({
    action: z.string(),
    projectId: z.string().nullable(),
    version: z.number().int().nonnegative(),
    status: z.enum(['exploring', 'proposed', 'approved', 'needs_review', 'rejected', 'closed', 'paused', 'stopped', 'updated', 'declined', 'not_applicable']),
    brief: z.object({ title: z.string(), goal: z.string(), audience: z.string().nullable(), context: z.string(), contextRef: z.string().nullable(), learningQuestion: z.string().nullable(), smallestResult: z.string(), extension: z.string().nullable() }).strict().nullable(),
    contextPolicy: z.array(z.object({ operation: z.string(), decision: z.enum(['allowed', 'prohibited', 'unclear']), explanation: z.string(), sourceId: z.string().nullable() }).strict()),
    capacity: z
      .object({
        base: z.object({ low: z.number(), high: z.number() }).strict(),
        reservePerWeek: z.number(),
        trial: z.boolean(),
        weeks: z.array(z.object({ week: z.number(), capacityLow: z.number(), usable: z.number(), placed: z.number(), reason: z.string().nullable() }).strict()),
        protectedCommitments: z.array(z.string()),
      })
      .strict()
      .nullable(),
    milestones: z.array(MilestoneOutSchema),
    graphIssues: z.array(z.object({ kind: z.string(), milestoneIds: z.array(z.string()), message: z.string() }).strict()),
    fits: z.boolean().nullable(),
    requiredHours: z.object({ low: z.number(), high: z.number() }).strict().nullable(),
    scopeVersions: z.array(z.object({ version: z.number(), smallestResult: z.string(), extension: z.string().nullable(), choice: z.enum(['full', 'smallest']), reason: z.string().nullable() }).strict()),
    scopeOptions: z.array(z.object({ option: z.enum(['smaller_version', 'extend_timeline', 'keep_and_review_estimates']), description: z.string(), fits: z.boolean(), extraWeeks: z.number().nullable() }).strict()),
    affected: z.array(z.string()),
    approvals: z.array(z.object({ id: z.string(), authority: z.string(), status: z.string(), permittedScope: z.string().nullable(), blocks: z.array(z.string()) }).strict()),
    supervision: z.object({ required: z.boolean(), areas: z.array(z.enum(SAFETY_AREAS)), whoToAsk: z.string(), safeAlternatives: z.array(z.string()) }).strict().nullable(),
    nextAction: z.object({ milestoneId: z.string(), action: z.string(), effort: z.object({ low: z.number(), high: z.number() }).strict(), week: z.number(), question: z.string() }).strict().nullable(),
    reminders: z.enum(['on', 'off']),
    tracking: TrackingSchema,
    estimateReview: z.object({ milestoneIds: z.array(z.string()), questions: z.array(z.string()), options: z.array(z.string()) }).strict().nullable(),
    exploration: z.object({ step: z.string(), sessions: z.string(), questions: z.array(z.string()) }).strict().nullable(),
    assist: z.object({ operation: z.string(), decision: z.enum(['allowed', 'prohibited', 'unclear']), explanation: z.string(), sources: z.array(z.string()), alternatives: z.array(z.string()) }).strict().nullable(),
    notebook: z.object({ entryId: z.string(), access: z.enum(['normal', 'restricted']), privateKinds: z.array(z.string()), redactionProposal: z.string().nullable(), minimalEvidence: z.string().nullable() }).strict().nullable(),
    completionProposal: CompletionOutSchema.nullable(),
    completionChanges: z.array(z.string()),
    publicRelease: z.enum(['not_planned', 'awaiting_permission', 'permitted']).nullable(),
    admissionsClaim: z.null(),
    questions: z.array(z.object({ code: z.string(), question: z.string() }).strict()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    pendingUpdate: z.unknown().nullable(),
  })
  .strict();
export type ProjectPayload = z.infer<typeof ProjectPayloadSchema>;

export const PROJECT_CONTRACT: ContractDefinition<ProjectPayload> = {
  id: 'project_plan_v1',
  role: '10',
  payload: ProjectPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    // Nothing is placed in time the student does not have (10T02).
    for (const w of p.capacity?.weeks ?? []) if (w.placed > w.usable + 1e-9 || w.usable > w.capacityLow + 1e-9) issues.push(`week ${w.week}: more work placed than the time available`);
    const byId = new Map(p.milestones.map((m) => [m.id, m]));
    for (const m of p.milestones) {
      if ((m.state === 'blocked' || m.state === 'dropped' || m.state === 'does_not_fit') && m.weeks.length > 0) issues.push(`${m.id}: ${m.state} work cannot be scheduled`);
      if (m.state !== 'scheduled') continue;
      for (const d of m.dependsOn) {
        const dm = byId.get(d);
        if (dm && dm.state === 'scheduled' && m.startWeek !== null && dm.availableFromWeek !== null && m.startWeek < dm.availableFromWeek) issues.push(`${m.id} starts before ${d} is ready`);
      }
    }
    if (p.status === 'approved' && p.fits !== true) issues.push('only a plan that fits can be approved');
    // Only the app's own words are checked; the student's descriptions are theirs.
    const text = JSON.stringify([p.notices, p.questions, p.estimateReview, p.scopeOptions, p.exploration, p.assist, p.nextAction?.question ?? null]);
    if (CHARACTER_LANGUAGE.test(text)) issues.push('no inference about the student’s character, motivation or health');
    if (ADMISSIONS_FRAMING.test(text)) issues.push('a project plan does not use admissions framing');
    return issues;
  },
};

// ---------------------------------------------------------------- stored plan

interface StoredPlan {
  version: number;
  status: ProjectPayload['status'];
  projectId: string;
  brief: z.infer<typeof BriefSchema>;
  weeks: number;
  startDate: CalendarDate | null;
  base: HoursRange;
  trial: boolean;
  reservePerWeek: number;
  capacityChanges: Array<z.infer<typeof CapacityChangeSchema>>;
  milestones: Milestone[];
  approvals: Approval[];
  safety: SafetyArea[];
  scopeChoice: 'full' | 'smallest';
  scopeVersions: ProjectPayload['scopeVersions'];
  tracking: z.infer<typeof TrackingSchema>;
  done: string[];
  overruns: Record<string, number>;
  schedule: Array<Pick<ScheduledMilestone, 'id' | 'state' | 'finishWeek'>>;
  approved: boolean;
}

const WHO_TO_ASK = 'your supervising teacher, the organization running the activity, or the competition’s review committee';

export class ProjectMentorAgent implements SpecialistAgent {
  readonly role = '10' as const;
  readonly contracts = [PROJECT_CONTRACT];

  /** Schedules, dependency checks and gates are code; a model would only help phrase questions. */
  constructor(private readonly model: ModelGateway) {}

  get modelConfigured(): boolean {
    return this.model.configured;
  }

  async handle(ctx: TaskContext) {
    const parsed = ProjectScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The project request was incomplete.', 'invalid_scope');
    const s = parsed.data;
    switch (s.action) {
      case 'explore':
        return this.explore(ctx, s);
      case 'plan':
        return this.plan(ctx, s);
      case 'check_in':
        return this.checkIn(ctx, s);
      case 'assist':
        return this.assist(ctx, s);
      case 'add_evidence':
        return this.addEvidence(ctx, s);
      case 'close':
        return this.close(ctx, s);
      case 'correct_completion':
        return this.correct(ctx, s);
    }
  }

  private empty(action: string, projectId: string | null): ProjectPayload {
    return { action, projectId, version: 0, status: 'updated', brief: null, contextPolicy: [], capacity: null, milestones: [], graphIssues: [], fits: null, requiredHours: null, scopeVersions: [], scopeOptions: [], affected: [], approvals: [], supervision: null, nextAction: null, reminders: 'off', tracking: 'approximate', estimateReview: null, exploration: null, assist: null, notebook: null, completionProposal: null, completionChanges: [], publicRelease: null, admissionsClaim: null, questions: [], notices: [], pendingUpdate: null };
  }

  private async storedPlan(ctx: TaskContext, projectId: string): Promise<{ artifact: DerivedArtifact; plan: StoredPlan } | null> {
    const all = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'project_plan' });
    const a = all.filter((x) => x.scopeKey === `project_${projectId}` && (x.status === 'current' || x.status === 'stale')).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0];
    return a ? { artifact: a, plan: a.payload as StoredPlan } : null;
  }

  // ------------------------------------------------------------ explore (10T01, 10T06)

  private async explore(ctx: TaskContext, s: Scope<'explore'>) {
    const p = this.empty('explore', null);
    p.status = 'exploring';
    if (s.request && requestsFabrication(s.request)) {
      p.status = 'declined';
      p.notices.push({ code: 'no_fabricated_activity', message: 'I can’t help create or describe an activity that didn’t happen. I can help you find something real you’d want to do, even a small one.' });
    }
    const topic = s.interest?.trim() || null;
    p.exploration = {
      step: topic ? `Try one small thing connected to ${topic} in one or two short sessions: read or watch one explainer, try one small exercise, or ask someone who already does it one question. Afterwards, note what you enjoyed and what you want to know next.` : 'Try one or two short sessions on something you already wonder about: read one explainer, try one small exercise, or ask someone one question. Afterwards, note what held your interest.',
      sessions: '1–2 sessions of about an hour',
      questions: ['What would you like to learn or be able to do?', 'Is there something you already do or care about that this could connect to?', 'Would you want anyone else to see or use the result, or is it just for you?'],
    };
    p.notices.push({ code: 'small_first', message: 'Starting small is a way to find out whether you enjoy it before committing to anything larger. Nothing needs to be launched, founded or published.' });
    return makeResult(ctx, { status: 'needs_student_input', summary: p.status === 'declined' ? 'I can’t help with a made-up activity; here is a small real step to explore instead.' : 'A small first step to explore the interest, and what you want to learn.', payload: p, completionReason: p.status === 'declined' ? 'fabrication_declined' : 'exploration_offered' });
  }

  // ------------------------------------------------------------ plan (steps 1-5)

  private async plan(ctx: TaskContext, s: Scope<'plan'>) {
    const p = this.empty('plan', s.projectId);
    const view = await readView(ctx, 'local', { entityTypes: ['project', 'commitment', 'student'] });
    const status = view.value<string>('project', s.projectId, 'status');
    if ((status === 'stopped' || status === 'completed') && !s.reopen) {
      p.status = 'not_applicable';
      p.notices.push({ code: 'project_ended', message: 'You ended this project, so it will not be reopened unless you choose to.' });
      return makeResult(ctx, { status: 'completed', summary: 'This project has ended; no new plan was made.', payload: p, completionReason: 'project_ended' });
    }
    const prior = await this.storedPlan(ctx, s.projectId);
    p.tracking = s.tracking;
    p.brief = briefOut(s.brief);

    // Step 1-3: structure, context policy, safety and capacity.
    const issues = checkGraph(s.milestones, s.approvals);
    if (issues.length > 0) {
      p.status = 'rejected';
      p.graphIssues = issues;
      p.milestones = s.milestones.map((m) => outOf(m, null));
      return makeResult(ctx, { status: 'needs_student_input', summary: `The milestones can’t be scheduled: ${issues.map((i) => i.message).join(' ')}`, payload: p, completionReason: 'dependency_graph_invalid' });
    }
    p.contextPolicy = await this.contextPolicy(ctx, s.brief);
    const areas = safetyAreas(`${s.brief.description} ${s.milestones.map((m) => `${m.action} ${m.purpose}`).join(' ')}`, s.safetyAreas);
    const milestones: Milestone[] = s.milestones.map((m) => ({ ...m, needsSupervision: m.needsSupervision || safetyAreas(`${m.action} ${m.purpose}`).length > 0 }));
    if (areas.length > 0) {
      p.supervision = { required: true, areas, whoToAsk: WHO_TO_ASK, safeAlternatives: [...SAFE_ALTERNATIVES] };
      p.notices.push({ code: 'supervision_needed', message: `Work involving ${areas.map((a) => a.replace(/_/g, ' ')).join(', ')} needs a responsible adult or review before it starts. Ask ${WHO_TO_ASK}; the plan keeps that work waiting until it is in place.` });
      if (!milestones.some((m) => m.needsSupervision)) p.questions.push({ code: 'which_supervised', question: `Which milestones involve ${areas.map((a) => a.replace(/_/g, ' ')).join(' or ')}? Those will wait for supervision.` });
    }
    const cap = this.capacity(view, s.weeklyHours);
    if (cap.trial) {
      p.notices.push({ code: 'trial_period', message: 'You haven’t said how much time you have each week, so the plan starts with a two-week trial at about 1–2 hours a week. Adjust it after you see how it goes.' });
      p.questions.push({ code: 'weekly_hours', question: 'Which evenings or days are already full, and roughly how many hours a week could you give this?' });
    }
    const reserve = s.reservePerWeek ?? defaultReserve(cap.base);
    const weeks = cap.trial ? Math.min(2, s.weeks) : s.weeks;
    // A re-plan keeps the capacity changes already known unless new ones are given, and weeks already past hold no new work.
    const capacityChanges = s.capacityChanges.length > 0 ? s.capacityChanges : prior?.plan.capacityChanges ?? [];
    const today = ctx.clock.nowIso().slice(0, 10) as CalendarDate;
    const current = s.startDate ? Math.max(1, Math.floor(diffDays(s.startDate, today) / 7) + 1) : 1;
    const past = (w: ReturnType<typeof capacityWindow>) => w.map((c) => (c.week < current ? { ...c, low: 0, high: 0, reason: 'already past' } : c));
    const window = past(capacityWindow(weeks, cap.base, capacityChanges));
    const done = new Set(prior?.plan.done ?? []);
    const approvals = s.approvals;
    const run = (choice: 'full' | 'smallest', w = window) => schedule({ milestones, capacity: past(w), reservePerWeek: reserve, approvals, done, include: (m) => choice === 'full' || !m.optional, startDate: s.startDate });
    const chosen = run(s.scopeChoice);
    this.fillSchedule(p, milestones, chosen, cap, reserve);

    // Scope versions keep why the scope changed.
    const versions = [...(prior?.plan.scopeVersions ?? [])];
    const last = versions.at(-1);
    if (!last || last.smallestResult !== s.brief.smallestResult || last.extension !== s.brief.extension || last.choice !== s.scopeChoice) versions.push({ version: versions.length + 1, smallestResult: s.brief.smallestResult, extension: s.brief.extension, choice: s.scopeChoice, reason: s.scopeChangeReason ?? (last ? 'changed by you' : null) });
    p.scopeVersions = versions;

    // When it does not fit, offer a proportionate scope, never more hours or shorter estimates (10T02, 10T03).
    if (!chosen.fits) this.scopeOptions(p, s.scopeChoice, run, cap, weeks, capacityChanges, chosen);
    p.approvals = approvals.map((a) => ({ id: a.id, authority: a.authority, status: a.status, permittedScope: a.permittedScope, blocks: p.milestones.filter((m) => m.state === 'blocked' && m.needsApproval === a.id).map((m) => m.id) }));
    for (const a of p.approvals.filter((x) => x.blocks.length > 0)) p.notices.push({ code: 'waiting_for_approval', message: `${a.blocks.join(', ')} ${a.blocks.length === 1 ? 'waits' : 'wait'} for ${a.authority}. That is a dependency, not something you did wrong; the other work can continue.` });
    p.publicRelease = publicRelease(s.brief, approvals);
    if (prior) p.affected = affectedMilestones(prior.plan.schedule, chosen.milestones);

    // Step 5: approval by the student, only for a plan that fits.
    const approve = s.approve && ctx.request.actor.kind === 'student' && chosen.fits;
    if (s.approve && !chosen.fits) p.notices.push({ code: 'cannot_approve', message: 'This version does not fit your time, so it cannot be approved yet. Choose one of the options first.' });
    p.status = approve ? 'approved' : chosen.fits ? 'proposed' : 'needs_review';
    p.version = (prior?.plan.version ?? 0) + 1;
    p.reminders = p.status === 'approved' ? 'on' : 'off';
    const stored: StoredPlan = { version: p.version, status: p.status, projectId: s.projectId, brief: s.brief, weeks, startDate: s.startDate, base: cap.base, trial: cap.trial, reservePerWeek: reserve, capacityChanges, milestones, approvals, safety: areas, scopeChoice: s.scopeChoice, scopeVersions: versions, tracking: s.tracking, done: [...done], overruns: prior?.plan.overruns ?? {}, schedule: chosen.milestones.map((m) => ({ id: m.id, state: m.state, finishWeek: m.finishWeek })), approved: approve };
    let recordVersion = view.recordVersion;
    if (approve) {
      const ev = [conversationEvidence('conv_project', `approve_${s.projectId}_${p.version}`, `approved plan ${p.version}: ${s.brief.goal}`, 'text', false)];
      const claims = [
        buildClaim({ entity: 'project', entityId: s.projectId, attribute: 'definition', value: { title: s.brief.title, goal: s.brief.goal, audience: s.brief.audience, context: s.brief.context, contextRef: s.brief.contextRef ? `${s.brief.contextRef.kind}:${s.brief.contextRef.ref}:${s.brief.contextRef.cycle}` : null }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: ev, actor: ctx.request.actor, viaRole: '10' }),
        buildClaim({ entity: 'project', entityId: s.projectId, attribute: 'status', value: 'active', origin: 'student_statement', confirmation: 'student_confirmed', evidence: ev, actor: ctx.request.actor, viaRole: '10' }),
      ];
      const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `approve_${s.projectId}_${p.version}`), operation: 'add_claims', claims, expectedRecordVersion: view.recordVersion, reason: `project_plan_approved:${s.projectId}` } });
      if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', 'The approval could not be recorded.', `record_${res.outcome}`);
      recordVersion = res.recordVersion ?? recordVersion;
    }
    await this.save(ctx, s.projectId, stored, recordVersion, p.contextPolicy);
    if (!approve && chosen.fits) p.questions.push({ code: 'fits_your_week', question: 'Does this fit your week? If it does, you can approve it; if not, change the hours or the scope.' });
    return makeResult(ctx, {
      status: p.status === 'approved' ? 'completed' : 'needs_student_input',
      summary: `Project plan version ${p.version}: ${p.status === 'needs_review' ? 'it does not fit the time you have, so a smaller version or a longer timeline is offered' : p.nextAction ? `next, ${p.nextAction.action}` : 'no work can start yet'}.`,
      payload: p,
      recordVersion,
      sourceRefs: p.contextPolicy.map((c) => c.sourceId).filter((x): x is string => x !== null),
      completionReason: p.status === 'approved' ? 'plan_approved' : 'plan_proposed',
    });
  }

  private capacity(view: RecordView, given: HoursRange | null): { base: HoursRange; trial: boolean; protectedCommitments: string[] } {
    const stated = view.studentValue<{ min: number; max: number }>('constraints.weekly_hours_available');
    const protectedCommitments = view.entityIds('commitment').map((id) => view.value<{ label: string }>('commitment', id, 'definition')?.label).filter((x): x is string => !!x);
    if (given) return { base: given, trial: false, protectedCommitments };
    if (stated) return { base: { low: stated.min, high: stated.max }, trial: false, protectedCommitments };
    return { base: { low: 1, high: 2 }, trial: true, protectedCommitments };
  }

  private fillSchedule(p: ProjectPayload, milestones: readonly Milestone[], sch: Schedule, cap: { base: HoursRange; trial: boolean; protectedCommitments: string[] }, reserve: number): void {
    p.milestones = milestones.map((m) => outOf(m, sch.milestones.find((x) => x.id === m.id) ?? null));
    p.fits = sch.fits;
    p.requiredHours = sch.requiredHours;
    p.capacity = { base: cap.base, reservePerWeek: reserve, trial: cap.trial, weeks: sch.load.map((l) => ({ week: l.week, capacityLow: l.capacityLow, usable: l.usable, placed: l.placed, reason: l.reason })), protectedCommitments: cap.protectedCommitments };
    const next = p.milestones.filter((m) => m.state === 'scheduled' && m.startWeek !== null).sort((a, b) => a.startWeek! - b.startWeek!)[0];
    p.nextAction = next ? { milestoneId: next.id, action: next.action, effort: next.effort, week: next.startWeek!, question: `This usually takes ${fmt(next.effort)}. Does that fit your week?` } : null;
    for (const m of p.milestones.filter((x) => x.late)) p.notices.push({ code: 'past_due', message: `${m.id} is planned to finish after its date (${m.due}). The effort estimate is kept as it is; the options are to change the scope or the date.` });
  }

  private scopeOptions(p: ProjectPayload, choice: 'full' | 'smallest', run: (c: 'full' | 'smallest', w?: ReturnType<typeof capacityWindow>) => Schedule, cap: { base: HoursRange }, weeks: number, changes: ReadonlyArray<z.infer<typeof CapacityChangeSchema>>, chosen: Schedule): void {
    if (choice === 'full') {
      const smaller = run('smallest');
      p.scopeOptions.push({ option: 'smaller_version', description: `Keep the smallest useful result and set the optional parts aside for now (${fmt(smaller.requiredHours)} instead of ${fmt(chosen.requiredHours)}).`, fits: smaller.fits, extraWeeks: null });
    }
    let extra: number | null = null;
    for (let add = 1; add <= 26 && weeks + add <= 52; add += 1) {
      if (run(choice, capacityWindow(weeks + add, cap.base, changes)).fits) {
        extra = add;
        break;
      }
    }
    p.scopeOptions.push({ option: 'extend_timeline', description: extra !== null ? `Keep this scope and take ${extra} more week${extra === 1 ? '' : 's'} at your usual pace.` : 'A longer timeline alone would not fit this scope.', fits: extra !== null, extraWeeks: extra });
    p.scopeOptions.push({ option: 'keep_and_review_estimates', description: 'If you think some estimates are too high, change them yourself and the plan will be checked again. The plan will not shorten them or add hours for you.', fits: false, extraWeeks: null });
    p.notices.push({ code: 'does_not_fit', message: `The work needs about ${fmt(chosen.requiredHours)}, and the time you have in this window is about ${chosen.usableHours} hours after your reserve. The plan does not add hours or squeeze estimates; choose a smaller version or a longer timeline.` });
  }

  private async contextPolicy(ctx: TaskContext, brief: z.infer<typeof BriefSchema>): Promise<ProjectPayload['contextPolicy']> {
    if (brief.context === 'personal_learning' || !brief.contextRef) return [];
    const out: ProjectPayload['contextPolicy'] = [];
    for (const operation of ['research_plan_generation', 'review_student_text'] as const) {
      const d = await ctx.call<OperationDecision>('policy.check_operation', { operation, destinations: [brief.contextRef] });
      out.push({ operation, decision: d.decision, explanation: d.explanation, sourceId: d.perDestination[0]?.sourceId ?? null });
    }
    return out;
  }

  private async save(ctx: TaskContext, projectId: string, stored: StoredPlan, recordVersion: number, policy: ProjectPayload['contextPolicy']): Promise<void> {
    await ctx.call<DerivedArtifact>('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind: 'project_plan',
      scopeKey: `project_${projectId}`,
      payload: stored,
      inputClaimIds: [],
      inputFieldKeys: [`project:${projectId}.status`],
      sourceIds: policy.map((c) => c.sourceId).filter((x): x is string => x !== null),
      recordVersion,
    });
  }

  // ------------------------------------------------------------ check-in (step 6)

  private async checkIn(ctx: TaskContext, s: Scope<'check_in'>) {
    const p = this.empty('check_in', s.projectId);
    const view = await readView(ctx, 'local', { entityTypes: ['project', 'commitment', 'student'] });
    const status = view.value<string>('project', s.projectId, 'status');
    const prior = await this.storedPlan(ctx, s.projectId);
    if (!prior || status === 'stopped' || status === 'completed' || prior.plan.status === 'stopped' || prior.plan.status === 'closed') {
      p.status = 'not_applicable';
      p.notices.push({ code: prior ? 'project_ended' : 'no_plan', message: prior ? 'This project has ended, so there are no check-ins or reminders.' : 'There is no plan for this project yet.' });
      return makeResult(ctx, { status: 'completed', summary: prior ? 'This project has ended; nothing to check in on.' : 'No plan exists for this project yet.', payload: p, completionReason: prior ? 'project_ended' : 'no_plan' });
    }
    const plan = structuredClone(prior.plan);
    const tracking = s.tracking ?? plan.tracking;
    p.tracking = tracking;
    const known = new Set(plan.milestones.map((m) => m.id));
    const unknown = s.reports.filter((r) => !known.has(r.milestoneId)).map((r) => r.milestoneId);
    if (unknown.length > 0) p.notices.push({ code: 'unknown_milestone', message: `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the plan; nothing was recorded for ${unknown.length === 1 ? 'it' : 'them'}.` });

    // Estimates are refined only from what the student chooses to report; without tracking, statuses are enough (10T11).
    const overrunNow: string[] = [];
    for (const r of s.reports.filter((x) => known.has(x.milestoneId))) {
      const m = plan.milestones.find((x) => x.id === r.milestoneId)!;
      if (r.status === 'done') plan.done = [...new Set([...plan.done, m.id])];
      const hours = tracking === 'none' ? null : r.actualHours;
      const over = r.status === 'took_longer' || (hours !== null && hours.low > m.effort.high);
      if (over) {
        plan.overruns[m.id] = (plan.overruns[m.id] ?? 0) + 1;
        overrunNow.push(m.id);
      }
    }
    for (const a of s.approvals) {
      const x = plan.approvals.find((y) => y.id === a.id);
      if (x) x.status = a.status;
    }
    // A milestone that keeps overrunning is a question about the estimate or the scope (10T12).
    const repeated = Object.entries(plan.overruns).filter(([, n]) => n >= 2).map(([id]) => id);
    const review = [...new Set([...repeated, ...(overrunNow.length >= 2 ? overrunNow : [])])];
    if (review.length > 0) {
      p.estimateReview = {
        milestoneIds: review,
        questions: ['Was the estimate too small for this kind of task, or has the task grown since you planned it?', 'Is anything outside the task getting in the way, like a wait for someone else or missing materials?'],
        options: ['Change the estimate to what the work actually takes.', 'Make the milestone smaller or move part of it to the optional extension.', 'Take a longer timeline at your usual pace.'],
      };
      p.notices.push({ code: 'estimate_review', message: 'This has taken longer than planned more than once. That usually means the estimate or the scope needs changing; the plan will not assume you should work more hours.' });
    }

    // Replan only what changed: completed work stays; capacity changes apply to the weeks named (10T03).
    const changes = [...plan.capacityChanges, ...s.capacityChanges];
    const today = ctx.clock.nowIso().slice(0, 10) as CalendarDate;
    const current = s.currentWeek ?? (plan.startDate ? Math.max(1, Math.floor(diffDays(plan.startDate, today) / 7) + 1) : 1);
    const past = (w: ReturnType<typeof capacityWindow>) => w.map((c) => (c.week < current ? { ...c, low: 0, high: 0, reason: 'already past' } : c));
    const window = past(capacityWindow(plan.weeks, plan.base, changes));
    const run = (choice: 'full' | 'smallest', w = window) => schedule({ milestones: plan.milestones, capacity: w, reservePerWeek: plan.reservePerWeek, approvals: plan.approvals, done: new Set(plan.done), include: (m) => choice === 'full' || !m.optional, startDate: plan.startDate });
    const chosen = run(plan.scopeChoice);
    const cap = { base: plan.base, trial: plan.trial, protectedCommitments: this.capacity(view, plan.base).protectedCommitments };
    this.fillSchedule(p, plan.milestones, chosen, cap, plan.reservePerWeek);
    p.affected = affectedMilestones(plan.schedule, chosen.milestones).filter((id) => !plan.done.includes(id));
    if (!chosen.fits) this.scopeOptions(p, plan.scopeChoice, (c, w) => run(c, w ? past(w) : window), plan, plan.weeks, changes, chosen);
    p.scopeVersions = plan.scopeVersions;
    p.brief = briefOut(plan.brief);
    p.approvals = plan.approvals.map((a) => ({ id: a.id, authority: a.authority, status: a.status, permittedScope: a.permittedScope, blocks: p.milestones.filter((m) => m.state === 'blocked' && m.needsApproval === a.id).map((m) => m.id) }));
    p.publicRelease = publicRelease(plan.brief, plan.approvals);
    if (s.capacityChanges.length > 0 && p.affected.length > 0) p.notices.push({ code: 'replanned', message: `Your time changed, so these milestones moved: ${p.affected.join(', ')}. Completed work is kept, and no estimate was shortened.` });

    // The student's note goes to the notebook first; if that fails, nothing changes and the update can be retried (10T18).
    const update = { reports: s.reports, capacityChanges: s.capacityChanges, approvals: s.approvals, tracking: s.tracking, note: s.note };
    if (s.note) {
      try {
        await ctx.call<NotebookView>('projects.notebook', { op: 'add', projectId: s.projectId, kind: 'check_in', text: s.note, url: null });
      } catch {
        const q = this.empty('check_in', s.projectId);
        q.status = 'updated';
        q.version = prior.plan.version;
        q.tracking = plan.tracking;
        q.pendingUpdate = update;
        q.notices.push({ code: 'saved_nothing_yet', message: 'The notebook could not be reached, so this check-in has not been saved and your plan is unchanged. Your update is kept here to try again; you can also keep a plain text note in the meantime.' });
        return makeResult(ctx, { status: 'partial', summary: 'The check-in could not be saved yet; your plan is unchanged and the update can be retried.', payload: q, completionReason: 'notebook_unavailable' });
      }
    }
    plan.version += 1;
    plan.tracking = tracking;
    plan.capacityChanges = changes;
    plan.schedule = chosen.milestones.map((m) => ({ id: m.id, state: m.state, finishWeek: m.finishWeek }));
    plan.status = chosen.fits ? (plan.approved ? 'approved' : 'proposed') : 'needs_review';
    p.status = plan.status;
    p.version = plan.version;
    p.reminders = plan.status === 'approved' ? 'on' : 'off';
    await this.save(ctx, s.projectId, plan, view.recordVersion, []);
    const status2 = p.estimateReview || !chosen.fits ? 'needs_student_input' : 'completed';
    return makeResult(ctx, { status: status2, summary: `Check-in recorded (plan version ${p.version})${p.affected.length > 0 ? `; ${p.affected.length} milestone${p.affected.length === 1 ? '' : 's'} moved` : ''}.`, payload: p, recordVersion: view.recordVersion, completionReason: 'check_in_recorded' });
  }

  // ------------------------------------------------------------ assistance gate (10T09)

  private async assist(ctx: TaskContext, s: Scope<'assist'>) {
    const p = this.empty('assist', s.projectId);
    let destination = s.destination;
    if (!destination && s.projectId) destination = (await this.storedPlan(ctx, s.projectId))?.plan.brief.contextRef ?? null;
    const d = await ctx.call<OperationDecision>('policy.check_operation', { operation: s.operation, destinations: destination ? [destination] : [] });
    const sources = d.perDestination.map((x) => x.sourceId).filter((x): x is string => x !== null);
    const alternatives =
      d.decision === 'allowed'
        ? []
        : s.operation === 'research_plan_generation'
          ? ['I can explain what the rules say a research plan must contain and who reviews it.', 'I can ask you questions while you write your own plan, such as what you want to find out and how you would know.', 'I can check your own draft against the required sections without writing any of it.']
          : ['I can explain the process and the rules.', 'I can ask questions while you do the work yourself.'];
    p.status = d.decision === 'allowed' ? 'updated' : 'declined';
    p.assist = { operation: s.operation, decision: d.decision, explanation: d.explanation, sources, alternatives };
    if (d.decision === 'unclear') p.questions.push({ code: 'ask_organizer', question: `The rules for ${destination?.ref ?? 'this context'} don’t settle this. Your teacher or the organizer can say whether it’s allowed.` });
    return makeResult(ctx, { status: d.decision === 'allowed' ? 'completed' : 'needs_student_input', summary: d.decision === 'allowed' ? 'That kind of help is allowed here.' : d.decision === 'prohibited' ? 'That kind of help isn’t permitted here; other help is.' : 'That kind of help isn’t confirmed for this context yet.', payload: p, sourceRefs: sources, completionReason: `assistance_${d.decision}` });
  }

  // ------------------------------------------------------------ evidence notebook (10T14)

  private async addEvidence(ctx: TaskContext, s: Scope<'add_evidence'>) {
    const p = this.empty('add_evidence', s.projectId);
    let entry: NotebookView;
    try {
      entry = await ctx.call<NotebookView>('projects.notebook', { op: 'add', projectId: s.projectId, kind: s.kind, text: s.text, url: s.url });
    } catch {
      p.pendingUpdate = { kind: s.kind, url: s.url };
      p.notices.push({ code: 'saved_nothing_yet', message: 'The notebook could not be reached, so the entry was not saved. Try again later.' });
      return makeResult(ctx, { status: 'partial', summary: 'The notebook entry could not be saved yet.', payload: p, completionReason: 'notebook_unavailable' });
    }
    p.notebook = { entryId: entry.entryId, access: entry.access, privateKinds: entry.privateKinds, redactionProposal: entry.redactionProposal, minimalEvidence: entry.access === 'restricted' ? MINIMAL_EVIDENCE_NOTE : null };
    if (entry.access === 'restricted') {
      p.notices.push({ code: 'private_details_restricted', message: `This entry includes other people’s private details (${entry.privateKinds.map((k) => k.replace(/_/g, ' ')).join(', ')}). It has been restricted so no one else, including this app’s helpers, can see it. You can replace it with the redacted version or a short note instead.` });
      p.questions.push({ code: 'redact', question: 'Would you like to replace the entry with the redacted version, or keep a short note instead?' });
    }
    return makeResult(ctx, { status: entry.access === 'restricted' ? 'needs_student_input' : 'completed', summary: entry.access === 'restricted' ? 'Saved and restricted, because it contains other people’s private details.' : 'Added to your project notebook.', payload: p, completionReason: 'evidence_added' });
  }

  // ------------------------------------------------------------ close (step 7, 10T07, 10T08, 10T13, 10T15, 10T17)

  private async close(ctx: TaskContext, s: Scope<'close'>) {
    const p = this.empty('close', s.projectId);
    const view = await readView(ctx, 'local', { entityTypes: ['project', 'story_use'] });
    const prior = await this.storedPlan(ctx, s.projectId);
    const releaseAllowed = prior ? publicRelease(prior.plan.brief, prior.plan.approvals) === 'permitted' : false;
    const completion = this.completion(p, s, releaseAllowed, prior?.plan ?? null);
    p.completionProposal = completion;
    p.status = s.outcome === 'completed' ? 'closed' : s.outcome;
    p.reminders = 'off';
    const confirmed = s.confirmedByStudent && ctx.request.actor.kind === 'student';
    if (!confirmed) {
      p.questions.push({ code: 'confirm_summary', question: 'Is this an accurate record of what exists and what you did? Correct anything before it is saved.' });
      return makeResult(ctx, { status: 'needs_student_input', summary: 'Here is the summary to check before it is saved.', payload: p, completionReason: 'confirmation_needed' });
    }
    const ev = [conversationEvidence('conv_project', `close_${s.projectId}`, `${s.outcome}: ${s.reason ?? 'no reason given'}`.slice(0, 200), 'text', false)];
    const claims = [
      buildClaim({ entity: 'project', entityId: s.projectId, attribute: 'status', value: s.outcome, origin: 'student_statement', confirmation: 'student_confirmed', evidence: ev, actor: ctx.request.actor, viaRole: '10' }),
      buildClaim({ entity: 'project', entityId: s.projectId, attribute: 'completion', value: completion, origin: 'student_statement', confirmation: 'student_confirmed', evidence: ev, actor: ctx.request.actor, viaRole: '10' }),
    ];
    if (s.contributions.length > 0) claims.push(buildClaim({ entity: 'project', entityId: s.projectId, attribute: 'contribution_log', value: { items: s.contributions }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: ev, actor: ctx.request.actor, viaRole: '10' }));
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `close_${s.projectId}`), operation: 'add_claims', claims, expectedRecordVersion: view.recordVersion, reason: `project_${s.outcome}:${s.projectId}` } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', `The summary could not be saved: ${res.reasons.slice(0, 2).join('; ')}`, `record_${res.outcome}`);
    if (prior) {
      const plan = structuredClone(prior.plan);
      plan.version += 1;
      plan.status = s.outcome === 'completed' ? 'closed' : s.outcome;
      plan.approved = false;
      await this.save(ctx, s.projectId, plan, res.recordVersion ?? view.recordVersion, []);
      p.version = plan.version;
    }
    if (s.outcome !== 'paused') p.notices.push({ code: 'reminders_stopped', message: 'Reminders for this project have stopped. It will not be reopened unless you choose to.' });
    // A reflection reaches writing help only with the student's permission (10T17).
    const permission = view.value<{ sourceRef: string; state: string }>('story_use', s.projectId, 'permission');
    const handoffs: Handoff[] = [];
    if (s.reflection) {
      if (permission?.state === 'possible_writing_material') handoffs.push({ toRole: '17', reason: 'The student allowed this project to be used as possible writing material.', requestedOutcome: 'Offer, when the student asks, to talk about the experience; nothing is written for them.', inputRefs: [`project:${s.projectId}`], unresolved: [], completionCondition: 'The student decides whether to explore it.' });
      else p.notices.push({ code: 'reflection_private', message: 'Your reflection stays with the project. It is not shared with writing help unless you choose to allow that.' });
      try {
        await ctx.call<NotebookView>('projects.notebook', { op: 'add', projectId: s.projectId, kind: 'explanation', text: s.reflection, url: null });
      } catch {
        p.notices.push({ code: 'reflection_not_saved', message: 'The notebook could not be reached, so the reflection was not saved there yet; the summary itself is saved.' });
      }
    }
    return makeResult(ctx, { status: p.questions.length > 0 ? 'needs_student_input' : 'completed', summary: `Project ${s.outcome === 'completed' ? 'completed' : s.outcome}; the record shows what exists and what is unfinished.`, payload: p, recordVersion: res.recordVersion ?? view.recordVersion, handoffs, completionReason: `project_${s.outcome}` });
  }

  private completion(p: ProjectPayload, s: Pick<Scope<'close'>, 'outputs' | 'contributions' | 'measures' | 'unfinished' | 'learned'>, releaseAllowed: boolean, plan: StoredPlan | null): ProjectCompletion {
    const outputs = s.outputs.map((o) => {
      const r = supportedOutputState(o.state, o.evidence, releaseAllowed);
      if (r.reason) p.notices.push({ code: 'output_state_kept', message: `${o.description}: ${r.reason}` });
      return { description: o.description, state: r.state };
    });
    // Contributions stay with whoever made them; shared work is not individual credit (10T07).
    const studentContribution = s.contributions.filter((c) => c.by === 'student').map((c) => c.description);
    const teamContribution = s.contributions.filter((c) => c.by === 'team').map((c) => c.description);
    const otherContributions = s.contributions.filter((c) => c.by !== 'student' && c.by !== 'team').map((c) => ({ by: c.by, description: c.description }));
    if (teamContribution.length > 0 || otherContributions.length > 0) {
      const repoOnly = s.contributions.filter((c) => c.by === 'student').every((c) => !c.evidence || /\b(shared )?(repo|repository|drive|folder)\b/i.test(c.evidence));
      if (repoOnly) p.questions.push({ code: 'explain_decisions', question: 'A shared repository shows the work exists but not who did which part. Could you describe a decision you made yourself and why?' });
    }
    const measures = s.measures.map((m) => {
      const c = checkMeasure(m.measure, m.statedAs);
      if (c.question) p.questions.push({ code: `measure_${m.measure.kind}`, question: c.question });
      if (c.note) p.notices.push({ code: 'measure_kept', message: c.note });
      return c.measure;
    });
    const planned = plan ? plan.milestones.filter((m) => !plan.done.includes(m.id) && !m.optional).map((m) => m.action) : [];
    const unfinished = [...new Set([...s.unfinished, ...planned])].slice(0, 20);
    return { outputs, studentContribution, teamContribution, otherContributions, measures, unfinished, learned: s.learned };
  }

  // ------------------------------------------------------------ correction (10T16)

  private async correct(ctx: TaskContext, s: Scope<'correct_completion'>) {
    const p = this.empty('correct_completion', s.projectId);
    if (ctx.request.actor.kind !== 'student') return failedResult(ctx, 'blocked', 'Only the student can correct their project record.', 'student_only');
    const view = await readView(ctx, 'local', { entityTypes: ['project'] });
    const current = view.value<ProjectCompletion>('project', s.projectId, 'completion');
    if (!current) return failedResult(ctx, 'failed', 'There is no saved summary to correct yet.', 'no_completion');
    const prior = await this.storedPlan(ctx, s.projectId);
    const releaseAllowed = prior ? publicRelease(prior.plan.brief, prior.plan.approvals) === 'permitted' : false;
    const next: ProjectCompletion = structuredClone(current);
    if (s.outputs) next.outputs = s.outputs.map((o) => {
      const r = supportedOutputState(o.state, o.evidence, releaseAllowed);
      if (r.reason) p.notices.push({ code: 'output_state_kept', message: `${o.description}: ${r.reason}` });
      return { description: o.description, state: r.state };
    });
    if (s.studentContribution) next.studentContribution = s.studentContribution;
    if (s.teamContribution) next.teamContribution = s.teamContribution;
    if (s.unfinished) next.unfinished = s.unfinished;
    if (s.learned !== undefined) next.learned = s.learned;
    for (const k of ['outputs', 'studentContribution', 'teamContribution', 'unfinished', 'learned'] as const) if (JSON.stringify(current[k]) !== JSON.stringify(next[k])) p.completionChanges.push(k);
    if (p.completionChanges.length === 0) {
      p.notices.push({ code: 'no_change', message: 'That matches what is already saved.' });
      p.completionProposal = current;
      return makeResult(ctx, { status: 'completed', summary: 'Nothing to change.', payload: p, completionReason: 'no_change' });
    }
    const claim = buildClaim({ entity: 'project', entityId: s.projectId, attribute: 'completion', value: next, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [conversationEvidence('conv_project', `correct_${s.projectId}`, s.note, 'text', false)], actor: ctx.request.actor, viaRole: '10' });
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `correct_${s.projectId}`), operation: 'add_claims', claims: [claim], expectedRecordVersion: view.recordVersion, reason: `student_correction:${s.projectId}` } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', 'The correction could not be saved.', `record_${res.outcome}`);
    p.completionProposal = next;
    p.notices.push({ code: 'correction_saved', message: 'Your correction is saved as a new version; the earlier version is kept in the history.' });
    return makeResult(ctx, { status: 'completed', summary: `Corrected: ${p.completionChanges.join(', ')}.`, payload: p, recordVersion: res.recordVersion ?? view.recordVersion, completionReason: 'completion_corrected' });
  }
}

// ---------------------------------------------------------------- helpers

function fmt(r: HoursRange): string {
  return r.low === r.high ? `${r.low} hours` : `${r.low}–${r.high} hours`;
}

function briefOut(b: z.infer<typeof BriefSchema>): NonNullable<ProjectPayload['brief']> {
  return { title: b.title, goal: b.goal, audience: b.audience, context: b.context, contextRef: b.contextRef ? `${b.contextRef.kind}:${b.contextRef.ref}:${b.contextRef.cycle}` : null, learningQuestion: b.learningQuestion, smallestResult: b.smallestResult, extension: b.extension };
}

function publicRelease(b: z.infer<typeof BriefSchema>, approvals: readonly Approval[]): ProjectPayload['publicRelease'] {
  if (!b.publicRelease.wanted) return 'not_planned';
  const a = b.publicRelease.approvalId ? approvals.find((x) => x.id === b.publicRelease.approvalId) : undefined;
  return a && (a.status === 'granted' || a.status === 'not_needed') ? 'permitted' : 'awaiting_permission';
}

function outOf(m: Milestone, sm: ScheduledMilestone | null): MilestoneOut {
  return {
    id: m.id,
    purpose: m.purpose,
    action: m.action,
    effort: { low: m.effort.low, high: m.effort.high },
    dependsOn: m.dependsOn,
    evidence: m.evidence,
    optional: m.optional,
    waitWeeks: m.waitWeeks,
    needsApproval: m.needsApproval,
    needsSupervision: m.needsSupervision,
    due: m.due,
    state: sm?.state ?? 'does_not_fit',
    weeks: sm?.weeks ?? [],
    startWeek: sm?.startWeek ?? null,
    finishWeek: sm?.finishWeek ?? null,
    availableFromWeek: sm?.availableFromWeek ?? null,
    blockedBy: sm?.blockedBy ?? [],
    late: sm?.late ?? false,
  };
}
