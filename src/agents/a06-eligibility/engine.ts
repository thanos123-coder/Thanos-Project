import { TEST_VERSIONS, type TestScoreRecord } from '../../shared/assessments.js';
import { ACHIEVED_STATUSES, FUTURE_STATUSES, meetsGradeThreshold, type GradeValue } from '../../shared/grades.js';
import type { ApplicantCategory, DecisionStage } from '../../shared/scope.js';
import { isPossibleSubjectMatch } from '../../shared/subjects.js';
import { isOnOrBefore, meetsMaximumAge, meetsMinimumAge, type CalendarDate } from '../../shared/time.js';
import { claimIdsOf, type CourseFacts, type Fact, type StudentFacts } from '../common/student-facts.js';
import type { Condition, EvidenceRequirement, GroupNode, Predicate, PredicateNode, RuleNode, RulePackage, SourceConflict } from './rules.js';

/**
 * Deterministic requirement evaluation (06R06-06R10).
 *
 * Rule-level states are met, not_met, unknown and not_applicable; applicability
 * is evaluated before the predicate; within an applicable rule unknown is not
 * false (spec 06 "Requirement logic and decision states"):
 *   AND: any not_met -> not_met, else any unknown -> unknown, else met.
 *   OR:  any met -> met, all not_met -> not_met, else unknown.
 *   NOT: unknown stays unknown.
 * Every tree is evaluated twice: with achieved results only, and with the
 * future-completion routes the institution permits at this stage. The overall
 * finding is derived from those two results, never generated independently.
 */

export type RuleState = 'met' | 'not_met' | 'unknown' | 'not_applicable';
export type EvalMode = 'achieved' | 'route';

export type ResolutionKind =
  | 'needed_fact'
  | 'confirm_fact'
  | 'resolve_conflicting_facts'
  | 'source_clarification'
  | 'future_condition'
  | 'published_alternative'
  | 'institution_instruction'
  | 'official_evidence'
  | 'qualified_review';

export interface Resolution {
  kind: ResolutionKind;
  text: string;
  /** Who can resolve it: ask the student (02), import a document (03), plan (07), research the source (11), or a person. */
  owner: '02' | '03' | '07' | '11' | 'institution' | 'human_review' | 'student';
}

export interface Outcome {
  state: RuleState;
  /** In route mode, true when the state depends on a permitted future completion. */
  viaFuture: boolean;
  explanation: string;
  resolution?: Resolution;
  /** Explicit future conditions, e.g. "Final grade in Mathematics HL of at least 6". */
  conditions: string[];
  claimIds: string[];
  /** Field keys or wildcard patterns this outcome depended on (for invalidation). */
  dependencies: string[];
}

export interface AtomicFinding {
  ruleId: string;
  label: string;
  mandatory: boolean;
  /** The current finding, from achieved results. */
  state: RuleState;
  /** The finding when permitted future completion is taken into account. */
  stateWithPermittedRoutes: RuleState;
  explanation: string;
  resolution?: Resolution;
  futureConditions: string[];
  claimIds: string[];
  source: PredicateNode['source'];
  publishedRemedy?: string;
  /** Concrete record fields this finding read (no wildcards), so a coordinator can ask for exactly these. */
  inputFields: string[];
}

export interface GroupFinding {
  ruleId: string;
  label: string;
  kind: GroupNode['kind'] | 'not';
  state: RuleState;
  stateWithPermittedRoutes: RuleState;
  childIds: string[];
}

export interface EvaluationContext {
  facts: StudentFacts;
  stage: DecisionStage;
  applicantCategory: ApplicantCategory | null;
  /** Only the rule tree and its source conflicts are read, so other rule sets (e.g. opportunity eligibility) can reuse the engine. */
  pkg: Pick<RulePackage, 'rules' | 'sourceConflicts'>;
  asOf: CalendarDate;
}

export interface TreeEvaluation {
  achieved: RuleState;
  route: RuleState;
  atomic: AtomicFinding[];
  groups: GroupFinding[];
  claimIds: string[];
  dependencies: string[];
}

// ------------------------------------------------------------------ logic

// 06R07: AND, OR, at-least and NOT combinations, with applicability evaluated first; an exception is a rule with conditions.
export function combineAll(states: readonly RuleState[]): RuleState {
  const s = states.filter((x) => x !== 'not_applicable');
  if (s.length === 0) return 'not_applicable';
  if (s.includes('not_met')) return 'not_met';
  if (s.includes('unknown')) return 'unknown';
  return 'met';
}

export function combineAny(states: readonly RuleState[]): RuleState {
  const s = states.filter((x) => x !== 'not_applicable');
  if (s.length === 0) return 'not_applicable';
  if (s.includes('met')) return 'met';
  if (s.every((x) => x === 'not_met')) return 'not_met';
  return 'unknown';
}

export function combineAtLeast(states: readonly RuleState[], n: number): RuleState {
  const s = states.filter((x) => x !== 'not_applicable');
  if (s.length === 0) return 'not_applicable';
  const met = s.filter((x) => x === 'met').length;
  const unknown = s.filter((x) => x === 'unknown').length;
  if (met >= n) return 'met';
  if (met + unknown < n) return 'not_met';
  return 'unknown';
}

export function negate(state: RuleState): RuleState {
  if (state === 'met') return 'not_met';
  if (state === 'not_met') return 'met';
  return state;
}

function triToState(t: true | false | 'unknown'): RuleState {
  return t === true ? 'met' : t === false ? 'not_met' : 'unknown';
}

// ------------------------------------------------------------------ helpers

const out = (state: RuleState, explanation: string, extra: Partial<Outcome> = {}): Outcome => ({
  state,
  viaFuture: false,
  explanation,
  conditions: [],
  claimIds: [],
  dependencies: [],
  ...extra,
});

