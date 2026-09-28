import { z } from 'zod';
import type { ReviewRequestOutcome } from '../../runtime/human-review.js';
import type { TaskReason } from '../../runtime/task-graph.js';
import type { ExternalActionProposal, Handoff, RoleId } from '../../shared/envelopes.js';
import { ExternalActionProposalSchema } from '../../shared/envelopes.js';
import { diffDays, type CalendarDate } from '../../shared/time.js';
import type { NodeRecord } from './objectives.js';
import { ROLE_WORK } from './roles.js';

/**
 * Composing the answer (01R09): the useful result first, then its most
 * consequential reason, the uncertainty and the next action. Each action is
 * labelled required, recommended, optional, awaiting confirmation or
 * information, so "potentially useful" never becomes "you must do this to get
 * in". Every sentence comes from a validated specialist summary or from the
 * coordinator's own templates; nothing is invented to fill a gap.
 */

export type ActionLabel = 'required' | 'recommended' | 'optional' | 'awaiting_confirmation' | 'information';

export interface Section {
  nodeId: string;
  role: RoleId;
  title: string;
  status: string;
  label: ActionLabel;
  summary: string;
  taskId: string;
  recordVersion: number;
}

export interface Priority {
  text: string;
  reasons: TaskReason[];
  label: ActionLabel;
  dueDate: string | null;
  ref: string | null;
}

export interface Conflict {
  kind: 'scope' | 'fact' | 'rule' | 'preference';
  description: string;
  /** Who resolves it: the student (a question), the record steward, or source research. */
  routeTo: '02' | '04' | '05' | '11' | 'student';
  question: string | null;
  nodeIds: string[];
}

export interface Question {
  text: string;
  whyNeeded: string;
  blockedTasks: string[];
  nextRole: '02' | 'student';
  intakeSessionId: string | null;
  options: string[];
  /** Recorded answers the student is asked to approve before they are used (intake review step). */
  reviewItems: Array<{ claimId: string; statement: string }>;
}

export interface LeadPayload {
  objectiveId: string | null;
  action: 'request' | 'status' | 'cancel' | 'resume' | 'answer' | 'confirm_review' | 'review_updates' | 'explain';
  /** The student's wording of the request, kept recoverable. */
  request: string | null;
  status: 'completed' | 'partial' | 'needs_student_input' | 'cancelled' | 'checkpointed' | 'blocked';
  headline: string;
  sections: Section[];
  priorities: Priority[];
  question: Question | null;
  otherQuestions: string[];
  completed: string[];
  waiting: Array<{ task: string; reason: string }>;
  blocked: Array<{ task: string; reason: string }>;
  remaining: string[];
  conflicts: Conflict[];
  uncertainties: Array<{ affects: string; description: string; resolution: string }>;
  externalActions: ExternalActionProposal[];
  laterRoles: Array<{ toRole: string; reason: string; requestedOutcome: string }>;
  coverage: Array<{ scope: string; note: string }>;
  review: ReviewRequestOutcome | null;
  inputVersion: number;
  progress: Array<{ task: string; role: RoleId; state: string }>;
  updates: Array<{ kind: string; ref: string; reason: string; suggestedAction: string }>;
  notices: Array<{ code: string; message: string }>;
}

const LabelSchema = z.enum(['required', 'recommended', 'optional', 'awaiting_confirmation', 'information']);

