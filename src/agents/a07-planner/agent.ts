import { z } from 'zod';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { isAbsence } from '../../shared/absence.js';
import { TestFamilySchema, type TestFamily } from '../../shared/assessments.js';
import type { ExternalActionProposal, Handoff, ResultStatus, Uncertainty } from '../../shared/envelopes.js';
import { AccessDeniedError } from '../../shared/errors.js';
import type { Budget } from '../../shared/money.js';
import { formatMoney } from '../../shared/money.js';
import { EligibilityScopeSchema, scopeKey, type EligibilityScope } from '../../shared/scope.js';
import { addDays, calendarDateInZone } from '../../shared/time.js';
import type { DerivedArtifact } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import type { EligibilityPayload } from '../a06-eligibility/agent.js';
import type { RuleLookup } from '../a06-eligibility/registry.js';
import { packageVersionRef } from '../a06-eligibility/rules.js';
import { failedResult, makeResult, readView, type SpecialistAgent } from '../common/specialist.js';
import type { CalendarQueryResult } from './calendars.js';
import { courseNeedsFrom, planCourses, readCourses, type CourseNeed, type CoursePlan } from './courses.js';
import { buildMilestones, contingencies, fitWorkload, type Contingency, type Milestone, type Workload } from './plan.js';
import { decideTests, organizationOf, policyMatrix, prepPlan, readAccommodation, readScores, selectAttempts, type AttemptSelection, type PolicyRow, type PrepPlan, type TestingDecision } from './testing.js';

/**
 * Agent 07 — Academic and testing planner.
 *
 * Turns verified requirements, the student's goals and real constraints into a
 * feasible course and testing plan with dependencies, costs and alternatives.
 * It never enrolls, registers, pays, promises a score gain or predicts
 * admission; registration is only ever proposed for explicit approval.
 */

const PurposeSchema = z.enum(['admission', 'scholarship', 'placement', 'credit', 'language_proficiency']);
const TargetSchema = z.object({ eligibility: EligibilityScopeSchema, purposes: z.array(PurposeSchema).min(1).default(['admission']) }).strict();

// 07R01: the request states the objective (targets, purposes, selected tests, terms); constraints come from the record.
const PlanRequestSchema = z
  .object({
    targets: z.array(TargetSchema).min(1).max(8),
    studentSelectedTests: z.array(TestFamilySchema).max(6).default([]),
    /** The school's terms in order, e.g. ["2026 Autumn", "2027 Spring"]. */
    terms: z.array(z.string().min(1)).max(12).default([]),
    completedMilestones: z.array(z.string().min(1)).max(200).default([]),
    timezone: z.string().optional(),
    /** The student's own question, e.g. asking for a guaranteed score increase. */
    question: z.string().max(400).optional(),
  })
  .strict();
type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const PlannerScopeSchema = z.discriminatedUnion('action', [
  PlanRequestSchema.extend({ action: z.literal('plan') }).strict(),
  z
    .object({
      action: z.literal('replan'),
      previousPlanId: z.string().min(1),
      cause: z.object({ kind: z.enum(['test_administration_cancelled', 'course_cancelled', 'policy_changed', 'time_budget_changed', 'score_received', 'accommodation_decided', 'goal_changed']), ref: z.string().optional() }).strict(),
      completedMilestones: z.array(z.string().min(1)).max(200).default([]),
    })
    .strict(),
  z.object({ action: z.literal('request_registration'), planId: z.string().min(1), administrationId: z.string().min(1) }).strict(),
]);
export type PlannerScope = z.infer<typeof PlannerScopeSchema>;

const MilestoneSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    owner: z.enum(['student', 'student_with_school_counselor', 'testing_organization', 'institution']),
    kind: z.enum(['official_deadline', 'official_date', 'planning_buffer', 'dependency', 'action', 'provisional_recheck']),
    reason: z.enum(['required_subject_route', 'required_prerequisite', 'required_test', 'student_selected', 'dependency']),
    earliestStart: z.string().nullable(),
    due: z.object({ date: z.string(), time: z.string().nullable(), timezone: z.string().nullable(), originalText: z.string().nullable() }).strict().nullable(),
    dependsOn: z.array(z.string()),
    effort: z.string().nullable(),
    completionEvidence: z.string(),
    status: z.enum(['proposed', 'completed']),
    sourceId: z.string().nullable(),
    branch: z.string(),
  })
  .strict();

const AttemptSchema = z.custom<NonNullable<AttemptSelection['primary']>>((v) => !!v && typeof v === 'object' && (v as { seatAvailability?: unknown }).seatAvailability === 'unknown');

export const PlanPayloadSchema = z
  .object({
    action: z.string(),
    planId: z.string().nullable(),
    targets: z.array(z.object({ scopeKey: z.string(), institution: z.string().nullable(), program: z.string().nullable(), cycle: z.string(), coverage: z.string(), findingOverall: z.string().nullable(), findingCurrent: z.boolean(), ruleVersion: z.string().nullable() }).strict()),
    coursePlan: z.custom<CoursePlan>((v) => !!v && typeof v === 'object' && Array.isArray((v as CoursePlan).items)),
    testingMatrix: z.array(z.custom<PolicyRow>()),
    testing: z.custom<TestingDecision>(),
    attempts: z.array(z.object({ family: TestFamilySchema, primary: AttemptSchema.nullable(), alternative: AttemptSchema.nullable(), others: z.number(), provisional: z.custom<AttemptSelection['provisional']>().nullable() }).strict()),
    prep: z.array(z.custom<PrepPlan>()),
    workload: z.custom<Workload>(),
    milestones: z.array(MilestoneSchema),
    contingencies: z.array(z.custom<Contingency>()),
    scores: z.array(z.object({ claimId: z.string(), family: z.string(), versionRef: z.string().nullable(), administrationDate: z.string().nullable(), description: z.string(), scaleNote: z.string() }).strict()),
    scoreNotes: z.array(z.string()),
    unresolved: z.array(z.string()),
    changes: z.object({ cause: z.string(), summary: z.array(z.string()), unchangedBranches: z.array(z.string()), preserved: z.array(z.string()) }).strict().nullable(),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    externalRegistrationsMade: z.literal(false),
    request: z.custom<PlanRequest>(),
  })
  .strict();
export type PlanPayload = z.infer<typeof PlanPayloadSchema>;

const GUARANTEE = /\b(guarantee[ds]?|will (definitely|certainly) (score|get|raise|increase)|certain to (score|improve))\b/i;
const NEGATED = /\b(no (plan|one) can guarantee|cannot guarantee|can'?t guarantee|not guaranteed|no guarantee)\b/i;

export const PLAN_CONTRACT: ContractDefinition<PlanPayload> = {
  id: 'academic_plan_v1',
  role: '07',
  payload: PlanPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    for (const s of p.attempts) {
      for (const a of [s.primary, s.alternative]) {
        if (!a) continue;
        if ((a.receipt.meets === 'no' || a.receipt.meets === 'uncertain') && (a.feasibility === 'feasible' || a.feasibility === 'feasible_with_dependencies')) issues.push(`${a.administrationId} is presented as feasible although score receipt is ${a.receipt.meets}`);
        if (a.registration.status === 'closed' && a.feasibility !== 'registration_closed') issues.push(`${a.administrationId} has a closed registration`);
      }
    }
    for (const m of p.milestones) {
      if (m.kind === 'planning_buffer' && (m.sourceId !== null || !/buffer/i.test(m.title))) issues.push(`milestone ${m.id} is a planning buffer and must be labelled as one`);
      if ((m.kind === 'official_deadline' || m.kind === 'official_date') && m.sourceId === null) issues.push(`official milestone ${m.id} has no source`);
    }
    for (const nn of p.testing.notNeeded) if (p.testing.needs.some((n) => n.family === nn.family && n.purposes.includes(nn.purpose))) issues.push(`${nn.family} is both not considered and planned for ${nn.purpose}`);
    for (const n of p.notices) if (GUARANTEE.test(n.message) && !NEGATED.test(n.message)) issues.push('a notice implies a guaranteed outcome');
    return issues;
  },
};

