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
    /** The entry cycle for college work (e.g. "2027"); the record's planned entry is used when absent. */
    cycle: z.string().regex(/^\d{4}$/).optional(),
    /** Colleges or programs the student selected, with a round where they have chosen one. */
    options: z.array(z.object({ optionRef: z.string().min(1).max(200), institution: z.string().min(1).max(200), campus: z.string().max(200).nullable().default(null), program: z.string().max(200).nullable().default(null), round: z.string().regex(/^[a-z0-9_]+$/).nullable().default(null) }).strict()).max(10).default([]),
    /** Fully specified requests for the college, funding and writing specialists, built by the interface; each specialist validates its own scope. */
    specialistScopes: z.partialRecord(z.enum(['10', '11', '12', '13', '14', '15', '16', '17', '18']), z.record(z.string(), z.unknown())).default({}),
    /** Outcomes chosen explicitly in the interface; they replace text classification. */
    outcomes: z.array(z.enum(['correct_fact', 'interpret_document', 'collect_information', 'explore_goals', 'check_requirement', 'plan_academics', 'assess_experiences', 'find_opportunities', 'mentor_project', 'research_college', 'match_fit', 'assess_admissions', 'plan_applications', 'plan_finances', 'find_scholarships', 'brainstorm_essay', 'review_writing'])).max(12).default([]),
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
  /** The planned entry cycle from the record, if the student has stated one. */
  entryCycle?: string | null;
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
  planVolumeTwo(input, outcomes, upstream, nodes, questions, notices);
  if (outcomes.has('collect_information') && nodes.length === 0) {
    const scope: Record<string, unknown> = { action: 'start', objective: 'onboarding', mode: input.modality };
    if (input.conversationId) scope['conversationId'] = input.conversationId;
    if (ctx.timezone) scope['timezone'] = ctx.timezone;
    nodes.push(node('intake', '02', 'intake', 'intake_turn_v1', scope, [], ['requested_by_student']));
  }
  return { nodes, questions, coverage, notices };
}

const WRITING_REQUEST = /\b(write|draft|compose|generate)\b[^.?!]{0,40}\b(essays?|personal statement|statement|paragraph|opening|draft)\b|\bcan you (just )?write\b/i;