function unusable(f: Fact<unknown>, what: string): Outcome {
  if (f.status === 'conflict') return out('unknown', `${what}: the recorded sources disagree.`, { resolution: { kind: 'resolve_conflicting_facts', text: `Resolve the disagreement about ${what} with an updated document or school confirmation.`, owner: '03' }, claimIds: f.claimIds, dependencies: [f.fieldKey] });
  if (f.status === 'needs_confirmation') return out('unknown', `${what} is recorded but not yet confirmed.`, { resolution: { kind: 'confirm_fact', text: `Confirm ${what}.`, owner: '02' }, claimIds: f.claimIds, dependencies: [f.fieldKey] });
  return out('unknown', `${what} is not recorded.`, { resolution: { kind: 'needed_fact', text: `Provide ${what}.`, owner: '02' }, claimIds: f.claimIds, dependencies: [f.fieldKey] });
}

function evidenceRequirement(node: PredicateNode, stage: DecisionStage): EvidenceRequirement {
  const configured = node.evidence[stage];
  if (configured) return configured;
  return stage === 'enrollment' || stage === 'credit_or_placement' ? 'official_required' : 'self_report_ok';
}

/** Does the fact's origin satisfy the stage's evidence requirement? */
function originSatisfies(origin: string | undefined, req: EvidenceRequirement): boolean {
  if (req === 'self_report_ok') return true;
  if (req === 'document_ok') return origin === 'document_extraction' || origin === 'issuer_report' || origin === 'school_feed' || origin === 'reviewer_decision';
  return origin === 'issuer_report' || origin === 'school_feed';
}

function applyEvidenceRequirement(o: Outcome, origins: ReadonlyArray<string | undefined>, req: EvidenceRequirement, what: string): Outcome {
  if (o.state !== 'met' || origins.every((x) => originSatisfies(x, req))) return o;
  const text =
    req === 'official_required'
      ? `At this stage the institution needs ${what} through its official route (for example sent directly by the issuer or school); the copy in the app is not a substitute.`
      : `At this stage ${what} must be supported by a document, not only a statement.`;
  return { ...o, state: 'unknown', explanation: `${o.explanation} ${text}`, resolution: { kind: 'official_evidence', text, owner: req === 'official_required' ? 'institution' : '03' } };
}

function mayUseFuture(node: PredicateNode, ctx: EvaluationContext): boolean {
  return node.futureCompletionPermittedAt.includes(ctx.stage);
}

function gradeLabel(g: GradeValue): string {
  return `${g.original}${g.status !== 'final' ? ` (${g.status})` : ''}`;
}

// ------------------------------------------------------------------ predicates

type PairOutcome = { achieved: Outcome; route: Outcome };
const same = (o: Outcome): PairOutcome => ({ achieved: o, route: o });

function evaluatePredicate(node: PredicateNode, ctx: EvaluationContext): PairOutcome {
  const p = node.predicate;
  switch (p.type) {
    case 'qualification':
      return evalQualification(node, p, ctx);
    case 'subject_result':
      return evalSubject(node, p, ctx);
    case 'course_count':
      return evalCourseCount(node, p, ctx);
    case 'test_score':
      return evalTest(node, p, ctx);
    case 'category':
      return same(evalCategory(p, ctx));
    case 'schooling_language_years':
      return same(evalSchoolingLanguage(p, ctx));
    case 'waiver_approved':
      return same(evalWaiver(p, ctx));
    case 'institution_gpa':
      return same(evalGpa(p, ctx));
    case 'contextual_criterion':
      return same(evalContextual(p, ctx));
    case 'age':
      return same(evalAge(p, ctx));
    case 'completion_by':
      return evalCompletionBy(node, p, ctx);
  }
}

function evalQualification(node: PredicateNode, p: Extract<Predicate, { type: 'qualification' }>, ctx: EvaluationContext): PairOutcome {
  const quals = ctx.facts.qualifications();
  const deps = ['qualification:*.credential', 'qualification:*.status', 'qualification:*.total'];
  const claims = claimIdsOf(...quals.flatMap((q) => [q.credential, q.status, q.total]));
  const matching = quals.filter((q) => q.credential.status === 'usable' && p.credentialIds.includes(q.credential.value!.id));
  const unsure = quals.filter((q) => q.credential.status === 'needs_confirmation' || q.credential.status === 'conflict');
  if (matching.length === 0) {
    const system = ctx.facts.student<{ id: string }>('education.qualification_system');
    const allUsable = quals.length > 0 && unsure.length === 0 && quals.every((q) => q.credential.status === 'usable');
    if (allUsable && system.status === 'usable') {
      return same(out('not_met', `The recorded qualification is not one of the credentials this route requires.`, { claimIds: claimIdsOf(system, ...quals.map((q) => q.credential)), dependencies: [...deps, system.fieldKey] }));
    }
    return same(out('unknown', 'The qualification you are completing is not recorded yet.', { resolution: { kind: 'needed_fact', text: 'Tell us which qualification you are working toward, or upload a school record showing it.', owner: '02' }, claimIds: claims, dependencies: [...deps, 'student:self.education.qualification_system'] }));
  }
  const results = matching.map((q) => {
    const status = q.status;
    if (status.status !== 'usable') return { achieved: unusable(status, 'the qualification status'), route: unusable(status, 'the qualification status') };
    const s = status.value!;
    if (s === 'withdrawn') return same(out('not_met', 'The recorded qualification was withdrawn.', { claimIds: claimIdsOf(q.credential, status) }));
    const completed = s === 'completed' || s === 'awarded';
    let achieved: Outcome;
    let route: Outcome;
    if (!p.minimumTotal) {
      achieved = completed ? out('met', `${q.credential.value!.label} is completed.`) : out('unknown', `${q.credential.value!.label} is not completed yet.`, { resolution: { kind: 'future_condition', text: `Complete ${q.credential.value!.label}.`, owner: 'student' } });
      route = completed ? achieved : mayUseFuture(node, ctx) ? out('met', `${q.credential.value!.label} is in progress; the institution allows completion later at this stage.`, { viaFuture: true, conditions: [`Complete ${q.credential.value!.label}${q.expectedCompletion.value ? ` (expected ${q.expectedCompletion.value})` : ''}`] }) : achieved;
    } else {
      const total = q.total;
      if (total.status !== 'usable') {
        achieved = unusable(total, 'the qualification total');
        route = achieved;
      } else {
        const g = total.value!;
        const meets = meetsGradeThreshold(g, p.minimumTotal);
        if (ACHIEVED_STATUSES.has(g.status)) {
          achieved = out(meets === 'unknown' ? 'unknown' : meets ? 'met' : 'not_met', `Total ${gradeLabel(g)} against a required ${p.minimumTotal.original}.`, meets === 'unknown' ? { resolution: { kind: 'institution_instruction', text: 'The total is on a different scale from the published requirement; ask how it is assessed.', owner: 'institution' } } : {});
          route = achieved;
        } else {
          achieved = out('unknown', `Total ${gradeLabel(g)} is not a final result yet.`, { resolution: { kind: 'future_condition', text: `Final total of at least ${p.minimumTotal.original}.`, owner: 'student' } });
          route =
            meets === true && mayUseFuture(node, ctx)
              ? out('met', `Predicted total ${g.original} meets the required ${p.minimumTotal.original}; the requirement applies to the final result.`, { viaFuture: true, conditions: [`Final total of at least ${p.minimumTotal.original}`] })
              : out('unknown', meets === false ? `Predicted total ${g.original} is below the required ${p.minimumTotal.original}; only the final result can settle this.` : `Predicted total ${g.original} cannot yet satisfy a final-result requirement.`, { resolution: { kind: 'future_condition', text: `Final total of at least ${p.minimumTotal.original}.`, owner: 'student' } });
        }
      }
    }
    const cl = claimIdsOf(q.credential, q.status, q.total);
    return { achieved: { ...achieved, claimIds: cl }, route: { ...route, claimIds: cl } };
  });
  return combineAlternatives(results, deps);
}