interface Loaded {
  targets: PlanPayload['targets'];
  needs: CourseNeed[];
  rows: PolicyRow[];
  ruleVersions: string[];
  unresolved: string[];
  handoffs: Handoff[];
}

export class AcademicPlannerAgent implements SpecialistAgent {
  readonly role = '07' as const;
  readonly contracts = [PLAN_CONTRACT];

  async handle(ctx: TaskContext) {
    const parsed = PlannerScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The planning request was incomplete.', 'invalid_scope');
    try {
      const s = parsed.data;
      if (s.action === 'plan') {
        const { action: _a, ...req } = s;
        return await this.plan(ctx, req, null);
      }
      if (s.action === 'replan') return await this.replan(ctx, s);
      return await this.requestRegistration(ctx, s);
    } catch (e) {
      if (e instanceof AccessDeniedError) return failedResult(ctx, 'blocked', 'That is not available with the current permissions.', e.code);
      throw e;
    }
  }

  private planView(ctx: TaskContext): Promise<RecordView> {
    return readView(ctx, 'local', { entityTypes: ['student', 'course', 'school_offering', 'test_attempt', 'accommodation', 'commitment'] });
  }

  // 07R02: planning uses Agent 06 findings with their rule versions; an unresolved or missing finding makes that branch conditional.
  private async loadTargets(ctx: TaskContext, req: PlanRequest, findings: readonly DerivedArtifact[]): Promise<Loaded> {
    const out: Loaded = { targets: [], needs: [], rows: [], ruleVersions: [], unresolved: [], handoffs: [] };
    for (const t of req.targets) {
      const scope = t.eligibility as EligibilityScope;
      const key = scopeKey(scope);
      const lookup = await ctx.call<RuleLookup>('rules.read_verified', { institutionRef: scope.institutionRef, programRef: scope.programRef, degreeLevel: scope.degreeLevel, entryCycle: scope.entryCycle, campusRef: scope.campusRef });
      const current = findings.find((f) => f.scopeKey === key && f.status === 'current');
      const finding = current ? (current.payload as EligibilityPayload) : null;
      if (lookup.status !== 'found') {
        const note = lookup.status === 'cycle_not_published' ? `Requirements for ${scope.programRef} (${scope.entryCycle}) are not published yet; planning for it stays provisional.` : lookup.status === 'not_reviewed' ? `The requirements for ${scope.programRef} have not been reviewed yet, so they are not used for planning.` : `There are no verified requirements for ${scope.programRef}; planning for it stays provisional.`;
        out.unresolved.push(note);
        out.targets.push({ scopeKey: key, institution: null, program: null, cycle: scope.entryCycle, coverage: lookup.status, findingOverall: finding?.overall ?? null, findingCurrent: !!current, ruleVersion: null });
        continue;
      }
      const ref = packageVersionRef(lookup.package);
      out.ruleVersions.push(ref);
      out.targets.push({ scopeKey: key, institution: lookup.package.institutionName, program: lookup.package.programName, cycle: lookup.package.entryCycle, coverage: 'supported', findingOverall: finding?.overall ?? null, findingCurrent: !!current, ruleVersion: ref });
      if (!current) {
        out.unresolved.push(`Eligibility for ${lookup.package.programName} has not been checked against your current record, so its course steps are conditional.`);
        out.handoffs.push({ toRole: '06', reason: 'The plan needs a current eligibility finding.', requestedOutcome: `Check requirements for ${lookup.package.programName} (${lookup.package.entryCycle}).`, inputRefs: [`scope:${key}`], unresolved: [], completionCondition: 'A current eligibility finding for this scope.' });
      } else if (finding && (finding.overall === 'unresolved' || finding.overall === 'conditionally_on_track')) {
        out.unresolved.push(...finding.findings.filter((f) => f.state === 'unknown' && f.resolution).map((f) => `${f.label}: ${f.resolution!.text}`));
      }
      out.needs.push(...courseNeedsFrom(lookup.package, finding, key));
      const category = typeof scope.applicantCategory === 'string' ? scope.applicantCategory : null;
      out.rows.push(...policyMatrix(lookup.package, ref, key, t.purposes, category));
    }
    return out;
  }

