import { z } from 'zod';
import { addDays, CalendarDateSchema, type CalendarDate } from '../../shared/time.js';

/**
 * The project workload model (10 "Workload model and scheduling rules").
 *
 * Milestones form a directed dependency graph; a cycle is rejected with the
 * milestones that form it. Effort (hours of the student's own work) and
 * elapsed time (waiting for a reviewer, an approval, a delivery) are separate:
 * a two-hour task that depends on a response next week cannot finish
 * tomorrow. Each week's capacity is the conservative end of the student's
 * range minus the reserve they chose, and nothing is ever scheduled beyond it
 * or made larger to fit a deadline. Milestones that need an approval or
 * supervision that is not in place are blocked, with everything downstream of
 * them; independent work stays available.
 */

export const HoursRangeSchema = z.object({ low: z.number().min(0).max(80), high: z.number().min(0).max(80) }).strict().refine((r) => r.high >= r.low, 'high must be at least low');
export type HoursRange = z.infer<typeof HoursRangeSchema>;

export const MilestoneSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/).max(40),
    /** Why the milestone exists, in the student's terms. */
    purpose: z.string().min(1).max(300),
    /** What the student will do. The student owns every action; external steps are waits, not tasks. */
    action: z.string().min(1).max(300),
    effort: HoursRangeSchema,
    dependsOn: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(10).default([]),
    /** What shows it is done (a checked link list, a working demonstration, a teacher's comment). */
    evidence: z.string().min(1).max(200),
    /** Part of the optional extension rather than the smallest useful result. */
    optional: z.boolean().default(false),
    /** Weeks of elapsed time after the student's part, before anything that depends on it can start (a reviewer's reply). */
    waitWeeks: z.number().int().min(0).max(12).default(0),
    /** An approval (by id) that must be granted before this work starts. */
    needsApproval: z.string().regex(/^[a-z0-9_]+$/).nullable().default(null),
    /** Work that needs a responsible adult present or a review first (participants, personal data, physical risk). */
    needsSupervision: z.boolean().default(false),
    /** A date the milestone is due, when there is one; separate from the effort estimate. */
    due: CalendarDateSchema.nullable().default(null),
  })
  .strict();
export type Milestone = z.infer<typeof MilestoneSchema>;
export type MilestoneInput = z.input<typeof MilestoneSchema>;

export const APPROVAL_STATUSES = ['pending', 'granted', 'denied', 'not_needed'] as const;
export const ApprovalSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/).max(40),
    /** Who decides, within their own authority (a teacher, a club adviser, a competition review committee). */
    authority: z.string().min(1).max(160),
    status: z.enum(APPROVAL_STATUSES),
    /** What the approval permits, in the approver's terms (e.g. "private demonstration only"). */
    permittedScope: z.string().max(300).nullable().default(null),
    /** A supervising adult for work that needs one. */
    supervision: z.boolean().default(false),
  })
  .strict();
export type Approval = z.infer<typeof ApprovalSchema>;

export interface WeekCapacity {
  week: number;
  low: number;
  high: number;
  reason: string | null;
}

export interface GraphIssue {
  kind: 'cycle' | 'unknown_dependency' | 'duplicate_id' | 'unknown_approval';
  milestoneIds: string[];
  message: string;
}

/** Structural checks in code: duplicate ids, unknown dependencies or approvals, and every cycle (10T04). */
export function checkGraph(milestones: readonly Milestone[], approvals: readonly Approval[] = []): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();
  for (const m of milestones) {
    if (ids.has(m.id)) issues.push({ kind: 'duplicate_id', milestoneIds: [m.id], message: `Two milestones use the id ${m.id}.` });
    ids.add(m.id);
  }
  for (const m of milestones) {
    for (const d of m.dependsOn) if (!ids.has(d)) issues.push({ kind: 'unknown_dependency', milestoneIds: [m.id, d], message: `${m.id} depends on ${d}, which is not in the plan.` });
    if (m.needsApproval && !approvals.some((a) => a.id === m.needsApproval)) issues.push({ kind: 'unknown_approval', milestoneIds: [m.id], message: `${m.id} needs approval ${m.needsApproval}, which is not listed.` });
  }
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    state.set(id, 'visiting');
    stack.push(id);
    for (const d of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(d)) continue;
      if (state.get(d) === 'visiting') {
        const cycle = stack.slice(stack.indexOf(d));
        const key = [...cycle].sort().join('>');
        if (!seen.has(key)) {
          seen.add(key);
          issues.push({ kind: 'cycle', milestoneIds: cycle, message: `These milestones depend on each other in a loop: ${[...cycle, d].join(' → ')}. At least one dependency has to go.` });
        }
      } else if (!state.has(d)) visit(d);
    }
    stack.pop();
    state.set(id, 'done');
  };
  for (const m of milestones) if (!state.has(m.id)) visit(m.id);
  return issues;
}

