import { DateTime } from 'luxon';
import { absent } from '../../shared/absence.js';
import type { WeeklySlot } from '../../shared/fields.js';
import { addMoney, checkAffordability, formatMoney, type CostComponent, type Money } from '../../shared/money.js';
import { countryName } from '../../shared/places.js';
import type { SourceRecord } from '../../shared/sources.js';
import {
  diffDays,
  earliestPossibleInstant,
  instantToLocal,
  isStrictlyBefore,
  localToInstant,
  partialDateBounds,
  parsePartialDate,
  resolveDeadlineInstant,
  type CalendarDate,
  type DateInterval,
  type PublishedDeadline,
} from '../../shared/time.js';
import type { StudentFacts } from '../common/student-facts.js';
import { claimIdsOf } from '../common/student-facts.js';
import { combineAll, evaluateTree, type RuleState } from '../a06-eligibility/engine.js';
import type { Predicate, RuleNode } from '../a06-eligibility/rules.js';
import type { Brief } from './brief.js';
import { DIRECT_ROUTES, type Cycle, type Opportunity, type Requirement, type Session } from './catalog.js';
import { topicLabel, topicRelation } from './topics.js';

/**
 * Local matching of one opportunity against the student's brief (09R05–09R10).
 *
 * Everything here is deterministic. Sensitive conditions (age at the
 * organizer's reference date, citizenship, residence, graduation status) are
 * evaluated locally against the scoped record, never sent anywhere. Unknown is
 * never converted to "fine": an unknown material fact keeps an option
 * conditional, and action-ready status needs the cycle, eligibility, essential
 * cost and deadline timing to be resolved (09R12).
 */

export type LifecycleState = 'discovered' | 'source_verified' | 'eligibility_assessed' | 'feasibility_assessed' | 'recommended' | 'action_ready' | 'closed' | 'stale' | 'rejected';
export type Bucket = 'feasible_now' | 'conditional' | 'excluded' | 'closed' | 'unannounced' | 'stale';

export interface Unresolved {
  code: string;
  text: string;
  /** The question that would settle it, when the student can answer it. */
  question: string | null;
  /** Who can resolve it. */
  owner: 'student' | 'organizer' | 'catalog_team' | 'qualified_adult';
  /** A material item keeps the option conditional and blocks action-ready status. */
  material: boolean;
}

export interface HardFailure {
  code: string;
  text: string;
}

export interface ConditionFinding {
  id: string;
  label: string;
  state: RuleState | 'met_if_completed';
  explanation: string;
  question: string | null;
  sourceId: string | null;
  quote: string | null;
}

export interface Check {
  area: 'session_status' | 'dates' | 'format' | 'travel' | 'overnight' | 'local_time' | 'commitments' | 'workload' | 'device';
  status: 'ok' | 'unknown' | 'poor_fit' | 'conflict' | 'hard_conflict';
  text: string;
}

export interface SessionEvaluation {
  sessionId: string;
  label: string;
  start: CalendarDate;
  end: CalendarDate;
  format: Session['format'];
  where: string;
  /** The session's daily times in the student's timezone, when they can be computed. */
  yourLocalTimes: { start: string; end: string; crossesMidnight: boolean } | null;
  checks: Check[];
  state: 'feasible' | 'unresolved' | 'infeasible';
  failures: HardFailure[];
  unresolved: Unresolved[];
}

export interface CostLine {
  component: string;
  amount: Money | null;
  status: 'published' | 'estimate' | 'your_estimate' | 'not_yet_estimated' | 'not_published' | 'not_applicable';
  required: boolean;
  note: string | null;
}

export interface CostPicture {
  published: boolean;
  lines: CostLine[];
  /** Known required costs per currency. */
  knownTotals: Money[];
  /** How far known costs exceed the budget, when they do. */
  overBy: Money | null;
  unknownComponents: string[];
  verdict: 'free' | 'within_budget' | 'over_budget' | 'over_preferred_budget' | 'aid_dependent' | 'unknown_costs' | 'budget_unknown' | 'budget_not_shared' | 'currency_conversion_needed' | 'not_published';
  verdictText: string;
  /** Possible aid is listed separately and never counted (09R08, 09T05). */
  aid: Array<{ kind: string; covers: string[]; amount: string; eligibility: string; deadline: PublishedDeadline | null; decisionTiming: string | null; status: 'possible_not_awarded'; sourceId: string }>;
  refund: string | null;
}

export interface DeadlineInfo {
  kind: 'deadline' | 'rolling';
  published: PublishedDeadline | null;
  /** Exact UTC instant, only when date, time and timezone are all published. */
  instantUtc: string | null;
  unresolvedReason: 'timezone_missing' | 'time_missing' | 'timezone_and_time_missing' | null;
  passed: boolean | 'unknown';
  /** A conservative target when timing is not exact. Never presented as the official deadline. */
  planningTarget: { instantUtc: string; yourLocal: string | null; label: string } | null;
}

export interface RouteView {
  route: Opportunity['selection']['route'];
  direct: boolean;
  text: string;
  pathway: { organizer: string; url: string | null; sourceId: string } | null;
}

export interface Concern {
  kind: string;
  text: string;
  /** Pause action-ready status pending review. */
  pause: boolean;
  sourceId: string | null;
}

export interface SafetyFlag {
  kind: 'prior_review_required' | 'qualified_supervision_required' | 'unverified_individual' | 'residential' | 'parental_consent';
  text: string;
  pause: boolean;
}

export interface ValueSummary {
  activities: string[];
  curriculum: string | null;
  supervision: string;
  feedback: string;
  outputs: string[];
  credential: string;
  organizerClaims: Array<{ quote: string; note: string }>;
  learningEvidence: 'well_documented' | 'some_evidence' | 'little_evidence';
  admissionsNote: string;
}

export interface OptionEvaluation {
  opportunityId: string;
  version: number;
  title: string;
  category: string;
  topics: string[];
  summary: string;
  organizerLine: string;
  hostLine: string | null;
  officialUrl: string;
  cycle: { id: string; label: string; status: Cycle['status']; retrievedAt: string } | null;
  cycleNote: string | null;
  sessions: SessionEvaluation[];
  chosenSessionId: string | null;
  eligibility: { state: 'appears_met' | 'conditional' | 'unresolved' | 'not_met' | 'not_published'; conditions: ConditionFinding[]; note: string };
  route: RouteView;
  feasibility: 'feasible' | 'unresolved' | 'infeasible';
  cost: CostPicture | null;
  deadline: DeadlineInfo | null;
  value: ValueSummary;
  concerns: Concern[];
  safety: SafetyFlag[];
  sponsorshipDisclosure: string | null;
  unresolved: Unresolved[];
  failures: HardFailure[];
  goalFit: { relation: 'direct' | 'related' | 'none'; matched: string[]; categoryRequested: boolean | null };
  bucket: Bucket;
  state: LifecycleState;
  actionReady: boolean;
  actionReadyBlockers: string[];
  verification: { status: 'reverified_unchanged' | 'page_changed' | 'page_inaccessible' | 'recent' | 'needs_refresh'; text: string; checkedAt: string | null };
  nextAction: { kind: 'review_and_apply' | 'answer_questions' | 'ask_organizer' | 'find_route' | 'wait_for_applications' | 'qualified_review' | 'none'; text: string };
  sourceIds: string[];
  claimIds: string[];
  fieldKeys: string[];
}

export const FRESH_DAYS = 14;
const DEFAULT_WAKING = { start: '07:00', end: '22:00' };
export const SELECTION_NOTE = 'Meeting the published conditions does not guarantee a place.';
export const ADMISSIONS_NOTE = 'Taking part is not evidence of an admissions advantage. What matters is what you actually do and learn, and a school project, job or ongoing responsibility can serve the same goal.';