function combineAlternatives(results: PairOutcome[], deps: string[]): PairOutcome {
  const pick = (mode: 'achieved' | 'route'): Outcome => {
    const list = results.map((r) => r[mode]);
    const state = combineAny(list.map((o) => o.state));
    const chosen = list.find((o) => o.state === state) ?? list[0]!;
    return { ...chosen, state, claimIds: [...new Set(list.flatMap((o) => o.claimIds))], dependencies: [...new Set([...deps, ...list.flatMap((o) => o.dependencies)])] };
  };
  return { achieved: pick('achieved'), route: pick('route') };
}

interface CourseEval {
  course: CourseFacts;
  achieved: Outcome;
  route: Outcome;
  courseKey: string;
}

function evalCourseAgainst(
  node: PredicateNode,
  c: CourseFacts,
  levels: readonly string[] | undefined,
  minimumGrade: { scaleRef: string; original: string } | undefined,
  ctx: EvaluationContext,
): { achieved: Outcome; route: Outcome } {
  const name = c.name.value ?? 'this course';
  const claims = claimIdsOf(c.subject, c.level, c.grade, c.enrollmentStatus, c.name);
  const deps = [c.subject.fieldKey, c.level.fieldKey, c.grade.fieldKey, c.enrollmentStatus.fieldKey];
  const wrap = (o: Outcome): Outcome => ({ ...o, claimIds: claims, dependencies: deps });
  if (levels) {
    if (c.level.status !== 'usable' || c.level.value!.normalized === null) {
      const o = c.level.status === 'usable' ? out('unknown', `The record does not show the level of ${name}.`, { resolution: { kind: 'needed_fact', text: `Confirm the level of ${name} from your school record.`, owner: '03' } }) : unusable(c.level, `the level of ${name}`);
      return { achieved: wrap(o), route: wrap(o) };
    }
    if (!levels.includes(c.level.value!.normalized)) {
      const o = out('not_met', `${name} is recorded at ${c.level.value!.original ?? c.level.value!.normalized}, not the required level.`);
      return { achieved: wrap(o), route: wrap(o) };
    }
  }
  if (!minimumGrade) {
    const st = c.enrollmentStatus;
    const graded = c.grade.status === 'usable' && ACHIEVED_STATUSES.has(c.grade.value!.status);
    if (graded || (st.status === 'usable' && st.value === 'completed')) return { achieved: wrap(out('met', `${name} is completed.`)), route: wrap(out('met', `${name} is completed.`)) };
    if (st.status === 'usable' && (st.value === 'withdrawn' || st.value === 'cancelled')) return { achieved: wrap(out('not_met', `${name} was ${st.value}.`)), route: wrap(out('not_met', `${name} was ${st.value}.`)) };
    const inFuture = st.status === 'usable' && ['planned', 'enrolled', 'in_progress'].includes(st.value!);
    const achieved = inFuture ? out('unknown', `${name} is not completed yet.`, { resolution: { kind: 'future_condition', text: `Complete ${name}.`, owner: 'student' } }) : unusable(st, `the status of ${name}`);
    const route = inFuture && mayUseFuture(node, ctx) ? out('met', `${name} is ${st.value!.replace('_', ' ')}; completion before entry is permitted.`, { viaFuture: true, conditions: [`Complete ${name}`] }) : achieved;
    return { achieved: wrap(achieved), route: wrap(route) };
  }
  if (c.grade.status !== 'usable') {
    const o = unusable(c.grade, `the grade for ${name}`);
    return { achieved: wrap(o), route: wrap(o) };
  }
  const g = c.grade.value!;
  const meets = meetsGradeThreshold(g, minimumGrade);
  if (meets === 'unknown') {
    const o = out('unknown', `The grade for ${name} (${g.original}) is not on the scale the requirement uses, or its scale is not established.`, { resolution: { kind: 'institution_instruction', text: `Ask how a grade of ${g.original} on your school's scale is assessed; no conversion is made here.`, owner: 'institution' } });
    return { achieved: wrap(o), route: wrap(o) };
  }
  if (ACHIEVED_STATUSES.has(g.status)) {
    const o = out(meets ? 'met' : 'not_met', `${name}: ${gradeLabel(g)} against a required ${minimumGrade.original}.`);
    return { achieved: wrap(o), route: wrap(o) };
  }
  if (FUTURE_STATUSES.has(g.status)) {
    const achieved = out('unknown', `${name}: ${gradeLabel(g)} is not a final result.`, { resolution: { kind: 'future_condition', text: `Final grade in ${name} of at least ${minimumGrade.original}.`, owner: 'student' } });
    const route =
      meets && mayUseFuture(node, ctx)
        ? out('met', `${name}: predicted ${g.original} meets the required ${minimumGrade.original}; the offer would depend on the final result.`, { viaFuture: true, conditions: [`Final grade in ${name} of at least ${minimumGrade.original}`] })
        : out('unknown', meets ? `${name}: predicted ${g.original}; this requirement needs a final result at this stage.` : `${name}: predicted ${g.original} is below the required ${minimumGrade.original}; only the final result can settle this.`, { resolution: { kind: 'future_condition', text: `Final grade in ${name} of at least ${minimumGrade.original}.`, owner: 'student' } });
    return { achieved: wrap(achieved), route: wrap(route) };
  }
  const o = out('unknown', `${name}: the result status "${g.status}" needs the institution's instruction.`, { resolution: { kind: 'institution_instruction', text: `Ask how a ${g.status.replace('_', ' ')} result is treated.`, owner: 'institution' } });
  return { achieved: wrap(o), route: wrap(o) };
}

