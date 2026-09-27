import { isAbsence } from '../../shared/absence.js';
import type { CourseLevel } from '../../shared/fields.js';
import { ACHIEVED_STATUSES, type GradeValue } from '../../shared/grades.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import type { EligibilityPayload } from '../a06-eligibility/agent.js';
import type { RuleNode, RulePackage } from '../a06-eligibility/rules.js';

/**
 * Course planning (07R03, 07R06). Requirements come from Agent 06's findings
 * and the verified rule package, never from memory. School offerings decide
 * what is possible: a course in the catalog is not a course that runs (07T04),
 * a course cannot be scheduled before its prerequisite, and nothing is ever
 * shown as approved or enrolled until the school confirms it.
 */

export interface CourseNeed {
  targetKey: string;
  ruleId: string;
  label: string;
  mandatory: boolean;
  subjectKeys: string[];
  levels: string[] | null;
  /** State from the eligibility finding; 'unknown' when no current finding exists. */
  state: 'met' | 'not_met' | 'unknown' | 'not_applicable';
  resolution: string | null;
  /** The rule sits inside an "any of" group, so another route may satisfy it. */
  hasAlternatives: boolean;
}

export function courseNeedsFrom(pkg: RulePackage, finding: EligibilityPayload | null, targetKey: string): CourseNeed[] {
  const out: CourseNeed[] = [];
  const walk = (n: RuleNode, insideAny: boolean) => {
    if (n.kind === 'predicate') {
      const p = n.predicate;
      if (p.type !== 'subject_result' && p.type !== 'course_count') return;
      const f = finding?.findings.find((x) => x.ruleId === n.id);
      out.push({
        targetKey,
        ruleId: n.id,
        label: n.label,
        mandatory: n.mandatory,
        subjectKeys: p.subjectKeys ?? [],
        levels: p.levels ? [...p.levels] : null,
        state: f ? f.stateWithPermittedRoutes : 'unknown',
        resolution: f?.resolution?.text ?? null,
        hasAlternatives: insideAny,
      });
      return;
    }
    if (n.kind === 'not') return walk(n.child, insideAny);
    for (const c of n.children) walk(c, insideAny || n.kind === 'any' || n.kind === 'at_least');
  };
  walk(pkg.rules, false);
  return out;
}

export interface Offering {
  entityId: string;
  claimId: string;
  name: string;
  subjectKey: string | null;
  level: string | null;
  termsOffered: string[];
  prerequisites: string[];
  availability: 'catalog_listed' | 'confirmed_running' | 'not_offered' | 'unknown';
}

export interface StudentCourse {
  entityId: string;
  claimIds: string[];
  name: string;
  subjectKey: string | null;
  level: string | null;
  status: string | null;
  /** An achieved (final, remarked, resit, transfer) grade is on record. */
  achieved: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function readCourses(view: RecordView): { offerings: Offering[]; courses: StudentCourse[] } {
  const offerings: Offering[] = view.entityIds('school_offering').flatMap((id) => {
    const c = view.current('school_offering', id, 'course');
    if (!c || isAbsence(c.value)) return [];
    const v = c.value as { name: string; subjectKey: string | null; level: string | null; termsOffered: string[]; prerequisites: string[]; availability: Offering['availability'] };
    return [{ entityId: id, claimId: c.claimId, name: v.name, subjectKey: v.subjectKey, level: v.level, termsOffered: v.termsOffered, prerequisites: v.prerequisites, availability: v.availability }];
  });
  const courses: StudentCourse[] = view.entityIds('course').flatMap((id) => {
    const name = view.current('course', id, 'name_original');
    if (!name || isAbsence(name.value)) return [];
    const mapping = view.current('course', id, 'subject_mapping');
    const level = view.current('course', id, 'level');
    const status = view.current('course', id, 'enrollment_status');
    const grade = view.value<GradeValue>('course', id, 'grade');
    const lv = level && !isAbsence(level.value) ? (level.value as CourseLevel).normalized : null;
    return [{ entityId: id, claimIds: [name, mapping, level, status].filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.claimId), name: String(name.value), subjectKey: mapping && !isAbsence(mapping.value) ? (mapping.value as { key: string }).key : null, level: lv, status: status && !isAbsence(status.value) ? String(status.value) : null, achieved: !!grade && ACHIEVED_STATUSES.has(grade.status) }];
  });
  return { offerings, courses };
}