// ------------------------------------------------------------------ cycles and deadlines

function lastSessionEnd(c: Cycle): CalendarDate {
  return c.sessions.reduce((m, s) => (s.end > m ? s.end : m), c.sessions[0]!.end);
}

function latestPossibleInstant(d: PublishedDeadline): string {
  const exact = resolveDeadlineInstant(d);
  if (exact.ok) return exact.instantUtc;
  if (d.timezone !== null) return DateTime.fromISO(d.date, { zone: d.timezone }).endOf('day').toUTC().toISO()!;
  const [hh, mm] = (d.time ?? '23:59').split(':').map(Number);
  return DateTime.fromISO(d.date, { zone: 'UTC-12' }).set({ hour: hh!, minute: mm!, second: 59, millisecond: 999 }).toUTC().toISO()!;
}

export function deadlineInfo(c: Cycle, nowIso: string, timezone: string | null): DeadlineInfo | null {
  if (!c.applicationDeadline) return c.rolling ? { kind: 'rolling', published: null, instantUtc: null, unresolvedReason: null, passed: false, planningTarget: null } : null;
  const d = c.applicationDeadline;
  const exact = resolveDeadlineInstant(d);
  const now = DateTime.fromISO(nowIso).toMillis();
  const passed: DeadlineInfo['passed'] = exact.ok
    ? DateTime.fromISO(exact.instantUtc).toMillis() < now
    : DateTime.fromISO(latestPossibleInstant(d)).toMillis() < now
      ? true
      : DateTime.fromISO(earliestPossibleInstant(d)).toMillis() > now
        ? false
        : 'unknown';
  let planningTarget: DeadlineInfo['planningTarget'] = null;
  if (!exact.ok) {
    const instant = earliestPossibleInstant(d);
    const local = timezone ? instantToLocal(instant, timezone) : null;
    planningTarget = {
      instantUtc: instant,
      yourLocal: local ? `${local.date} ${local.time}` : null,
      label: 'A safe planning target that covers every possible timezone, not the official deadline',
    };
  }
  return { kind: 'deadline', published: d, instantUtc: exact.ok ? exact.instantUtc : null, unresolvedReason: exact.ok ? null : exact.reason, passed, planningTarget };
}

/**
 * The cycle a student could take part in now (09R05). A page about a cycle
 * that already ran is history; if no later cycle is published the entry is an
 * unannounced recurring lead, and no deadline is inferred from last year's.
 */
export function currentCycle(o: Opportunity, today: CalendarDate): { cycle: Cycle | null; history: Cycle | null } {
  const live = o.cycles.filter((c) => c.status !== 'past' && lastSessionEnd(c) >= today);
  const rank: Record<Cycle['status'], number> = { open: 0, upcoming: 1, filled: 2, closed: 3, cancelled: 4, past: 5 };
  live.sort((a, b) => rank[a.status] - rank[b.status] || a.sessions[0]!.start.localeCompare(b.sessions[0]!.start) || a.id.localeCompare(b.id));
  const history = [...o.cycles].filter((c) => !live.includes(c)).sort((a, b) => b.year - a.year || lastSessionEnd(b).localeCompare(lastSessionEnd(a)))[0] ?? null;
  return { cycle: live[0] ?? null, history };
}

// ------------------------------------------------------------------ eligibility

function findPredicate(node: RuleNode | null, id: string): Predicate | null {
  if (!node) return null;
  if (node.kind === 'predicate') return node.id === id ? node.predicate : null;
  if (node.kind === 'not') return findPredicate(node.child, id);
  for (const c of node.children) {
    const p = findPredicate(c, id);
    if (p) return p;
  }
  return null;
}

function findQuote(node: RuleNode | null, id: string): { sourceId: string; quote: string } | null {
  if (!node) return null;
  if (node.kind === 'predicate') return node.id === id ? { sourceId: node.source.sourceId, quote: node.source.quote } : null;
  if (node.kind === 'not') return findQuote(node.child, id);
  for (const c of node.children) {
    const q = findQuote(c, id);
    if (q) return q;
  }
  return null;
}

interface LocalResult {
  finding: ConditionFinding;
  state: RuleState;
  claimIds: string[];
  fieldKeys: string[];
}

function evalRequirement(r: Requirement, o: Opportunity, facts: StudentFacts, brief: Brief): LocalResult {
  const base = { id: r.id, label: r.label, sourceId: r.sourceId, quote: r.quote };
  const res = (state: RuleState, explanation: string, question: string | null, claimIds: string[], fieldKeys: string[]): LocalResult => ({ finding: { ...base, state, explanation, question }, state, claimIds, fieldKeys });
  const stage = facts.student<string>('education.stage');
  const grad = facts.student<string>('education.expected_graduation');
  switch (r.type) {
    case 'still_in_secondary_on': {
      const keys = [stage.fieldKey, grad.fieldKey];
      const claims = claimIdsOf(stage, grad);
      const q = `Will you still be in secondary school on ${r.date}?`;
      if (stage.status === 'usable' && ['completed_secondary', 'gap_year', 'postsecondary'].includes(stage.value!)) return res('not_met', 'You have finished secondary school; this is for students who are still enrolled.', null, claims, keys);
      if (stage.status !== 'usable') return res('unknown', 'Your current stage of education is not confirmed.', q, claims, keys);
      if (stage.value !== 'secondary') return res('unknown', 'It is not clear whether you will be enrolled in secondary school then.', q, claims, keys);
      if (grad.status !== 'usable') return res('unknown', 'Your expected graduation date is needed for this condition.', q, claims, keys);
      const before = isStrictlyBefore(grad.value!, r.date);
      if (before === true) return res('not_met', `You expect to finish secondary school (${grad.value}) before ${r.date}, and the organizer requires participants to still be enrolled then.`, null, claims, keys);
      if (before === false) return res('met', `You expect to still be in secondary school on ${r.date}.`, null, claims, keys);
      return res('unknown', `Your expected graduation (${grad.value}) is too close to ${r.date} to be sure.`, q, claims, keys);
    }
    case 'education_stage_in': {
      if (stage.status !== 'usable') return res('unknown', 'Your current stage of education is not confirmed.', 'Are you currently in secondary school, or have you finished?', stage.claimIds, [stage.fieldKey]);
      return res(r.stages.includes(stage.value as (typeof r.stages)[number]) ? 'met' : 'not_met', 'Checked your stage of education against the published condition.', null, stage.claimIds, [stage.fieldKey]);
    }
    case 'graduation_year_between': {
      if (grad.status !== 'usable') return res('unknown', 'Your expected graduation year is needed for this condition.', 'In which year do you expect to finish secondary school?', grad.claimIds, [grad.fieldKey]);
      const year = parsePartialDate(grad.value!)!.year;
      const ok = (r.earliest === null || year >= r.earliest) && (r.latest === null || year <= r.latest);
      return res(ok ? 'met' : 'not_met', `Expected graduation ${year} checked against the published graduation years.`, null, grad.claimIds, [grad.fieldKey]);
    }
    case 'residence_region_in': {
      const country = brief.residenceCountry ?? brief.location?.country ?? null;
      const keys = ['student:self.identity.residence_country', 'student:self.constraints.location_broad'];
      if (!country) return res('unknown', 'Where you live is needed for this condition.', 'Which country and region do you live in?', [], keys);
      if (country !== r.country) return res('not_met', `The condition is for residents of listed regions of ${countryName(r.country)}.`, null, [], keys);
      const region = brief.location?.country === r.country ? brief.location.region : null;
      if (!region) return res('unknown', 'Your region is needed for this condition.', 'Which region do you live in?', [], keys);
      const norm = (s: string) => s.trim().toLowerCase();
      return res(r.regions.some((x) => norm(x) === norm(region)) ? 'met' : 'not_met', 'Checked your region against the published list.', null, [], keys);
    }
    case 'declaration': {
      const answer = brief.declarations[`${o.id}.${r.id}`];
      if (answer === undefined) return res('unknown', 'Only you can answer this condition.', r.question, [], []);
      return res(answer ? 'met' : 'not_met', 'Based on your answer.', null, [], []);
    }
  }
}