function subjectCandidates(subjectKeys: readonly string[] | undefined, ctx: EvaluationContext): { matching: CourseFacts[]; possible: CourseFacts[] } {
  const courses = ctx.facts.courses().filter((c) => c.enrollmentStatus.value !== 'cancelled');
  if (!subjectKeys) return { matching: courses, possible: [] };
  const matching: CourseFacts[] = [];
  const possible: CourseFacts[] = [];
  for (const c of courses) {
    const s = c.subject;
    if (s.status === 'usable') {
      if (subjectKeys.includes(s.value!.key) && s.value!.basis !== 'broad_taxonomy') matching.push(c);
      else if (subjectKeys.some((k) => isPossibleSubjectMatch(s.value!.key, k)) && !subjectKeys.includes(s.value!.key)) possible.push(c);
      else if (s.value!.basis === 'broad_taxonomy' && subjectKeys.includes(s.value!.key)) possible.push(c);
    } else if (s.status === 'needs_confirmation' || s.status === 'conflict') {
      if (s.value && (subjectKeys.includes(s.value.key) || subjectKeys.some((k) => isPossibleSubjectMatch(s.value!.key, k)))) possible.push(c);
    }
  }
  return { matching, possible };
}

function courseListComplete(ctx: EvaluationContext): Fact<{ complete: boolean; throughPeriod: string }> {
  return ctx.facts.student('education.course_list_complete');
}

function evalSubject(node: PredicateNode, p: Extract<Predicate, { type: 'subject_result' }>, ctx: EvaluationContext): PairOutcome {
  const { matching, possible } = subjectCandidates(p.subjectKeys, ctx);
  const deps = ['course:*.subject_mapping', 'course:*.level', 'course:*.grade', 'course:*.enrollment_status', 'student:self.education.course_list_complete'];
  if (matching.length === 0) {
    const completeness = courseListComplete(ctx);
    if (possible.length > 0) {
      const names = possible.map((c) => c.name.value ?? 'a course').join(', ');
      return same(out('unknown', `${names} may correspond to the required subject, but the course content has not been matched to it.`, { resolution: { kind: 'qualified_review', text: `Confirm whether ${names} is the specific subject the program requires (a similar title is not enough).`, owner: 'human_review' }, claimIds: claimIdsOf(...possible.map((c) => c.subject)), dependencies: deps }));
    }
    if (completeness.status === 'usable' && completeness.value!.complete) {
      return same(out('not_met', `The required subject is not on your confirmed course list (through ${completeness.value!.throughPeriod}).`, { claimIds: completeness.claimIds, dependencies: deps }));
    }
    return same(out('unknown', 'The required subject is not on the courses recorded so far.', { resolution: { kind: 'needed_fact', text: 'Tell us whether you take or have taken this subject, or upload a full transcript.', owner: '02' }, claimIds: completeness.claimIds, dependencies: deps }));
  }
  // Only recorded attempts (resit/retake/remark) of one course are grouped; different periods of a course are separate results.
  const evals: CourseEval[] = matching.map((c) => ({ course: c, courseKey: c.attempt.status === 'usable' && c.courseKey.value ? c.courseKey.value : c.entityId, ...evalCourseAgainst(node, c, p.levels, p.minimumGrade, ctx) }));
  // Attempt policy: several attempts of the same course with different results stay unresolved unless the institution's policy is published.
  const byKey = new Map<string, CourseEval[]>();
  for (const e of evals) byKey.set(e.courseKey, [...(byKey.get(e.courseKey) ?? []), e]);
  const perCourse: PairOutcome[] = [...byKey.values()].map((attempts) => {
    if (attempts.length === 1) return { achieved: attempts[0]!.achieved, route: attempts[0]!.route };
    const ordered = [...attempts].sort((a, b) => (a.course.attempt.value?.number ?? 0) - (b.course.attempt.value?.number ?? 0));
    const choose = (mode: 'achieved' | 'route'): Outcome => {
      const states = ordered.map((a) => a[mode].state);
      const merged = { claimIds: [...new Set(ordered.flatMap((a) => a[mode].claimIds))], dependencies: [...new Set(ordered.flatMap((a) => a[mode].dependencies))] };
      if (p.attemptPolicy === 'latest') return { ...ordered[ordered.length - 1]![mode], ...merged };
      if (p.attemptPolicy === 'first') return { ...ordered[0]![mode], ...merged };
      if (p.attemptPolicy === 'any') return { ...ordered.find((a) => a[mode].state === combineAny(states))![mode], state: combineAny(states), ...merged };
      if (states.every((s) => s === states[0])) return { ...ordered[0]![mode], ...merged };
      return out('unknown', 'Several attempts of this course have different results, and the institution decides how repeated results are considered.', { resolution: { kind: 'institution_instruction', text: 'Ask how the institution treats repeated attempts (resits) for this requirement.', owner: 'institution' }, ...merged });
    };
    return { achieved: choose('achieved'), route: choose('route') };
  });
  const combined = combineAlternatives(perCourse, deps);
  // Possible matches keep a negative from being definitive.
  const guard = (o: Outcome): Outcome =>
    o.state === 'not_met' && possible.length > 0 ? { ...o, state: 'unknown', resolution: { kind: 'qualified_review', text: 'Another course may satisfy this requirement; confirm its content.', owner: 'human_review' } } : o;
  const req = evidenceRequirement(node, ctx.stage);
  const origins = matching.flatMap((c) => [c.grade.origin, c.level.origin]).filter((x): x is string => x !== undefined);
  return {
    achieved: applyEvidenceRequirement(guard(combined.achieved), origins, req, 'the course result'),
    route: applyEvidenceRequirement(guard(combined.route), origins, req, 'the course result'),
  };
}

