import { isAbsence } from '../../shared/absence.js';
import type { Lifecycle } from '../../shared/facts.js';
import type { Outcome, TimeEstimate } from '../../shared/fields.js';
import { diffDays, partialDateBounds, type DateInterval } from '../../shared/time.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import type { AwardInput, Clarification, EpisodeInput, ExperienceInput, OutcomeInput, ResearchInput } from './types.js';

/**
 * Deterministic checks and descriptive assessment for Agent 08. Dates,
 * overlaps and totals are computed here; a model is never asked for an impact
 * number. Findings are clarification triggers phrased neutrally, never
 * accusations (08R07), and the assessment describes supported qualities with
 * evidence instead of scoring the student (08R08).
 */

export interface Notice {
  code: 'lifecycle_corrected' | 'acceptance_recorded' | 'team_outcome_separated' | 'measure_needs_clarifying' | 'private_detail_omitted' | 'unofficial_title' | 'award_scope_unverified' | 'approval_needed' | 'approval_timing' | 'nothing_to_record' | 'faithful_wording' | 'no_admission_score';
  message: string;
}

// ------------------------------------------------------------------ privacy minimization

const RELATION = String.raw`(?:brother|sister|sibling|siblings|mom|mum|mother|dad|father|grandma|grandpa|grandmother|grandfather|grandparents?|aunt|uncle|cousin|son|daughter|neighbou?r|parent|parents)`;
const NAME_AFTER_RELATION = new RegExp(String.raw`\b((?:my|our|his|her)\s+(?:little\s+|younger\s+|older\s+|baby\s+)?${RELATION})(?:,)?\s+(?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?\b`, 'g');
const HEALTH_DETAIL = /\b(?:who|that)\s+(?:has|is|was|had)\s+[^,.;]{0,40}\b(?:diagnos\w*|disab\w*|autis\w*|adhd|ill\w*|sick|cancer|dementia|disorder|medication|hospital\w*|depress\w*|anxiety|pregnan\w*|surgery|chemo\w*|wheelchair)\b[^,.;]*|\b(?:with|because of)\s+(?:his|her|their|my)\s+[^,.;]{0,30}\b(?:diagnos\w*|disab\w*|autis\w*|adhd|illness|cancer|dementia|disorder|depress\w*|anxiety)\b[^,.;]*/gi;

/**
 * Keep enough to understand time and responsibility without other people's
 * names, diagnoses or intimate circumstances (08 "Privacy and personal
 * boundaries", 08T11).
 */