export function evaluateEligibility(o: Opportunity, facts: StudentFacts, brief: Brief, today: CalendarDate): { view: OptionEvaluation['eligibility']; unresolved: Unresolved[]; failures: HardFailure[]; claimIds: string[]; fieldKeys: string[] } {
  if (!o.eligibility.published) {
    return {
      view: { state: 'not_published', conditions: [], note: 'The organizer has not published eligibility conditions for this cycle.' },
      unresolved: [{ code: 'eligibility_not_published', text: 'Who may take part is not published yet.', question: null, owner: 'organizer', material: true }],
      failures: [],
      claimIds: [],
      fieldKeys: [],
    };
  }
  const conditions: ConditionFinding[] = [];
  const states: RuleState[] = [];
  const routeStates: RuleState[] = [];
  const claimIds = new Set<string>();
  const fieldKeys = new Set<string>();
  const rules = o.eligibility.rules;
  if (rules) {
    // The same deterministic engine as Agent 06, at the application stage.
    const t = evaluateTree({ facts, stage: 'application', applicantCategory: null, pkg: { rules, sourceConflicts: [] }, asOf: today });
    states.push(t.achieved);
    routeStates.push(t.route);
    t.claimIds.forEach((c) => claimIds.add(c));
    t.dependencies.forEach((d) => fieldKeys.add(d));
    for (const a of t.atomic) {
      const p = findPredicate(rules, a.ruleId);
      const q = findQuote(rules, a.ruleId);
      let explanation = a.explanation;
      let question = a.state === 'unknown' && a.resolution && (a.resolution.owner === '02' || a.resolution.owner === 'student') ? a.resolution.text : null;
      if (p?.type === 'age') {
        const limit = p.minimumAge !== undefined && p.maximumAgeInclusive !== undefined ? `aged ${p.minimumAge} to ${p.maximumAgeInclusive}` : p.minimumAge !== undefined ? `at least ${p.minimumAge}` : `${p.maximumAgeInclusive} or younger`;
        explanation = a.state === 'met' ? `You meet the age condition (${limit} on ${p.referenceDate}, the organizer’s reference date).` : a.state === 'not_met' ? `The organizer requires participants to be ${limit} on ${p.referenceDate}. You will not be on that date, so this opportunity is not open to you.` : `The organizer requires participants to be ${limit} on ${p.referenceDate}; your age on that date is not recorded.`;
        // An age restriction is never presented with a way around it (09T12).
        if (a.state === 'not_met') question = null;
      }
      const state: ConditionFinding['state'] = a.state === 'unknown' && a.stateWithPermittedRoutes === 'met' ? 'met_if_completed' : a.state;
      conditions.push({ id: a.ruleId, label: a.label, state, explanation: a.futureConditions.length > 0 ? `${explanation} Condition: ${a.futureConditions.join('; ')}.` : explanation, question, sourceId: q?.sourceId ?? null, quote: q?.quote ?? null });
    }
  }
  for (const r of o.eligibility.requirements) {
    const l = evalRequirement(r, o, facts, brief);
    conditions.push(l.finding);
    states.push(l.state);
    routeStates.push(l.state);
    l.claimIds.forEach((c) => claimIds.add(c));
    l.fieldKeys.forEach((k) => fieldKeys.add(k));
  }
  const achieved = combineAll(states);
  const route = combineAll(routeStates);
  const state: OptionEvaluation['eligibility']['state'] =
    achieved === 'met' || (achieved === 'not_applicable' && route !== 'not_met' && route !== 'unknown')
      ? 'appears_met'
      : achieved === 'not_met' && route === 'not_met'
        ? 'not_met'
        : route === 'met'
          ? 'conditional'
          : 'unresolved';
  const unresolved: Unresolved[] = [];
  const failures: HardFailure[] = [];
  for (const c of conditions) {
    if (c.state === 'unknown') unresolved.push({ code: `eligibility:${c.id}`, text: `${c.label}: ${c.explanation}`, question: c.question, owner: c.question ? 'student' : 'organizer', material: true });
    if (c.state === 'met_if_completed') unresolved.push({ code: `eligibility:${c.id}`, text: `${c.label}: ${c.explanation}`, question: null, owner: 'student', material: true });
  }
  if (state === 'not_met') for (const c of conditions.filter((x) => x.state === 'not_met')) failures.push({ code: `eligibility:${c.id}`, text: `${c.label}: ${c.explanation}` });
  return { view: { state, conditions, note: SELECTION_NOTE }, unresolved, failures, claimIds: [...claimIds], fieldKeys: [...fieldKeys] };
}

export function selectionRoute(o: Opportunity, brief: Brief): { view: RouteView; unresolved: Unresolved[] } {
  const s = o.selection;
  if (DIRECT_ROUTES.has(s.route)) {
    const text = s.route === 'first_come' ? 'Places are given in order of application.' : s.route === 'drop_in' ? 'No application is needed; you can attend.' : 'You apply directly to the organizer.';
    return { view: { route: s.route, direct: true, text: s.description ? `${text} ${s.description}` : text, pathway: null }, unresolved: [] };
  }
  const country = brief.residenceCountry ?? brief.schoolCountry ?? brief.location?.country ?? null;
  const pathway = s.pathways.find((p) => p.country === country) ?? s.pathways.find((p) => p.country === 'ANY') ?? null;
  const how: Record<string, string> = {
    nomination_required: 'Participants are nominated; you cannot apply directly to this stage.',
    qualifying_competition: 'Participants qualify through an earlier competition; there is no direct entry to this stage.',
    school_nomination: 'Schools nominate participants; ask your school whether it takes part.',
    invitation_only: 'Participation is by invitation only.',
  };
  const text = [how[s.route], s.description, pathway ? `Your route: ${pathway.organizer}.` : null].filter(Boolean).join(' ');
  const unresolved: Unresolved = pathway
    ? { code: 'entry_route', text: `Entry for you is through ${pathway.organizer}; that route has its own dates and rules, which need to be checked.`, question: null, owner: 'organizer', material: true }
    : country
      ? { code: 'entry_route', text: `No qualification route for ${countryName(country)} is recorded; check the organizer’s list of national or regional organizers.`, question: null, owner: 'organizer', material: true }
      : { code: 'entry_route', text: 'Which qualification route applies depends on where you live or go to school.', question: 'Which country do you live or go to school in?', owner: 'student', material: true };
  return { view: { route: s.route, direct: false, text, pathway: pathway ? { organizer: pathway.organizer, url: pathway.url, sourceId: pathway.sourceId } : null }, unresolved: [unresolved] };
}

// ------------------------------------------------------------------ logistics

/** Is the session wholly inside one of the student's available windows? Three-valued with partial dates. */
function withinWindows(start: CalendarDate, end: CalendarDate, windows: readonly DateInterval[]): true | false | 'unknown' {
  let unknown = false;
  for (const w of windows) {
    const ws = partialDateBounds(w.start);
    const we = w.end ? partialDateBounds(w.end) : w.ongoing ? { start: '9999-12-31', end: '9999-12-31' } : partialDateBounds(w.start);
    if (ws.end <= start && we.start >= end) return true;
    const definitelyNot = ws.start > start || we.end < end;
    if (!definitelyNot) unknown = true;
  }
  return unknown ? 'unknown' : false;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + m!;
}