function evalCourseCount(node: PredicateNode, p: Extract<Predicate, { type: 'course_count' }>, ctx: EvaluationContext): PairOutcome {
  const { matching, possible } = subjectCandidates(p.subjectKeys, ctx);
  const evals = matching.map((c) => evalCourseAgainst(node, c, p.levels, p.minimumGrade, ctx));
  const deps = ['course:*.subject_mapping', 'course:*.level', 'course:*.grade', 'course:*.enrollment_status', 'student:self.education.course_list_complete'];
  const completeness = courseListComplete(ctx);
  const listComplete = completeness.status === 'usable' && completeness.value!.complete;
  const count = (mode: 'achieved' | 'route'): Outcome => {
    const met = evals.filter((e) => e[mode].state === 'met').length;
    const unknown = evals.filter((e) => e[mode].state === 'unknown').length + possible.length + (listComplete ? 0 : p.minCount);
    const state: RuleState = met >= p.minCount ? 'met' : met + unknown < p.minCount ? 'not_met' : 'unknown';
    const viaFuture = mode === 'route' && evals.some((e) => e.route.viaFuture);
    return out(state, `${met} of the required ${p.minCount} qualifying courses are ${mode === 'route' ? 'met or on track' : 'met'}.`, {
      viaFuture: viaFuture && state === 'met',
      conditions: mode === 'route' ? evals.flatMap((e) => e.route.conditions) : [],
      claimIds: [...new Set(evals.flatMap((e) => e[mode].claimIds)), ...completeness.claimIds],
      dependencies: deps,
      ...(state === 'unknown' ? { resolution: { kind: listComplete ? 'confirm_fact' : 'needed_fact', text: listComplete ? 'Confirm the level and results of the listed courses.' : 'Confirm your full course list so the count can be checked.', owner: '02' } as Resolution } : {}),
    });
  };
  return { achieved: count('achieved'), route: count('route') };
}

function evalTest(node: PredicateNode, p: Extract<Predicate, { type: 'test_score' }>, ctx: EvaluationContext): PairOutcome {
  const deps = ['test_attempt:*.record'];
  const tests = ctx.facts.tests().filter((t) => (t.record.value ? t.record.value.family === p.family : true));
  const usable = tests.filter((t) => t.record.status === 'usable' && t.record.value!.family === p.family);
  const pending = tests.filter((t) => t.record.status === 'needs_confirmation' || t.record.status === 'conflict');
  const acceptedLabels = p.acceptedVersions.map((v) => TEST_VERSIONS[v]?.label ?? v).join(' or ');
  if (usable.length === 0) {
    if (pending.length > 0) return same({ ...unusable(pending[0]!.record, `your ${p.family.replace('_', ' ')} score`), dependencies: deps });
    return same(out('unknown', `No ${p.family.replace(/_/g, ' ')} score is recorded.`, { resolution: { kind: 'needed_fact', text: `Add a ${p.family.replace(/_/g, ' ')} score if you have one, or use another accepted route.`, owner: '02' }, dependencies: deps }));
  }
  const req = evidenceRequirement(node, ctx.stage);
  const results: Outcome[] = usable.map((t) => {
    const r = t.record.value as TestScoreRecord;
    const claims = t.record.claimIds;
    if (r.reportStatus === 'unofficial_practice') return out('unknown', 'A practice score cannot satisfy a requirement.', { claimIds: claims, dependencies: deps, resolution: { kind: 'needed_fact', text: 'An official score is needed.', owner: 'student' } });
    if (r.versionRef === null || !p.acceptedVersions.includes(r.versionRef)) {
      const yours = r.versionRef ? TEST_VERSIONS[r.versionRef]?.label ?? r.versionRef : 'an unidentified scale';
      return out('unknown', `Your report uses ${yours}; the institution's published requirement refers to ${acceptedLabels}. No conversion between scales is made.`, { claimIds: claims, dependencies: deps, resolution: { kind: 'institution_instruction', text: `Check the institution's instructions for scores reported on ${yours}.`, owner: 'institution' } });
    }
    if (r.combination === 'issuer_superscore' && !p.acceptsIssuerSuperscore) return out('unknown', 'This is a superscore, and the requirement does not say superscores are accepted.', { claimIds: claims, dependencies: deps, resolution: { kind: 'institution_instruction', text: 'Ask whether superscores are accepted, or use a single-administration score.', owner: 'institution' } });
    if (p.administeredOnOrAfter) {
      const tooOld = isOnOrBefore(r.administrationDate, p.administeredOnOrAfter);
      if (tooOld === true && r.administrationDate !== p.administeredOnOrAfter) return out('not_met', `The test was taken on ${r.administrationDate}, before the earliest accepted date (${p.administeredOnOrAfter}).`, { claimIds: claims, dependencies: deps });
      if (tooOld === 'unknown') return out('unknown', 'The exact test date is needed to check whether the score is still valid.', { claimIds: claims, dependencies: deps, resolution: { kind: 'needed_fact', text: 'Provide the exact test date.', owner: '02' } });
    }
    const value = p.component === 'total' ? r.reportedTotal : r.sections[p.component];
    if (value === null || value === undefined) return out('unknown', `The ${p.component === 'total' ? 'total' : p.component} score is not recorded.`, { claimIds: claims, dependencies: deps, resolution: { kind: 'needed_fact', text: `Add the ${p.component} score as reported.`, owner: '02' } });
    const sectionShortfalls = p.sectionMinimums.filter((m) => r.sections[m.section] !== undefined && r.sections[m.section]! < m.minimum);
    const sectionUnknown = p.sectionMinimums.filter((m) => r.sections[m.section] === undefined);
    let o: Outcome;
    if (value < p.minimum || sectionShortfalls.length > 0) o = out('not_met', `Reported ${p.component} ${value} against a required ${p.minimum}${sectionShortfalls.length > 0 ? `; below the minimum in ${sectionShortfalls.map((s) => s.section).join(', ')}` : ''}.`, { claimIds: claims, dependencies: deps });
    else if (sectionUnknown.length > 0) o = out('unknown', `Section scores for ${sectionUnknown.map((s) => s.section).join(', ')} are needed.`, { claimIds: claims, dependencies: deps, resolution: { kind: 'needed_fact', text: 'Add the section scores as reported.', owner: '02' } });
    else o = out('met', `Reported ${p.component} ${value} meets the required ${p.minimum}.`, { claimIds: claims, dependencies: deps });
    const withStatus = o.state === 'met' && req !== 'self_report_ok' && r.reportStatus !== 'official' ? { ...o, state: 'unknown' as const, resolution: { kind: 'official_evidence' as const, text: 'An official score report is needed at this stage.', owner: 'institution' as const } } : o;
    return applyEvidenceRequirement(withStatus, [t.record.origin], req, 'the score');
  });
  const state = combineAny(results.map((r) => r.state));
  const chosen = results.find((r) => r.state === state) ?? results[0]!;
  return same({ ...chosen, state, claimIds: [...new Set(results.flatMap((r) => r.claimIds))], dependencies: deps });
}

