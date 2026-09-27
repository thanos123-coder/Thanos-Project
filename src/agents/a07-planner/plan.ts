import { addDays, type PublishedDeadline } from '../../shared/time.js';
import type { CoursePlan } from './courses.js';
import { organizationOf, type AttemptSelection, type PrepPlan, type TestNeed } from './testing.js';

/**
 * Milestones, workload and contingencies (07R04, 07R05, 07R07, 07R12).
 * Every milestone has an owner, a reason, a dependency list and completion
 * evidence. Official deadlines keep their published time and timezone; a
 * planning buffer is a separate, labelled milestone and never replaces the
 * official date.
 */

export interface Milestone {
  id: string;
  title: string;
  owner: 'student' | 'student_with_school_counselor' | 'testing_organization' | 'institution';
  kind: 'official_deadline' | 'official_date' | 'planning_buffer' | 'dependency' | 'action' | 'provisional_recheck';
  reason: 'required_subject_route' | 'required_prerequisite' | 'required_test' | 'student_selected' | 'dependency';
  earliestStart: string | null;
  due: { date: string; time: string | null; timezone: string | null; originalText: string | null } | null;
  dependsOn: string[];
  effort: string | null;
  completionEvidence: string;
  status: 'proposed' | 'completed';
  sourceId: string | null;
  branch: string;
}

const BUFFER_DAYS = 14;

function due(d: PublishedDeadline): Milestone['due'] {
  return { date: d.date, time: d.time, timezone: d.timezone, originalText: d.originalText };
}

export function buildMilestones(course: CoursePlan, selections: readonly AttemptSelection[], needs: readonly TestNeed[], prep: readonly PrepPlan[], today: string, completed: ReadonlySet<string>): Milestone[] {
  const out: Milestone[] = [];
  const push = (m: Omit<Milestone, 'status'>) => out.push({ ...m, status: completed.has(m.id) ? 'completed' : 'proposed' });
  for (const item of course.items) {
    if (item.status === 'already_met') continue;
    if (item.confirmationNeeded) {
      push({ id: `confirm_${item.id}`, title: item.confirmationNeeded, owner: 'student_with_school_counselor', kind: 'action', reason: item.purpose === 'required_prerequisite' ? 'required_prerequisite' : 'required_subject_route', earliestStart: today, due: null, dependsOn: item.dependsOn.map((d) => `confirm_${d}`), effort: 'A short conversation or message', completionEvidence: 'The school confirms availability, placement or an alternative.', sourceId: null, branch: `course:${item.id}` });
    }
  }
  for (const sel of selections) {
    const need = needs.find((n) => n.family === sel.family)!;
    const reason: Milestone['reason'] = need.reason === 'required' || need.reason === 'required_one_of' ? 'required_test' : 'student_selected';
    const branch = `test:${sel.family}`;
    const p = prep.find((x) => x.family === sel.family);
    if (p && p.blocks.length > 0) {
      push({ id: `prep_start_${sel.family}`, title: `Start preparation: ${p.blocks[0]!.objective}`, owner: 'student', kind: 'action', reason, earliestStart: today, due: null, dependsOn: [], effort: `About ${p.weeklyHours} hour${p.weeklyHours === 1 ? '' : 's'} a week`, completionEvidence: 'The diagnostic section is done and errors are logged.', sourceId: null, branch });
    }
    if (sel.provisional) {
      push({ id: `recheck_${sel.family}`, title: `Check whether ${organizationOf(sel.family)} has published ${sel.family.replace(/_/g, ' ')} dates`, owner: 'student', kind: 'provisional_recheck', reason, earliestStart: sel.provisional.recheckOn, due: { date: sel.provisional.recheckOn, time: null, timezone: null, originalText: null }, dependsOn: [], effort: 'A few minutes', completionEvidence: 'Official dates are found, or the recheck is moved.', sourceId: null, branch });
    }
    const a = sel.primary;
    if (!a) continue;
    const id = a.administrationId;
    if (a.accommodation.dependency) {
      push({ id: `accommodation_${id}`, title: a.accommodation.dependency, owner: 'testing_organization', kind: 'dependency', reason: 'dependency', earliestStart: today, due: a.accommodation.deadline ? due(a.accommodation.deadline) : null, dependsOn: [], effort: null, completionEvidence: 'A written decision from the testing organization.', sourceId: a.accommodation.deadline ? a.sourceId : null, branch });
    }
    if (a.device.needed && a.device.deadline) {
      push({ id: `device_${id}`, title: 'Request a loaned testing device', owner: 'student', kind: 'official_deadline', reason: 'dependency', earliestStart: today, due: due(a.device.deadline), dependsOn: [], effort: 'A short form', completionEvidence: 'Confirmation of the device loan.', sourceId: a.sourceId, branch });
    }
    const regDue = a.registration.deadline;
    const bufferDate = addDays(regDue.date, -BUFFER_DAYS);
    if (bufferDate > today) {
      push({ id: `register_buffer_${id}`, title: `Planning buffer: aim to register by ${bufferDate}`, owner: 'student', kind: 'planning_buffer', reason, earliestStart: today, due: { date: bufferDate, time: null, timezone: null, originalText: null }, dependsOn: [...(a.accommodation.dependency ? [`accommodation_${id}`] : []), ...(a.device.needed && a.device.deadline ? [`device_${id}`] : [])], effort: null, completionEvidence: 'Registration details are ready (this is a buffer chosen for planning, not an official deadline).', sourceId: null, branch });
    }
    push({ id: `register_${id}`, title: `Official registration deadline for the ${a.testDate} ${a.family.replace(/_/g, ' ')}`, owner: 'student', kind: 'official_deadline', reason, earliestStart: today, due: due(regDue), dependsOn: [...(a.accommodation.dependency ? [`accommodation_${id}`] : []), ...(a.device.needed && a.device.deadline ? [`device_${id}`] : [])], effort: 'Registration with the testing organization (needs your explicit approval before anything is submitted)', completionEvidence: 'A registration confirmation from the testing organization.', sourceId: a.sourceId, branch });
    push({ id: `seat_${id}`, title: 'Check seat availability at a nearby center when registering (a listed date does not guarantee a seat)', owner: 'student', kind: 'dependency', reason: 'dependency', earliestStart: today, due: null, dependsOn: [], effort: null, completionEvidence: 'A confirmed seat in the registration confirmation.', sourceId: null, branch });
    push({ id: `test_${id}`, title: `${a.family.replace(/_/g, ' ')} test date`, owner: 'student', kind: 'official_date', reason, earliestStart: a.testDate, due: { date: a.testDate, time: null, timezone: null, originalText: null }, dependsOn: [`register_${id}`], effort: null, completionEvidence: 'The test was taken.', sourceId: a.sourceId, branch });
    push({ id: `scores_${id}`, title: `Scores ${a.scoreRelease.estimate ? 'expected' : 'released'} between ${a.scoreRelease.earliest} and ${a.scoreRelease.latest}${a.scoreRelease.estimate ? ' (an estimate, not a promise)' : ''}`, owner: 'testing_organization', kind: 'official_date', reason: 'dependency', earliestStart: a.scoreRelease.earliest, due: { date: a.scoreRelease.latest, time: null, timezone: null, originalText: null }, dependsOn: [`test_${id}`], effort: null, completionEvidence: 'The official score report.', sourceId: a.sourceId, branch });
    if (need.receiptDeadline) {
      push({ id: `receipt_${id}`, title: `Scores must be received by ${need.receiptDeadline}`, owner: 'institution', kind: 'official_deadline', reason, earliestStart: a.scoreRelease.earliest, due: { date: need.receiptDeadline, time: null, timezone: null, originalText: null }, dependsOn: [`scores_${id}`], effort: 'Order the official score report', completionEvidence: 'The institution confirms receipt.', sourceId: need.sourceIds[0] ?? null, branch });
    }
  }
  return out;
}

