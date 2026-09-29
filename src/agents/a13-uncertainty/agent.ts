import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import type { TestScoreRecord } from '../../shared/assessments.js';
import { RoleIdSchema, type Handoff } from '../../shared/envelopes.js';
import { artifactRef } from '../a04-record-steward/service.js';
import type { DerivedArtifact } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { APPLICANT_CATEGORIES, claimRef, type StatisticValue } from '../a11-research/claims.js';
import type { Resolution } from '../a11-research/entities.js';
import type { ReadClaimsResult } from '../a11-research/tools.js';
import { failedResult, makeResult, readView, type SpecialistAgent } from '../common/specialist.js';
import { compareScores, DEFINITIONS, explainStatistic, PLAUSIBLE_MIN_RATE, roundNote, scopedAdmitRate, SELECTION_STATES, cohortYear, type ScoreComparison, type SelectionState, type StatClaim } from './assess.js';
import { modelRef, type RegisteredModel } from './models.js';

/**
 * Agent 13 — Admissions uncertainty advisor.
 *
 * Explains what the evidence can and cannot establish about competitiveness,
 * in a defined qualitative vocabulary. It never produces a personal
 * percentage, never treats a score range as a threshold or an early-round
 * rate as a benefit, never multiplies options into a combined chance, and
 * never uses eligibility, fit, affordability or an essay score as selection
 * evidence. A numerical model could only ever be referenced through the
 * governed registry, and this release shows no number from one.
 */

/** Qualification systems for which grade comparisons with published statistics are supported; everything else is compared on requirements only. */
export const GRADE_COMPARISON_SYSTEMS = new Set(['us_high_school']);

const OptionSchema = z
  .object({
    optionRef: z.string().min(1).max(200),
    institution: z.string().min(1).max(200),
    campus: z.string().max(200).nullable().default(null),
    program: z.string().max(200).nullable().default(null),
    cycle: z.string().regex(/^\d{4}$/),
    applicantCategory: z.enum(APPLICANT_CATEGORIES).default('first_year'),
    /** Guarantee conditions the eligibility check or the institution has confirmed. */
    guaranteeConditionsConfirmed: z.boolean().default(false),
  })
  .strict();

const SignalSchema = z.object({ kind: z.enum(['essay_evaluation', 'project_completed', 'fit_result', 'affordability_state']), value: z.union([z.string(), z.number()]) }).strict();
const FeatureRequestSchema = z.object({ name: z.string().regex(/^[a-z0-9_]+$/), provenance: z.enum(['student_record', 'inferred_from_text']), sensitive: z.boolean() }).strict();

export const UncertaintyScopeSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('assess'),
      question: z.enum(['context', 'exact_chance', 'statistic', 'portfolio']).default('context'),
      options: z.array(OptionSchema).min(1).max(8),
      /** Other roles' results the student mentioned; they are never selection evidence (13T08). */
      otherSignals: z.array(SignalSchema).max(10).default([]),
      /** Inputs someone proposes to use for a prediction; inferred sensitive attributes are refused (13T16). */
      proposedInputs: z.array(FeatureRequestSchema).max(20).default([]),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('clarify'), optionRef: z.string().min(1).nullable().default(null), category: z.enum(SELECTION_STATES).nullable().default(null), text: z.string().min(1).max(600), requester: RoleIdSchema.default('01') }).strict(),
  z.object({ action: z.literal('improve'), text: z.string().min(1).max(600), requester: RoleIdSchema.default('01') }).strict(),
]);
export type UncertaintyScope = z.infer<typeof UncertaintyScopeSchema>;

// ---------------------------------------------------------------- payload