  private async plan(ctx: TaskContext, req: PlanRequest, previous: { artifact: DerivedArtifact; cause: string } | null) {
    const view = await this.planView(ctx);
    const tz = req.timezone ?? view.studentValue<string>('constraints.timezone') ?? 'UTC';
    const today = calendarDateInZone(ctx.clock.nowIso(), tz);
    const findings = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'eligibility_finding' });
    const loaded = await this.loadTargets(ctx, req, findings);
    const notices: PlanPayload['notices'] = [];

    // Courses.
    const { offerings, courses } = readCourses(view);
    const coursePlan = planCourses(loaded.needs, offerings, courses, req.terms);

    // Testing.
    const scores = readScores(view);
    const decision = decideTests(loaded.rows, scores, req.studentSelectedTests);
    const toPlan = decision.needs.filter((n) => n.existing.length === 0);
    const location = view.studentValue<{ country: string }>('constraints.location_broad');
    const country = location?.country ?? view.studentValue<string>('education.school_country') ?? null;
    // Each test is planned within its own window: its last accepted date or receipt deadline, else about a year.
    const windowFor = (n: (typeof toPlan)[number]) => n.latestTestDate ?? n.receiptDeadline ?? addDays(today, 365);
    let calendar: CalendarQueryResult = { administrations: [], coverage: [], sources: [] };
    if (toPlan.length > 0) calendar = await ctx.call<CalendarQueryResult>('calendars.read_verified', { families: toPlan.map((n) => n.family), country, from: today, to: addDays(today, 540) });
    const commitments = view.entityIds('commitment').flatMap((id) => {
      const v = view.value<{ label: string; weekly: Array<{ weekday: number }> }>('commitment', id, 'definition');
      return v ? [{ label: v.label, weekdays: [...new Set(v.weekly.map((w) => w.weekday))] }] : [];
    });
    const deviceAccess = view.studentValue<string>('constraints.device_access') ?? null;
    const selections: AttemptSelection[] = toPlan.map((n) => selectAttempts(n, calendar, { nowIso: ctx.clock.nowIso(), accommodation: readAccommodation(view, n.family), deviceAccess, commitments, country }, today, windowFor(n)));
    for (const s of selections) {
      if (!s.primary && !s.provisional) loaded.unresolved.push(`No listed ${s.family.replace(/_/g, ' ')} administration fits the deadlines and your commitments; this needs a decision with your counselor or the institution rather than an assumed date.`);
    }

    // Preparation, within the student's own time budget.
    const weekly = view.studentValue<{ min: number; max: number }>('constraints.weekly_hours_available') ?? null;
    const testBudget = view.current('student', 'self', 'constraints.test_budget');
    const paidAllowed = !!testBudget && (isAbsence(testBudget.value) ? (testBudget.value as { reason: string }).reason === 'not_applicable' : Number((testBudget.value as Budget).amount.amount) >= 100);
    const prep = selections.filter((s) => s.primary || s.provisional).map((s) => prepPlan(s.family, s.primary?.testDate ?? null, weekly, paidAllowed, today));
    const workload = fitWorkload(prep, toPlan, weekly);
    if (req.question && /\b(guarantee|guaranteed|promise|for sure|definitely)\b/i.test(req.question)) {
      notices.push({ code: 'no_guarantee', message: 'No plan can guarantee a score increase. This plan is built from steps you control, and it will be adjusted after each practice result.' });
    }
    if (!paidAllowed) notices.push({ code: 'free_resources', message: 'The plan uses free official materials and school support; paid tutoring is never required.' });

    const milestones = buildMilestones(coursePlan, selections, toPlan, prep, today, new Set(req.completedMilestones));
    const conts = contingencies(coursePlan, selections);
    const scoreOut = scores.map((s) => ({ claimId: s.claimId, family: s.record.family, versionRef: s.record.versionRef, administrationDate: s.record.administrationDate, description: s.description, scaleNote: s.scaleNote }));
    const scoreNotes: string[] = [];
    for (const fam of [...new Set(scores.map((s) => s.record.family))]) {
      const versions = [...new Set(scores.filter((s) => s.record.family === fam).map((s) => s.record.versionRef ?? 'unknown'))];
      if (versions.length > 1) scoreNotes.push(`Your ${fam.replace(/_/g, ' ')} results are on different formats or scales (${versions.join(', ')}). They are listed separately with their dates; no combined score is calculated, and each institution’s instructions decide how they are used.`);
    }
    for (const n of decision.needs.filter((x) => x.existing.length > 0)) scoreNotes.push(`You already have a ${n.family.replace(/_/g, ' ')} result on record. Whether it meets each program’s requirement is part of the eligibility check; a retake is only planned if you decide one is worthwhile.`);
    if (decision.needs.length === 0 && decision.notNeeded.length > 0) notices.push({ code: 'no_testing_needed', message: 'None of your targets requires a test for the purposes you chose, so no testing is planned. That time can go to your other priorities.' });

    const payload: PlanPayload = {
      action: previous ? 'replan' : 'plan',
      planId: null,
      targets: loaded.targets,
      coursePlan,
      testingMatrix: loaded.rows,
      testing: decision,
      attempts: selections,
      prep,
      workload,
      milestones,
      contingencies: conts,
      scores: scoreOut,
      scoreNotes,
      unresolved: [...loaded.unresolved, ...coursePlan.issues, ...decision.unresolved.map((u) => u.note)],
      changes: null,
      notices,
      externalRegistrationsMade: false,
      request: req,
    };
    if (previous) payload.changes = diffPlans(previous.artifact.payload as PlanPayload, payload, previous.cause);

    const sourceIds = [...new Set([...calendar.sources.map((s) => s.id), ...loaded.rows.map((r) => r.sourceId)])].filter((id) => ctx.servedSourceIds.has(id));
    const inputClaimIds = [...new Set([...offerings.map((o) => o.claimId), ...courses.flatMap((c) => c.claimIds), ...scores.map((s) => s.claimId)])].filter((id) => ctx.servedClaimIds.has(id));
    const artifact = await ctx.call<DerivedArtifact>('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind: 'academic_plan',
      scopeKey: `plan:${loaded.targets.map((t) => t.scopeKey).sort().join('+')}`,
      payload,
      inputClaimIds,
      inputFieldKeys: ['school_offering:*.course', 'course:*.level', 'course:*.enrollment_status', 'course:*.grade', 'test_attempt:*.record', 'accommodation:*.status', 'commitment:*.definition', 'student:self.constraints.weekly_hours_available', 'student:self.constraints.device_access', 'student:self.constraints.test_budget'],
      ruleVersions: loaded.ruleVersions,
      sourceIds,
      recordVersion: view.recordVersion,
    });
    payload.planId = artifact.id;

    const handoffs: Handoff[] = [...loaded.handoffs];
    if (coursePlan.items.some((i) => i.status === 'no_option_found') || selections.some((s) => !s.primary && !s.provisional)) {
      handoffs.push({ toRole: '34', reason: 'A required course or test has no workable option in the current data.', requestedOutcome: 'Help the student ask their school counselor or the institution the specific question below.', inputRefs: [`plan:${artifact.id}`], unresolved: payload.unresolved.slice(0, 5), completionCondition: 'The school or institution answers, or the student chooses a different route.' });
    }
    if (milestones.length > 0) handoffs.push({ toRole: '30', reason: 'Plan milestones are ready for the student to accept.', requestedOutcome: 'Add the milestones the student accepts to their timeline, keeping official deadlines and planning buffers distinct.', inputRefs: milestones.map((m) => `milestone:${artifact.id}:${m.id}`).slice(0, 40), unresolved: [], completionCondition: 'The student accepts or declines each milestone.' });

    const uncertainties: Uncertainty[] = [];
    for (const s of selections) if (s.primary) uncertainties.push({ affects: `attempt:${s.primary.administrationId}`, description: `A seat at a nearby center for the ${s.primary.testDate} ${s.family.replace(/_/g, ' ')} is not known until registration.`, resolution: 'Check availability when registering; the alternative date is listed.', consequence: 'changes_decision' });
    for (const s of selections) if (s.provisional) uncertainties.push({ affects: `calendar:${s.family}`, description: s.provisional.note, resolution: `Recheck the official calendar on ${s.provisional.recheckOn}.`, consequence: 'changes_decision' });
    for (const i of coursePlan.items.filter((x) => x.status === 'conditional' || x.status === 'no_option_found')) uncertainties.push({ affects: `course:${i.id}`, description: i.confirmationNeeded ?? `${i.need} is not confirmed.`, resolution: 'Ask your school counselor to confirm.', consequence: 'changes_decision' });

    const hasOpen = payload.unresolved.length > 0 || coursePlan.items.some((i) => i.status === 'conditional' || i.status === 'no_option_found') || selections.some((s) => s.provisional);
    const status: ResultStatus = hasOpen ? 'partial' : 'completed';
    const next = milestones.find((m) => m.status === 'proposed' && (m.kind === 'action' || m.kind === 'dependency' || m.kind === 'planning_buffer'));
    const summary = [
      previous ? `Plan updated after ${previous.cause.replace(/_/g, ' ')}.` : 'Plan ready.',
      toPlan.length > 0 ? `Testing: ${toPlan.map((n) => n.family.replace(/_/g, ' ')).join(', ')}.` : 'No new test is needed for the purposes you chose.',
      next ? `Next step: ${next.title}` : '',
      hasOpen ? 'Some parts are conditional until they are confirmed.' : '',
    ].filter(Boolean).join(' ');
    return makeResult(ctx, {
      status,
      summary,
      payload,
      claimIds: inputClaimIds,
      recordVersion: view.recordVersion,
      ruleVersions: loaded.ruleVersions,
      sourceRefs: sourceIds,
      uncertainties: uncertainties.slice(0, 20),
      handoffs,
      completionReason: previous ? 'replanned' : 'planned',
    });
  }

  private async replan(ctx: TaskContext, s: Extract<PlannerScope, { action: 'replan' }>) {
    const [prev] = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, artifactId: s.previousPlanId });
    if (!prev || prev.kind !== 'academic_plan') return failedResult(ctx, 'failed', 'That plan was not found.', 'unknown_plan');
    const old = prev.payload as PlanPayload;
    const completed = [...new Set([...old.milestones.filter((m) => m.status === 'completed').map((m) => m.id), ...s.completedMilestones])];
    return this.plan(ctx, { ...old.request, completedMilestones: completed }, { artifact: prev, cause: s.cause.kind });
  }

  private async requestRegistration(ctx: TaskContext, s: Extract<PlannerScope, { action: 'request_registration' }>) {
    const [artifact] = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, artifactId: s.planId });
    if (!artifact || artifact.kind !== 'academic_plan') return failedResult(ctx, 'failed', 'That plan was not found.', 'unknown_plan');
    if (artifact.status !== 'current') return failedResult(ctx, 'failed', 'That plan is out of date; please update it before registering.', 'plan_stale');
    const p = artifact.payload as PlanPayload;
    const a = p.attempts.flatMap((x) => [x.primary, x.alternative]).find((x) => x?.administrationId === s.administrationId);
    if (!a) return failedResult(ctx, 'failed', 'That test date is not in the plan.', 'unknown_administration');
    const fee = a.costs.find((c) => c.component === 'registration fee')?.amount;
    // Exact details for the student to approve; nothing is submitted by the app (07T16).
    const exactContent = [
      `Register for the ${a.family.replace(/_/g, ' ')} on ${a.testDate} (${a.format.replace(/_/g, ' ')}).`,
      `Registration deadline: ${a.registration.deadline.originalText}.`,
      fee ? `Registration fee: ${formatMoney(fee)}.` : 'Registration fee: see the testing organization.',
      `Accommodations: ${a.accommodation.status === 'none_recorded' ? 'none requested' : a.accommodation.status.replace(/_/g, ' ')}.`,
      'Seat availability is confirmed only during registration.',
    ].join('\n');
    const proposal = await ctx.call<ExternalActionProposal>('actions.propose', { kind: 'register_for_test', destination: organizationOf(a.family), exactContent, consequence: `A registration with ${organizationOf(a.family)} and a fee charge. Nothing happens unless you approve it; you can also register yourself on the official site.` });
    const payload: PlanPayload = { ...p, action: 'request_registration', notices: [{ code: 'registration_prepared', message: 'The registration details are ready for your approval. Nothing has been submitted or paid.' }], changes: null, externalRegistrationsMade: false };
    return makeResult(ctx, { status: 'needs_student_input', summary: 'Registration details prepared for your approval. Nothing has been submitted.', payload, externalActions: [proposal], completionReason: 'registration_proposed' });
  }
}