export interface CoursePlanItem {
  id: string;
  purpose: 'required_prerequisite' | 'required_subject_route' | 'alternative_route';
  forTargets: string[];
  need: string;
  course: string | null;
  term: string | null;
  status: 'already_met' | 'in_progress' | 'proposed' | 'conditional' | 'no_option_found';
  availability: Offering['availability'] | null;
  dependsOn: string[];
  confirmationNeeded: string | null;
  alternatives: string[];
  claimIds: string[];
}

export interface CoursePlan {
  items: CoursePlanItem[];
  cycles: string[][];
  issues: string[];
}

function detectCycles(offerings: readonly Offering[]): string[][] {
  const byName = new Map(offerings.map((o) => [norm(o.name), o]));
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (o: Offering) => {
    const k = norm(o.name);
    if (state.get(k) === 'done') return;
    if (state.get(k) === 'visiting') {
      const i = stack.indexOf(k);
      cycles.push([...stack.slice(i), k].map((x) => byName.get(x)?.name ?? x));
      return;
    }
    state.set(k, 'visiting');
    stack.push(k);
    for (const p of o.prerequisites) {
      const next = byName.get(norm(p));
      if (next) visit(next);
    }
    stack.pop();
    state.set(k, 'done');
  };
  for (const o of offerings) visit(o);
  return cycles;
}