export const LeadPayloadSchema = z
  .object({
    objectiveId: z.string().nullable(),
    action: z.enum(['request', 'status', 'cancel', 'resume', 'answer', 'confirm_review', 'review_updates', 'explain']),
    request: z.string().nullable(),
    status: z.enum(['completed', 'partial', 'needs_student_input', 'cancelled', 'checkpointed', 'blocked']),
    headline: z.string().min(1),
    sections: z.array(z.object({ nodeId: z.string(), role: z.string(), title: z.string(), status: z.string(), label: LabelSchema, summary: z.string(), taskId: z.string(), recordVersion: z.number() }).strict()),
    priorities: z.array(z.object({ text: z.string(), reasons: z.array(z.string()), label: LabelSchema, dueDate: z.string().nullable(), ref: z.string().nullable() }).strict()),
    question: z.object({ text: z.string().min(1), whyNeeded: z.string(), blockedTasks: z.array(z.string()), nextRole: z.enum(['02', 'student']), intakeSessionId: z.string().nullable(), options: z.array(z.string()), reviewItems: z.array(z.object({ claimId: z.string(), statement: z.string() }).strict()) }).strict().nullable(),
    otherQuestions: z.array(z.string()),
    completed: z.array(z.string()),
    waiting: z.array(z.object({ task: z.string(), reason: z.string() }).strict()),
    blocked: z.array(z.object({ task: z.string(), reason: z.string() }).strict()),
    remaining: z.array(z.string()),
    conflicts: z.array(z.object({ kind: z.enum(['scope', 'fact', 'rule', 'preference']), description: z.string(), routeTo: z.string(), question: z.string().nullable(), nodeIds: z.array(z.string()) }).strict()),
    uncertainties: z.array(z.object({ affects: z.string(), description: z.string(), resolution: z.string() }).strict()),
    externalActions: z.array(ExternalActionProposalSchema),
    laterRoles: z.array(z.object({ toRole: z.string(), reason: z.string(), requestedOutcome: z.string() }).strict()),
    coverage: z.array(z.object({ scope: z.string(), note: z.string() }).strict()),
    review: z.custom<ReviewRequestOutcome>().nullable(),
    inputVersion: z.number().int().nonnegative(),
    progress: z.array(z.object({ task: z.string(), role: z.string(), state: z.string() }).strict()),
    updates: z.array(z.object({ kind: z.string(), ref: z.string(), reason: z.string(), suggestedAction: z.string() }).strict()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  })
  .strict();

export function emptyPayload(action: LeadPayload['action'], objectiveId: string | null, inputVersion: number): LeadPayload {
  return { objectiveId, action, request: null, status: 'completed', headline: '', sections: [], priorities: [], question: null, otherQuestions: [], completed: [], waiting: [], blocked: [], remaining: [], conflicts: [], uncertainties: [], externalActions: [], laterRoles: [], coverage: [], review: null, inputVersion, progress: [], updates: [], notices: [] };
}

const TASK_NAMES: Record<string, string> = {
  apply_student_correction: 'updating your record',
  interpret_document: 'reading your document',
  check_program_requirements: 'checking program requirements',
  academic_plan: 'your course and testing plan',
  explore_majors: 'exploring subjects',
  compare_options: 'comparing subjects',
  experience_review: 'reviewing your activities',
  opportunity_research: 'the opportunity search',
  intake: 'getting to know your situation',
  fill_gaps: 'a question about a missing detail',
};

export function taskName(n: Pick<NodeRecord, 'objective'>): string {
  return TASK_NAMES[n.objective] ?? n.objective.replace(/_/g, ' ');
}

function labelFor(n: NodeRecord): ActionLabel {
  const r = n.result!;
  if (r.status === 'needs_student_input') return 'awaiting_confirmation';
  switch (n.role) {
    case '07':
      return 'recommended';
    case '05':
    case '09':
      return 'optional';
    case '02':
      return 'awaiting_confirmation';
    default:
      return 'information';
  }
}

function titleFor(n: NodeRecord): string {
  const base = ROLE_WORK[n.role as Exclude<RoleId, '01'>] ?? n.objective;
  if (n.role === '06') {
    const p = n.result?.payload as { rulePackage?: { programName: string; institutionName: string } | null; scope?: { programRef: string } } | undefined;
    if (p?.rulePackage) return `${base}: ${p.rulePackage.programName}, ${p.rulePackage.institutionName}`;
    if (p?.scope) return `${base}: ${p.scope.programRef}`;
  }
  return base;
}

export function sectionsFrom(nodes: readonly NodeRecord[]): Section[] {
  return nodes
    .filter((n) => n.result && n.state !== 'cancelled' && n.state !== 'stale')
    .map((n) => ({ nodeId: n.id, role: n.role, title: titleFor(n), status: n.result!.status, label: labelFor(n), summary: n.result!.summary, taskId: n.result!.taskId, recordVersion: n.result!.inputVersions.recordVersion }));
}

// ------------------------------------------------------------------ reconciliation

interface ScopeUse {
  program: string;
  cycle: string;
  nodeId: string;
}

function scopeUses(nodes: readonly NodeRecord[]): ScopeUse[] {
  const out: ScopeUse[] = [];
  for (const n of nodes) {
    if (!n.result || n.state === 'cancelled' || n.state === 'stale') continue;
    if (n.role === '06') {
      const p = n.result.payload as { scope?: { institutionRef: string; programRef: string; entryCycle: string } };
      if (p.scope) out.push({ program: `${p.scope.institutionRef}/${p.scope.programRef}`, cycle: p.scope.entryCycle, nodeId: n.id });
    }
    if (n.role === '07') {
      const p = n.result.payload as { targets?: Array<{ scopeKey: string; cycle: string }> };
      for (const t of p.targets ?? []) {
        const [inst, , prog] = t.scopeKey.split('|');
        out.push({ program: `${inst}/${prog}`, cycle: t.cycle, nodeId: n.id });
      }
    }
  }
  return out;
}

const yearOf = (cycle: string) => /\d{4}/.exec(cycle)?.[0] ?? cycle;

/**
 * Reconcile by evidence (01R08). Disagreements are classified: scope (different
 * cycles), facts (routed to the record steward), rules (routed to source
 * research) and preferences (back to the student). No majority vote decides.
 */
export function reconcile(nodes: readonly NodeRecord[], recordEntryCycle: string | null): Conflict[] {
  const conflicts: Conflict[] = [];
  const uses = scopeUses(nodes);
  const byProgram = new Map<string, ScopeUse[]>();
  for (const u of uses) byProgram.set(u.program, [...(byProgram.get(u.program) ?? []), u]);
  for (const [program, us] of byProgram) {
    const cycles = [...new Set(us.map((u) => yearOf(u.cycle)))];
    if (cycles.length > 1) {
      conflicts.push({ kind: 'scope', description: `Results for ${program} were computed for different entry years (${cycles.join(' and ')}), so they cannot be combined.`, routeTo: 'student', question: `Which entry year should I use for ${program}: ${cycles.join(' or ')}?`, nodeIds: [...new Set(us.map((u) => u.nodeId))] });
    } else if (recordEntryCycle && cycles[0] !== yearOf(recordEntryCycle)) {
      conflicts.push({ kind: 'scope', description: `This was checked for entry in ${cycles[0]}, but your record says you plan to start in ${yearOf(recordEntryCycle)}. Rules can differ between cycles, so neither is treated as the answer yet.`, routeTo: 'student', question: `Should I use entry in ${cycles[0]} or in ${yearOf(recordEntryCycle)}?`, nodeIds: [...new Set(us.map((u) => u.nodeId))] });
    }
  }
  for (const n of nodes) {
    if (!n.result) continue;
    if (n.role === '04' && (n.result.payload as { outcome?: string }).outcome === 'conflict') {
      conflicts.push({ kind: 'fact', description: `Your correction disagrees with another source, so both are kept until the difference is resolved. ${(n.result.payload as { studentSummary?: string }).studentSummary ?? ''}`.trim(), routeTo: '04', question: null, nodeIds: [n.id] });
    }
    for (const h of n.result.handoffs) {
      if (n.role === '06' && h.toRole === '11' && h.reason.startsWith('Official sources conflict')) conflicts.push({ kind: 'rule', description: `Official sources disagree about a requirement: ${h.unresolved.join('; ')}`, routeTo: '11', question: null, nodeIds: [n.id] });
    }
  }
  return conflicts;
}

// ------------------------------------------------------------------ priorities

export interface DeadlineItem {
  title: string;
  date: CalendarDate;
  originalText: string | null;
  ref: string;
}

export const URGENT_DAYS = 7;

/** Deadlines due soon become the first priority, with the reason stated; the original goal stays (01T16). */
export function urgentPriorities(deadlines: readonly DeadlineItem[], today: CalendarDate): Priority[] {
  return deadlines
    .map((d) => ({ d, days: diffDays(today, d.date) }))
    .filter((x) => x.days >= 0 && x.days <= URGENT_DAYS)
    .sort((a, b) => a.days - b.days)
    .map(({ d, days }) => ({
      text: `${d.title} is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`} (${d.originalText ?? d.date}). It comes first because it closes soon; your request below is still being handled.`,
      reasons: ['deadline_dependency'],
      label: 'required' as const,
      dueDate: d.date,
      ref: d.ref,
    }));
}

export function laterRolesFrom(nodes: readonly NodeRecord[]): LeadPayload['laterRoles'] {
  const out: LeadPayload['laterRoles'] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    for (const h of n.result?.handoffs ?? []) {
      if (/^0[1-9]$/.test(h.toRole)) continue;
      const k = `${h.toRole}:${h.requestedOutcome}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ toRole: h.toRole, reason: h.reason, requestedOutcome: h.requestedOutcome });
    }
  }
  return out;
}