export interface Workload {
  available: { min: number; max: number } | null;
  plannedHoursPerWeek: number;
  overCapacity: boolean;
  reductions: string[];
  tradeoffs: string[];
}

/** Keep the plan within the student's own time estimate; reduce optional work first (07R04, 07T05). */
export function fitWorkload(prep: PrepPlan[], needs: readonly TestNeed[], available: { min: number; max: number } | null): Workload {
  const total = () => prep.reduce((s, p) => s + p.weeklyHours, 0);
  const reductions: string[] = [];
  const tradeoffs: string[] = [];
  if (available && total() > available.max) {
    // Optional (student-selected) testing goes first.
    for (const p of [...prep]) {
      const n = needs.find((x) => x.family === p.family);
      if (total() <= available.max) break;
      if (n && (n.reason === 'student_selected' || n.reason === 'recommended_student_choice')) {
        prep.splice(prep.indexOf(p), 1);
        reductions.push(`Optional ${p.family.replace(/_/g, ' ')} preparation is left out for now so the plan fits your week.`);
      }
    }
    if (total() > available.max) {
      const share = Math.max(1, Math.floor(available.max / Math.max(1, prep.length)));
      for (const p of prep) {
        if (p.weeklyHours > share) {
          reductions.push(`${p.family.replace(/_/g, ' ')} preparation reduced from ${p.weeklyHours} to ${share} hour${share === 1 ? '' : 's'} a week.`);
          p.weeklyHours = share;
          for (const b of p.blocks) b.weeklyHours = Math.min(b.weeklyHours, share);
        }
      }
      tradeoffs.push('With fewer hours a week, starting earlier or choosing a later test date gives the same practice time; a lighter plan is still a real plan.');
    }
  }
  const planned = total();
  return { available, plannedHoursPerWeek: planned, overCapacity: !!available && planned > available.max, reductions, tradeoffs };
}

export interface Contingency {
  trigger: string;
  alternative: string;
  remainingUncertainty: string;
  branch: string;
}

export function contingencies(course: CoursePlan, selections: readonly AttemptSelection[]): Contingency[] {
  const out: Contingency[] = [];
  for (const s of selections) {
    if (!s.primary) continue;
    out.push({
      trigger: `The ${s.primary.testDate} ${s.family.replace(/_/g, ' ')} is cancelled or you cannot take it`,
      alternative: s.alternative && (s.alternative.feasibility === 'feasible' || s.alternative.feasibility === 'feasible_with_dependencies') ? `The ${s.alternative.testDate} administration (check registration and score timing again).` : 'No other listed date is known to work; check the official calendar and ask the institution before assuming a later date.',
      remainingUncertainty: 'Seat availability and exact score timing are not known in advance.',
      branch: `test:${s.family}`,
    });
  }
  for (const i of course.items.filter((x) => x.status === 'conditional' && x.course)) {
    out.push({ trigger: `${i.course} does not run or does not fit your timetable`, alternative: i.alternatives[0] ?? 'Ask your counselor about another way to meet the requirement.', remainingUncertainty: 'The school decides what runs and who is placed in it.', branch: `course:${i.id}` });
  }
  return out;
}