/** The subject the student named ("an essay about robotics"), used only as the first thing to explore. */
function essayInterest(text: string): string | null {
  const m = /\babout (?:my |the |a |an )?([a-z][a-z' -]{1,40}?)(?=[.?!,;]|$| for | and | so )/i.exec(text);
  return m ? m[1]!.trim() : null;
}

/**
 * Nodes for the college, funding and writing specialists (volume two). Each
 * gets a scope it can validate; when a detail only the student can give is
 * missing (the entry year, which colleges), the student is asked rather than
 * the scope guessed. The application plan runs after the fit, uncertainty
 * and affordability results it integrates.
 */
function planVolumeTwo(input: PlanInput, outcomes: ReadonlySet<Outcome>, upstream: readonly string[], nodes: NodeRecord[], questions: PlanOutput['questions'], notices: PlanOutput['notices']): void {
  const ctx = input.context;
  const cycle = ctx.cycle ?? (input.entryCycle ? /\d{4}/.exec(input.entryCycle)?.[0] : undefined) ?? null;
  const scoped = (role: keyof typeof ctx.specialistScopes) => ctx.specialistScopes[role];
  const ask = (text: string, whyNeeded: string) => {
    if (!questions.some((q) => q.text === text)) questions.push({ text, whyNeeded });
  };
  const needCycle = () => ask('Which entry year are you applying for?', 'College rules, costs, rounds and awards are specific to one entry cycle.');
  const needOptions = () => ask('Which colleges or programs should I look at?', 'This is worked out for specific colleges and programs, not in general.');
  const opt = (o: RequestContext['options'][number]) => ({ optionRef: o.optionRef, institution: o.institution, campus: o.campus, program: o.program });
  const reasons: TaskReason[] = ['requested_by_student'];
  const before = [...upstream];
  const inputs: string[] = [];

  if (outcomes.has('mentor_project')) nodes.push(node('project', '10', 'project_mentoring', 'project_plan_v1', scoped('10') ?? { action: 'explore', interest: null, request: input.text.slice(0, 1500) }, before, reasons));
  if (outcomes.has('research_college')) {
    const o = ctx.options[0];
    const scope = scoped('11') ?? (o && cycle ? { action: 'research', institution: o.institution, campus: o.campus, program: o.program, cycle, decision: 'explore', question: input.text.slice(0, 600) } : null);
    if (scope) nodes.push(node('college_research', '11', 'college_research', 'evidence_packet_v1', scope, before, reasons, ANY_ACCEPTED));
    else if (!o) ask('Which college and program should I look up?', 'Official information is specific to one institution, campus and program.');
    else needCycle();
  }
  if (outcomes.has('match_fit')) {
    const scope = scoped('12') ?? (cycle ? { action: 'match', cycle } : null);
    if (scope) {
      nodes.push(node('fit', '12', 'fit_matching', 'fit_shortlist_v1', scope, before, reasons, ANY_ACCEPTED));
      inputs.push('fit');
    } else needCycle();
  }
  if (outcomes.has('assess_admissions')) {
    const scope = scoped('13') ?? (ctx.options.length > 0 && cycle ? { action: 'assess', options: ctx.options.slice(0, 8).map((o) => ({ ...opt(o), cycle })) } : null);
    if (scope) {
      nodes.push(node('uncertainty', '13', 'admissions_context', 'admissions_uncertainty_v1', scope, before, reasons, ANY_ACCEPTED));
      inputs.push('uncertainty');
    } else if (ctx.options.length === 0) needOptions();
    else needCycle();
  }
  if (outcomes.has('plan_finances')) {
    const scope = scoped('15') ?? (ctx.options.length > 0 && cycle ? { action: 'compare', options: ctx.options.slice(0, 6).map((o) => ({ ...opt(o), cycle })) } : null);
    if (scope) {
      nodes.push(node('affordability', '15', 'financial_planning', 'affordability_ledger_v1', scope, before, reasons, ANY_ACCEPTED));
      inputs.push('affordability');
    } else if (ctx.options.length === 0) needOptions();
    else needCycle();
  }
  if (outcomes.has('find_scholarships')) {
    const scope = scoped('16') ?? (cycle ? { action: 'shortlist', cycle } : null);
    if (scope) nodes.push(node('scholarships', '16', 'scholarship_matching', 'scholarship_matches_v1', scope, before, reasons, ANY_ACCEPTED));
    else needCycle();
  }
  if (outcomes.has('plan_applications')) {
    const withRounds = ctx.options.filter((o) => o.round);
    const scope = scoped('14') ?? (withRounds.length > 0 && cycle ? { action: 'plan', cycle, options: withRounds.map((o) => ({ ...opt(o), round: o.round })) } : null);
    if (scope) nodes.push(node('portfolio', '14', 'application_strategy', 'portfolio_plan_v1', scope, [...before, ...inputs], reasons, ANY_ACCEPTED));
    else if (withRounds.length === 0) ask('Which colleges, and which application rounds, are you considering?', 'Round rules are checked across the whole set of applications.');
    else needCycle();
  }
  if (outcomes.has('brainstorm_essay')) {
    if (WRITING_REQUEST.test(input.text)) notices.push({ code: 'student_is_author', message: 'Essay help here never writes the essay for you: it needs to be yours. A short brainstorming session has started instead, to help you find your own material.' });
    const interest = essayInterest(input.text);
    nodes.push(node('essay_exploration', '17', 'essay_exploration', 'story_session_v1', scoped('17') ?? { action: 'start', interest, mode: input.modality, conversationId: input.conversationId ?? 'conv_story' }, before, reasons));
  }
  if (outcomes.has('review_writing')) nodes.push(node('writing_review', '18', 'narrative_review', 'narrative_review_v1', scoped('18') ?? { action: 'review', applicationId: null }, before, reasons, ANY_ACCEPTED));
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
