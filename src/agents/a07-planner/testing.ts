import { isAbsence } from '../../shared/absence.js';
import { describeTestScore, TEST_VERSIONS, type TestFamily, type TestScoreRecord } from '../../shared/assessments.js';
import type { Money } from '../../shared/money.js';
import type { ApplicantCategory } from '../../shared/scope.js';
import { addDays, earliestPossibleInstant, resolveDeadlineInstant, type PublishedDeadline } from '../../shared/time.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import type { RulePackage, TestingPolicy } from '../a06-eligibility/rules.js';
import type { CalendarQueryResult, TestAdministration } from './calendars.js';

/**
 * Testing policy matrix, test needs and administration checks (07R09-07R14,
 * "Testing policy matrix", "Score and format handling").
 *
 * Each policy applies only to its own institution, program, cycle, applicant
 * category and purpose. A test that is not considered for a purpose is never
 * planned for it (07T01). Scores stay attached to their version and date and
 * are never combined into a homemade composite (07T09, 07T10).
 */

export type Purpose = TestingPolicy['purpose'];

export interface PolicyRow {
  targetKey: string;
  institution: string;
  program: string;
  cycle: string;
  purpose: Purpose;
  family: TestFamily;
  policy: TestingPolicy['policy'];
  acceptedVersions: string[];
  reporting: TestingPolicy['reporting'];
  superscore: TestingPolicy['superscore'];
  lastAcceptedTestDate: string | null;
  receiptDeadline: string | null;
  alternativeGroup: string | null;
  sourceId: string;
  packageRef: string;
}

export function policyMatrix(pkg: RulePackage, packageRef: string, targetKey: string, purposes: readonly Purpose[], category: ApplicantCategory | null): PolicyRow[] {
  return pkg.testingPolicies
    .filter((p) => purposes.includes(p.purpose) && (category === null || p.applicantCategories.includes(category)))
    .map((p) => ({
      targetKey,
      institution: pkg.institutionName,
      program: pkg.programName,
      cycle: pkg.entryCycle,
      purpose: p.purpose,
      family: p.family,
      policy: p.policy,
      acceptedVersions: p.acceptedVersions,
      reporting: p.reporting,
      superscore: p.superscore,
      lastAcceptedTestDate: p.lastAcceptedTestDate,
      receiptDeadline: p.receiptDeadline,
      alternativeGroup: p.alternativeGroup,
      sourceId: p.source.sourceId,
      packageRef,
    }));
}

export interface ExistingScore {
  claimId: string;
  record: TestScoreRecord;
  description: string;
  scaleNote: string;
}

export function readScores(view: RecordView): ExistingScore[] {
  return view.entityIds('test_attempt').flatMap((id) => {
    const c = view.current('test_attempt', id, 'record');
    if (!c || isAbsence(c.value)) return [];
    const r = c.value as TestScoreRecord;
    const v = r.versionRef ? TEST_VERSIONS[r.versionRef] : undefined;
    const scaleNote = v ? `${v.label} (reported on this scale; not converted)` : 'Scale or version not established from the report';
    return [{ claimId: c.claimId, record: r, description: describeTestScore(r), scaleNote }];
  });
}

export interface TestNeed {
  family: TestFamily;
  reason: 'required' | 'required_one_of' | 'recommended_student_choice' | 'student_selected';
  purposes: Purpose[];
  targets: string[];
  acceptedVersions: string[];
  /** Latest test date any target accepts (earliest across targets). */
  latestTestDate: string | null;
  /** Earliest institutional receipt deadline across targets. */
  receiptDeadline: string | null;
  alternatives: TestFamily[];
  existing: ExistingScore[];
  sourceIds: string[];
}

export interface TestingDecision {
  needs: TestNeed[];
  notNeeded: Array<{ family: TestFamily; purpose: Purpose; target: string; reason: string; sourceId: string }>;
  optionalChoices: Array<{ family: TestFamily; purpose: Purpose; target: string; note: string }>;
  unresolved: Array<{ family: TestFamily; purpose: Purpose; target: string; note: string }>;
}

