import { isAbsence, type Absence } from '../../shared/absence.js';
import type { Lifecycle } from '../../shared/facts.js';
import type { GradeValue } from '../../shared/grades.js';
import type { Budget } from '../../shared/money.js';
import { broadSubjectOf } from '../../shared/subjects.js';
import { addDays } from '../../shared/time.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import type { Condition, ExperimentTemplate, SubjectProfile } from './knowledge.js';

/**
 * Exploration core for Agent 05: evidence from the student's own words,
 * tentative hypotheses tied to that evidence, and feasible experiments.
 *
 * Deliberately absent: names, gender, ethnicity, disability, family income and
 * any other demographic input (05T08). Grades are read only as current
 * preparation, never to rank or exclude a field (05T03). Other people's
 * preferences are shown as attributed views and never become hypotheses
 * (05R03, 05T02).
 */

// ------------------------------------------------------------------ evidence

export type EvidenceKind = 'interest' | 'own_preference' | 'reflection' | 'experience' | 'assessment';

export interface EvidenceItem {
  claimId: string;
  kind: EvidenceKind;
  text: string;
  lifecycle: Lifecycle;
  recordedAt: string;
  about: string | null;
}

export interface AttributedView {
  claimId: string;
  holderLabel: string;
  text: string;
  topic: string;
}

export interface ExistingHypothesis {
  entityId: string;
  claimId: string;
  text: string;
  subjectKeys: string[];
  taskFocus: string[];
  evidenceClaimIds: string[];
  response: 'accepted_as_tentative' | 'rejected' | 'edited' | null;
  responseRecordedAt: string | null;
}

export interface CourseEvidence {
  claimId: string;
  name: string;
  broadSubject: string | null;
  grade: GradeValue | null;
  status: string | null;
}

export interface GoalContext {
  evidence: EvidenceItem[];
  otherViews: AttributedView[];
  hypotheses: ExistingHypothesis[];
  decisionHorizon: string | null;
  stage: string | null;
  destinations: string[];
  countryContext: string[];
  budget: Budget | Absence | null;
  weeklyHours: { min: number; max: number } | null;
  deviceAccess: string | null;
  courses: CourseEvidence[];
  schoolContext: Array<{ claimId: string; text: string }>;
  servedClaimIds: string[];
}