function firstDateOnWeekdays(start: CalendarDate, end: CalendarDate, weekdays: readonly number[]): CalendarDate | null {
  let d = DateTime.fromISO(start, { zone: 'UTC' });
  const last = DateTime.fromISO(end, { zone: 'UTC' });
  for (let i = 0; i < 8 && d <= last; i += 1, d = d.plus({ days: 1 })) if (weekdays.includes(d.weekday)) return d.toISODate()!;
  return null;
}

function slotsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function evaluateSession(s: Session, brief: Brief): SessionEvaluation {
  const checks: Check[] = [];
  const failures: HardFailure[] = [];
  const unresolved: Unresolved[] = [];
  const hard = (area: Check['area'], code: string, text: string) => {
    checks.push({ area, status: 'hard_conflict', text });
    failures.push({ code, text });
  };
  const open = (area: Check['area'], status: 'unknown' | 'poor_fit' | 'conflict', code: string, text: string, question: string | null, material = true, owner: Unresolved['owner'] = question ? 'student' : 'organizer') => {
    checks.push({ area, status, text });
    unresolved.push({ code, text, question, owner, material });
  };
  const where = s.format === 'online' ? 'Online' : s.location ? [s.location.venue, s.location.city, s.location.region, countryName(s.location.country)].filter(Boolean).join(', ') + (s.format === 'hybrid' ? ' (or online)' : '') : 'Location not published';

  if (s.status === 'full') hard('session_status', 'session_full', `The ${s.label} session is full.`);
  if (s.status === 'cancelled') hard('session_status', 'session_cancelled', `The ${s.label} session was cancelled.`);

  // Dates.
  if (brief.windows.length === 0) open('dates', 'unknown', 'dates_unknown', `Runs ${s.start} to ${s.end}; your available dates are not recorded.`, 'Which dates or weeks are you available?');
  else {
    const w = withinWindows(s.start, s.end, brief.windows);
    if (w === true) checks.push({ area: 'dates', status: 'ok', text: `Runs ${s.start} to ${s.end}, within your available dates.` });
    else if (w === false) hard('dates', 'dates_outside_availability', `Runs ${s.start} to ${s.end}, which is outside your available dates.`);
    else open('dates', 'unknown', 'dates_uncertain', `Runs ${s.start} to ${s.end}; your available dates are not precise enough to be sure.`, 'Can you confirm the exact dates you are available?');
  }

  // Format: a hard "only" is a constraint, a preference is only a ranking factor.
  if (brief.format.required === 'online' && s.format === 'in_person') hard('format', 'format_mismatch', 'This session is in person and you can only take part online.');
  else if (brief.format.required === 'in_person' && s.format === 'online') hard('format', 'format_mismatch', 'This session is online and you asked for in-person options only.');
  else checks.push({ area: 'format', status: 'ok', text: s.format === 'online' ? 'Online.' : s.format === 'hybrid' ? 'In person or online.' : 'In person.' });

  // Travel and overnight stays (in-person participation only).
  const inPerson = s.format === 'in_person' || (s.format === 'hybrid' && brief.format.required !== 'online' && brief.format.preferred !== 'online');
  if (inPerson) {
    const multiDay = diffDays(s.start, s.end) >= 1;
    const loc = s.location;
    const sameCountry = !!loc && !!brief.location && loc.country === brief.location.country;
    const sameCity = sameCountry && sameText(loc!.city, brief.location!.city);
    const overnight = s.residential || s.overnightRequired || (!!loc && !!brief.location && !sameCountry && multiDay);
    const overnightOk = brief.travel?.overnightTravelPossible ?? null;
    if (overnight) {
      const why = s.residential ? 'It is residential' : s.overnightRequired ? 'It needs overnight stays' : `A multi-day program in ${countryName(loc!.country)} would need overnight stays`;
      if (overnightOk === false) hard('overnight', 'overnight_not_possible', `${why}, and you cannot travel overnight.`);
      else if (overnightOk === null) open('overnight', 'unknown', 'overnight_unknown', `${why}; whether you can stay away overnight is not recorded.`, 'Could you stay away from home overnight for a program?');
      else checks.push({ area: 'overnight', status: 'ok', text: `${why}; you said overnight stays are possible.` });
    }
    if (!loc) open('travel', 'unknown', 'location_unknown', 'The venue is not published yet.', null);
    else if (!brief.location) open('travel', 'unknown', 'your_location_needed', `It takes place in ${where}; your city or region is not recorded.`, 'Which city or region are you in? A street address is not needed.');
    else if (sameCity) checks.push({ area: 'travel', status: 'ok', text: `In your city (${loc.city}).` });
    else if (!overnight) open('travel', 'unknown', 'travel_time_unknown', `It takes place in ${where}; the travel time from where you live is not known.`, brief.travel?.maxTravelMinutes ? `How long would the trip to ${loc.city ?? countryName(loc.country)} take you?` : 'How would you get there, and how long would it take?');
  } else if (s.format === 'online' || s.format === 'hybrid') {
    // Online is not automatically feasible (09R07, 09T07).
    if (brief.deviceAccess === 'none') open('device', 'conflict', 'device_needed', 'It needs a computer or tablet and an internet connection, which you said you do not have. A school or library device might work.', 'Could you use a school or library device for the sessions?');
    else if (brief.deviceAccess === 'shared_device' || brief.deviceAccess === 'limited') checks.push({ area: 'device', status: 'unknown', text: 'Needs regular use of a device at the session times.' });
  }

  // Daily times in the student's own timezone.
  let yourLocalTimes: SessionEvaluation['yourLocalTimes'] = null;
  if (s.schedule) {
    if (s.format !== 'in_person') {
      if (s.schedule.timezone === null) open('local_time', 'unknown', 'session_timezone_missing', `Sessions run ${s.schedule.dailyStart}–${s.schedule.dailyEnd}, but the organizer does not say in which timezone.`, null);
      else if (!brief.timezone) open('local_time', 'unknown', 'your_timezone_needed', `Sessions run ${s.schedule.dailyStart}–${s.schedule.dailyEnd} (${s.schedule.timezone}); your timezone is needed to check this.`, 'Which timezone or city are you in?');
      else {
        const day = firstDateOnWeekdays(s.start, s.end, s.schedule.weekdays) ?? s.start;
        const a = instantToLocal(localToInstant(day, s.schedule.dailyStart, s.schedule.timezone), brief.timezone);
        const b = instantToLocal(localToInstant(day, s.schedule.dailyEnd, s.schedule.timezone), brief.timezone);
        const crosses = a.date !== b.date || minutes(b.time) < minutes(a.time);
        yourLocalTimes = { start: a.time, end: b.time, crossesMidnight: crosses };
        const window = brief.dailyHours ?? DEFAULT_WAKING;
        const fits = !crosses && minutes(a.time) >= minutes(window.start) && minutes(b.time) <= minutes(window.end);
        const text = `Sessions run ${a.time}–${b.time} your time${crosses ? ' (across midnight)' : ''}.`;
        if (fits) checks.push({ area: 'local_time', status: 'ok', text });
        else if (brief.dailyHours) hard('local_time', 'outside_your_hours', `${text} That is outside the hours you said you are available (${brief.dailyHours.start}–${brief.dailyHours.end}).`);
        else open('local_time', 'poor_fit', 'schedule_poor_fit', `${text} That is late at night or very early for you, so it is a poor fit even though it is online.`, 'Could you really take part at those times?');
      }
    }
    // Regular commitments (work, caregiving, school) on the same weekdays.
    if (brief.timezone && s.schedule.timezone) {
      const zone = s.schedule.timezone;
      const day = firstDateOnWeekdays(s.start, s.end, s.schedule.weekdays) ?? s.start;
      const a = instantToLocal(localToInstant(day, s.schedule.dailyStart, zone), brief.timezone);
      const b = instantToLocal(localToInstant(day, s.schedule.dailyEnd, zone), brief.timezone);
      const shift = a.weekday - DateTime.fromISO(day).weekday;
      const weekdays = s.schedule.weekdays.map((w) => ((w - 1 + shift + 7) % 7) + 1);
      for (const c of brief.commitments) {
        if (c.period && intervalMiss(c.period, s.start, s.end)) continue;
        const clash = c.weekly.find((slot: WeeklySlot) => weekdays.includes(slot.weekday) && slotsOverlap(minutes(a.time), minutes(b.time) || 24 * 60, minutes(slot.start), minutes(slot.end)));
        if (clash) open('commitments', 'conflict', 'commitment_clash', `Sessions overlap with ${c.label} (${clash.start}–${clash.end}).`, `Could you change ${c.label} on those days?`);
      }
    }
  } else if (s.format !== 'in_person') {
    open('local_time', 'unknown', 'session_times_unknown', 'Session times are not published, so they cannot be checked against your day.', null);
  }

  // Workload against the student's own estimate.
  if (s.hoursPerWeek !== null && brief.weeklyHours) {
    if (s.hoursPerWeek > brief.weeklyHours.max) open('workload', 'conflict', 'workload_over', `About ${s.hoursPerWeek} hours a week; you said you have up to ${brief.weeklyHours.max}.`, 'Would you free up time during these weeks, or should this wait?');
    else checks.push({ area: 'workload', status: 'ok', text: `About ${s.hoursPerWeek} hours a week, within your time.` });
  } else if (s.hoursPerWeek === null) {
    checks.push({ area: 'workload', status: 'unknown', text: 'The weekly time commitment is not published.' });
    unresolved.push({ code: 'workload_unknown', text: 'The weekly time commitment is not published.', question: null, owner: 'organizer', material: false });
  }

  const state: SessionEvaluation['state'] = failures.length > 0 ? 'infeasible' : unresolved.some((u) => u.material) ? 'unresolved' : 'feasible';
  return { sessionId: s.id, label: s.label, start: s.start, end: s.end, format: s.format, where, yourLocalTimes, checks, state, failures, unresolved };
}

