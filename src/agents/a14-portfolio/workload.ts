import { addDays, diffDays, type CalendarDate } from '../../shared/time.js';

/**
 * Application workload and schedule (14 "Application inventory and
 * workload", step 6).
 *
 * Each application is a set of tasks with owners, dependencies, effort
 * ranges and dates. Writing effort comes from the actual prompt inventory; a
 * shared platform essay is counted once. External work (a recommendation, a
 * school report) is scheduled from the lead time its owner needs, so the
 * request date is visible. Feasibility compares the student's own work due by
 * each date with the hours the student says they have; official deadlines
 * and the app's internal targets stay separate.
 */

export const TASK_KINDS = ['writing', 'form', 'platform_setup', 'test_report', 'recommendation_request', 'school_report_request', 'transcript_request', 'scholarship', 'nomination_request', 'aid_form'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface Deadline {
  date: CalendarDate;
  time: string | null;
  timezone: string | null;
  sourceRef: string | null;
}

export interface Task {
  taskId: string;
  optionRefs: string[];
  label: string;
  kind: TaskKind;
  owner: 'student' | 'school' | 'recommender' | 'testing_agency' | 'institution' | 'supporter' | 'scholarship_provider';
  hours: { low: number; high: number };
  officialDeadline: Deadline | null;
  /** The earliest date this task must be done by, taking dependents into account (an earlier scholarship deadline controls, 14T11). */
  controllingDate: CalendarDate | null;
  controlledBy: string | null;
  /** For work someone else does: when the student must ask, given the owner's lead time (14T08). */
  requestBy: CalendarDate | null;
  /** The app's suggested target before the official date; never presented as the official date. */
  internalTarget: CalendarDate | null;
  dependsOn: string[];
}

/** Effort ranges in hours for the student's own writing; the student can scale them with their own pace. */
export const WRITING_HOURS: Readonly<Record<string, [number, number]>> = {
  personal_essay: [8, 14],
  personal_statement: [8, 14],
  supplement: [3, 6],
  short_answer: [1, 2],
  insight_question: [2, 4],
  scholarship_essay: [3, 6],
};
export const FORM_HOURS: [number, number] = [1, 2];
export const PLATFORM_SETUP_HOURS: [number, number] = [2, 3];

export function scale(h: [number, number], pace: number): { low: number; high: number } {
  return { low: Math.round(h[0] * pace * 10) / 10, high: Math.round(h[1] * pace * 10) / 10 };
}

/** Earliest date a task must be done by, following dependents (a scholarship that needs the admission application first). */
export function resolveControllingDates(tasks: Task[]): void {
  for (const t of tasks) {
    t.controllingDate = t.officialDeadline?.date ?? null;
    t.controlledBy = t.officialDeadline ? 'its own deadline' : null;
  }
  // Iterate to a fixed point: a task must finish before anything that depends on it.
  for (let pass = 0; pass < tasks.length; pass += 1) {
    let changed = false;
    for (const t of tasks) {
      for (const depId of t.dependsOn) {
        const dep = tasks.find((x) => x.taskId === depId);
        if (!dep || !t.controllingDate) continue;
        if (dep.controllingDate === null || t.controllingDate < dep.controllingDate) {
          dep.controllingDate = t.controllingDate;
          dep.controlledBy = t.label;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

export function applyTargets(tasks: Task[], bufferDays: number, leadTimes: Readonly<Partial<Record<TaskKind, number>>>): void {
  for (const t of tasks) {
    if (!t.controllingDate) continue;
    t.internalTarget = addDays(t.controllingDate, -bufferDays);
    const lead = leadTimes[t.kind];
    if (t.owner !== 'student' && lead !== undefined) t.requestBy = addDays(t.controllingDate, -lead);
  }
}

export interface Feasibility {
  status: 'comfortable' | 'tight' | 'infeasible' | 'unknown';
  firstShortfall: { by: CalendarDate; needLow: number; needHigh: number; availableLow: number; availableHigh: number } | null;
  totalHours: { low: number; high: number };
  lateRequests: Array<{ taskId: string; label: string; requestBy: CalendarDate }>;
}

/** The student's own work due by each date, against the hours they said they have (weekly min and max). */
export function feasibility(tasks: readonly Task[], today: CalendarDate, weekly: { min: number; max: number } | null): Feasibility {
  const own = tasks.filter((t) => t.owner === 'student');
  const totalHours = { low: round(own.reduce((a, t) => a + t.hours.low, 0)), high: round(own.reduce((a, t) => a + t.hours.high, 0)) };
  const lateRequests = tasks.filter((t) => t.requestBy !== null && t.requestBy < today).map((t) => ({ taskId: t.taskId, label: t.label, requestBy: t.requestBy! }));
  if (!weekly) return { status: 'unknown', firstShortfall: null, totalHours, lateRequests };
  const dates = [...new Set(own.map((t) => t.controllingDate).filter((d): d is CalendarDate => d !== null))].sort();
  let status: Feasibility['status'] = 'comfortable';
  let firstShortfall: Feasibility['firstShortfall'] = null;
  for (const d of dates) {
    const due = own.filter((t) => t.controllingDate !== null && t.controllingDate <= d);
    const needLow = round(due.reduce((a, t) => a + t.hours.low, 0));
    const needHigh = round(due.reduce((a, t) => a + t.hours.high, 0));
    const weeks = Math.max(0, diffDays(today, d)) / 7;
    const availableLow = round(weekly.min * weeks);
    const availableHigh = round(weekly.max * weeks);
    if (needLow > availableHigh) {
      status = 'infeasible';
      firstShortfall ??= { by: d, needLow, needHigh, availableLow, availableHigh };
      break;
    }
    if (needHigh > availableLow && status === 'comfortable') {
      status = 'tight';
      firstShortfall ??= { by: d, needLow, needHigh, availableLow, availableHigh };
    }
  }
  return { status, firstShortfall, totalHours, lateRequests };
}

/** External work several applications rely on (one teacher's letter, one test sitting): a single failure affects all of them (14T18). */
export function sharedDependencies(tasks: readonly Task[]): Array<{ label: string; owner: string; optionRefs: string[] }> {
  return tasks.filter((t) => t.owner !== 'student' && t.optionRefs.length > 1).map((t) => ({ label: t.label, owner: t.owner, optionRefs: [...t.optionRefs].sort() }));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