const AssessmentSchema = z
  .object({
    optionRef: z.string(),
    version: z.number().int().positive(),
    scope: z.object({ entityId: z.string().nullable(), name: z.string(), institutionId: z.string().nullable(), cycle: z.string(), applicantCategory: z.string(), programSelection: z.enum(['with_admission', 'separate_competitive', 'unknown']) }).strict(),
    eligibility: z.object({ state: z.enum(['supported', 'conditional', 'ineligible', 'unknown']), ref: z.string().nullable(), explanation: z.string() }).strict(),
    statistics: z.array(z.object({ claimId: z.string(), explanation: z.string(), applicability: z.enum(['scope_matched', 'broader_group', 'different_group', 'too_old']) }).strict()),
    comparisons: z.array(z.custom<ScoreComparison>((v) => typeof v === 'object' && v !== null && 'position' in v)),
    roundNote: z.string().nullable(),
    observations: z.array(z.string()),
    uncertaintyReasons: z.array(z.object({ code: z.string(), text: z.string() }).strict()),
    state: z.enum(SELECTION_STATES),
    definition: z.string(),
    reasons: z.array(z.string()),
    nextSteps: z.array(z.string()).max(3),
    numericModel: z.object({ ref: z.string(), status: z.enum(['approved', 'rejected', 'withdrawn']), usable: z.literal(false), reason: z.string() }).strict().nullable(),
    guaranteeVerified: z.boolean(),
  })
  .strict();
export type Assessment = z.infer<typeof AssessmentSchema>;

export const UncertaintyPayloadSchema = z
  .object({
    action: z.string(),
    question: z.string().nullable(),
    assessments: z.array(AssessmentSchema),
    portfolio: z.object({ byState: z.record(z.string(), z.number()), dependsOnUncertainSelection: z.boolean(), sharedDependencies: z.array(z.string()), combinedChance: z.null(), note: z.string() }).strict().nullable(),
    definitions: z.record(z.string(), z.string()),
    corrections: z.array(z.object({ modelRef: z.string(), affectedResults: z.array(z.string()), message: z.string() }).strict()),
    refusals: z.array(z.string()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    reviewFlags: z.array(z.object({ code: z.string(), category: z.string().nullable(), text: z.string() }).strict()),
    personalProbability: z.null(),
  })
  .strict();
export type UncertaintyPayload = z.infer<typeof UncertaintyPayloadSchema>;

export const UNCERTAINTY_CONTRACT: ContractDefinition<UncertaintyPayload> = {
  id: 'admissions_uncertainty_v1',
  role: '13',
  payload: UncertaintyPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    for (const a of p.assessments) {
      if ((a.state === 'formally_ineligible') !== (a.eligibility.state === 'ineligible')) issues.push(`${a.optionRef}: an unmet formal requirement must be the state, and only then`);
      if (a.state === 'verified_open_admission' && !a.guaranteeVerified) issues.push(`${a.optionRef}: "safe" without a verified open or guaranteed route`);
      if (a.state === 'plausible_option_with_material_uncertainty' && !a.statistics.some((s) => s.applicability === 'scope_matched')) issues.push(`${a.optionRef}: a favourable category needs scope-matched evidence`);
      if (a.definition !== DEFINITIONS[a.state]) issues.push(`${a.optionRef}: the category must carry its definition`);
    }
    const text = JSON.stringify(p);
    if (/\b\d{1,3}(\.\d+)?\s?%\s?(chance|probability|likelihood|odds)\b|\byour (chance|odds|probability)[^.]{0,30}\b\d{1,3}\s?%/i.test(text)) issues.push('no personal probability may be stated');
    if (/\b(boost|increase|improve|raise)s? your (chance|odds|probability)/i.test(text)) issues.push('no causal claim about raising a chance may be made');
    if (/\bsafe\b/i.test(text) && !p.assessments.some((a) => a.state === 'verified_open_admission') && !/only case the app calls safe/.test(text)) issues.push('"safe" is reserved for a verified open or guaranteed route');
    if (/\bweak applicant\b/i.test(text)) issues.push('no judgement of the student’s worth');
    return issues;
  },
};

const ELIGIBILITY_MAP: Record<string, Assessment['eligibility']['state']> = { apparently_meets: 'supported', conditionally_on_track: 'conditional', requirement_not_met: 'ineligible', unresolved: 'unknown', outside_supported_coverage: 'unknown' };

function testsFrom(view: RecordView): TestScoreRecord[] {
  return view.entityIds('test_attempt').flatMap((id) => {
    const v = view.value<TestScoreRecord>('test_attempt', id, 'record');
    return v ? [v] : [];
  });
}