const min = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b);

export function decideTests(rows: readonly PolicyRow[], existing: readonly ExistingScore[], studentSelected: readonly TestFamily[]): TestingDecision {
  const needs = new Map<TestFamily, TestNeed>();
  const notNeeded: TestingDecision['notNeeded'] = [];
  const optional: TestingDecision['optionalChoices'] = [];
  const unresolved: TestingDecision['unresolved'] = [];
  const add = (row: PolicyRow, reason: TestNeed['reason'], alternatives: TestFamily[] = []) => {
    const n = needs.get(row.family);
    if (n) {
      n.purposes = [...new Set([...n.purposes, row.purpose])];
      n.targets = [...new Set([...n.targets, row.targetKey])];
      n.acceptedVersions = n.acceptedVersions.length === 0 ? row.acceptedVersions : n.acceptedVersions.filter((v) => row.acceptedVersions.length === 0 || row.acceptedVersions.includes(v));
      n.latestTestDate = min(n.latestTestDate, row.lastAcceptedTestDate);
      n.receiptDeadline = min(n.receiptDeadline, row.receiptDeadline);
      n.sourceIds = [...new Set([...n.sourceIds, row.sourceId])];
      if (reason === 'required' || (reason === 'required_one_of' && n.reason !== 'required')) n.reason = reason;
      n.alternatives = [...new Set([...n.alternatives, ...alternatives])].filter((f) => f !== row.family);
      return;
    }
    needs.set(row.family, {
      family: row.family,
      reason,
      purposes: [row.purpose],
      targets: [row.targetKey],
      acceptedVersions: row.acceptedVersions,
      latestTestDate: row.lastAcceptedTestDate,
      receiptDeadline: row.receiptDeadline,
      alternatives: alternatives.filter((f) => f !== row.family),
      existing: existing.filter((e) => e.record.family === row.family),
      sourceIds: [row.sourceId],
    });
  };
  // Alternatives ("ACT or SAT"): one family is enough. Prefer one the student already has or chose.
  const groups = new Map<string, PolicyRow[]>();
  for (const r of rows) {
    if (r.policy === 'required' && r.alternativeGroup) groups.set(`${r.targetKey}#${r.purpose}#${r.alternativeGroup}`, [...(groups.get(`${r.targetKey}#${r.purpose}#${r.alternativeGroup}`) ?? []), r]);
  }
  for (const g of groups.values()) {
    const families = g.map((r) => r.family);
    const chosen = g.find((r) => existing.some((e) => e.record.family === r.family)) ?? g.find((r) => studentSelected.includes(r.family)) ?? g.find((r) => needs.has(r.family)) ?? g[0]!;
    add(chosen, 'required_one_of', families);
  }
  for (const r of rows) {
    if (r.policy === 'required' && r.alternativeGroup) continue;
    switch (r.policy) {
      case 'required':
        add(r, 'required');
        break;
      case 'not_considered':
        notNeeded.push({ family: r.family, purpose: r.purpose, target: r.targetKey, reason: `${r.institution} does not consider ${r.family.replace(/_/g, ' ')} for ${r.purpose} in the ${r.cycle} cycle, so no test is planned for this purpose.`, sourceId: r.sourceId });
        break;
      case 'recommended':
      case 'optional':
        if (studentSelected.includes(r.family)) add(r, r.policy === 'recommended' ? 'recommended_student_choice' : 'student_selected');
        else optional.push({ family: r.family, purpose: r.purpose, target: r.targetKey, note: `${r.institution} lists ${r.family.replace(/_/g, ' ')} as ${r.policy} for ${r.purpose}. Taking it is your choice; whether to submit a score is a separate strategy question.` });
        break;
      case 'unresolved':
        unresolved.push({ family: r.family, purpose: r.purpose, target: r.targetKey, note: `The ${r.family.replace(/_/g, ' ')} policy of ${r.institution} for ${r.purpose} could not be settled from official sources.` });
        break;
    }
  }
  // A test required for one purpose stays required even if another purpose does not consider it.
  const neededFamilies = new Set(needs.keys());
  return { needs: [...needs.values()], notNeeded: notNeeded.filter((x) => !neededFamilies.has(x.family) || !needs.get(x.family)!.purposes.includes(x.purpose)), optionalChoices: optional.filter((o) => !neededFamilies.has(o.family)), unresolved };
}