function intervalMiss(period: DateInterval, start: CalendarDate, end: CalendarDate): boolean {
  const ps = partialDateBounds(period.start);
  const pe = period.end ? partialDateBounds(period.end) : period.ongoing ? { start: '9999-12-31', end: '9999-12-31' } : ps;
  return pe.end < start || ps.start > end;
}

// ------------------------------------------------------------------ costs

const TRAVEL_COMPONENTS = new Set(['travel', 'local_transport']);

export function costPicture(c: Cycle, session: Session | null, brief: Brief, travelEstimate: Money | null): CostPicture {
  const aid = c.aid.map((a) => ({
    kind: a.kind,
    covers: a.covers,
    amount: a.amount === 'full' ? 'the full cost of the covered items' : a.amount ? formatMoney(a.amount) : 'amount not stated',
    eligibility: a.eligibility,
    deadline: a.deadline,
    decisionTiming: a.decisionTiming,
    status: 'possible_not_awarded' as const,
    sourceId: a.sourceId,
  }));
  const refund = c.refund?.text ?? null;
  if (!c.costsPublished) {
    return { published: false, lines: [], knownTotals: [], overBy: null, unknownComponents: ['all'], verdict: 'not_published', verdictText: 'The organizer has not published the costs, so it cannot be called affordable or free.', aid, refund };
  }
  const components: CostComponent[] = [...c.costs];
  const inPerson = !!session && (session.format === 'in_person' || (session.format === 'hybrid' && brief.format.required !== 'online' && brief.format.preferred !== 'online'));
  // A free program can still need unaffordable transport (09R07): the student's own travel is always part of the picture.
  const implicitTravel = inPerson && !components.some((k) => TRAVEL_COMPONENTS.has(k.component));
  if (implicitTravel) components.push({ component: 'travel', amount: travelEstimate ?? absent('not_supplied', 'Estimate the cost of getting to the venue'), estimate: true, required: true, note: travelEstimate ? 'your estimate' : 'your travel to the venue' });
  const lines: CostLine[] = components.map((k, i) => {
    const implicit = implicitTravel && i === components.length - 1;
    const a = k.amount as Money | { kind: 'absent'; reason: string };
    if ('kind' in a) {
      const status: CostLine['status'] = a.reason === 'not_applicable' || a.reason === 'confirmed_absent' ? 'not_applicable' : implicit ? 'not_yet_estimated' : 'not_published';
      return { component: k.component, amount: null, status, required: k.required, note: k.note ?? null };
    }
    return { component: k.component, amount: a, status: implicit ? 'your_estimate' : k.estimate ? 'estimate' : 'published', required: k.required, note: k.note ?? null };
  });
  const totals = new Map<string, Money>();
  for (const l of lines) if (l.required && l.amount) totals.set(l.amount.currency, totals.has(l.amount.currency) ? addMoney(totals.get(l.amount.currency)!, l.amount) : l.amount);
  const knownTotals = [...totals.values()];
  const unknownComponents = lines.filter((l) => l.required && (l.status === 'not_yet_estimated' || l.status === 'not_published')).map((l) => l.component);
  const allZero = knownTotals.every((m) => Number(m.amount) === 0);

  let verdict: CostPicture['verdict'];
  let verdictText: string;
  let overBy: Money | null = null;
  if (unknownComponents.length === 0 && allZero) {
    verdict = 'free';
    verdictText = 'No cost to take part, as published.';
  } else if (brief.budget) {
    const b = brief.budget;
    const v = checkAffordability(components, b);
    if (v.verdict === 'over_budget') {
      overBy = v.overBy;
      const overCovered = aid.some((x) => x.covers.some((k) => b.covers === 'all' || (b.covers as readonly string[]).includes(k)));
      if (overCovered) {
        verdict = 'aid_dependent';
        verdictText = `Known costs are ${formatMoney(v.overBy)} over your ${b.kind === 'hard_cap' ? 'limit' : 'preferred budget'}. It would only fit if the listed aid were awarded, which is not known yet.`;
      } else {
        verdict = b.kind === 'hard_cap' ? 'over_budget' : 'over_preferred_budget';
        verdictText = `Known costs are ${formatMoney(v.overBy)} over your ${b.kind === 'hard_cap' ? 'budget limit' : 'preferred budget'}.`;
      }
    } else if (v.verdict === 'unresolved') {
      verdict = v.reason === 'unconvertible_currency' ? 'currency_conversion_needed' : 'unknown_costs';
      verdictText = v.reason === 'unconvertible_currency' ? 'Some costs are in another currency, so they cannot be compared with your budget without a dated exchange rate.' : `Some costs are not known yet (${v.total.unknownComponents.join(', ').replace(/_/g, ' ')}), so it cannot be called affordable.`;
    } else if (unknownComponents.length > 0) {
      // The budget's covered costs fit, but other required costs (e.g. travel outside a tuition-only budget) are unknown.
      verdict = 'unknown_costs';
      verdictText = `The costs your budget covers fit, but ${unknownComponents.join(', ').replace(/_/g, ' ')} ${unknownComponents.length === 1 ? 'is' : 'are'} not known yet.`;
    } else {
      verdict = 'within_budget';
      verdictText = `Known costs ${knownTotals.map(formatMoney).join(' + ')} are within your ${b.kind === 'hard_cap' ? 'budget' : 'preferred budget'}.`;
    }
  } else if (brief.budgetAbsence?.reason === 'declined') {
    verdict = 'budget_not_shared';
    verdictText = 'You chose not to share a budget, so costs are shown but no paid option is called affordable.';
  } else {
    verdict = unknownComponents.length > 0 ? 'unknown_costs' : 'budget_unknown';
    verdictText = unknownComponents.length > 0 ? `Some costs are not known yet (${unknownComponents.join(', ').replace(/_/g, ' ')}).` : 'Your budget is not recorded, so no paid option is called affordable.';
  }
  return { published: true, lines, knownTotals, overBy, unknownComponents, verdict, verdictText, aid, refund };
}