const GUARANTEE_READING = /\b(so|that means|does that mean|means)\b[^.?]{0,40}\b(i'?ll|i will|i am going to|i'm going to|i’m going to|guaranteed|definitely|for sure|certain(ly)?)\b[^.?]{0,30}\b(get in|be admitted|be accepted|admission|in)\b|\b(guarantee|guaranteed|a sure thing|definitely get in)\b/i;
const FABRICATE = /\b(invent|make up|fake|fabricat\w*|pretend|exaggerat\w*|inflate|embellish)\b/i;

type Scope<A extends UncertaintyScope['action']> = Extract<UncertaintyScope, { action: A }>;

export class UncertaintyAdvisorAgent implements SpecialistAgent {
  readonly role = '13' as const;
  readonly contracts = [UNCERTAINTY_CONTRACT];

  /** Evidence checks run in code; a model could only phrase the explanation, never supply a category or a number. */
  constructor(private readonly model: ModelGateway) {}

  get modelConfigured(): boolean {
    return this.model.configured;
  }

  async handle(ctx: TaskContext) {
    const parsed = UncertaintyScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The request was incomplete.', 'invalid_scope');
    const s = parsed.data;
    if (s.action === 'clarify') return this.clarify(ctx, s);
    if (s.action === 'improve') return this.improve(ctx, s);
    return this.assess(ctx, s);
  }

  private empty(action: string, question: string | null): UncertaintyPayload {
    return { action, question, assessments: [], portfolio: null, definitions: { ...DEFINITIONS }, corrections: [], refusals: [], notices: [], reviewFlags: [], personalProbability: null };
  }

  // ------------------------------------------------------------ assess (steps 1-7)