/** Explain what changed and which branches stayed the same (07R08, 07T14). */
function diffPlans(old: PlanPayload, now: PlanPayload, cause: string): NonNullable<PlanPayload['changes']> {
  const summary: string[] = [];
  const key = (r: PolicyRow) => `${r.targetKey}#${r.purpose}#${r.family}`;
  const oldRows = new Map(old.testingMatrix.map((r) => [key(r), r]));
  for (const r of now.testingMatrix) {
    const o = oldRows.get(key(r));
    if (o && o.policy !== r.policy) summary.push(`${r.institution}: ${r.family.replace(/_/g, ' ')} for ${r.purpose} changed from ${o.policy.replace(/_/g, ' ')} to ${r.policy.replace(/_/g, ' ')} (rule set ${o.packageRef} → ${r.packageRef}, source ${r.sourceId}).`);
  }
  const oldBranches = groupByBranch(old.milestones);
  const newBranches = groupByBranch(now.milestones);
  const unchanged: string[] = [];
  for (const [b, ids] of newBranches) {
    const prev = oldBranches.get(b);
    if (prev && prev.join('|') === ids.join('|')) unchanged.push(b);
  }
  for (const [b, ids] of oldBranches) {
    const cur = newBranches.get(b) ?? [];
    const removed = ids.filter((id) => !cur.includes(id) && !id.startsWith('prep_'));
    if (removed.length > 0) summary.push(`${b.replace(':', ' ')}: ${removed.length} step${removed.length === 1 ? '' : 's'} no longer apply (${cause.replace(/_/g, ' ')}).`);
  }
  for (const [b, ids] of newBranches) {
    const prev = oldBranches.get(b) ?? [];
    const added = ids.filter((id) => !prev.includes(id));
    if (added.length > 0 && prev.length > 0) summary.push(`${b.replace(':', ' ')}: ${added.length} new step${added.length === 1 ? '' : 's'}.`);
    if (prev.length === 0 && added.length > 0) summary.push(`${b.replace(':', ' ')}: new part of the plan.`);
  }
  const preserved = now.milestones.filter((m) => m.status === 'completed').map((m) => m.title);
  if (summary.length === 0) summary.push('Nothing in the plan needed to change.');
  return { cause, summary, unchangedBranches: unchanged, preserved };
}

function groupByBranch(ms: readonly Milestone[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const x of ms) m.set(x.branch, [...(m.get(x.branch) ?? []), x.id]);
  for (const [k, v] of m) m.set(k, [...v].sort());
  return m;
}

export type { TestFamily };