// ------------------------------------------------------------------ value, concerns, safety

const CREDENTIAL_TEXT: Record<Opportunity['value']['credential'], string> = {
  credit_bearing: 'Credit-bearing',
  noncredit_certificate: 'A non-credit certificate of completion',
  participation_certificate: 'A certificate of participation (not a competitive award)',
  competitive_award: 'Some participants receive competitive awards',
  none: 'No certificate',
  unknown: 'Credential not stated',
};

const SUPERVISION_TEXT: Record<Opportunity['value']['supervision'], string> = {
  qualified_staff: 'Supervised by the organizer’s staff',
  organizer_vetted_mentor: 'A mentor assigned and vetted by the organizer',
  unverified_individual: 'Work with an individual the organizer does not vet',
  self_directed: 'Self-directed',
  unknown: 'Supervision not described',
};

export function valueSummary(o: Opportunity): ValueSummary {
  const v = o.value;
  const points = (v.activities.length > 0 ? 1 : 0) + (v.curriculum ? 1 : 0) + (v.supervision === 'qualified_staff' || v.supervision === 'organizer_vetted_mentor' ? 1 : 0) + (v.feedback === true ? 1 : 0) + (v.outputs.length > 0 ? 1 : 0);
  const credential = v.credential === 'credit_bearing' ? `${CREDENTIAL_TEXT.credit_bearing}. ${v.creditNote ?? 'Credit earned here is not automatically accepted by every school or university.'}` : CREDENTIAL_TEXT[v.credential];
  return {
    activities: v.activities,
    curriculum: v.curriculum,
    supervision: SUPERVISION_TEXT[v.supervision],
    feedback: v.feedback === true ? 'Participants get feedback on their work' : v.feedback === false ? 'No individual feedback is described' : 'Feedback is not described',
    outputs: v.outputs,
    credential,
    // Marketing claims are quoted and attributed, never restated as fact.
    organizerClaims: o.marketingClaims.filter((m) => m.kind !== 'admission_guarantee' && m.kind !== 'urgency').map((m) => ({ quote: m.text, note: m.kind === 'selectivity' ? 'The organizer’s description; no admission rate is published, so selectivity is not assessed.' : 'The organizer’s own claim; not independently verified.' })),
    learningEvidence: points >= 4 ? 'well_documented' : points >= 2 ? 'some_evidence' : 'little_evidence',
    admissionsNote: ADMISSIONS_NOTE,
  };
}

const PAUSE_KINDS = new Set(['unsupported_guarantee', 'pressure_to_pay', 'excessive_personal_info', 'inconsistent_organizer']);

export function concernsFor(o: Opportunity, cycle: Cycle | null): Concern[] {
  const out: Concern[] = [];
  for (const m of o.marketingClaims) {
    if (m.kind === 'admission_guarantee') out.push({ kind: 'unsupported_guarantee', text: `The organizer claims: “${m.text}” No program can guarantee admission to a university, so this is not repeated as a fact. A claim like this is a common warning sign, not proof of wrongdoing.`, pause: true, sourceId: m.sourceId });
    if (m.kind === 'urgency') out.push({ kind: 'pressure_to_pay', text: `The page pressures people to pay quickly (“${m.text}”). Take time to check the details; pressure to pay immediately is a common warning sign.`, pause: true, sourceId: m.sourceId });
    if (m.kind === 'endorsement' && o.host && o.host.relation !== 'same_as_organizer' && o.host.relation !== 'partner') out.push({ kind: 'implied_endorsement', text: `The listing suggests an endorsement (“${m.text}”), but ${o.host.name} is ${o.host.relation === 'venue_only' ? 'only the venue' : 'not shown to be involved beyond hosting'}. A logo or venue does not establish endorsement.`, pause: false, sourceId: m.sourceId });
  }
  for (const c of o.concerns) out.push({ kind: c.kind, text: `${c.evidence} This is a concern to check, not proof of wrongdoing.`, pause: PAUSE_KINDS.has(c.kind), sourceId: c.sourceId });
  if (cycle && !cycle.costsPublished && !out.some((c) => c.kind === 'unclear_costs')) out.push({ kind: 'unclear_costs', text: 'The full cost is not published. Ask for a complete list of fees before paying anything.', pause: false, sourceId: null });
  if (!o.contact && !out.some((c) => c.kind === 'missing_contact')) out.push({ kind: 'missing_contact', text: 'No contact channel for the organizer is published.', pause: false, sourceId: null });
  return out;
}

export function safetyFlags(o: Opportunity, session: Session | null): SafetyFlag[] {
  const out: SafetyFlag[] = [];
  for (const r of o.safety.priorReview) {
    const area = r.area.replace(/_/g, ' ');
    out.push({ kind: 'prior_review_required', text: `Projects involving ${area} need approval from ${r.body}${r.beforeWorkBegins ? ' before the work begins' : ''}. A signature collected afterwards is not automatically accepted; check this year’s rules and plan with a qualified supervisor.`, pause: false });
  }
  if (o.safety.supervisionRequired) out.push({ kind: 'qualified_supervision_required', text: 'The organizer requires qualified adult supervision for this work.', pause: false });
  if (o.value.supervision === 'unverified_individual') out.push({ kind: 'unverified_individual', text: 'This involves working with an individual the organizer does not vet. The app cannot vouch for a person’s safety; a parent, guardian or school should review the arrangement first, and meetings should happen in supervised settings.', pause: true });
  if (session?.residential) out.push({ kind: 'residential', text: 'Residential: confirm supervision, housing and emergency arrangements with the organizer; a parent or guardian may need to agree.', pause: false });
  if (o.safety.parentalConsentRequired) out.push({ kind: 'parental_consent', text: 'A parent or guardian must give consent.', pause: false });
  return out;
}

export function organizerLines(o: Opportunity): { organizerLine: string; hostLine: string | null } {
  const organizerLine = `Run by ${o.organizer.name}.`;
  const h = o.host;
  if (!h || h.relation === 'same_as_organizer') return { organizerLine, hostLine: null };
  // A program held on a campus is not necessarily run by that university (09R04, 09T06).
  const hostLine =
    h.relation === 'venue_only'
      ? `Held at ${h.name}, which provides the venue; ${h.name} is not the organizer.`
      : h.relation === 'partner'
        ? `Held with ${h.name} as a partner; ${o.organizer.name} runs it.`
        : `Held at ${h.name}; its role beyond hosting is not stated.`;
  return { organizerLine, hostLine: h.note ? `${hostLine} ${h.note}` : hostLine };
}

// ------------------------------------------------------------------ whole option

export interface EvaluateOptions {
  today: CalendarDate;
  nowIso: string;
  sources: ReadonlyMap<string, SourceRecord>;
  usable: (sourceId: string | null) => boolean;
}