  private async assess(ctx: TaskContext, s: Scope<'assess'>) {
    const p = this.empty('assess', s.question);
    // Step 1: a number is never invented; the strongest supported alternative is given instead (13T01).
    if (s.question === 'exact_chance') p.refusals.push('There is no validated model behind a personal percentage here, so none is given. A number from judgement would look precise without being reliable. Below is what the published evidence does and does not show.');
    for (const sig of s.otherSignals) {
      const what = sig.kind === 'essay_evaluation' ? 'An essay evaluation is a diagnostic view of your writing' : sig.kind === 'project_completed' ? 'A completed project is a true part of your record' : sig.kind === 'fit_result' ? 'A fit result describes how well an option matches what you want' : 'An affordability result describes cost';
      p.notices.push({ code: `not_selection_evidence_${sig.kind}`, message: `${what}; it is not admissions odds and does not change this assessment.` });
    }
    const inferred = s.proposedInputs.filter((f) => f.sensitive && f.provenance === 'inferred_from_text');
    if (inferred.length > 0) p.refusals.push(`${inferred.map((f) => f.name.replace(/_/g, ' ')).join(', ')} would be inferred from your writing. Sensitive characteristics are never inferred from essays, names or other text, and cannot be used as prediction inputs.`);

    const view = await readView(ctx, 'local', { catalogKeys: ['student.education.qualification_system', 'test_attempt.record', 'student.application.applicant_category'] });
    const tests = testsFrom(view);
    const qual = view.studentValue<{ id: string; label: string }>('education.qualification_system') ?? null;
    const claimIds = view.view.fields.filter((f) => f.current).map((f) => f.current!.claimId);
    const eligibility = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'eligibility_finding' });
    const previous = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'admissions_assessment' });
    const sourceRefs = new Set<string>();
    const handoffs: Handoff[] = [];
    const stored: Array<{ a: Assessment; sources: string[]; modelRefs: string[]; eligibilityRef: string | null; withdrawn: Array<{ ref: string; reason: string }> }> = [];

    const models = await ctx.call<RegisteredModel[]>('models.read_registry', {});
    for (const o of s.options) {
      const built = await this.assessOption(ctx, o, { tests, qual, eligibility, sourceRefs, models });
      const prior = previous.filter((x) => x.scopeKey === o.optionRef).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      built.a.version = ((prior?.payload as { version?: number } | undefined)?.version ?? 0) + 1;
      p.assessments.push(built.a);
      stored.push(built);
      if (built.gradeLimit) handoffs.push({ toRole: '06', reason: 'Grades from this qualification cannot be compared with the published statistics.', requestedOutcome: `Check the official prerequisites and equivalences for ${built.a.scope.name} with the institution’s guidance for ${qual?.label ?? 'this qualification'}.`, inputRefs: [built.a.scope.entityId ?? o.optionRef], unresolved: [], completionCondition: 'Eligibility for this qualification is settled from official guidance.' });
    }

    // A withdrawn model version: stop using it, name every result that relied on it, and correct plainly (13T15).
    const withdrawn = new Map<string, string>();
    for (const b of stored) for (const r of b.withdrawn) withdrawn.set(r.ref, r.reason);
    if (withdrawn.size > 0) {
      const all = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId });
      for (const [ref, reason] of withdrawn) {
        const direct = all.filter((a) => a.inputs.ruleVersions.includes(ref));
        const downstream = all.filter((a) => a.inputs.sourceIds.some((x) => direct.some((d) => x === artifactRef(d.id))));
        const affected = [...direct, ...downstream].map((a) => a.id);
        p.corrections.push({ modelRef: ref, affectedResults: affected, message: `An earlier assessment referred to ${ref}, which has been withdrawn (${reason}). It is no longer used; the earlier result is kept for the record but no longer endorsed, and plans that relied on it need another look.` });
        if (downstream.length > 0) handoffs.push({ toRole: '14', reason: `Plans relied on an assessment that referred to a withdrawn model (${ref}).`, requestedOutcome: 'Revisit the plans that relied on it, using the current qualitative assessment.', inputRefs: downstream.map((a) => artifactRef(a.id)), unresolved: [], completionCondition: 'No plan depends on the withdrawn model.' });
      }
    }

    // Step 6: portfolio implications, never a product of independent chances (13T09).
    if (s.question === 'portfolio' || s.options.length > 1) {
      const byState: Record<string, number> = {};
      for (const a of p.assessments) byState[a.state] = (byState[a.state] ?? 0) + 1;
      const uncertain = p.assessments.filter((a) => a.state === 'highly_uncertain_selection' || a.state === 'selection_evidence_insufficient');
      const shared: string[] = [];
      if (uncertain.length >= 2) shared.push('The uncertain options select on similar academic evidence, so one result tells you something about the others; they are not independent chances.');
      if (p.assessments.filter((a) => a.scope.programSelection === 'separate_competitive').length >= 2) shared.push('Several options depend on a separate competitive selection into the same field.');
      if (new Set(s.options.map((o) => o.cycle)).size === 1 && s.options.length > 1) shared.push('All options fall in the same cycle and share the same timing risks.');
      const dependsOnUncertain = p.assessments.length > 0 && uncertain.length === p.assessments.length;
      p.portfolio = { byState, dependsOnUncertainSelection: dependsOnUncertain, sharedDependencies: shared, combinedChance: null, note: 'No combined chance is calculated: outcomes share academic, financial, timing and institutional dependencies, so multiplying them as independent events would be misleading.' };
      if (s.requester !== '14') handoffs.push({ toRole: '14', reason: dependsOnUncertain ? 'Every option in the set depends on highly uncertain or unassessable selection.' : 'The admissions uncertainty of the set is assessed.', requestedOutcome: dependsOnUncertain ? 'Help the student add at least one option with clearer admission evidence and a verified affordable path.' : 'Balance the portfolio with these qualitative states.', inputRefs: p.assessments.map((a) => a.optionRef), unresolved: [], completionCondition: 'The portfolio does not rest on one speculative result.' });
    }

    // A single highly uncertain option is still a portfolio question: the plan should not depend on it alone.
    if (!p.portfolio && s.requester !== '14' && p.assessments.some((a) => a.state === 'highly_uncertain_selection')) {
      handoffs.push({ toRole: '14', reason: 'An option’s selection is highly uncertain.', requestedOutcome: 'Look at the whole portfolio so that it does not depend on this one result.', inputRefs: p.assessments.map((a) => a.optionRef), unresolved: [], completionCondition: 'The portfolio has options with clearer admission evidence.' });
    }

    // Step 7: store each assessment with its evidence and version.
    for (const b of stored) {
      await ctx.call('artifacts.put_derived', {
        tenantId: ctx.request.tenantId,
        studentId: ctx.request.studentId,
        kind: 'admissions_assessment',
        scopeKey: b.a.optionRef,
        payload: { version: b.a.version, state: b.a.state, optionRef: b.a.optionRef, reasons: b.a.reasons },
        inputClaimIds: claimIds,
        inputFieldKeys: ['test_attempt:*.record', 'student:self.education.qualification_system'],
        ruleVersions: b.modelRefs,
        sourceIds: [...b.sources, ...(b.eligibilityRef ? [b.eligibilityRef] : [])],
        recordVersion: view.recordVersion,
      });
    }
    const summary = p.assessments.map((a) => `${a.scope.name}: ${a.state.replace(/_/g, ' ')}`).join('; ');
    return makeResult(ctx, {
      status: 'completed',
      summary: `Admissions uncertainty — ${summary}.`,
      payload: p,
      claimIds,
      recordVersion: view.recordVersion,
      sourceRefs: [...sourceRefs],
      handoffs,
      completionReason: s.question === 'exact_chance' ? 'qualitative_instead_of_number' : 'assessed',
    });
  }

  private async assessOption(ctx: TaskContext, o: z.infer<typeof OptionSchema>, env: { tests: TestScoreRecord[]; qual: { id: string; label: string } | null; eligibility: DerivedArtifact[]; sourceRefs: Set<string>; models: RegisteredModel[] }) {
    const a: Assessment = {
      optionRef: o.optionRef,
      version: 1,
      scope: { entityId: null, name: o.program ? `${o.program} at ${o.institution}` : o.institution, institutionId: null, cycle: o.cycle, applicantCategory: o.applicantCategory, programSelection: 'unknown' },
      eligibility: { state: 'unknown', ref: null, explanation: 'No eligibility check is on file for this option.' },
      statistics: [],
      comparisons: [],
      roundNote: null,
      observations: [],
      uncertaintyReasons: [],
      state: 'selection_evidence_insufficient',
      definition: DEFINITIONS.selection_evidence_insufficient,
      reasons: [],
      nextSteps: [],
      numericModel: null,
      guaranteeVerified: false,
    };
    const sources: string[] = [];
    const modelRefs: string[] = [];
    const withdrawn: Array<{ ref: string; reason: string }> = [];
    let gradeLimit = false;
    const finish = (state: SelectionState) => {
      a.state = state;
      a.definition = DEFINITIONS[state];
      return { a, sources, modelRefs, withdrawn, gradeLimit, eligibilityRef: a.eligibility.ref };
    };

    // Step 2: scope and formal eligibility come first.
    const r = await ctx.call<Resolution>('institutions.read', { op: 'resolve', institution: o.institution, campus: o.campus, program: o.program });
    if (r.status !== 'resolved') {
      a.uncertaintyReasons.push({ code: 'scope_unresolved', text: r.question });
      a.reasons.push('The option could not be identified precisely enough to match any statistics.');
      return finish('selection_evidence_insufficient');
    }
    a.scope.entityId = r.entity.id;
    a.scope.institutionId = r.institution.id;
    a.scope.name = r.program ? `${r.program.name} at ${r.institution.name}` : r.institution.name;
    const finding = env.eligibility.filter((x) => x.status === 'current' && (x.scopeKey.includes(`|${r.entity.id}|`) || x.scopeKey.startsWith(`${r.institution.id}|`))).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0];
    if (finding) {
      const overall = (finding.payload as { overall: string; explanation?: string }).overall;
      a.eligibility = { state: ELIGIBILITY_MAP[overall] ?? 'unknown', ref: artifactRef(finding.id), explanation: (finding.payload as { explanation?: string }).explanation ?? overall.replace(/_/g, ' ') };
    }
    if (a.eligibility.state === 'ineligible') {
      a.reasons.push(`The eligibility check found an unmet formal requirement: ${a.eligibility.explanation}`);
      a.nextSteps.push('Look at the specific requirement with the eligibility check before weighing selection at all.');
      return finish('formally_ineligible');
    }

    // Step 3: evidence quality.
    const read = await ctx.call<ReadClaimsResult>('institutions.read', { op: 'claims', entityId: r.entity.id, predicates: ['statistic', 'program_access_route', 'selection_policy_change', 'admission_guarantee'], cycle: null, includeHistorical: false });
    const live = read.claims.filter((c) => c.status === 'verified' || c.status === 'provisional');
    const stats: StatClaim[] = live.filter((c) => c.predicate === 'statistic').map((c) => ({ claimId: c.claimId, qualifier: c.qualifier, value: c.value as StatisticValue }));
    const cite = (id: string) => {
      sources.push(claimRef(id));
      env.sourceRefs.add(claimRef(id));
    };
    const access = live.find((c) => c.predicate === 'program_access_route');
    const accessRoute = access ? (access.value as { route: string }).route : r.program?.attributes.accessRoute ?? null;
    a.scope.programSelection = accessRoute === 'later_competitive_selection' ? 'separate_competitive' : accessRoute ? 'with_admission' : 'unknown';
    if (access) cite(access.claimId);
    const policy = live.find((c) => c.predicate === 'selection_policy_change' && (c.value as { affectsComparability: boolean }).affectsComparability);
    const guarantee = live.find((c) => c.predicate === 'admission_guarantee' && c.status === 'verified');

    // The governed model registry: referenced for its status, never for a number in this release.
    const models = env.models.filter((x) => x.card.supportedPopulation.institutions.includes(r.institution.id));
    for (const m of models.filter((x) => x.card.supportedPopulation.applicantCategories.includes(o.applicantCategory) || x.status === 'withdrawn')) {
      const ref = modelRef(m.card.modelId, m.card.version);
      const abstain = m.card.evaluation.subgroups.filter((g) => m.review.abstain.includes(g.name) && (g.match.applicantCategory === undefined || g.match.applicantCategory === o.applicantCategory) && (g.match.qualificationSystem === undefined || g.match.qualificationSystem === env.qual?.id));
      if (m.status === 'withdrawn') {
        a.numericModel = { ref, status: 'withdrawn', usable: false, reason: `Withdrawn: ${m.withdrawnReason ?? 'no longer approved'}. It is not used.` };
        withdrawn.push({ ref, reason: m.withdrawnReason ?? 'withdrawn' });
        continue;
      }
      if (m.status === 'rejected') {
        a.numericModel = { ref, status: 'rejected', usable: false, reason: `Not approved: ${m.review.issues[0] ?? 'failed review'}.` };
        continue;
      }
      modelRefs.push(ref);
      a.numericModel = abstain.length > 0
        ? { ref, status: 'approved', usable: false, reason: `The model is not reliable enough for your group (${abstain.map((g) => g.name).join(', ')}: ${abstain.map((g) => `n=${g.n}, calibration slope ${g.calibrationSlope}`).join('; ')}), so it abstains and the assessment is qualitative.` }
        : { ref, status: 'approved', usable: false, reason: 'This release gives qualitative assessments only; the approved model is not used to show a number.' };
      if (abstain.length > 0) a.uncertaintyReasons.push({ code: 'model_abstains_for_group', text: a.numericModel.reason });
    }

    // Statistics, explained before use, with their applicability to this applicant.
    const cycle = Number(o.cycle);
    const population = a.scope.programSelection === 'separate_competitive' ? 'program_applicants' : o.applicantCategory.startsWith('transfer') ? 'transfer_applicants' : 'first_year_applicants';
    for (const st of stats) {
      const y = cohortYear(st.value);
      const applicability: Assessment['statistics'][number]['applicability'] = y !== null && cycle - y > 3 ? 'too_old' : st.value.cohort.population === population ? (st.value.cohort.applicantCategory && st.value.cohort.applicantCategory !== o.applicantCategory && !o.applicantCategory.startsWith(st.value.cohort.applicantCategory) ? 'broader_group' : 'scope_matched') : st.value.cohort.population.startsWith(population.split('_')[0]!) ? 'broader_group' : 'different_group';
      a.statistics.push({ claimId: st.claimId, explanation: explainStatistic(st), applicability });
      cite(st.claimId);
    }
    a.comparisons = compareScores(stats, env.tests);
    for (const c of a.comparisons) {
      a.observations.push(c.explanation);
      if (c.population === 'enrolled_score_submitters') a.uncertaintyReasons.push({ code: 'score_range_selected_group', text: 'The score range covers only enrolled students who submitted scores; students who did not submit, and those admitted who did not enroll, are not in it.' });
    }
    a.roundNote = roundNote(stats);
    // Grades from an unsupported qualification are never converted (13T07).
    if (env.qual && !GRADE_COMPARISON_SYSTEMS.has(env.qual.id)) {
      gradeLimit = true;
      a.uncertaintyReasons.push({ code: 'qualification_not_comparable', text: `Published statistics do not cover ${env.qual.label}, and no conversion to another grading scale is made. Grades are compared with official requirements only; competitiveness is less certain as a result.` });
    }

    if (guarantee) {
      cite(guarantee.claimId);
      const g = guarantee.value as { route: string; conditions: string[]; text: string };
      if (a.eligibility.state === 'supported' && (g.conditions.length === 0 || o.guaranteeConditionsConfirmed)) {
        a.guaranteeVerified = true;
        a.reasons.push(`${r.institution.name} publishes a ${g.route.replace(/_/g, ' ')} route (“${g.text.slice(0, 200)}”), and its conditions are confirmed as met.`);
        a.nextSteps.push('Keep the route’s conditions met through graduation, and check its deadline.');
        return finish('verified_open_admission');
      }
      a.observations.push(`A ${g.route.replace(/_/g, ' ')} route exists${g.conditions.length > 0 ? ` with conditions (${g.conditions.join('; ')}) that are not yet confirmed` : ''}.`);
    }
    if (a.eligibility.state === 'unknown') {
      a.reasons.push('Formal eligibility has not been checked, so selection is not assessed yet.');
      a.nextSteps.push('Run the eligibility check for this program and entry year.');
      return finish('eligibility_unresolved');
    }
    if (policy) {
      cite(policy.claimId);
      const pv = policy.value as { effectiveCycle: string; description: string };
      const newest = Math.max(0, ...stats.map((s) => cohortYear(s.value) ?? 0));
      if (Number(pv.effectiveCycle) > newest) {
        // A policy change makes earlier years a weak comparison: the assessment is suspended pending review (13T13).
        a.uncertaintyReasons.push({ code: 'policy_change', text: `Selection changes from the ${pv.effectiveCycle} cycle (${pv.description}). Statistics from earlier years are not a reliable comparison, so no category is given until newer evidence is reviewed.` });
        a.reasons.push('A selection policy change makes the historical statistics a weak comparison.');
        a.nextSteps.push('Read the institution’s description of the new selection policy.');
        return finish('selection_evidence_insufficient');
      }
    }
    if (a.scope.programSelection === 'separate_competitive' && !stats.some((s) => s.value.cohort.population === 'program_applicants')) {
      a.uncertaintyReasons.push({ code: 'program_selection_separate', text: 'Entry to the program is a separate competitive selection, and no program-level statistics are published. Institution-wide figures do not describe it.' });
      a.reasons.push('Institutional statistics do not describe the separate selection into this program.');
      a.nextSteps.push('Ask the department how many students who apply to the program are admitted to it.');
      return finish('selection_evidence_insufficient');
    }
    const rate = scopedAdmitRate(stats, { population, cycle });
    if (!rate || rate.stale) {
      a.uncertaintyReasons.push({ code: 'no_scope_matched_rate', text: rate?.stale ? 'The newest published admit rate is too old to compare with this cycle.' : 'No admit rate is published for your applicant group and this option.' });
      a.reasons.push('There is no recent, comparable outcome evidence for your group.');
      a.nextSteps.push('Treat this option as one uncertain part of a balanced list.');
      return finish('selection_evidence_insufficient');
    }
    const value = (rate.stat.value.value as { value: number }).value;
    a.observations.push(explainStatistic(rate.stat));
    if (rate.stat.value.cohort.applicantCategory === null && o.applicantCategory !== 'first_year' && o.applicantCategory !== 'transfer') a.uncertaintyReasons.push({ code: 'broader_group', text: `The rate covers all ${rate.stat.value.cohort.population.replace(/_/g, ' ')}, not ${o.applicantCategory.replace(/_/g, ' ')} applicants specifically.` });
    if (a.eligibility.state === 'conditional') a.uncertaintyReasons.push({ code: 'eligibility_conditional', text: 'Formal eligibility is conditional on facts or future requirements.' });
    if (value < PLAUSIBLE_MIN_RATE) {
      a.reasons.push(`Most applicants in the relevant group are not admitted (${value}% admitted in ${rate.stat.value.cohort.year}), including many with strong records.`);
      a.nextSteps.push('Keep this option alongside ones with clearer admission evidence.');
      return finish('highly_uncertain_selection');
    }
    const below = a.comparisons.some((c) => c.position === 'below_25th');
    const comparable = a.comparisons.length > 0 && !gradeLimit;
    if (below) {
      a.reasons.push('Your reported score is below the middle half of the published range; this is one consideration, not a cutoff.');
      a.nextSteps.push('Check whether testing is required or optional for this cycle before deciding whether to submit scores.');
      return finish('highly_uncertain_selection');
    }
    if (!comparable) {
      a.reasons.push(`The group admit rate is ${value}%, but there is no comparable academic evidence for you to place this option in a category.`);
      a.nextSteps.push('Compare your record with the official requirements; the category can be reviewed when comparable evidence exists.');
      return finish('selection_evidence_insufficient');
    }
    a.reasons.push(`${value}% of the relevant group were admitted in ${rate.stat.value.cohort.year}, and your checked academic context is comparable. Selection is still uncertain.`);
    a.nextSteps.push('Keep the application complete and on time; the outcome still depends on factors the app cannot see.');
    return finish('plausible_option_with_material_uncertainty');
  }

  // ------------------------------------------------------------ clarify a misread category (13T18)

  private async clarify(ctx: TaskContext, s: Scope<'clarify'>) {
    const p = this.empty('clarify', null);
    const misread = GUARANTEE_READING.test(s.text) && s.category !== 'verified_open_admission';
    if (misread) {
      p.notices.push({ code: 'not_a_guarantee', message: `${s.category ? `“${s.category.replace(/_/g, ' ')}” means: ${DEFINITIONS[s.category]}` : 'None of these categories is a promise.'} It is not a promise of admission; only a verified open or guaranteed route is.` });
      p.reviewFlags.push({ code: 'category_misread', category: s.category, text: s.text.slice(0, 300) });
      // The misreading is kept for a review of how the categories are explained, not about the student.
      await ctx.call('artifacts.put_derived', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'explanation_feedback', scopeKey: `category_${s.category ?? 'unknown'}`, payload: { category: s.category, misread: 'read_as_guarantee' }, inputClaimIds: [], recordVersion: ctx.request.recordVersion });
    } else if (s.category) p.notices.push({ code: 'definition', message: DEFINITIONS[s.category] });
    return makeResult(ctx, { status: 'completed', summary: misread ? 'That category is not a guarantee; here is what it means.' : 'Here is what the category means.', payload: p, completionReason: misread ? 'misreading_clarified' : 'definition_given' });
  }

  // ------------------------------------------------------------ genuine planning, never fabrication (13T14)

  private async improve(ctx: TaskContext, s: Scope<'improve'>) {
    const p = this.empty('improve', null);
    const handoffs: Handoff[] = [];
    if (FABRICATE.test(s.text)) {
      p.refusals.push('I can’t help invent or inflate an activity. Beyond being dishonest, it can lead to a rescinded offer, and there is no reliable formula by which an activity adds admission odds.');
    }
    p.notices.push({ code: 'genuine_planning', message: 'What helps is real: work you care about, done over time, described accurately. The project mentor can help plan something genuine that fits your schedule.' });
    handoffs.push({ toRole: '10', reason: 'The student wants to strengthen their application.', requestedOutcome: 'Help plan a genuine project or activity within the student’s time and interests; nothing is fabricated or exaggerated.', inputRefs: [], unresolved: [], completionCondition: 'The student has a realistic plan for real work, or chooses not to add one.' });
    return makeResult(ctx, { status: 'completed', summary: FABRICATE.test(s.text) ? 'Inventing an activity is not something I can help with; planning a real one is.' : 'Planning genuine work is the useful next step.', payload: p, handoffs, completionReason: FABRICATE.test(s.text) ? 'fabrication_refused' : 'routed_to_planning' });
  }
}