function evalCategory(p: Extract<Predicate, { type: 'category' }>, ctx: EvaluationContext): Outcome {
  const test = (values: readonly string[], present: readonly string[]): RuleState => {
    const hit = present.some((v) => values.includes(v));
    return (p.operator === 'in' ? hit : !hit) ? 'met' : 'not_met';
  };
  const label: Record<typeof p.fact, string> = {
    citizenship: 'citizenship',
    residence_country: 'country of residence',
    school_country: 'school country',
    schooling_language: 'language of instruction',
    applicant_category: 'applicant category',
    postsecondary_enrollment: 'college enrollment history',
    qualification_system: 'qualification system',
  };
  if (p.fact === 'applicant_category') {
    if (ctx.applicantCategory === null) return out('unknown', 'Your applicant category is not settled yet.', { resolution: { kind: 'needed_fact', text: 'Confirm whether you would apply as a first-year or transfer applicant (this depends on any college study after secondary school).', owner: '02' } });
    return out(test(p.values, [ctx.applicantCategory]), `Applicant category: ${ctx.applicantCategory.replace('_', '-')}.`);
  }
  const attribute: Record<Exclude<typeof p.fact, 'applicant_category'>, string> = {
    citizenship: 'identity.citizenships',
    residence_country: 'identity.residence_country',
    school_country: 'education.school_country',
    schooling_language: 'education.schooling_language',
    postsecondary_enrollment: 'education.postsecondary_enrollment',
    qualification_system: 'education.qualification_system',
  };
  const f = ctx.facts.student<unknown>(attribute[p.fact]);
  if (f.status !== 'usable') return { ...unusable(f as Fact<unknown>, `your ${label[p.fact]}`), dependencies: [f.fieldKey] };
  const v = f.value;
  const present = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : v && typeof v === 'object' ? [String((v as Record<string, unknown>)['language'] ?? (v as Record<string, unknown>)['id'])] : [];
  return out(test(p.values, present), `Checked your ${label[p.fact]} against the published condition.`, { claimIds: f.claimIds, dependencies: [f.fieldKey] });
}

function evalSchoolingLanguage(p: Extract<Predicate, { type: 'schooling_language_years' }>, ctx: EvaluationContext): Outcome {
  const f = ctx.facts.student<{ language: string; yearsOfInstruction: number | null }>('education.schooling_language');
  if (f.status !== 'usable') return { ...unusable(f, 'the language of instruction at school'), dependencies: [f.fieldKey] };
  const v = f.value!;
  const base = { claimIds: f.claimIds, dependencies: [f.fieldKey] };
  if (!p.languages.includes(v.language)) return out('not_met', `Instruction was in ${v.language}, not a listed language.`, base);
  if (v.yearsOfInstruction === null) return out('unknown', 'The number of years of instruction in that language is needed.', { ...base, resolution: { kind: 'needed_fact', text: 'How many years has your schooling been taught in this language?', owner: '02' } });
  return out(v.yearsOfInstruction >= p.minimumYears ? 'met' : 'not_met', `${v.yearsOfInstruction} years of instruction in ${v.language} against a required ${p.minimumYears}.`, base);
}

function evalWaiver(p: Extract<Predicate, { type: 'waiver_approved' }>, ctx: EvaluationContext): Outcome {
  const w = ctx.facts.waivers().find((x) => x.value?.waiverRef === p.waiverRef);
  const deps = ['waiver:*.state'];
  if (!w) return out('unknown', 'No waiver request is recorded.', { resolution: { kind: 'published_alternative', text: 'If you may qualify, the waiver must be requested and approved by the institution.', owner: 'institution' }, dependencies: deps });
  if (w.status !== 'usable') return { ...unusable(w as Fact<unknown>, 'the waiver status'), dependencies: deps };
  const s = w.value!.state;
  const base = { claimIds: w.claimIds, dependencies: deps };
  if (s === 'approved') return out('met', 'The institution approved the waiver.', base);
  if (s === 'denied') return out('not_met', 'The waiver was denied.', base);
  if (s === 'pending') return out('unknown', 'The waiver request is pending; it is not approved until the institution says so.', { ...base, resolution: { kind: 'future_condition', text: 'Wait for the institution’s decision on the waiver.', owner: 'institution' } });
  return out('not_met', 'A waiver has not been requested; it only applies once approved.', { ...base, resolution: { kind: 'published_alternative', text: 'Request the waiver if you meet its published conditions.', owner: 'student' } });
}

function evalGpa(p: Extract<Predicate, { type: 'institution_gpa' }>, ctx: EvaluationContext): Outcome {
  const g = ctx.facts.gpaCalculations().find((x) => x.value?.calculationRef === p.calculationRef);
  const deps = ['gpa_calculation:*.result'];
  if (!g) return out('unknown', 'This requirement uses the institution’s own GPA calculation; a general GPA cannot be substituted.', { resolution: { kind: 'institution_instruction', text: 'Calculate the GPA with the institution’s published method and eligible courses.', owner: 'institution' }, dependencies: deps });
  if (g.status !== 'usable') return { ...unusable(g as Fact<unknown>, 'the institution-specific GPA'), dependencies: deps };
  return out(g.value!.value >= p.minimum ? 'met' : 'not_met', `Institution-method GPA ${g.value!.value} against a required ${p.minimum}.`, { claimIds: g.claimIds, dependencies: deps });
}