/** Dependencies first, keeping the student's order otherwise. Assumes an acyclic graph. */
export function topoOrder(milestones: readonly Milestone[]): Milestone[] {
  const out: Milestone[] = [];
  const placed = new Set<string>();
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const place = (m: Milestone): void => {
    if (placed.has(m.id)) return;
    placed.add(m.id);
    for (const d of m.dependsOn) {
      const dm = byId.get(d);
      if (dm) place(dm);
    }
    out.push(m);
  };
  for (const m of milestones) place(m);
  return out;
}

export interface BlockReason {
  milestoneId: string;
  reasons: string[];
}

/**
 * Work that cannot start: an approval that is not granted, supervision that
 * is not in place, and everything that depends on blocked work (10T05, 10T10).
 */
export function blockedMilestones(milestones: readonly Milestone[], approvals: readonly Approval[], done: ReadonlySet<string> = new Set()): Map<string, string[]> {
  const blocked = new Map<string, string[]>();
  const supervised = approvals.some((a) => a.supervision && a.status === 'granted');
  for (const m of topoOrder(milestones)) {
    if (done.has(m.id)) continue;
    const reasons: string[] = [];
    if (m.needsApproval) {
      const a = approvals.find((x) => x.id === m.needsApproval);
      if (!a || (a.status !== 'granted' && a.status !== 'not_needed')) reasons.push(a ? `waiting for approval from ${a.authority}${a.status === 'denied' ? ' (it was declined)' : ''}` : `approval ${m.needsApproval} is not on file`);
    }
    if (m.needsSupervision && !supervised) reasons.push('needs a responsible adult or review before it starts');
    for (const d of m.dependsOn) if (blocked.has(d)) reasons.push(`depends on ${d}, which is blocked`);
    if (reasons.length > 0) blocked.set(m.id, reasons);
  }
  return blocked;
}

export interface ScheduledMilestone {
  id: string;
  state: 'done' | 'scheduled' | 'blocked' | 'does_not_fit' | 'dropped';
  /** Hours placed in each week (the high estimate, against conservative capacity). */
  weeks: Array<{ week: number; hours: number }>;
  startWeek: number | null;
  finishWeek: number | null;
  /** When dependents may start, after any wait. */
  availableFromWeek: number | null;
  blockedBy: string[];
  late: boolean;
}