export function readGoalContext(view: RecordView): GoalContext {
  const evidence: EvidenceItem[] = [];
  const otherViews: AttributedView[] = [];
  const served: string[] = [];
  for (const id of view.entityIds('interest')) {
    const c = view.current('interest', id, 'description');
    const status = view.value<string>('interest', id, 'status');
    if (!c || isAbsence(c.value) || status === 'retired') continue;
    const v = c.value as { text: string; lens: string };
    evidence.push({ claimId: c.claimId, kind: 'interest', text: v.text, lifecycle: c.lifecycle, recordedAt: c.recordedAt, about: null });
    served.push(c.claimId);
  }
  for (const id of view.entityIds('preference')) {
    for (const f of view.holderVariants('preference', id, 'statement')) {
      const c = f.current;
      if (!c || isAbsence(c.value)) continue;
      const v = c.value as { text: string; topic: string };
      served.push(c.claimId);
      if (!f.holder || f.holder.kind === 'student') evidence.push({ claimId: c.claimId, kind: 'own_preference', text: v.text, lifecycle: c.lifecycle, recordedAt: c.recordedAt, about: v.topic });
      else otherViews.push({ claimId: c.claimId, holderLabel: f.holder.kind === 'reported_other' ? f.holder.label : 'a supporter', text: v.text, topic: v.topic });
    }
  }
  for (const id of view.entityIds('reflection')) {
    const c = view.current('reflection', id, 'text');
    if (!c || isAbsence(c.value)) continue;
    const v = c.value as { text: string; about: string | null };
    evidence.push({ claimId: c.claimId, kind: 'reflection', text: v.text, lifecycle: c.lifecycle, recordedAt: c.recordedAt, about: v.about });
    served.push(c.claimId);
  }
  for (const id of view.entityIds('experience')) {
    const c = view.current('experience', id, 'identity');
    if (!c || isAbsence(c.value)) continue;
    const v = c.value as { titleStudentSupplied: string; category: string };
    evidence.push({ claimId: c.claimId, kind: 'experience', text: v.titleStudentSupplied, lifecycle: c.lifecycle, recordedAt: c.recordedAt, about: v.category });
    served.push(c.claimId);
  }
  for (const id of view.entityIds('assessment')) {
    const c = view.current('assessment', id, 'result');
    if (!c || isAbsence(c.value)) continue;
    const v = c.value as { instrument: string; results: Array<{ scale: string; value: number | string }> };
    evidence.push({ claimId: c.claimId, kind: 'assessment', text: v.results.map((r) => r.scale).join(', '), lifecycle: c.lifecycle, recordedAt: c.recordedAt, about: v.instrument });
    served.push(c.claimId);
  }
  const hypotheses: ExistingHypothesis[] = [];
  for (const id of view.entityIds('hypothesis')) {
    const c = view.current('hypothesis', id, 'statement');
    if (!c || isAbsence(c.value)) continue;
    const v = c.value as { text: string; evidenceClaimIds: string[]; subjectKeys?: string[]; taskFocus?: string[] };
    const r = view.current('hypothesis', id, 'student_response');
    hypotheses.push({ entityId: id, claimId: c.claimId, text: v.text, subjectKeys: v.subjectKeys ?? [], taskFocus: v.taskFocus ?? [], evidenceClaimIds: v.evidenceClaimIds, response: r && !isAbsence(r.value) ? (r.value as ExistingHypothesis['response']) : null, responseRecordedAt: r?.recordedAt ?? null });
    served.push(c.claimId);
  }
  const courses: CourseEvidence[] = view.entityIds('course').flatMap((id) => {
    const name = view.current('course', id, 'name_original');
    if (!name || isAbsence(name.value)) return [];
    const mapping = view.value<{ key: string }>('course', id, 'subject_mapping');
    const grade = view.value<GradeValue>('course', id, 'grade') ?? null;
    served.push(name.claimId);
    return [{ claimId: name.claimId, name: String(name.value), broadSubject: mapping ? (broadSubjectOf(mapping.key) ?? mapping.key) : null, grade, status: view.value<string>('course', id, 'enrollment_status') ?? null }];
  });
  const schoolContext = view.entityIds('school_context').flatMap((id) => {
    const c = view.current('school_context', id, 'note');
    if (!c || isAbsence(c.value)) return [];
    served.push(c.claimId);
    return [{ claimId: c.claimId, text: (c.value as { text: string }).text }];
  });
  const budgetView = view.current('student', 'self', 'constraints.opportunity_budget');
  const residence = view.studentValue<string>('identity.residence_country');
  const school = view.studentValue<string>('education.school_country');
  const destinations = view.studentValue<string[]>('application.destination_countries') ?? [];
  return {
    evidence,
    otherViews,
    hypotheses,
    decisionHorizon: view.studentValue<string>('goals.decision_horizon') ?? null,
    stage: view.studentValue<string>('education.stage') ?? null,
    destinations,
    countryContext: [...new Set([...destinations, ...(residence ? [residence] : []), ...(school ? [school] : [])])],
    budget: budgetView ? (budgetView.value as Budget | Absence) : null,
    weeklyHours: view.studentValue<{ min: number; max: number }>('constraints.weekly_hours_available') ?? null,
    deviceAccess: view.studentValue<string>('constraints.device_access') ?? null,
    courses,
    schoolContext,
    servedClaimIds: served,
  };
}

// ------------------------------------------------------------------ matching words to fields

const NEGATIVE = /\b(don'?t|do not|didn'?t|did not|not|never|no longer|hate[ds]?|dislike[ds]?|boring|bored|not for me|wasn'?t for me|too hard|frustrat\w*)\b/i;
const PRESSURE = /\b(should|have to|has to|supposed to|expected to|they want me|(my )?(parents|family|mom|mum|dad|father|mother) (want|wants|expect|expects))\b/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface SubjectMatch {
  key: string;
  phrase: string;
  direction: 'supports' | 'against';
  pressure: boolean;
}

function clauses(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|,?\s+\b(?:but|while|whereas|although|though|however)\b\s+/i).map((c) => c.trim()).filter(Boolean);
}