// ------------------------------------------------------------------ administrations

export interface AttemptOption {
  administrationId: string;
  family: TestFamily;
  testDate: string;
  format: TestAdministration['deliveryFormat'];
  registration: { deadline: PublishedDeadline; status: 'open' | 'closed' | 'timing_unclear' };
  accommodation: { status: 'not_requested' | 'pending' | 'approved' | 'denied' | 'none_recorded'; deadline: PublishedDeadline | null; dependency: string | null };
  device: { needed: boolean; deadline: PublishedDeadline | null };
  scoreRelease: { earliest: string; latest: string; estimate: boolean };
  receipt: { deadline: string | null; meets: 'yes' | 'no' | 'uncertain' | 'not_applicable'; note: string | null };
  acceptedDate: boolean;
  /** A calendar date is not a reserved seat. */
  seatAvailability: 'unknown';
  costs: Array<{ component: string; amount: Money | null; note: string }>;
  conflicts: string[];
  feasibility: 'feasible' | 'feasible_with_dependencies' | 'not_reliable_for_deadline' | 'conflicts_with_commitment' | 'registration_closed' | 'date_not_accepted';
  sourceId: string;
}

export interface AttemptContext {
  nowIso: string;
  accommodation: AttemptOption['accommodation']['status'];
  deviceAccess: string | null;
  commitments: Array<{ label: string; weekdays: number[] }>;
  country: string | null;
}

const ORGANIZATION: Record<TestFamily, string> = {
  SAT: 'College Board',
  AP: 'College Board',
  ACT: 'ACT',
  TOEFL_IBT: 'ETS',
  IELTS_ACADEMIC: 'IELTS',
  IELTS_GENERAL: 'IELTS',
  DUOLINGO_ENGLISH_TEST: 'Duolingo',
  OTHER: 'the testing organization',
};

export function organizationOf(f: TestFamily): string {
  return ORGANIZATION[f];
}

// 07R13: only the accommodation status is read (never diagnostic records); the app cannot approve accommodations.
export function readAccommodation(view: RecordView, family: TestFamily): AttemptOption['accommodation']['status'] {
  const org = ORGANIZATION[family].toLowerCase();
  for (const id of view.entityIds('accommodation')) {
    const v = view.value<{ organization: string; status: 'not_requested' | 'pending' | 'approved' | 'denied' }>('accommodation', id, 'status');
    if (v && v.organization.toLowerCase().includes(org)) return v.status;
  }
  return 'none_recorded';
}