export interface Schedule {
  milestones: ScheduledMilestone[];
  /** Hours placed in each week; never more than that week's usable capacity. */
  load: Array<{ week: number; placed: number; usable: number; capacityLow: number; reason: string | null }>;
  fits: boolean;
  requiredHours: HoursRange;
  usableHours: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Place milestones week by week. The high effort estimate is used against the
 * low end of weekly capacity less the reserve: when uncertainty is high the
 * plan is conservative. Nothing is placed in time the student does not have,
 * and no estimate is shortened to make the plan fit.
 */
export function schedule(input: { milestones: readonly Milestone[]; capacity: readonly WeekCapacity[]; reservePerWeek: number; approvals: readonly Approval[]; done?: ReadonlySet<string>; include?: (m: Milestone) => boolean; startDate?: CalendarDate | null }): Schedule {
  const done = input.done ?? new Set<string>();
  const include = input.include ?? (() => true);
  const usable = input.capacity.map((c) => r2(Math.max(0, c.low - input.reservePerWeek)));
  const left = [...usable];
  const blocked = blockedMilestones(input.milestones, input.approvals, done);
  const out = new Map<string, ScheduledMilestone>();
  for (const m of topoOrder(input.milestones)) {
    const base: ScheduledMilestone = { id: m.id, state: 'scheduled', weeks: [], startWeek: null, finishWeek: null, availableFromWeek: null, blockedBy: [], late: false };
    if (done.has(m.id)) {
      out.set(m.id, { ...base, state: 'done', availableFromWeek: 1 });
      continue;
    }
    if (!include(m)) {
      out.set(m.id, { ...base, state: 'dropped' });
      continue;
    }
    const b = blocked.get(m.id);
    if (b) {
      out.set(m.id, { ...base, state: 'blocked', blockedBy: b });
      continue;
    }
    const deps = m.dependsOn.map((d) => out.get(d)).filter((x): x is ScheduledMilestone => x !== undefined);
    if (deps.some((d) => d.state === 'does_not_fit' || d.state === 'dropped' || d.state === 'blocked')) {
      out.set(m.id, { ...base, state: 'does_not_fit', blockedBy: deps.filter((d) => d.state !== 'scheduled' && d.state !== 'done').map((d) => `depends on ${d.id}, which is ${d.state.replace(/_/g, ' ')}`) });
      continue;
    }
    let week = Math.max(1, ...deps.map((d) => d.availableFromWeek ?? 1));
    let need = m.effort.high;
    const weeks: Array<{ week: number; hours: number }> = [];
    while (need > 1e-9 && week <= left.length) {
      const take = Math.min(left[week - 1]!, need);
      if (take > 1e-9) {
        weeks.push({ week, hours: r2(take) });
        left[week - 1] = r2(left[week - 1]! - take);
        need = r2(need - take);
      }
      if (need > 1e-9) week += 1;
    }
    if (need > 1e-9) {
      // Return the hours taken: a milestone either fits in the window or is shown as not fitting.
      for (const w of weeks) left[w.week - 1] = r2(left[w.week - 1]! + w.hours);
      out.set(m.id, { ...base, state: 'does_not_fit', blockedBy: [] });
      continue;
    }
    const startWeek = weeks[0]?.week ?? week;
    const finishWeek = weeks.at(-1)?.week ?? startWeek;
    const endDate = input.startDate ? addDays(input.startDate, finishWeek * 7 - 1) : null;
    out.set(m.id, { ...base, weeks, startWeek, finishWeek, availableFromWeek: finishWeek + m.waitWeeks, late: !!(m.due && endDate && endDate > m.due) });
  }
  const milestones = input.milestones.map((m) => out.get(m.id)!);
  const load = input.capacity.map((c, i) => ({ week: c.week, placed: r2(usable[i]! - left[i]!), usable: usable[i]!, capacityLow: c.low, reason: c.reason }));
  const included = input.milestones.filter((m) => !done.has(m.id) && include(m));
  const requiredHours = { low: r2(included.reduce((a, m) => a + m.effort.low, 0)), high: r2(included.reduce((a, m) => a + m.effort.high, 0)) };
  return { milestones, load, fits: milestones.every((m) => m.state !== 'does_not_fit'), requiredHours, usableHours: r2(usable.reduce((a, b) => a + b, 0)) };
}

/** Weekly capacity for a window, applying the student's own changes (an exam period) to the weeks they name. */
export function capacityWindow(weeks: number, base: HoursRange, changes: ReadonlyArray<{ fromWeek: number; toWeek: number; hours: HoursRange; reason: string }>): WeekCapacity[] {
  const out: WeekCapacity[] = [];
  for (let w = 1; w <= weeks; w += 1) {
    const c = [...changes].reverse().find((x) => w >= x.fromWeek && w <= x.toWeek);
    out.push({ week: w, low: c ? c.hours.low : base.low, high: c ? c.hours.high : base.high, reason: c?.reason ?? null });
  }
  return out;
}

/** The product's default reserve: about one short session a week, rounded to a quarter hour. A setting to test, not a rule; the student can change it. */
export function defaultReserve(base: HoursRange): number {
  return Math.round(base.low * 0.15 * 4) / 4;
}

/** Milestones whose timing or state changed between two schedules: only these are "affected" by a change. */
export function affectedMilestones(before: ReadonlyArray<Pick<ScheduledMilestone, 'id' | 'state' | 'finishWeek'>>, after: readonly ScheduledMilestone[]): string[] {
  return after.filter((a) => {
    const b = before.find((x) => x.id === a.id);
    return !b || b.state !== a.state || b.finishWeek !== a.finishWeek;
  }).map((a) => a.id);
}