function evalContextual(p: Extract<Predicate, { type: 'contextual_criterion' }>, ctx: EvaluationContext): Outcome {
  const c = ctx.facts.contextualCriteria().find((x) => x.value?.criteriaRef === p.criteriaRef);
  const deps = ['contextual_criterion:*.result'];
  if (!c) return out('unknown', 'Contextual routes depend on explicit published criteria; nothing is inferred from names, places or assumed background.', { resolution: { kind: 'institution_instruction', text: 'Check the institution’s published contextual criteria with your school.', owner: 'institution' }, dependencies: deps });
  if (c.status !== 'usable') return { ...unusable(c as Fact<unknown>, 'the contextual criterion'), dependencies: deps };
  return out(c.value!.meets ? 'met' : 'not_met', 'Checked against the published contextual criterion.', { claimIds: c.claimIds, dependencies: deps });
}

function evalAge(p: Extract<Predicate, { type: 'age' }>, ctx: EvaluationContext): Outcome {
  const deps = ['student:self.identity.birth_date', 'age_attestation:*.meets'];
  const att = ctx.facts.ageAttestations().find((a) => a.meets.status === 'usable' && a.referenceDate.value === p.referenceDate && a.minimumAge.value === p.minimumAge);
  if (att && p.maximumAgeInclusive === undefined) return out(att.meets.value ? 'met' : 'not_met', `Age on ${p.referenceDate} checked from your answer.`, { claimIds: claimIdsOf(att.meets, att.minimumAge, att.referenceDate), dependencies: deps });
  const b = ctx.facts.student<string>('identity.birth_date');
  if (b.status !== 'usable') {
    const question = p.minimumAge !== undefined ? `Will you be at least ${p.minimumAge} on ${p.referenceDate}?` : `Will you be ${p.maximumAgeInclusive} or younger on ${p.referenceDate}?`;
    return out('unknown', `Your age on ${p.referenceDate} is needed for this rule.`, { resolution: { kind: 'needed_fact', text: question, owner: '02' }, dependencies: deps });
  }
  const checks: RuleState[] = [];
  if (p.minimumAge !== undefined) checks.push(triToState(meetsMinimumAge(b.value!, p.referenceDate, p.minimumAge)));
  if (p.maximumAgeInclusive !== undefined) checks.push(triToState(meetsMaximumAge(b.value!, p.referenceDate, p.maximumAgeInclusive)));
  const state = combineAll(checks);
  return out(state, `Age on ${p.referenceDate} (the organizer’s reference date).`, { claimIds: b.claimIds, dependencies: deps, ...(state === 'unknown' ? { resolution: { kind: 'needed_fact', text: 'A more precise date of birth is needed to settle this.', owner: '02' } as Resolution } : {}) });
}

function evalCompletionBy(node: PredicateNode, p: Extract<Predicate, { type: 'completion_by' }>, ctx: EvaluationContext): PairOutcome {
  const stage = ctx.facts.student<string>('education.stage');
  const grad = ctx.facts.student<string>('education.expected_graduation');
  const deps = [stage.fieldKey, grad.fieldKey];
  const claims = claimIdsOf(stage, grad);
  if (stage.status === 'usable' && ['completed_secondary', 'gap_year', 'postsecondary'].includes(stage.value!)) return same(out('met', 'Secondary education is completed.', { claimIds: claims, dependencies: deps }));
  if (grad.status !== 'usable') return same({ ...unusable(grad, 'your expected completion date'), dependencies: deps });
  const before = isOnOrBefore(grad.value!, p.latestDate);
  const achieved = out('unknown', 'Completion is expected but has not happened yet.', { claimIds: claims, dependencies: deps, resolution: { kind: 'future_condition', text: `Complete by ${p.latestDate}.`, owner: 'student' } });
  if (before === false) return same(out('not_met', `Expected completion ${grad.value} is after the latest accepted date ${p.latestDate}.`, { claimIds: claims, dependencies: deps }));
  if (before === 'unknown') return same(out('unknown', `Expected completion ${grad.value} may fall after ${p.latestDate}; a more precise date is needed.`, { claimIds: claims, dependencies: deps, resolution: { kind: 'needed_fact', text: 'Confirm your exact expected completion date.', owner: '02' } }));
  const route = mayUseFuture(node, ctx) ? out('met', `Expected completion ${grad.value} is before ${p.latestDate}.`, { viaFuture: true, conditions: [`Complete by ${p.latestDate}`], claimIds: claims, dependencies: deps }) : achieved;
  return { achieved, route };
}

// ------------------------------------------------------------------ conditions and tree

function evalCondition(c: Condition, ctx: EvaluationContext): { state: RuleState; claimIds: string[]; dependencies: string[] } {
  if (c.kind === 'predicate') {
    const synthetic: PredicateNode = { kind: 'predicate', id: '_cond', label: 'applicability', predicate: c.predicate, stages: [ctx.stage], mandatory: true, futureCompletionPermittedAt: [], evidence: {}, source: { sourceId: '_', quote: '_' } };
    const r = evaluatePredicate(synthetic, { ...ctx }).achieved;
    return { state: r.state, claimIds: r.claimIds, dependencies: r.dependencies };
  }
  if (c.kind === 'not') {
    const r = evalCondition(c.child, ctx);
    return { ...r, state: negate(r.state) };
  }
  const rs = c.children.map((x) => evalCondition(x, ctx));
  const state = c.kind === 'all' ? combineAll(rs.map((r) => r.state)) : combineAny(rs.map((r) => r.state));
  return { state, claimIds: rs.flatMap((r) => r.claimIds), dependencies: rs.flatMap((r) => r.dependencies) };
}

