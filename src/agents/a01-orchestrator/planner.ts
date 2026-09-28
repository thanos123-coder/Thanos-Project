import { z } from 'zod';
import type { TaskNodeState, TaskReason } from '../../runtime/task-graph.js';
import { TestFamilySchema } from '../../shared/assessments.js';
import type { RoleId } from '../../shared/envelopes.js';
import type { Purpose } from '../../shared/permissions.js';
import { EligibilityScopeSchema, scopeKey, type EligibilityScope } from '../../shared/scope.js';
import { isValidTimezone } from '../../shared/time.js';
import { CorrectionSchema } from '../a04-record-steward/agent.js';
import { ExperienceInputSchema } from '../a08-activities/types.js';
import { ROLE_PURPOSE } from './roles.js';
import type { Classification } from './intents.js';
import type { NodeRecord, Outcome } from './objectives.js';

/**
 * Building the bounded task graph (01R04, 01R05). Every specialist gets a
 * question, scoped inputs, an output contract and a stop condition; nodes run
 * in parallel only when neither depends on the other. A correction runs
 * before anything that could depend on the corrected fact (01R03), document
 * extraction before the eligibility check that uses it (01T02), and the
 * eligibility check before a confident academic plan.
 */

export const RequestContextSchema = z
  .object({
    /** Programs the student selected in the interface, with exact cycle and category. */
    targets: z.array(EligibilityScopeSchema).max(6).default([]),
    /** Documents the student just uploaded. */
    documentIds: z.array(z.string().min(1)).max(5).default([]),
    /** A correction made in the interface (e.g. editing an activity date). The current message is its evidence unless another turn is named. */
    correction: CorrectionSchema.partial({ quote: true, conversationId: true, turnId: true }).optional(),
    /** An activity entered in the form. */
    experience: ExperienceInputSchema.optional(),
    /** Extra details for an opportunity search (dates, categories, weights, answers). */
    opportunity: z.record(z.string(), z.unknown()).optional(),
    subjectKeys: z.array(z.string().regex(/^[a-z_]+$/)).max(4).default([]),
    studentSelectedTests: z.array(TestFamilySchema).max(6).default([]),
    terms: z.array(z.string().min(1)).max(12).default([]),
    timezone: z.string().refine(isValidTimezone).optional(),
    /** Outcomes chosen explicitly in the interface; they replace text classification. */
    outcomes: z.array(z.enum(['correct_fact', 'interpret_document', 'collect_information', 'explore_goals', 'check_requirement', 'plan_academics', 'assess_experiences', 'find_opportunities'])).max(8).default([]),
  })
  .strict();
export type RequestContext = z.infer<typeof RequestContextSchema>;
export type RequestContextInput = z.input<typeof RequestContextSchema>;

export interface PlanInput {
  text: string;
  classification: Classification;
  context: RequestContext;
  conversationId: string | null;
  turnId: string | null;
  modality: 'text' | 'voice';
}

export interface PlanOutput {
  nodes: NodeRecord[];
  /** Questions to ask before any work can start (e.g. which program to check). */
  questions: Array<{ text: string; whyNeeded: string }>;
  /** Supported-coverage notes (01R02). */
  coverage: Array<{ scope: string; note: string }>;
  notices: Array<{ code: string; message: string }>;
}

/** Accepted results of a dependency that let the next step proceed. */
const ANY_ACCEPTED: TaskNodeState[] = ['completed', 'partial', 'needs_student_input', 'needs_source', 'needs_human_review'];
/** A plan waits while the eligibility check is waiting for the student's answer. */
const PLAN_ACCEPTS: TaskNodeState[] = ['completed', 'partial', 'needs_source', 'needs_human_review'];

export const SUPPORTED_DEGREE_LEVELS: ReadonlySet<string> = new Set(['undergraduate_first_degree', 'foundation', 'associate']);

function node(id: string, role: Exclude<RoleId, '01'>, objective: string, completionContract: string, scope: Record<string, unknown>, dependsOn: string[], reasons: TaskReason[], acceptStates?: TaskNodeState[]): NodeRecord {
  const n: NodeRecord = { id, role, purpose: ROLE_PURPOSE[role] as Purpose, objective, completionContract, scope, dependsOn, acceptsPartialDependencies: true, reasons, state: 'pending', attempts: 0, taskIds: [], issues: [] };
  if (acceptStates) n.acceptStates = acceptStates;
  return n;
}