function weekdayOf(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const WEEKDAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function evaluateAdministration(a: TestAdministration, need: TestNeed, ctx: AttemptContext): AttemptOption {
  const reg = resolveDeadlineInstant(a.registrationDeadline);
  const regStatus: AttemptOption['registration']['status'] = reg.ok ? (reg.instantUtc > ctx.nowIso ? 'open' : 'closed') : earliestPossibleInstant(a.registrationDeadline) > ctx.nowIso ? 'open' : 'timing_unclear';
  const acc: AttemptOption['accommodation'] = { status: ctx.accommodation, deadline: a.accommodationRequestDeadline, dependency: null };
  if (ctx.accommodation === 'pending') acc.dependency = `Your accommodation request with ${ORGANIZATION[a.family]} is still pending. Registration for this date may depend on the decision, and approval is not assumed.`;
  if (ctx.accommodation === 'denied') acc.dependency = `${ORGANIZATION[a.family]} did not approve the accommodation request; plan with that decision in mind or ask your school counselor about next steps.`;
  const deviceNeeded = !!a.deviceLoanDeadline && (ctx.deviceAccess === 'none' || ctx.deviceAccess === 'limited' || ctx.deviceAccess === 'shared_device');
  let meets: AttemptOption['receipt']['meets'] = 'not_applicable';
  let note: string | null = null;
  if (need.receiptDeadline) {
    const releaseLatest = a.scoreRelease.latest;
    if (a.scoreRelease.earliest > need.receiptDeadline) meets = 'no';
    else if (addDays(releaseLatest, 7) <= need.receiptDeadline) meets = 'yes';
    else meets = 'uncertain';
    note =
      meets === 'no'
        ? `Scores are released from ${a.scoreRelease.earliest}, after the ${need.receiptDeadline} receipt deadline, so this date is not a reliable way to meet it.`
        : meets === 'uncertain'
          ? `Scores are ${a.scoreRelease.estimate ? 'expected' : 'released'} between ${a.scoreRelease.earliest} and ${a.scoreRelease.latest}, close to the ${need.receiptDeadline} receipt deadline; sending also takes time, so this is not reliable.`
          : `Scores should be ${a.scoreRelease.estimate ? 'available (estimated)' : 'released'} by ${a.scoreRelease.latest}, before the ${need.receiptDeadline} receipt deadline; sending time still applies.`;
  }
  const accepted = !need.latestTestDate || a.testDate <= need.latestTestDate;
  const wd = weekdayOf(a.testDate);
  const conflicts = ctx.commitments.filter((c) => c.weekdays.includes(wd)).map((c) => `The test is on a ${WEEKDAY[wd]}, when you have “${c.label}”.`);
  const costs: AttemptOption['costs'] = [{ component: 'registration fee', amount: a.fees.registration, note: 'As published by the testing organization.' }];
  if (a.fees.lateFee) costs.push({ component: 'late registration fee', amount: a.fees.lateFee, note: 'Only if you register after the regular deadline.' });
  if (a.fees.scoreReport) costs.push({ component: 'additional score report', amount: a.fees.scoreReport, note: 'Per extra report, if needed.' });
  if (a.deliveryFormat === 'test_center') costs.push({ component: 'travel to the test center', amount: null, note: 'Depends on which center you get; not included.' });
  let feasibility: AttemptOption['feasibility'] = 'feasible';
  if (regStatus === 'closed') feasibility = 'registration_closed';
  else if (!accepted) feasibility = 'date_not_accepted';
  else if (meets === 'no' || meets === 'uncertain') feasibility = 'not_reliable_for_deadline';
  else if (conflicts.length > 0) feasibility = 'conflicts_with_commitment';
  else if (acc.dependency || deviceNeeded || regStatus === 'timing_unclear') feasibility = 'feasible_with_dependencies';
  return {
    administrationId: a.id,
    family: a.family,
    testDate: a.testDate,
    format: a.deliveryFormat,
    registration: { deadline: a.registrationDeadline, status: regStatus },
    accommodation: acc,
    device: { needed: deviceNeeded, deadline: a.deviceLoanDeadline },
    scoreRelease: a.scoreRelease,
    receipt: { deadline: need.receiptDeadline, meets, note },
    acceptedDate: accepted,
    seatAvailability: 'unknown',
    costs,
    conflicts,
    feasibility,
    sourceId: a.sourceId,
  };
}

export interface ProvisionalWindow {
  family: TestFamily;
  window: { from: string; to: string };
  recheckOn: string;
  note: string;
}

export interface AttemptSelection {
  family: TestFamily;
  primary: AttemptOption | null;
  alternative: AttemptOption | null;
  others: number;
  provisional: ProvisionalWindow | null;
}

const USABLE: ReadonlySet<AttemptOption['feasibility']> = new Set(['feasible', 'feasible_with_dependencies']);

/** Pick a primary date and one materially different alternative (07R05), or a provisional window when dates are unpublished (07T15). */
export function selectAttempts(need: TestNeed, cal: CalendarQueryResult, ctx: AttemptContext, today: string, windowEnd: string): AttemptSelection {
  const options = cal.administrations.filter((a) => a.family === need.family && a.status === 'scheduled').map((a) => evaluateAdministration(a, need, ctx));
  const usable = options.filter((o) => USABLE.has(o.feasibility));
  const primary = usable[0] ?? null;
  const alternative = usable[1] ?? options.find((o) => o !== primary && (o.feasibility === 'conflicts_with_commitment' || o.feasibility === 'not_reliable_for_deadline')) ?? null;
  const cov = cal.coverage.find((c) => c.family === need.family);
  let provisional: ProvisionalWindow | null = null;
  if (!primary && (cov?.publishedThrough === null || cov?.publishedThrough === undefined || cov.publishedThrough < windowEnd)) {
    const from = cov?.publishedThrough && cov.publishedThrough >= today ? addDays(cov.publishedThrough, 1) : today;
    provisional = {
      family: need.family,
      window: { from, to: need.latestTestDate ?? windowEnd },
      recheckOn: cov?.publishedThrough && cov.publishedThrough >= today ? addDays(cov.publishedThrough, 1) : addDays(today, 30),
      note: `${ORGANIZATION[need.family]} has not published ${need.family.replace(/_/g, ' ')} dates for this period yet. Plan preparation for this window and check again on the recheck date; no date is assumed.`,
    };
  }
  return { family: need.family, primary, alternative: alternative === primary ? null : alternative, others: Math.max(0, options.length - (primary ? 1 : 0) - (alternative ? 1 : 0)), provisional };
}

// ------------------------------------------------------------------ preparation

export interface StudyBlock {
  id: string;
  objective: string;
  weeklyHours: number;
  weeks: number | null;
  resource: string;
  reviewMethod: string;
}

export interface PrepPlan {
  family: TestFamily;
  weeklyHours: number;
  source: 'student' | 'default_small';
  blocks: StudyBlock[];
  resources: Array<{ name: string; cost: 'free' | 'paid_optional' }>;
  completionCriteria: string[];
  notes: string[];
}

export function prepPlan(family: TestFamily, testDate: string | null, weekly: { min: number; max: number } | null, paidAllowed: boolean, today: string): PrepPlan {
  const hours = weekly ? Math.max(0, weekly.min) : 2;
  const weeks = testDate ? Math.max(1, Math.floor((Date.parse(`${testDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * 86_400_000))) : null;
  const org = ORGANIZATION[family];
  const blocks: StudyBlock[] = [
    { id: `${family}_diagnostic`, objective: 'Take one official practice section to see which kinds of questions need work.', weeklyHours: Math.min(hours, 2), weeks: 1, resource: `${org} official practice material`, reviewMethod: 'Sort each missed question: content gap, misread instructions, timing, or unfamiliar format.' },
    { id: `${family}_targeted`, objective: 'Work on the largest error category from the diagnostic.', weeklyHours: hours, weeks: weeks ? Math.max(1, weeks - 3) : null, resource: `${org} official practice material and school notes`, reviewMethod: 'Update the error log once a week.' },
    { id: `${family}_timed`, objective: 'Practice timed sections to get used to the format.', weeklyHours: hours, weeks: weeks ? Math.min(2, Math.max(1, weeks - 1)) : null, resource: `${org} official timed practice`, reviewMethod: 'Check timing and the error log after each section.' },
  ];
  return {
    family,
    weeklyHours: hours,
    source: weekly ? 'student' : 'default_small',
    blocks: hours === 0 ? [] : blocks,
    resources: [
      { name: `${org} official free practice materials`, cost: 'free' },
      { name: 'Help from a teacher or a school study group', cost: 'free' },
      ...(paidAllowed ? [{ name: 'Paid tutoring or courses (optional; never required)', cost: 'paid_optional' as const }] : []),
    ],
    completionCriteria: ['The diagnostic section is done and every missed question is in the error log.', 'The error log is reviewed each week.', 'Timed practice sections are done in the last weeks before the test.'],
    notes: [
      weekly ? `Uses about ${hours} hour${hours === 1 ? '' : 's'} a week, the lower end of what you said you can give.` : 'Your available time is not recorded, so this starts small; tell me how much time you have and the plan will adjust.',
      'Missing a session means rescheduling or trimming the plan, not starting over.',
    ],
  };
}