export function evaluateTree(ctx: EvaluationContext): TreeEvaluation {
  const atomic: AtomicFinding[] = [];
  const groups: GroupFinding[] = [];
  const claimIds = new Set<string>();
  const dependencies = new Set<string>();
  const conflicted = new Map<string, SourceConflict>();
  for (const c of ctx.pkg.sourceConflicts) if (c.status === 'unresolved') for (const r of c.affectedRuleIds) conflicted.set(r, c);

  const visit = (node: RuleNode): { achieved: RuleState; route: RuleState } => {
    // Stage filter.
    const nodeStages = node.kind === 'predicate' ? node.stages : node.kind === 'not' ? undefined : node.stages;
    if (nodeStages && !nodeStages.includes(ctx.stage)) {
      if (node.kind === 'predicate') atomic.push(finding(node, 'not_applicable', 'not_applicable', out('not_applicable', `Does not apply at the ${ctx.stage.replace(/_/g, ' ')} stage.`)));
      return { achieved: 'not_applicable', route: 'not_applicable' };
    }
    // Applicability before the substantive predicate.
    const applicability = node.kind !== 'not' ? node.applicability : undefined;
    if (applicability) {
      const a = evalCondition(applicability, ctx);
      a.claimIds.forEach((x) => claimIds.add(x));
      a.dependencies.forEach((x) => dependencies.add(x));
      if (a.state === 'not_met' || a.state === 'not_applicable') {
        if (node.kind === 'predicate') atomic.push(finding(node, 'not_applicable', 'not_applicable', out('not_applicable', 'This condition does not apply to your situation under the published rule.', { claimIds: a.claimIds })));
        else if (node.kind !== 'not') groups.push({ ruleId: node.id, label: node.label, kind: node.kind, state: 'not_applicable', stateWithPermittedRoutes: 'not_applicable', childIds: node.children.map((c) => c.id) });
        return { achieved: 'not_applicable', route: 'not_applicable' };
      }
      if (a.state === 'unknown') {
        const o = out('unknown', 'Whether this condition applies to you depends on information not yet recorded.', { resolution: { kind: 'needed_fact', text: 'Provide the information that decides whether this rule applies.', owner: '02' }, claimIds: a.claimIds });
        if (node.kind === 'predicate') atomic.push(finding(node, 'unknown', 'unknown', o));
        else if (node.kind !== 'not') groups.push({ ruleId: node.id, label: node.label, kind: node.kind, state: 'unknown', stateWithPermittedRoutes: 'unknown', childIds: node.children.map((c) => c.id) });
        return { achieved: 'unknown', route: 'unknown' };
      }
    }
    if (node.kind === 'predicate') {
      if (conflicted.has(node.id)) {
        const c = conflicted.get(node.id)!;
        const o = out('unknown', `Official sources disagree about this requirement: ${c.description}`, { resolution: { kind: 'source_clarification', text: c.question, owner: '11' } });
        atomic.push(finding(node, 'unknown', 'unknown', o));
        return { achieved: 'unknown', route: 'unknown' };
      }
      const r = evaluatePredicate(node, ctx);
      r.achieved.claimIds.forEach((x) => claimIds.add(x));
      r.route.claimIds.forEach((x) => claimIds.add(x));
      [...r.achieved.dependencies, ...r.route.dependencies].forEach((x) => dependencies.add(x));
      atomic.push(finding(node, r.achieved.state, r.route.state, r.achieved, r.route));
      if (!node.mandatory) return { achieved: 'not_applicable', route: 'not_applicable' };
      return { achieved: r.achieved.state, route: r.route.state };
    }
    if (node.kind === 'not') {
      const r = visit(node.child);
      const res = { achieved: negate(r.achieved), route: negate(r.route) };
      groups.push({ ruleId: node.id, label: node.label, kind: 'not', state: res.achieved, stateWithPermittedRoutes: res.route, childIds: [node.child.id] });
      return res;
    }
    const children = node.children.map(visit);
    const combine = (states: RuleState[]): RuleState => (node.kind === 'all' ? combineAll(states) : node.kind === 'any' ? combineAny(states) : combineAtLeast(states, node.n!));
    const res = { achieved: combine(children.map((c) => c.achieved)), route: combine(children.map((c) => c.route)) };
    groups.push({ ruleId: node.id, label: node.label, kind: node.kind, state: res.achieved, stateWithPermittedRoutes: res.route, childIds: node.children.map((c) => c.id) });
    return res;
  };

  const root = visit(ctx.pkg.rules);
  return { achieved: root.achieved, route: root.route, atomic, groups, claimIds: [...claimIds], dependencies: [...dependencies] };
}

function finding(node: PredicateNode, state: RuleState, routeState: RuleState, achieved: Outcome, route?: Outcome): AtomicFinding {
  const f: AtomicFinding = {
    ruleId: node.id,
    label: node.label,
    mandatory: node.mandatory,
    state,
    stateWithPermittedRoutes: routeState,
    explanation: achieved.explanation,
    futureConditions: route && route.state === 'met' && route.viaFuture ? route.conditions : [],
    claimIds: [...new Set([...achieved.claimIds, ...(route?.claimIds ?? [])])],
    source: node.source,
    inputFields: [...new Set([...achieved.dependencies, ...(route?.dependencies ?? [])])].filter((k) => !k.includes('*')),
  };
  const resolution = achieved.resolution ?? route?.resolution;
  if (resolution && state !== 'met' && state !== 'not_applicable') f.resolution = resolution;
  if (state === 'not_met' && node.publishedRemedy) f.publishedRemedy = node.publishedRemedy;
  if (state === 'not_met' && !f.resolution && node.publishedRemedy) f.resolution = { kind: 'published_alternative', text: node.publishedRemedy, owner: 'student' };
  return f;
}

export type OverallFinding = 'apparently_meets' | 'conditionally_on_track' | 'requirement_not_met' | 'unresolved' | 'outside_supported_coverage';

/**
 * Overall finding derived from the two evaluations. A hard negative requires
 * both the achieved and the route evaluation to be not_met ("A hard negative
 * should receive especially careful validation because it can wrongly
 * discourage an application").
 */
export function deriveOverall(achieved: RuleState, route: RuleState): OverallFinding {
  // A tree in which nothing applies is not evidence of meeting requirements.
  if (achieved === 'met') return 'apparently_meets';
  if (route === 'met') return 'conditionally_on_track';
  if (achieved === 'not_met' && route === 'not_met') return 'requirement_not_met';
  return 'unresolved';
}