export function minimizeThirdParty(text: string): { text: string; changed: boolean } {
  let t = text.replace(NAME_AFTER_RELATION, '$1');
  t = t.replace(HEALTH_DETAIL, '').replace(/\s+([,.;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return { text: t.length > 0 ? t : 'regular family responsibilities', changed: t !== text.trim() };
}

// ------------------------------------------------------------------ normalization of one submitted experience

const TEAM_WORDS = /\b(we|our|the team|the club|the group|together|everyone)\b/i;
const IMPACT_WORDS = /\b(help(ed|s)?|reach(ed)?|impact(ed)?|serv(e|ed)|benefit(ed)?|affected|touched)\b/i;

export interface NormalizedExperience {
  input: ExperienceInput;
  /** Awards derived from the input (e.g. an acceptance recorded as a selection). */
  derivedAwards: AwardInput[];
  notices: Notice[];
  clarifications: Omit<Clarification, 'id' | 'experienceRef'>[];
  /** Restrict visibility (caregiving and family responsibilities). */
  restrictToFamilyContext: boolean;
  /** Human review is advisable (work started before a required approval). */
  reviewAdvisable: boolean;
}

function startBound(d: DateInterval): string {
  return partialDateBounds(d.start).start;
}

export function normalizeExperience(raw: ExperienceInput, today: string): NormalizedExperience {
  const input: ExperienceInput = structuredClone(raw);
  const notices: Notice[] = [];
  const clarifications: NormalizedExperience['clarifications'] = [];
  const derivedAwards: AwardInput[] = [];
  let reviewAdvisable = false;

  const family = ['caregiving', 'household_responsibility'].includes(input.category) || input.organizationKind === 'family';
  let privacyChanged = false;
  const minimize = (s: string): string => {
    if (!family) return s;
    const m = minimizeThirdParty(s);
    privacyChanged ||= m.changed;
    return m.text;
  };
  input.title = minimize(input.title);

  input.episodes = input.episodes.map((ep, i) => {
    const e: EpisodeInput = { ...ep, personalTasks: ep.personalTasks.map(minimize), decisionsInfluenced: ep.decisionsInfluenced.map(minimize), learning: ep.learning ? minimize(ep.learning) : null };
    const start = startBound(e.period);
    // A future start cannot be a completed or current experience (08R02, 08T02).
    if (start > today && (e.lifecycle === 'completed' || e.lifecycle === 'in_progress')) {
      notices.push({ code: 'lifecycle_corrected', message: `“${input.title}” has not started yet, so it is recorded as planned rather than ${e.lifecycle === 'completed' ? 'completed' : 'in progress'}.` });
      e.lifecycle = 'planned';
      e.period = { ...e.period, ongoing: false };
    }
    if (e.lifecycle === 'completed' && e.period.ongoing) e.period = { ...e.period, ongoing: false };
    if ((e.lifecycle === 'planned' || e.lifecycle === 'considering') && start < today) {
      clarifications.push({ episodeRef: `episode:${i}`, kind: 'lifecycle', question: `The start date for “${input.title}” has passed. Has it started, or is it still planned?`, options: ['It has started', 'Still planned', 'It did not happen'] });
    }
    if (e.period.end && partialDateBounds(e.period.end).end < partialDateBounds(e.period.start).start) {
      clarifications.push({ episodeRef: `episode:${i}`, kind: 'dates', question: `The end date for “${input.title}” is before its start date. Could you check the dates?`, options: [] });
    }
    if (e.selection !== 'none') {
      derivedAwards.push({ title: `Selected for ${input.title}`, organizer: input.organization, date: null, scope: 'unknown', stage: 'selected', attribution: 'individual', selectionNote: e.lifecycle === 'planned' ? 'Acceptance recorded; participation is planned, not completed.' : null, scopeBasis: 'student_stated' });
      if (e.lifecycle === 'planned') notices.push({ code: 'acceptance_recorded', message: `Your acceptance to “${input.title}” is recorded, with participation as planned.` });
    }
    // Team results described as personal impact are kept as team results (08R03, 08T03).
    const personal: OutcomeInput[] = [];
    const team: OutcomeInput[] = [...e.teamOutcomes.map((o) => ({ ...o, description: minimize(o.description) }))];
    for (const o0 of e.personalOutcomes) {
      const o = { ...o0, description: minimize(o0.description) };
      if (o.attribution === 'team' || TEAM_WORDS.test(o.description)) {
        team.push({ ...o, attribution: 'team' });
        notices.push({ code: 'team_outcome_separated', message: `“${o.description}” reads as a team result, so it is kept separate from your personal contribution.` });
        if (e.personalTasks.length === 0) clarifications.push({ episodeRef: `episode:${i}`, kind: 'personal_contribution', question: `For “${o.description}”, what did you personally do?`, options: [] });
      } else personal.push(o);
    }
    // An impact number with an unclear measure is not stored as "people helped" (08R05, 08T06).
    const clarifyMeasure = (o: OutcomeInput): OutcomeInput => {
      const m = o.measure;
      if (m && m.value !== null && (m.kind === 'people_served' || m.kind === 'other') && (m.method === 'unknown' || m.method === 'estimated') && IMPACT_WORDS.test(o.description)) {
        const shown = typeof m.value === 'number' ? m.value : `${m.value.min}-${m.value.max}`;
        clarifications.push({ episodeRef: `episode:${i}`, kind: 'measure', question: `When you say ${shown}${m.unit ? ` ${m.unit}` : ''}, is that the number invited, the number who took part, or another measure?`, options: ['Invited', 'Took part', 'Another measure'] });
        notices.push({ code: 'measure_needs_clarifying', message: `The number in “${o.description}” is kept out of summaries until its measure is clear.` });
        return { ...o, measure: null };
      }
      return o;
    };
    e.personalOutcomes = personal.map(clarifyMeasure);
    e.teamOutcomes = team.map(clarifyMeasure);
    if (e.roleTitle && !e.titleIsOfficial) notices.push({ code: 'unofficial_title', message: `“${e.roleTitle}” is recorded as your own description of the role, not an official title.` });
    return e;
  });

  input.awards = input.awards.map((a) => {
    const award = { ...a, title: minimize(a.title) };
    // An impressive name is not evidence of scope (08T08).
    if (award.scopeBasis === 'inferred_from_title') award.scope = 'unknown';
    if (!award.scopeSourceId && award.scope !== 'unknown' && award.scope !== 'school') {
      notices.push({ code: 'award_scope_unverified', message: `The ${award.scope} scope of “${award.title}” is recorded as you reported it; it has not been verified.` });
    }
    return award;
  });

  input.research = input.research.map((r: ResearchInput) => {
    const needsReview = r.oversight.some((o) => o !== 'none_known');
    if (needsReview && r.approvalStatus !== 'approved_before_work' && r.approvalStatus !== 'not_required') {
      clarifications.push({ episodeRef: null, kind: 'approval', question: 'This work involves people, animals or hazardous materials. Has a supervisor or review body approved it before the work begins?', options: ['Approved before starting', 'Approval is pending', 'Not sure what applies'] });
      notices.push({ code: 'approval_needed', message: 'Work involving people, animals or hazardous materials usually needs supervision and approval before it starts. Nothing here suggests going ahead without it.' });
      if (r.workStarted) {
        reviewAdvisable = true;
        notices.push({ code: 'approval_timing', message: 'Some reviews must happen before work begins, and a later approval may not cover work already done. A supervisor or the program’s review body is the right person to advise.' });
      }
    }
    return r;
  });

  if (privacyChanged) notices.push({ code: 'private_detail_omitted', message: 'I kept a broad description of your responsibilities and left out other people’s names and personal details.' });
  return { input, derivedAwards, notices, clarifications, restrictToFamilyContext: family, reviewAdvisable };
}

// ------------------------------------------------------------------ reading the experience record

export interface EpisodeRecord {
  episodeId: string;
  experienceRef: string;
  roleTitle: string | null;
  titleIsOfficial: boolean;
  period: DateInterval;
  time: TimeEstimate | null;
  lifecycle: Lifecycle;
  personalTasks: string[];
  decisionsInfluenced: string[];
  teamOutcomes: Outcome[];
  personalOutcomes: Outcome[];
  supervision: string;
  learning: string | null;
  claimIds: string[];
  confirmed: boolean;
}

export interface ExperienceRecord {
  experienceId: string;
  title: string;
  organization: string | null;
  organizationKind: string;
  category: string;
  lifecycle: Lifecycle;
  episodes: EpisodeRecord[];
  awards: Array<{ awardId: string; title: string; organizer: string | null; scope: string; stage: string; attribution: string; lifecycle: Lifecycle; claimIds: string[]; confirmed: boolean }>;
  research: Array<{ researchId: string; status: string; studentTasks: string[]; supervision: string; approvalStatus: string; authorship: string | null; oversight: string[]; claimIds: string[]; confirmed: boolean }>;
  claimIds: string[];
  evidenceStatus: 'self_reported' | 'document_supported' | 'verified';
  confirmed: boolean;
}

export function readExperiences(view: RecordView): ExperienceRecord[] {
  const out: ExperienceRecord[] = [];
  const confirmed = (c: string | undefined) => c === 'student_confirmed' || c === 'counselor_confirmed' || c === 'human_reviewed' || c === 'issuer_verified';
  const episodes = view.entityIds('episode').map((id) => {
    const def = view.current('episode', id, 'definition');
    if (!def || isAbsence(def.value)) return null;
    const d = def.value as { experienceRef: string; roleTitle: string | null; titleIsOfficial: boolean; period: DateInterval; time: TimeEstimate | null };
    const contrib = view.current('episode', id, 'contribution');
    const c = contrib && !isAbsence(contrib.value) ? (contrib.value as { personalTasks: string[]; decisionsInfluenced: string[]; teamOutcomes: Outcome[]; personalOutcomes: Outcome[]; supervision: string }) : null;
    const learning = view.current('episode', id, 'learning');
    const rec: EpisodeRecord = {
      episodeId: id,
      experienceRef: d.experienceRef,
      roleTitle: d.roleTitle,
      titleIsOfficial: d.titleIsOfficial,
      period: d.period,
      time: d.time,
      lifecycle: def.lifecycle,
      personalTasks: c?.personalTasks ?? [],
      decisionsInfluenced: c?.decisionsInfluenced ?? [],
      teamOutcomes: c?.teamOutcomes ?? [],
      personalOutcomes: c?.personalOutcomes ?? [],
      supervision: c?.supervision ?? 'unknown',
      learning: learning && !isAbsence(learning.value) ? (learning.value as { studentWords: string }).studentWords : null,
      claimIds: [def.claimId, ...(contrib ? [contrib.claimId] : []), ...(learning ? [learning.claimId] : [])],
      confirmed: confirmed(def.confirmation),
    };
    return rec;
  });
  for (const id of view.entityIds('experience')) {
    const ident = view.current('experience', id, 'identity');
    if (!ident || isAbsence(ident.value)) continue;
    const v = ident.value as { titleStudentSupplied: string; organization: string | null; organizationKind: string; category: string };
    const eps = episodes.filter((e): e is EpisodeRecord => !!e && e.experienceRef === id).sort((a, b) => startBound(a.period).localeCompare(startBound(b.period)));
    const awards = view.entityIds('award').flatMap((aid) => {
      const a = view.current('award', aid, 'definition');
      if (!a || isAbsence(a.value)) return [];
      const av = a.value as { title: string; organizer: string | null; scope: string; stage: string; attribution: string; experienceRef: string | null };
      return av.experienceRef === id ? [{ awardId: aid, title: av.title, organizer: av.organizer, scope: av.scope, stage: av.stage, attribution: av.attribution, lifecycle: a.lifecycle, claimIds: [a.claimId], confirmed: confirmed(a.confirmation) }] : [];
    });
    const research = view.entityIds('research_output').flatMap((rid) => {
      const r = view.current('research_output', rid, 'definition');
      if (!r || isAbsence(r.value)) return [];
      const rv = r.value as { experienceRef: string; status: string; studentTasks: string[]; supervision: string; approvalStatus: string; authorship: string | null; oversight?: string[] };
      return rv.experienceRef === id ? [{ researchId: rid, status: rv.status, studentTasks: rv.studentTasks, supervision: rv.supervision, approvalStatus: rv.approvalStatus, authorship: rv.authorship, oversight: rv.oversight ?? [], claimIds: [r.claimId], confirmed: confirmed(r.confirmation) }] : [];
    });
    const kinds = new Set(ident.evidenceKinds);
    out.push({
      experienceId: id,
      title: v.titleStudentSupplied,
      organization: v.organization,
      organizationKind: v.organizationKind,
      category: v.category,
      lifecycle: ident.lifecycle,
      episodes: eps,
      awards,
      research,
      claimIds: [ident.claimId, ...eps.flatMap((e) => e.claimIds), ...awards.flatMap((a) => a.claimIds), ...research.flatMap((r) => r.claimIds)],
      evidenceStatus: ident.confirmation === 'issuer_verified' ? 'verified' : kinds.has('document_anchor') ? 'document_supported' : 'self_reported',
      confirmed: confirmed(ident.confirmation),
    });
  }
  return out;
}

// ------------------------------------------------------------------ consistency checks

const PLAUSIBLE_WEEKLY_HOURS = 60;

function activeOn(e: EpisodeRecord | { period: DateInterval; lifecycle: Lifecycle }, day: string): boolean {
  if (e.lifecycle !== 'in_progress' && e.lifecycle !== 'completed') return false;
  const s = partialDateBounds(e.period.start).start;
  const end = e.period.end ? partialDateBounds(e.period.end).end : e.period.ongoing ? '9999-12-31' : partialDateBounds(e.period.start).end;
  return s <= day && day <= end;
}

/**
 * Neutral consistency checks across the record (08R07). A high combined total
 * is a reason to ask about double counting or seasonal peaks, never a
 * judgment that something is untrue (08T05).
 */
// 08R04: time is kept as the student's own ranges with their basis; overlapping totals prompt a neutral question, not a precise invented figure.
export function consistencyChecks(experiences: readonly ExperienceRecord[], today: string): Array<Omit<Clarification, 'id'>> {
  const out: Array<Omit<Clarification, 'id'>> = [];
  const current = experiences.flatMap((x) => x.episodes.filter((e) => activeOn(e, today) && e.time).map((e) => ({ x, e })));
  const total = current.reduce((sum, { e }) => sum + (e.time?.hoursPerWeek.min ?? 0), 0);
  if (total > PLAUSIBLE_WEEKLY_HOURS) {
    out.push({
      experienceRef: current[0]!.x.experienceId,
      episodeRef: null,
      kind: 'overlap',
      question: `Together these add up to about ${total} hours a week right now (${current.map(({ x, e }) => `${x.title}: ${e.time!.hoursPerWeek.min === e.time!.hoursPerWeek.max ? e.time!.hoursPerWeek.min : `${e.time!.hoursPerWeek.min}-${e.time!.hoursPerWeek.max}`}`).join('; ')}). That can happen with overlapping responsibilities or busy seasons. Are some hours counted in more than one activity, or are some only during certain weeks?`,
      options: ['Some hours overlap', 'Some are seasonal', 'The totals are right'],
    });
  }
  for (const x of experiences) {
    for (const e of x.episodes) {
      if (e.period.end && partialDateBounds(e.period.end).end < partialDateBounds(e.period.start).start) {
        out.push({ experienceRef: x.experienceId, episodeRef: e.episodeId, kind: 'dates', question: `The dates for “${x.title}” end before they start. Could you check them?`, options: [] });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ descriptive assessment

export type Quality = 'sustained_involvement' | 'responsibility' | 'initiative' | 'collaboration' | 'craft' | 'curiosity' | 'contribution';

export interface ExperienceAssessment {
  experienceId: string;
  title: string;
  category: string;
  lifecycle: Lifecycle;
  evidenceStatus: ExperienceRecord['evidenceStatus'];
  episodes: Array<{ episodeId: string; role: string | null; roleIsOfficial: boolean; period: string; lifecycle: Lifecycle; time: string | null }>;
  progression: string | null;
  supported: Array<{ quality: Quality; basis: string; claimIds: string[] }>;
  missing: string[];
  notes: string[];
  /** Always null: the app does not assign an admissions value to an activity (08T13). */
  admissionsImpactScore: null;
}

const INITIATIVE = /\b(start(ed)?|found(ed)?|creat(ed|e)|propos(ed|e)|organi[sz](ed|e)|set up|launch(ed)?|initiat(ed|e)|design(ed)?|built|introduc(ed|e))\b/i;
const COLLAB = /\b(with|team|together|coordinat(ed|e)|collaborat(ed|e)|helped the|worked alongside)\b/i;
const RESPONSIBLE = /\b(responsible for|in charge of|look(ed)? after|manag(e|ed|ing)|took care of|handled|cover(ed)? shifts|open(ed)? the)\b/i;
const CURIOUS = /\b(learn(ed|t)?|curious|wanted to understand|figur(ed|e) out|taught myself|research(ed)?|explor(ed|e))\b/i;

export function describePeriod(p: DateInterval): string {
  const end = p.ongoing ? 'now' : p.end ?? p.start;
  return p.end || p.ongoing ? `${p.start} to ${end}` : p.start;
}

function describeTime(t: TimeEstimate | null): string | null {
  if (!t) return null;
  const h = t.hoursPerWeek.min === t.hoursPerWeek.max ? `${t.hoursPerWeek.min}` : `${t.hoursPerWeek.min}-${t.hoursPerWeek.max}`;
  const pattern: Record<TimeEstimate['pattern'], string> = { school_term: 'during term', holidays: 'in the holidays', year_round: 'year-round', seasonal: 'in season', irregular: 'irregularly', one_off: 'once' };
  const basis = t.basis === 'student_estimate' ? ' (your estimate)' : '';
  return `${h} hours a week ${pattern[t.pattern]}${t.weeksPerYear ? `, about ${t.weeksPerYear.min === t.weeksPerYear.max ? t.weeksPerYear.min : `${t.weeksPerYear.min}-${t.weeksPerYear.max}`} weeks a year` : ''}${basis}`;
}

function monthsBetween(a: string, b: string): number {
  return Math.round(diffDays(a, b) / 30.44);
}

export function assessExperience(x: ExperienceRecord, today: string): ExperienceAssessment {
  const supported: ExperienceAssessment['supported'] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  const eps = x.episodes;
  if (eps.length > 0) {
    const first = partialDateBounds(eps[0]!.period.start).start;
    const lastEp = eps[eps.length - 1]!;
    const last = lastEp.period.ongoing ? today : lastEp.period.end ? partialDateBounds(lastEp.period.end).end : partialDateBounds(lastEp.period.start).end;
    const months = monthsBetween(first, last > today ? today : last);
    const actual = eps.filter((e) => e.lifecycle === 'in_progress' || e.lifecycle === 'completed');
    if (months >= 12 && actual.length > 0) supported.push({ quality: 'sustained_involvement', basis: `Involved for about ${Math.floor(months / 12)} year${months >= 24 ? 's' : ''}${eps.length > 1 ? ` across ${eps.length} periods` : ''}.`, claimIds: eps.flatMap((e) => e.claimIds.slice(0, 1)) });
  }
  const tasks = eps.flatMap((e) => e.personalTasks.map((t) => ({ t, e })));
  if (['paid_work', 'caregiving', 'household_responsibility'].includes(x.category) || tasks.some(({ t }) => RESPONSIBLE.test(t))) {
    const ev = tasks.filter(({ t }) => RESPONSIBLE.test(t));
    supported.push({ quality: 'responsibility', basis: ev.length > 0 ? `Regular responsibilities: ${ev.map(({ t }) => t).slice(0, 3).join('; ')}.` : `A regular ${x.category.replace(/_/g, ' ')} commitment.`, claimIds: [x.claimIds[0]!, ...ev.flatMap(({ e }) => e.claimIds.slice(1, 2))] });
  }
  const init = [...tasks.filter(({ t }) => INITIATIVE.test(t)), ...eps.flatMap((e) => e.decisionsInfluenced.map((t) => ({ t, e })))];
  if (init.length > 0) supported.push({ quality: 'initiative', basis: `You ${init.map(({ t }) => t.replace(/^i\s+/i, '')).slice(0, 3).join('; ')}.`, claimIds: [...new Set(init.flatMap(({ e }) => e.claimIds.slice(1, 2)))] });
  const collab = tasks.filter(({ t }) => COLLAB.test(t));
  if (collab.length > 0 || eps.some((e) => e.teamOutcomes.length > 0 && e.personalTasks.length > 0)) {
    supported.push({ quality: 'collaboration', basis: collab.length > 0 ? `Worked with others: ${collab.map(({ t }) => t).slice(0, 2).join('; ')}.` : 'Contributed personal tasks to a team result.', claimIds: [...new Set(eps.filter((e) => e.personalTasks.length > 0).flatMap((e) => e.claimIds.slice(1, 2)))] });
  }
  const outputs = eps.flatMap((e) => e.personalOutcomes.map((o) => ({ o, e })));
  if (['creative_practice', 'independent_project'].includes(x.category) && (outputs.length > 0 || tasks.length > 0)) supported.push({ quality: 'craft', basis: outputs.length > 0 ? `Produced: ${outputs.map(({ o }) => o.description).slice(0, 2).join('; ')}.` : `Regular practice: ${tasks.map(({ t }) => t).slice(0, 2).join('; ')}.`, claimIds: [...new Set([...outputs, ...tasks].flatMap(({ e }) => e.claimIds.slice(1, 2)))] });
  const curious = eps.filter((e) => e.learning && CURIOUS.test(e.learning));
  if (['research', 'independent_learning'].includes(x.category) || curious.length > 0) supported.push({ quality: 'curiosity', basis: curious.length > 0 ? `In your words: “${curious[0]!.learning}”` : `Self-directed ${x.category.replace(/_/g, ' ')}.`, claimIds: [...new Set([x.claimIds[0]!, ...curious.flatMap((e) => e.claimIds.slice(-1))])] });
  const measured = outputs.filter(({ o }) => o.measure !== null);
  if (measured.length > 0) supported.push({ quality: 'contribution', basis: measured.map(({ o }) => `${o.description} (${o.measure!.kind.replace(/_/g, ' ')}${o.measure!.method === 'estimated' ? ', estimated' : ''})`).slice(0, 2).join('; '), claimIds: [...new Set(measured.flatMap(({ e }) => e.claimIds.slice(1, 2)))] });

  if (eps.length === 0) missing.push('When it happened (a start date, even a month and year).');
  if (eps.length > 0 && tasks.length === 0) missing.push('What you personally did.');
  if (eps.some((e) => (e.lifecycle === 'in_progress' || e.lifecycle === 'completed') && !e.time)) missing.push('Roughly how much time it takes (a range is fine).');
  if (eps.some((e) => [...e.personalOutcomes, ...e.teamOutcomes].some((o) => o.measure === null && /\d/.test(o.description)))) missing.push('What a number in an outcome measures (for example invited versus attended).');
  if (x.evidenceStatus === 'self_reported') notes.push('Described in your own words; no document is needed for this to count.');
  if (eps.length > 1) notes.push('Each period is kept separately so later summaries stay accurate.');
  for (const a of x.awards) {
    notes.push(a.scope === 'unknown' ? `“${a.title}”: ${a.stage.replace(/_/g, ' ')}; scope not known.` : `“${a.title}”: ${a.stage.replace(/_/g, ' ')}; ${a.scope} scope as reported.`);
  }
  for (const r of x.research) notes.push(`Research status: ${researchStatusText(r.status)}.`);

  const roles = eps.filter((e) => e.roleTitle).map((e) => `${e.roleTitle}${e.titleIsOfficial ? '' : ' (your description)'}`);
  const progression = eps.length > 1 && roles.length > 1 ? `Your role changed over time: ${roles.join(' → ')}.` : null;
  return {
    experienceId: x.experienceId,
    title: x.title,
    category: x.category,
    lifecycle: x.lifecycle,
    evidenceStatus: x.evidenceStatus,
    episodes: eps.map((e) => ({ episodeId: e.episodeId, role: e.roleTitle, roleIsOfficial: e.titleIsOfficial, period: describePeriod(e.period), lifecycle: e.lifecycle, time: describeTime(e.time) })),
    progression,
    supported,
    missing,
    notes,
    admissionsImpactScore: null,
  };
}

export function researchStatusText(status: string): string {
  const map: Record<string, string> = {
    in_progress: 'in progress',
    literature_review: 'literature review',
    supervised_data_analysis: 'supervised data analysis',
    original_experiment: 'original experiment',
    poster: 'poster presented',
    preprint: 'preprint (not peer reviewed)',
    submitted_manuscript: 'manuscript submitted, not yet accepted',
    accepted_paper: 'accepted for publication',
    published_article: 'published',
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

/**
 * A faithful account built from what the student actually did. A requested
 * inflated title is not adopted (08R03, 08T10).
 */
export function faithfulDescription(x: ExperienceRecord): string {
  const eps = x.episodes;
  const tasks = [...new Set(eps.flatMap((e) => e.personalTasks))];
  const official = eps.map((e) => (e.titleIsOfficial ? e.roleTitle : null)).filter((t): t is string => !!t);
  const head = official.length > 0 ? `${official[official.length - 1]} — ${x.title}` : x.title;
  const body = tasks.length > 0 ? `: ${tasks.slice(0, 5).join('; ')}` : '';
  const team = eps.flatMap((e) => e.teamOutcomes.map((o) => o.description));
  return `${head}${body}${team.length > 0 ? `. Team result: ${team.slice(0, 2).join('; ')}` : ''}.`;
}

// ------------------------------------------------------------------ proportionate next steps

export interface NextStep {
  kind: 'continue_current' | 'smaller_step' | 'new_opportunity';
  text: string;
  hoursPerWeek: { min: number; max: number };
  experienceRef: string | null;
  capacityNote: string;
}

/**
 * Suggest a next step that fits the student's real capacity (08R10, 08T15).
 * Adding another activity is not assumed to be better than continuing a
 * meaningful one or keeping time for school and rest.
 */
export function suggestNextStep(experiences: readonly ExperienceRecord[], weeklyAvailable: { min: number; max: number } | null, proposedHours: number | null, today: string, interestText: string | null): NextStep {
  const current = experiences.flatMap((x) => x.episodes.filter((e) => activeOn(e, today)).map((e) => ({ x, e })));
  const committed = current.reduce((s, { e }) => s + (e.time?.hoursPerWeek.min ?? 0), 0);
  const capacity = weeklyAvailable ? Math.max(0, weeklyAvailable.max - committed) : null;
  const deepen = [...current].sort((a, b) => b.x.episodes.length - a.x.episodes.length)[0];
  const capacityNote = weeklyAvailable
    ? `You said you can give about ${weeklyAvailable.min === weeklyAvailable.max ? weeklyAvailable.max : `${weeklyAvailable.min}-${weeklyAvailable.max}`} hours a week; current activities already use about ${committed}.`
    : 'Your available time is not recorded yet, so this suggestion stays small.';
  if (proposedHours !== null && capacity !== null && proposedHours > capacity) {
    if (deepen) return { kind: 'continue_current', text: `Keep going with “${deepen.x.title}” and take one small next step in it${interestText ? ` connected to ${interestText}` : ''}, rather than adding something new that would not fit.`, hoursPerWeek: { min: 0, max: Math.max(1, Math.min(2, capacity)) }, experienceRef: deepen.x.experienceId, capacityNote };
    return { kind: 'smaller_step', text: 'Start with a smaller version that fits your week, such as one short session, and see how it goes.', hoursPerWeek: { min: 1, max: Math.max(1, Math.min(2, capacity)) }, experienceRef: null, capacityNote };
  }
  if (capacity !== null && capacity < 2) {
    return deepen
      ? { kind: 'continue_current', text: `Your week already looks full. Continuing “${deepen.x.title}” is a good choice; there is no need to add more.`, hoursPerWeek: { min: 0, max: 0 }, experienceRef: deepen.x.experienceId, capacityNote }
      : { kind: 'smaller_step', text: 'Your week already looks full, so there is no need to add anything right now.', hoursPerWeek: { min: 0, max: 0 }, experienceRef: null, capacityNote };
  }
  if (deepen) return { kind: 'continue_current', text: `One manageable step inside “${deepen.x.title}”${interestText ? `, connected to ${interestText}` : ''}, such as documenting something you already do or taking on one clearly defined task.`, hoursPerWeek: { min: 1, max: Math.min(3, capacity ?? 2) }, experienceRef: deepen.x.experienceId, capacityNote };
  return { kind: 'new_opportunity', text: `A small first activity${interestText ? ` related to ${interestText}` : ''} that fits your week; an opportunity search can look for options.`, hoursPerWeek: { min: 1, max: Math.min(3, capacity ?? 2) }, experienceRef: null, capacityNote };
}