export function evaluateOpportunity(o: Opportunity, brief: Brief, facts: StudentFacts, opts: EvaluateOptions): OptionEvaluation {
  const { today } = opts;
  const { organizerLine, hostLine } = organizerLines(o);
  const { cycle, history } = currentCycle(o, today);
  const unresolved: Unresolved[] = [];
  const failures: HardFailure[] = [];
  const claimIds = new Set<string>(brief.claimIds);
  const fieldKeys = new Set<string>(brief.fieldKeys);
  const goal = topicRelation(brief.topics, o.topics);
  const eligibility = evaluateEligibility(o, facts, brief, today);
  eligibility.claimIds.forEach((c) => claimIds.add(c));
  eligibility.fieldKeys.forEach((k) => fieldKeys.add(k));
  const route = selectionRoute(o, brief);
  const value = valueSummary(o);
  const sourceIds = new Set<string>([o.organizer.sourceId]);

  const base = {
    opportunityId: o.id,
    version: o.version,
    title: o.title,
    category: o.category,
    topics: o.topics,
    summary: o.summary,
    organizerLine,
    hostLine,
    officialUrl: o.organizer.officialUrl,
    value,
    route: route.view,
    eligibility: eligibility.view,
    goalFit: { relation: goal.relation, matched: goal.matched, categoryRequested: brief.categories.length > 0 ? brief.categories.includes(o.category) : null },
    sponsorshipDisclosure: o.sponsorship.paidPlacement || o.sponsorship.affiliateCommission ? `${o.sponsorship.paidPlacement ? 'Sponsored listing' : 'The app may receive a commission'}${o.sponsorship.sponsor ? ` (${o.sponsorship.sponsor})` : ''}. This does not affect the order of results.` : null,
  };

  // Stale sources cannot support a recommendation.
  const staleSource = !opts.usable(o.organizer.sourceId) || (cycle !== null && !opts.usable(cycle.sourceId));
  if (!cycle) {
    const last = history ? `The last published cycle was ${history.label} (${history.year}).` : 'No cycle dates are published.';
    return finish({
      ...base,
      cycle: null,
      cycleNote: `${last} The next cycle has not been announced, so there is no current deadline; one is never estimated from a past cycle.`,
      sessions: [],
      chosenSessionId: null,
      feasibility: 'unresolved',
      cost: null,
      deadline: null,
      concerns: concernsFor(o, null),
      safety: safetyFlags(o, null),
      unresolved: [{ code: 'cycle_unannounced', text: 'The next cycle is not announced.', question: null, owner: 'organizer', material: true }],
      failures: [],
      bucket: 'unannounced',
      state: 'source_verified',
      sourceIds: [...sourceIds, ...(history ? [history.sourceId] : [])],
    });
  }
  sourceIds.add(cycle.sourceId);
  if (o.eligibility.sourceId) sourceIds.add(o.eligibility.sourceId);

  const sessions = cycle.sessions.map((s) => evaluateSession(s, brief));
  const order = { feasible: 0, unresolved: 1, infeasible: 2 } as const;
  const chosen = [...sessions].sort((a, b) => order[a.state] - order[b.state] || a.unresolved.filter((u) => u.material).length - b.unresolved.filter((u) => u.material).length || a.start.localeCompare(b.start))[0]!;
  const chosenSession = cycle.sessions.find((s) => s.id === chosen.sessionId)!;
  const feasibility: OptionEvaluation['feasibility'] = chosen.state;
  if (feasibility === 'infeasible') for (const f of dedupe(sessions.flatMap((s) => s.failures), (f) => f.code)) failures.push(f);
  else unresolved.push(...chosen.unresolved);

  const deadline = deadlineInfo(cycle, opts.nowIso, brief.timezone);
  const published = cycle.status;
  const closedByStatus = published === 'closed' || published === 'filled' || published === 'cancelled';
  const closedByDeadline = !closedByStatus && deadline?.kind === 'deadline' && deadline.passed === true;
  const cost = costPicture(cycle, chosenSession, brief, brief.travelEstimates.get(o.id) ?? null);
  for (const a of cycle.aid) sourceIds.add(a.sourceId);

  const concerns = concernsFor(o, cycle);
  const safety = safetyFlags(o, chosenSession);

  // Cost consequences.
  if (cost.verdict === 'over_budget') failures.push({ code: 'over_budget', text: cost.verdictText });
  else if (cost.verdict === 'aid_dependent') unresolved.push({ code: 'aid_dependent', text: cost.verdictText, question: null, owner: 'organizer', material: true });
  else if (cost.verdict === 'over_preferred_budget') unresolved.push({ code: 'over_preferred_budget', text: cost.verdictText, question: 'Would you stretch your preferred budget for this?', owner: 'student', material: true });
  else if (cost.verdict === 'not_published') unresolved.push({ code: 'cost_not_published', text: cost.verdictText, question: null, owner: 'organizer', material: true });
  else if (cost.verdict === 'currency_conversion_needed') unresolved.push({ code: 'currency_conversion', text: cost.verdictText, question: null, owner: 'student', material: true });
  else if (cost.verdict === 'budget_unknown' || cost.verdict === 'budget_not_shared') unresolved.push({ code: 'budget_unknown', text: cost.verdictText, question: cost.verdict === 'budget_unknown' ? 'Is there a spending limit, and does it need to include travel?' : null, owner: 'student', material: true });
  if (cost.unknownComponents.includes('travel')) unresolved.push({ code: 'travel_cost', text: 'The cost of getting there is not yet estimated.', question: `Roughly what would the trip to ${chosen.where} cost you?`, owner: 'student', material: true });
  else if (cost.unknownComponents.length > 0 && cost.verdict !== 'not_published') unresolved.push({ code: 'cost_unknown', text: `Not published: ${cost.unknownComponents.join(', ').replace(/_/g, ' ')}.`, question: null, owner: 'organizer', material: true });

  // Deadline timing (09T08): a missing timezone is never replaced with the student's.
  if (deadline?.kind === 'deadline' && deadline.unresolvedReason) {
    const d = deadline.published!;
    const reason = deadline.unresolvedReason === 'time_missing' ? `The deadline (${d.date}, ${d.timezone}) has no published time.` : `The deadline (${d.originalText}) does not say which timezone it uses, so its exact moment is not known.`;
    unresolved.push({ code: deadline.unresolvedReason === 'time_missing' ? 'deadline_time' : 'deadline_timezone', text: `${reason} Plan to finish before ${deadline.planningTarget!.yourLocal ?? deadline.planningTarget!.instantUtc}${deadline.planningTarget!.yourLocal ? ' your time' : ' UTC'}, and ask the organizer to confirm.`, question: null, owner: 'organizer', material: deadline.unresolvedReason !== 'time_missing' });
  }
  if (!deadline) unresolved.push({ code: 'deadline_not_published', text: 'No application deadline is published for this cycle.', question: null, owner: 'organizer', material: true });
  if (deadline?.kind === 'deadline' && deadline.passed === 'unknown') unresolved.push({ code: 'deadline_may_have_passed', text: 'The deadline may already have passed, depending on its timezone.', question: null, owner: 'organizer', material: true });

  unresolved.push(...eligibility.unresolved, ...route.unresolved);
  failures.push(...eligibility.failures);
  if (o.team) {
    const ready = brief.declarations[`${o.id}.team_ready`];
    if (ready !== true) unresolved.push({ code: 'team', text: `Teams of ${o.team.minSize}${o.team.maxSize !== o.team.minSize ? `–${o.team.maxSize}` : ''}${o.team.memberRules ? `; ${o.team.memberRules}` : ''}${o.team.schoolAffiliationRequired ? '; members must be from the same school' : ''}. Every member must meet the conditions, and the rules on who did and owns the work apply.`, question: 'Do you have a team that meets these rules?', owner: 'student', material: true });
  }
  if (brief.hasAccessibilityNeeds && !o.accessibility.statement) unresolved.push({ code: 'accessibility_info', text: 'The organizer does not publish accessibility information; you can ask them about what you need before applying.', question: null, owner: 'organizer', material: false });
  for (const c of concerns.filter((x) => x.pause)) unresolved.push({ code: `concern:${c.kind}`, text: c.text, question: null, owner: 'qualified_adult', material: true });
  for (const s of safety.filter((x) => x.pause)) unresolved.push({ code: `safety:${s.kind}`, text: s.text, question: null, owner: 'qualified_adult', material: true });
  if (o.verification.needsReview) unresolved.push({ code: 'verification', text: 'The official page changed after it was last reviewed, so some details may be out of date.', question: null, owner: 'catalog_team', material: true });

  let bucket: Bucket;
  let state: LifecycleState;
  if (staleSource) {
    bucket = 'stale';
    state = 'stale';
  } else if (closedByStatus || closedByDeadline) {
    bucket = 'closed';
    state = 'closed';
  } else if (failures.length > 0) {
    bucket = 'excluded';
    state = 'rejected';
  } else if (unresolved.some((u) => u.material)) {
    bucket = 'conditional';
    state = feasibility === 'unresolved' ? 'eligibility_assessed' : 'feasibility_assessed';
  } else {
    bucket = 'feasible_now';
    state = 'feasibility_assessed';
  }
  const cycleNote = closedByStatus
    ? `The ${cycle.label} cycle is ${published === 'filled' ? 'full' : published}.`
    : closedByDeadline
      ? `The published deadline (${deadline!.published!.originalText}) has passed.`
      : published === 'upcoming'
        ? cycle.applicationOpens
          ? `Applications open ${cycle.applicationOpens.originalText}.`
          : 'Applications are not open yet.'
        : null;

  return finish({
    ...base,
    cycle: { id: cycle.id, label: cycle.label, status: published, retrievedAt: cycle.retrievedAt },
    cycleNote,
    sessions,
    chosenSessionId: chosen.sessionId,
    feasibility,
    cost,
    deadline,
    concerns,
    safety,
    unresolved: dedupe(unresolved, (u) => u.code),
    failures: dedupe(failures, (f) => f.code),
    bucket,
    state,
    sourceIds: [...sourceIds],
  });

  function finish(e: Omit<OptionEvaluation, 'actionReady' | 'actionReadyBlockers' | 'verification' | 'nextAction' | 'claimIds' | 'fieldKeys'>): OptionEvaluation {
    const out: OptionEvaluation = { ...e, actionReady: false, actionReadyBlockers: [], verification: freshness(e.cycle?.retrievedAt ?? null, opts.today, o), nextAction: { kind: 'none', text: '' }, claimIds: [...claimIds], fieldKeys: [...fieldKeys] };
    refreshActionReadiness(out);
    return out;
  }
}