function termIndex(term: string, order: readonly string[]): number {
  const i = order.findIndex((t) => norm(t) === norm(term));
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

export function planCourses(needs: readonly CourseNeed[], offerings: readonly Offering[], courses: readonly StudentCourse[], termOrder: readonly string[]): CoursePlan {
  const items: CoursePlanItem[] = [];
  const issues: string[] = [];
  const cycles = detectCycles(offerings);
  for (const c of cycles) issues.push(`The school’s prerequisites form a loop (${c.join(' → ')}); the school needs to confirm the actual sequence.`);
  const byName = new Map(offerings.map((o) => [norm(o.name), o]));
  // A prerequisite counts as met only when the course is completed, in progress, or has an achieved grade.
  const done = (name: string) => courses.some((c) => norm(c.name) === norm(name) && (c.status === 'completed' || c.status === 'in_progress' || c.achieved));
  const matchesNeed = (subjectKey: string | null, level: string | null, need: CourseNeed) => !!subjectKey && need.subjectKeys.includes(subjectKey) && (need.levels === null || (level !== null && need.levels.includes(level)));

  // Merge the same need across targets (e.g. two programs both asking for the same subject).
  const merged = new Map<string, CourseNeed & { targets: string[] }>();
  for (const n of needs) {
    const k = `${[...n.subjectKeys].sort().join('|')}#${(n.levels ?? []).join('|')}`;
    const m = merged.get(k);
    if (m) {
      m.targets.push(n.targetKey);
      if (n.state !== 'met') m.state = n.state;
    } else merged.set(k, { ...n, targets: [n.targetKey] });
  }

  for (const need of merged.values()) {
    const base = { id: `course_${need.ruleId}`, purpose: (need.hasAlternatives ? 'alternative_route' : 'required_subject_route') as CoursePlanItem['purpose'], forTargets: need.targets, need: need.label };
    if (need.state === 'met' || need.state === 'not_applicable') {
      items.push({ ...base, course: null, term: null, status: 'already_met', availability: null, dependsOn: [], confirmationNeeded: null, alternatives: [], claimIds: [] });
      continue;
    }
    const own = courses.find((c) => matchesNeed(c.subjectKey, c.level, need));
    if (own && own.status === 'in_progress') {
      items.push({ ...base, course: own.name, term: null, status: 'in_progress', availability: null, dependsOn: [], confirmationNeeded: need.resolution, alternatives: [], claimIds: own.claimIds });
      continue;
    }
    if (need.state === 'unknown' && need.resolution && courses.some((c) => c.subjectKey && need.subjectKeys.includes(c.subjectKey))) {
      // The student may already take the course; the missing detail must be confirmed before planning anything new.
      const related = courses.filter((c) => c.subjectKey && need.subjectKeys.includes(c.subjectKey));
      items.push({ ...base, course: related[0]!.name, term: null, status: 'conditional', availability: null, dependsOn: [], confirmationNeeded: need.resolution, alternatives: [], claimIds: related.flatMap((c) => c.claimIds) });
      continue;
    }
    const candidates = offerings.filter((o) => matchesNeed(o.subjectKey, o.level, need) && o.availability !== 'not_offered');
    if (candidates.length === 0) {
      items.push({
        ...base,
        course: null,
        term: null,
        status: 'no_option_found',
        availability: offerings.some((o) => matchesNeed(o.subjectKey, o.level, need)) ? 'not_offered' : null,
        dependsOn: [],
        confirmationNeeded: `No course at your school is listed that meets “${need.label}”. Ask your school counselor whether there is an approved way to meet it.`,
        alternatives: [need.hasAlternatives ? 'This program lists other ways to meet the requirement; check whether one of them fits.' : 'Another program with requirements you can meet at your school.', 'An approved course outside school, only if your school and the program accept it.'],
        claimIds: [],
      });
      continue;
    }
    const o = [...candidates].sort((a, b) => (a.availability === 'confirmed_running' ? 0 : 1) - (b.availability === 'confirmed_running' ? 0 : 1) || a.name.localeCompare(b.name))[0]!;
    const deps: string[] = [];
    const blocked: string[] = [];
    let earliest = 0;
    for (const p of o.prerequisites) {
      if (done(p)) continue;
      const po = byName.get(norm(p));
      if (!po || po.availability === 'not_offered') {
        blocked.push(p);
        continue;
      }
      deps.push(`course_prereq_${norm(p).replace(/ /g, '_')}`);
      const pt = po.termsOffered.map((t) => termIndex(t, termOrder)).sort((a, b) => a - b)[0] ?? 0;
      earliest = Math.max(earliest, pt + 1);
      if (!items.some((i) => i.id === `course_prereq_${norm(p).replace(/ /g, '_')}`)) {
        items.push({
          id: `course_prereq_${norm(p).replace(/ /g, '_')}`,
          purpose: 'required_prerequisite',
          forTargets: need.targets,
          need: `Prerequisite for ${o.name}`,
          course: po.name,
          term: [...po.termsOffered].sort((a, b) => termIndex(a, termOrder) - termIndex(b, termOrder))[0] ?? null,
          status: po.availability === 'confirmed_running' ? 'proposed' : 'conditional',
          availability: po.availability,
          dependsOn: [],
          confirmationNeeded: po.availability === 'confirmed_running' ? `Confirm your placement in ${po.name} with your school counselor.` : `Your school lists ${po.name}, but that does not confirm it will run. Ask your counselor whether it runs and fits your timetable.`,
          alternatives: [],
          claimIds: [po.claimId],
        });
      }
    }
    const terms = [...o.termsOffered].sort((a, b) => termIndex(a, termOrder) - termIndex(b, termOrder)).filter((t) => termIndex(t, termOrder) >= earliest || termIndex(t, termOrder) === Number.MAX_SAFE_INTEGER);
    const term = terms[0] ?? null;
    const status: CoursePlanItem['status'] = blocked.length > 0 ? 'conditional' : o.availability === 'confirmed_running' ? 'proposed' : 'conditional';
    const confirmation =
      blocked.length > 0
        ? `${o.name} requires ${blocked.join(', ')}, which is not offered at your school. Ask your school counselor whether it can be met another way; the course cannot be scheduled before its prerequisite.`
        : o.availability === 'confirmed_running'
          ? `Confirm your placement in ${o.name}${term ? ` for ${term}` : ''} with your school counselor.`
          : `Your school catalog lists ${o.name}, but that does not confirm it runs${term ? ` in ${term}` : ''}. Ask your counselor whether it will run and fit your timetable.`;
    items.push({
      ...base,
      course: o.name,
      term,
      status,
      availability: o.availability,
      dependsOn: deps,
      confirmationNeeded: confirmation,
      alternatives: blocked.length > 0 ? ['Ask whether the school accepts another way to meet the prerequisite (placement or an approved course).', need.hasAlternatives ? 'Check whether one of the program’s other listed routes fits instead.' : 'Consider programs whose requirements fit your school’s courses.'] : [],
      claimIds: [o.claimId],
    });
  }
  return { items, cycles, issues };
}