export function matchSubjects(text: string, profiles: readonly SubjectProfile[]): SubjectMatch[] {
  const out: SubjectMatch[] = [];
  for (const clause of clauses(text)) {
    for (const p of profiles) {
      for (const kw of p.keywords) {
        const m = new RegExp(`(?<![\\p{L}])${escapeRe(kw)}(?![\\p{L}])`, 'iu').exec(clause);
        if (!m) continue;
        const before = clause.slice(0, m.index);
        const after = clause.slice(m.index + m[0].length, m.index + m[0].length + 30);
        const negativeAfter = /\b(hated|disliked|boring|didn'?t like|did not like)\b/i.test(after) && !/\b(liked|loved|enjoyed)\b/i.test(before);
        const against = NEGATIVE.test(before) || negativeAfter;
        out.push({ key: p.key, phrase: m[0], direction: against ? 'against' : 'supports', pressure: PRESSURE.test(clause) });
        break;
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(`${m.key}:${m.direction}`) ? false : (seen.add(`${m.key}:${m.direction}`), true)));
}

/** Tasks the student said they enjoyed or disliked ("I liked debugging but hated designing the interface"). */
export function taskSentiments(text: string): { liked: string[]; disliked: string[] } {
  const liked: string[] = [];
  const disliked: string[] = [];
  for (const m of text.matchAll(/\b(?:i\s+)?(liked|enjoyed|loved|had fun|was good at|found it fun)\s+(?!it\b)([^.;,!?]+?)(?=\s+\b(?:but|and i|while|though)\b|[.;,!?]|$)/gi)) liked.push(m[2]!.trim());
  for (const m of text.matchAll(/\b(?:i\s+)?(hated|disliked|didn'?t like|did not like|didn'?t enjoy|found it boring|was bored by)\s+([^.;,!?]+?)(?=\s+\b(?:but|and i|while|though)\b|[.;,!?]|$)/gi)) disliked.push(m[2]!.trim());
  return { liked: liked.filter((t) => t.split(/\s+/).length <= 8), disliked: disliked.filter((t) => t.split(/\s+/).length <= 8) };
}

// ------------------------------------------------------------------ hypotheses

export interface Hypothesis {
  id: string;
  subjectKeys: string[];
  label: string;
  kind: 'direct' | 'combination' | 'adjacent';
  statement: string;
  evidence: Array<{ claimId: string; quote: string; kind: EvidenceKind; direction: 'supports' | 'against' }>;
  unknowns: string[];
  support: 'emerging' | 'several_examples' | 'mixed' | 'less_supported';
  taskFocus: string[];
  pressureNote: string | null;
  commitmentLevel: 'tentative';
  /** The recorded hypothesis this corresponds to, if any. */
  existingEntityId: string | null;
}

const WEIGHT: Record<EvidenceKind, number> = { reflection: 2, interest: 1.5, own_preference: 1, experience: 1, assessment: 0.5 };

function quoteOf(text: string): string {
  const t = text.trim().replace(/[.!?]+$/, '');
  return t.length > 90 ? `${t.slice(0, 87)}...` : t;
}

/**
 * A few plausible, distinct options tied to the student's own evidence
 * (05R04). Never a list of 40 majors; never a winner.
 */
export function generateHypotheses(ctx: GoalContext, profiles: readonly SubjectProfile[], max = 4): Hypothesis[] {
  const byKey = new Map(profiles.map((p) => [p.key, p]));
  const acc = new Map<string, { supports: Hypothesis['evidence']; against: Hypothesis['evidence']; score: number; pressure: string | null; tasks: string[] }>();
  const get = (k: string) => {
    let a = acc.get(k);
    if (!a) {
      a = { supports: [], against: [], score: 0, pressure: null, tasks: [] };
      acc.set(k, a);
    }
    return a;
  };
  for (const e of ctx.evidence) {
    const matches = matchSubjects(e.text, profiles);
    if (e.about && byKey.has(e.about) && !matches.some((m) => m.key === e.about)) {
      // A reflection about an experiment for a known field counts for that field.
      const s = taskSentiments(e.text);
      const negative = s.liked.length === 0 && (s.disliked.length > 0 || NEGATIVE.test(e.text));
      matches.push({ key: e.about, phrase: e.about, direction: negative ? 'against' : 'supports', pressure: false });
    }
    const tasks = e.kind === 'reflection' ? taskSentiments(e.text) : { liked: [], disliked: [] };
    for (const m of matches) {
      const a = get(m.key);
      const item = { claimId: e.claimId, quote: quoteOf(e.text), kind: e.kind, direction: m.direction };
      if (m.direction === 'supports') {
        a.supports.push(item);
        a.score += WEIGHT[e.kind];
        a.tasks.push(...tasks.liked);
      } else {
        a.against.push(item);
        a.score -= WEIGHT[e.kind];
      }
      if (m.pressure && e.kind === 'own_preference') a.pressure = `You said “${quoteOf(e.text)}”. It can help to separate what attracts you to this from what others expect.`;
      if (m.pressure && e.kind === 'interest' && /\bshould\b/i.test(e.text)) a.pressure = `You said “${quoteOf(e.text)}”. It can help to separate what attracts you to this from what others expect.`;
    }
  }
  // Rejected suggestions are not proposed again unless the student brings the field up afterwards (05T12).
  const rejected = new Map<string, string>();
  for (const h of ctx.hypotheses) if (h.response === 'rejected') for (const k of h.subjectKeys) rejected.set(k, h.responseRecordedAt ?? '');
  const allowed = (k: string) => {
    const when = rejected.get(k);
    if (when === undefined) return true;
    return (acc.get(k)?.supports ?? []).some((s) => (ctx.evidence.find((e) => e.claimId === s.claimId)?.recordedAt ?? '') > when);
  };
  const existingFor = (keys: string[]) => ctx.hypotheses.find((h) => h.response !== 'rejected' && h.subjectKeys.length === keys.length && h.subjectKeys.every((k) => keys.includes(k)))?.entityId ?? null;

  const supportLevel = (a: { supports: unknown[]; against: unknown[] }): Hypothesis['support'] =>
    a.against.length >= a.supports.length && a.against.length > 0 ? 'less_supported' : a.against.length > 0 ? 'mixed' : a.supports.length >= 2 ? 'several_examples' : 'emerging';

  const unknownsFor = (p: SubjectProfile, a: { supports: Hypothesis['evidence'] }) => {
    const u: string[] = [];
    if (!a.supports.some((s) => s.kind === 'reflection' || s.kind === 'experience')) u.push(`You have not tried work like ${p.methods[0]} yet.`);
    if (p.oftenRequires.length > 0) u.push(`Many programs ask for ${p.oftenRequires.join(' or ')}; this varies by program.`);
    if (p.regulatedProfessions.length > 0) u.push('Professional routes differ by country and need checking for the countries you are considering.');
    u.push(p.variesAcrossPrograms);
    return u;
  };

  const direct = [...acc.entries()]
    .filter(([k, a]) => byKey.has(k) && a.supports.length > 0 && allowed(k))
    .sort((x, y) => y[1].score - x[1].score || x[0].localeCompare(y[0]));
  const out: Hypothesis[] = [];
  for (const [k, a] of direct) {
    const p = byKey.get(k)!;
    const tasks = [...new Set(a.tasks)].slice(0, 2);
    const quotes = [...new Set(a.supports.map((s) => s.quote))].slice(0, 2);
    const statement = tasks.length > 0
      ? `You enjoyed ${tasks.join(' and ')}. It may be worth exploring more work like that, for example in ${p.label.toLowerCase()}.`
      : `You mentioned “${quotes.join('” and “')}”. ${p.label} is one field where that is central, so it may be worth exploring.`;
    out.push({ id: `hyp_${k}`, subjectKeys: [k], label: p.label, kind: 'direct', statement, evidence: [...a.supports, ...a.against], unknowns: unknownsFor(p, a), support: supportLevel(a), taskFocus: tasks, pressureNote: a.pressure, commitmentLevel: 'tentative', existingEntityId: existingFor([k]) });
  }
  // Combinations the student's own interests point to (e.g. biology + visual design).
  const supported = new Set(direct.map(([k]) => k));
  for (const p of profiles) {
    if (supported.has(p.key) || !allowed(p.key)) continue;
    const bridge = p.bridges.find((b) => b.every((k) => supported.has(k)));
    if (!bridge) continue;
    const ev = bridge.flatMap((k) => acc.get(k)!.supports);
    const labels = bridge.map((k) => byKey.get(k)!.label.toLowerCase());
    out.push({ id: `hyp_${p.key}`, subjectKeys: [p.key], label: p.label, kind: 'combination', statement: `You are drawn to both ${labels.join(' and ')}. ${p.label} combines them, so it may be worth a look.`, evidence: ev, unknowns: unknownsFor(p, { supports: ev }), support: 'emerging', taskFocus: [], pressureNote: null, commitmentLevel: 'tentative', existingEntityId: existingFor([p.key]) });
  }
  // One adjacent, less obvious option when there are few direct ones.
  if (out.length > 0 && out.length < 3) {
    const top = byKey.get(out[0]!.subjectKeys[0]!)!;
    const adj = top.adjacent.find((k) => byKey.has(k) && !out.some((h) => h.subjectKeys.includes(k)) && allowed(k) && (acc.get(k)?.against.length ?? 0) === 0);
    if (adj) {
      const p = byKey.get(adj)!;
      const ev = out[0]!.evidence.filter((e) => e.direction === 'supports');
      out.push({ id: `hyp_${adj}`, subjectKeys: [adj], label: p.label, kind: 'adjacent', statement: `${p.label} is related to ${top.label.toLowerCase()} and uses some of the same interests; it is less obvious but may be worth a look.`, evidence: ev, unknowns: unknownsFor(p, { supports: [] }), support: 'emerging', taskFocus: [], pressureNote: null, commitmentLevel: 'tentative', existingEntityId: existingFor([adj]) });
    }
  }
  // Keep options distinct and few; a field the evidence now argues against stays visible, marked as such.
  return out.slice(0, max);
}

// ------------------------------------------------------------------ preparation (a lens, never a ceiling)

export interface PreparationNote {
  subjectKey: string;
  text: string;
  claimIds: string[];
}

export function preparationNotes(h: Hypothesis, p: SubjectProfile, ctx: GoalContext): PreparationNote | null {
  if (p.helpfulSchoolSubjects.length === 0) return null;
  const related = ctx.courses.filter((c) => c.broadSubject && p.helpfulSchoolSubjects.includes(c.broadSubject));
  const covered = new Set(related.map((c) => c.broadSubject));
  const missing = p.helpfulSchoolSubjects.filter((s) => !covered.has(s));
  const parts: string[] = [];
  if (related.length > 0) parts.push(`On your record: ${related.map((c) => c.name).join(', ')}.`);
  if (missing.length > 0) parts.push(`${missing.map((s) => s.replace(/_/g, ' ')).join(' and ')} often help${missing.length === 1 ? 's' : ''} for this field; specific programs set their own requirements.`);
  parts.push('Grades show current preparation and context, not a limit on what you can develop.');
  if (ctx.schoolContext.length > 0) parts.push('Your school context is taken into account.');
  return { subjectKey: h.subjectKeys[0]!, text: parts.join(' '), claimIds: [...related.map((c) => c.claimId), ...ctx.schoolContext.map((s) => s.claimId)] };
}

// ------------------------------------------------------------------ experiments

export interface PlannedExperiment {
  experimentId: string;
  hypothesisRef: string | null;
  learningQuestion: string;
  activity: string;
  timeBudget: string;
  minutesTotal: number;
  cost: 'free' | 'low_cost' | 'paid';
  accessNotes: string[];
  reflectionPrompt: string;
  publicSharingRequired: false;
  externalContact: { needed: boolean; preparedQuestions: string[]; sent: false };
  sponsorDisclosure: string | null;
  reviewDate: string;
}

function budgetAllowsPaid(b: GoalContext['budget']): 'free_only' | 'low_cost' | 'paid' {
  if (b === null) return 'low_cost';
  if (isAbsence(b)) return (b as Absence).reason === 'not_applicable' ? 'paid' : 'free_only';
  const amt = Number((b as Budget).amount.amount);
  return amt <= 0 ? 'free_only' : amt < 50 ? 'low_cost' : 'paid';
}

/**
 * Choose two or three feasible experiments (05R07). Order depends only on fit
 * with the student's hypotheses, cost and time; sponsorship is disclosed but
 * never considered (05T13).
 */
export function chooseExperiments(hypotheses: readonly Hypothesis[], templates: readonly ExperimentTemplate[], ctx: GoalContext, today: string, max = 3): PlannedExperiment[] {
  const allowance = budgetAllowsPaid(ctx.budget);
  const costRank = { free: 0, low_cost: 1, paid: 2 } as const;
  const limitedDevice = ctx.deviceAccess === 'none' || ctx.deviceAccess === 'limited' || ctx.deviceAccess === 'shared_device';
  const capacityMinutes = ctx.weeklyHours ? ctx.weeklyHours.max * 60 : null;
  const scored = templates
    .filter((t) => t.cost.kind === 'free' || (t.cost.kind === 'low_cost' && allowance !== 'free_only') || (t.cost.kind === 'paid' && allowance === 'paid'))
    .map((t) => {
      const hIndex = hypotheses.findIndex((h) => h.subjectKeys.some((k) => t.subjectKeys.includes(k)));
      const h = hIndex >= 0 ? hypotheses[hIndex]! : null;
      const taskHit = h ? t.taskFocus.some((f) => h.taskFocus.some((x) => x.toLowerCase().includes(f.split(' ')[0]!.toLowerCase()) || f.toLowerCase().includes(x.split(' ')[0]!.toLowerCase()))) : false;
      return { t, h, hIndex: hIndex < 0 ? 99 : hIndex, taskHit, minutes: t.timeBudget.sessions * t.timeBudget.minutesPerSession };
    })
    .filter((x) => hypotheses.length === 0 || x.h !== null)
    .filter((x) => capacityMinutes === null || x.minutes <= capacityMinutes)
    .sort((a, b) => Number(b.taskHit) - Number(a.taskHit) || a.hIndex - b.hIndex || costRank[a.t.cost.kind] - costRank[b.t.cost.kind] || a.minutes - b.minutes || a.t.id.localeCompare(b.t.id));
  const picked: typeof scored = [];
  const coveredHyp = new Set<number>();
  for (const x of scored) {
    if (picked.length >= max) break;
    // Prefer covering different hypotheses before doubling up on one.
    if (coveredHyp.has(x.hIndex) && scored.some((y) => !picked.includes(y) && !coveredHyp.has(y.hIndex) && y !== x)) continue;
    picked.push(x);
    coveredHyp.add(x.hIndex);
  }
  for (const x of scored) if (picked.length < max && !picked.includes(x)) picked.push(x);
  return picked.slice(0, max).map(({ t, h, minutes }) => {
    const access: string[] = [];
    if (t.needs.includes('device') && limitedDevice) access.push(...t.alternatives);
    if (t.needs.includes('internet')) access.push(...t.alternatives.filter((a) => /library|book/i.test(a)));
    if (t.cost.kind !== 'free') access.push(t.cost.kind === 'low_cost' ? 'Needs only inexpensive materials; alternatives are listed.' : 'This one costs money; free alternatives are listed.');
    return {
      experimentId: t.id,
      hypothesisRef: h?.id ?? null,
      learningQuestion: t.learningQuestion,
      activity: t.activity,
      timeBudget: `${t.timeBudget.sessions} session${t.timeBudget.sessions === 1 ? '' : 's'} of about ${t.timeBudget.minutesPerSession} minutes`,
      minutesTotal: minutes,
      cost: t.cost.kind,
      accessNotes: [...new Set(access.length > 0 ? access : t.alternatives.slice(0, 1))],
      reflectionPrompt: t.reflectionPrompt,
      publicSharingRequired: false as const,
      externalContact: { needed: t.needs.includes('external_contact'), preparedQuestions: t.contactQuestions, sent: false as const },
      sponsorDisclosure: t.sponsorship ? `Offered by ${t.sponsorship.sponsor}${t.sponsorship.paidReferral ? '; the provider pays for referrals, which did not affect this suggestion' : ''}.` : null,
      reviewDate: addDays(today, 14),
    };
  });
}

// ------------------------------------------------------------------ learning conditions the student prefers

const CONDITION_WORDS: ReadonlyArray<[Condition, RegExp]> = [
  ['practical_work', /\b(hands[- ]on|practical|real[- ]world|applied)\b/i],
  ['collaboration', /\b(team|group|together|with others|collaborat\w*)\b/i],
  ['independence', /\b(on my own|independent\w*|by myself|alone)\b/i],
  ['reading', /\b(reading|books|read)\b/i],
  ['writing', /\b(writing|essays|write)\b/i],
  ['making', /\b(making|building|creating|craft)\b/i],
  ['quantitative', /\b(numbers|maths?|equations|calculat\w*)\b/i],
  ['fieldwork', /\b(outdoors|outside|field)\b/i],
  ['clinical', /\b(patients|hospital|clinic)\b/i],
  ['presenting', /\b(presenting|speaking|performing)\b/i],
  ['programming', /\b(coding|programming)\b/i],
];

export function preferredConditions(ctx: GoalContext): Array<{ condition: Condition; claimId: string }> {
  const out: Array<{ condition: Condition; claimId: string }> = [];
  for (const e of ctx.evidence.filter((x) => x.kind === 'own_preference' || x.kind === 'reflection')) {
    for (const [c, re] of CONDITION_WORDS) if (re.test(e.text) && !NEGATIVE.test(e.text.slice(0, e.text.search(re)))) out.push({ condition: c, claimId: e.claimId });
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.condition) ? false : (seen.add(x.condition), true)));
}