/** Field keys specialists asked intake to settle, from their typed handoffs. */
export function gapFields(nodes: readonly NodeRecord[]): string[] {
  const keys = new Set<string>();
  for (const n of nodes) {
    if (n.result?.status !== 'needs_student_input') continue;
    for (const h of n.result.handoffs as Handoff[]) if (h.toRole === '02') for (const r of h.inputRefs) if (r.startsWith('field:')) keys.add(r.slice(6));
  }
  return [...keys];
}

// ------------------------------------------------------------------ checks on the composed answer

const GUARANTEE = /\b(guarantee[ds]?|will (definitely|certainly) (get in|be admitted|be accepted)|certain to be admitted|you('| wi)ll get in)\b/i;
const NEGATED = /\b(no one can guarantee|cannot guarantee|can'?t guarantee|not guaranteed|no guarantee|does not guarantee|doesn'?t guarantee|without a guarantee)\b/i;
const IMPLIED_REVIEW = /\b(a (counselor|reviewer|person|human|specialist) (has|is|will be) (accepted|reviewing|looking at|assigned|handling)|(counselor|reviewer) (has )?accepted|has been escalated|escalated to a (counselor|person|human))\b/i;

export function checkAnswer(p: LeadPayload, summary: string): string[] {
  const issues: string[] = [];
  const texts = [summary, p.headline, ...p.priorities.map((x) => x.text), ...p.notices.map((n) => n.message)];
  for (const t of texts) {
    if (GUARANTEE.test(t) && !NEGATED.test(t)) issues.push('the answer presents a guarantee');
    if (IMPLIED_REVIEW.test(t)) issues.push('the answer implies a person has taken up the case');
  }
  if (p.review?.kind === 'referral' && texts.some((t) => /\b(queued|in the review queue)\b/i.test(t))) issues.push('an unstaffed review is described as queued');
  if (p.status === 'completed' && p.question !== null) issues.push('a completed answer still has an open question');
  for (const a of p.externalActions) if (a.authorizationState !== 'proposed') issues.push('an external action is not a proposal');
  const ids = p.sections.map((s) => s.taskId);
  if (new Set(ids).size !== ids.length) issues.push('the same specialist result appears twice');
  return [...new Set(issues)];
}