function freshness(retrievedAt: string | null, today: CalendarDate, o: Opportunity): OptionEvaluation['verification'] {
  const obs = o.verification.lastObservation;
  if (obs && obs.outcome === 'changed') return { status: 'page_changed', text: 'The official page has changed since it was last reviewed.', checkedAt: obs.observedAt };
  if (!retrievedAt) return { status: 'needs_refresh', text: 'Not checked recently.', checkedAt: null };
  const age = diffDays(retrievedAt.slice(0, 10), today);
  return age <= FRESH_DAYS ? { status: 'recent', text: `Official details last checked ${retrievedAt.slice(0, 10)}.`, checkedAt: retrievedAt } : { status: 'needs_refresh', text: `Official details last checked ${retrievedAt.slice(0, 10)}; they need a fresh check before you act.`, checkedAt: retrievedAt };
}

/** Recompute action readiness and the next action from the option's current facts (also after finalist verification). */
export function refreshActionReadiness(e: OptionEvaluation): void {
  const blockers: string[] = [];
  if (e.bucket !== 'feasible_now') blockers.push(e.bucket === 'conditional' ? 'Some material conditions are unresolved.' : `The option is ${e.bucket.replace(/_/g, ' ')}.`);
  if (e.cycle && e.cycle.status !== 'open') blockers.push(e.cycleNote ?? 'Applications are not open.');
  if (!e.route.direct) blockers.push('Entry is through a separate qualification route.');
  if (e.deadline?.kind === 'deadline' && !e.deadline.instantUtc) blockers.push('The deadline’s exact timing is not published.');
  if (e.eligibility.state !== 'appears_met') blockers.push('Eligibility is not settled.');
  if (e.cost && e.cost.verdict !== 'free' && e.cost.verdict !== 'within_budget') blockers.push('The essential costs are not settled.');
  if (e.cost && e.cost.unknownComponents.length > 0) blockers.push('Some costs are unknown.');
  if (e.verification.status === 'page_changed' || e.verification.status === 'page_inaccessible' || e.verification.status === 'needs_refresh') blockers.push(e.verification.text);
  if (e.concerns.some((c) => c.pause) || e.safety.some((s) => s.pause)) blockers.push('A concern needs review by a qualified adult first.');
  e.actionReadyBlockers = [...new Set(blockers)];
  e.actionReady = e.actionReadyBlockers.length === 0;
  if (e.state === 'action_ready' && !e.actionReady) e.state = 'recommended';
  e.nextAction = nextActionFor(e);
}

/** A shortlisted option becomes recommended, and action ready when nothing material is open (lifecycle, 09 "Opportunity lifecycle"). */
export function promoteShortlisted(e: OptionEvaluation): void {
  if (e.bucket !== 'feasible_now') return;
  e.state = e.actionReady ? 'action_ready' : 'recommended';
}

function nextActionFor(e: OptionEvaluation): OptionEvaluation['nextAction'] {
  if (e.bucket === 'excluded' || e.bucket === 'closed' || e.bucket === 'stale') return { kind: 'none', text: e.bucket === 'excluded' ? 'This does not fit your constraints; see the other options.' : e.bucket === 'closed' ? 'Not available now; see the other options.' : 'Its details need to be re-checked before it can be recommended.' };
  if (e.bucket === 'unannounced') return { kind: 'wait_for_applications', text: 'Save it if you like; you can check again when the organizer announces the next cycle.' };
  if (e.unresolved.some((u) => u.material && u.owner === 'qualified_adult')) return { kind: 'qualified_review', text: 'Talk it over with a parent, guardian or school counselor before going further.' };
  if (!e.route.direct) return { kind: 'find_route', text: e.route.pathway ? `Look at ${e.route.pathway.organizer}, the route for your country, and its own dates.` : 'Find the national or regional route that applies to you.' };
  if (e.actionReady) return { kind: 'review_and_apply', text: 'Review the details; if it still fits, you can apply on the organizer’s official site. Nothing is submitted for you.' };
  if (e.cycle?.status === 'upcoming') return { kind: 'wait_for_applications', text: e.cycleNote ?? 'Applications are not open yet.' };
  const q = e.unresolved.find((u) => u.material && u.question);
  if (q) return { kind: 'answer_questions', text: q.question! };
  return { kind: 'ask_organizer', text: 'Some details are only known to the organizer; a short message to them could settle them.' };
}

function dedupe<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(key(i)) ? false : (seen.add(key(i)), true)));
}

export function describeTopics(keys: readonly string[]): string {
  return keys.map(topicLabel).join(', ');
}