export function planRequest(input: PlanInput): PlanOutput {
  const { classification: c, context: ctx } = input;
  const outcomes = new Set<Outcome>(c.outcomes);
  const nodes: NodeRecord[] = [];
  const questions: PlanOutput['questions'] = [];
  const coverage: PlanOutput['coverage'] = [];
  const notices: PlanOutput['notices'] = [];
  if (ctx.correction) outcomes.add('correct_fact');
  if (ctx.documentIds.length > 0) outcomes.add('interpret_document');
  if (ctx.experience) outcomes.add('assess_experiences');

  // Supported coverage first: graduate admissions rules are not in this volume (01T11).
  const graduateTargets = ctx.targets.filter((t) => !SUPPORTED_DEGREE_LEVELS.has(t.degreeLevel));
  const targets: EligibilityScope[] = ctx.targets.filter((t) => SUPPORTED_DEGREE_LEVELS.has(t.degreeLevel)) as EligibilityScope[];
  if (c.graduate || graduateTargets.length > 0) {
    coverage.push({ scope: 'graduate admissions', note: 'Requirement checks and academic planning here cover admission to first degrees (and foundation or associate programs) with reviewed rule sets. Graduate admissions are not covered, so no graduate requirements are stated or guessed.' });
  }

  const upstream: string[] = [];
  if (outcomes.has('correct_fact')) {
    const correction = ctx.correction && (ctx.correction.conversationId ?? input.conversationId) && (ctx.correction.turnId ?? input.turnId) ? { ...ctx.correction, quote: ctx.correction.quote ?? input.text, conversationId: ctx.correction.conversationId ?? input.conversationId, turnId: ctx.correction.turnId ?? input.turnId } : null;
    if (correction) {
      nodes.push(node('correction', '04', 'apply_student_correction', 'record_change_v1', { action: 'apply_correction', corrections: [correction] }, [], ['requested_by_student']));
      upstream.push('correction');
    } else {
      questions.push({ text: 'What would you like to correct, and what should it say instead?', whyNeeded: 'Changing the record needs the exact item and the new value.' });
    }
  }
  const docNodes: string[] = [];
  if (outcomes.has('interpret_document')) {
    if (ctx.documentIds.length === 0) {
      notices.push({ code: 'upload_needed', message: 'To read a transcript or certificate, upload it here; it is checked and read before anything from it is used.' });
    } else {
      ctx.documentIds.forEach((documentId, i) => {
        const id = `document_${i + 1}`;
        nodes.push(node(id, '03', 'interpret_document', 'document_import_v1', { documentId, commit: 'immediately' }, [...upstream], ['requested_by_student']));
        docNodes.push(id);
      });
    }
  }
  const before = [...upstream, ...docNodes];

  const wantsCheck = outcomes.has('check_requirement');
  const wantsPlan = outcomes.has('plan_academics');
  const eligibilityNodes: string[] = [];
  if (wantsCheck || wantsPlan) {
    if (targets.length === 0) {
      if (graduateTargets.length === 0 && !c.graduate) questions.push({ text: 'Which program should I check (institution, program and entry year)?', whyNeeded: 'Requirements are specific to a program, an entry cycle and an applicant category.' });
    } else {
      targets.forEach((t, i) => {
        const id = `eligibility_${i + 1}`;
        // A plan needs the eligibility finding first (01 "Entry points": "Can I apply, and what should I do this year?").
        nodes.push(node(id, '06', 'check_program_requirements', 'eligibility_finding_v1', { eligibility: t }, [...before], wantsCheck ? ['requested_by_student'] : ['dependency_of_requested_work'], ANY_ACCEPTED));
        eligibilityNodes.push(id);
      });
    }
  }
  if (wantsPlan && targets.length > 0) {
    const scope: Record<string, unknown> = { action: 'plan', targets: targets.map((t) => ({ eligibility: t })), studentSelectedTests: ctx.studentSelectedTests, terms: ctx.terms };
    if (ctx.timezone) scope['timezone'] = ctx.timezone;
    if (outcomes.has('guarantee_request')) scope['question'] = input.text.slice(0, 400);
    nodes.push(node('academic_plan', '07', 'academic_plan', 'academic_plan_v1', scope, [...before, ...eligibilityNodes], ['requested_by_student'], PLAN_ACCEPTS));
  }
  if (outcomes.has('explore_goals')) {
    const keys = [...new Set([...ctx.subjectKeys, ...c.subjectKeys])];
    const scope = keys.length >= 2 ? { action: 'compare_options', subjectKeys: keys.slice(0, 4) } : { action: 'goal_map', record: true, ...(ctx.timezone ? { timezone: ctx.timezone } : {}) };
    nodes.push(node('exploration', '05', keys.length >= 2 ? 'compare_options' : 'explore_majors', 'exploration_v1', scope, [...upstream], ['requested_by_student']));
  }
  if (outcomes.has('assess_experiences')) {
    const scope = ctx.experience && input.turnId ? { action: 'record', turnId: input.turnId, experience: ctx.experience } : { action: 'review' };
    nodes.push(node('experiences', '08', 'experience_review', 'experience_record_v1', scope, [...upstream], ['requested_by_student']));
  }
  if (outcomes.has('find_opportunities')) {
    // The student's words stay inside the scout, which uses them locally only; public queries are generalized.
    const request: Record<string, unknown> = { ...(ctx.opportunity ?? {}) };
    if (request['purpose'] === undefined && input.text.trim().length > 0) request['purpose'] = input.text.slice(0, 400);
    nodes.push(node('opportunities', '09', 'opportunity_research', 'opportunity_dossier_v1', { action: 'shortlist', request }, [...upstream], ['requested_by_student']));
  }
  if (outcomes.has('collect_information') && nodes.length === 0) {
    const scope: Record<string, unknown> = { action: 'start', objective: 'onboarding', mode: input.modality };
    if (input.conversationId) scope['conversationId'] = input.conversationId;
    if (ctx.timezone) scope['timezone'] = ctx.timezone;
    nodes.push(node('intake', '02', 'intake', 'intake_turn_v1', scope, [], ['requested_by_student']));
  }
  return { nodes, questions, coverage, notices };
}

/** A follow-up intake node for consequential facts the specialists could not settle (01R04, worked interaction). */
export function gapIntakeNode(fieldKeys: readonly string[], conversationId: string | null, modality: 'text' | 'voice', timezone: string | undefined): NodeRecord {
  const scope: Record<string, unknown> = { action: 'start', objective: 'fill_gaps', mode: modality, targetFields: [...new Set(fieldKeys)].slice(0, 20) };
  if (conversationId) scope['conversationId'] = conversationId;
  if (timezone) scope['timezone'] = timezone;
  return node('fill_gaps', '02', 'fill_gaps', 'intake_turn_v1', scope, [], ['missing_required_information']);
}

export function targetKey(t: EligibilityScope): string {
  return scopeKey(t);
}
