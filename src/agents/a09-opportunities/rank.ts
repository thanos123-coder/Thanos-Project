import { compareMoney, formatMoney } from '../../shared/money.js';
import type { Brief, Weights } from './brief.js';
import type { HardFailure, OptionEvaluation } from './match.js';
import { promoteShortlisted } from './match.js';
import { topicLabel } from './topics.js';

/**
 * Transparent ranking (09R11, "Ranking and explanation design").
 *
 * Hard failures exclude first. The remaining options are compared on separate,
 * visible dimensions, never an unexplained prestige score. Evidence quality
 * affects how confidently an option is recommended, not a guess about the
 * chance of selection.
 *
 * Sponsorship cannot influence the order: `RankFeatures` has no field for it,
 * so the scoring function has no way to read a paid placement or a commission
 * (09T09). Sponsored entries are disclosed next to the result instead.
 */

export interface RankFeatures {
  goalFit: 'direct' | 'related' | 'none';
  feasibility: 'fits' | 'conditional' | 'poor_fit';
  learning: 'well_documented' | 'some_evidence' | 'little_evidence';
  cost: 'free' | 'within_budget' | 'unknown' | 'aid_dependent' | 'over_preference';
  evidence: 'verified_recently' | 'needs_refresh';
  format: 'preferred' | 'neutral' | 'not_preferred';
}

const VALUES: { [K in keyof RankFeatures]: Record<RankFeatures[K], number> } = {
  goalFit: { direct: 3, related: 1, none: 0 },
  // A poor logistical fit (e.g. sessions in the middle of the night) ranks below an option that is merely unconfirmed.
  feasibility: { fits: 3, conditional: 1, poor_fit: -2 },
  learning: { well_documented: 3, some_evidence: 2, little_evidence: 0 },
  cost: { free: 3, within_budget: 2, unknown: 1, aid_dependent: 0, over_preference: 0 },
  evidence: { verified_recently: 2, needs_refresh: 0 },
  format: { preferred: 1, neutral: 0, not_preferred: -1 },
};

export function featuresOf(e: OptionEvaluation, brief: Brief): RankFeatures {
  const chosen = e.sessions.find((s) => s.sessionId === e.chosenSessionId);
  const poorFit = !!chosen && chosen.checks.some((c) => c.status === 'poor_fit' || c.status === 'conflict');
  const v = e.cost?.verdict;
  const pref = brief.format.preferred;
  const fmt = chosen?.format;
  return {
    goalFit: e.goalFit.relation,
    feasibility: poorFit ? 'poor_fit' : e.bucket === 'feasible_now' ? 'fits' : 'conditional',
    learning: e.value.learningEvidence,
    cost: v === 'free' ? 'free' : v === 'within_budget' ? 'within_budget' : v === 'aid_dependent' ? 'aid_dependent' : v === 'over_preferred_budget' ? 'over_preference' : 'unknown',
    evidence: e.verification.status === 'recent' || e.verification.status === 'reverified_unchanged' ? 'verified_recently' : 'needs_refresh',
    format: !pref || !fmt || fmt === 'hybrid' ? 'neutral' : fmt === (pref === 'online' ? 'online' : 'in_person') ? 'preferred' : 'not_preferred',
  };
}

export function score(f: RankFeatures, w: Weights): number {
  return w.goalFit * VALUES.goalFit[f.goalFit] + w.feasibility * VALUES.feasibility[f.feasibility] + w.learning * VALUES.learning[f.learning] + w.cost * VALUES.cost[f.cost] + w.evidence * VALUES.evidence[f.evidence] + w.format * VALUES.format[f.format];
}

export interface RankedOption {
  evaluation: OptionEvaluation;
  features: RankFeatures;
  score: number;
  why: string[];
  watchOuts: string[];
  includedAs: 'ranked' | 'accessible_alternative';
  alsoListedAs: string[];
}

function knownCost(e: OptionEvaluation): number {
  const t = e.cost?.knownTotals ?? [];
  return t.length === 1 ? Number(t[0]!.amount) : Number.POSITIVE_INFINITY;
}

function explain(e: OptionEvaluation, f: RankFeatures): { why: string[]; watchOuts: string[] } {
  const why: string[] = [];
  const watchOuts: string[] = [];
  if (f.goalFit === 'direct') why.push(`Matches what you want to explore: ${e.goalFit.matched.map(topicLabel).join(', ')}.`);
  else if (f.goalFit === 'related') why.push(`Close to your interests (${e.goalFit.matched.map(topicLabel).join(', ')}).`);
  else watchOuts.push('Not closely connected to the interests you named.');
  if (e.goalFit.categoryRequested === false) watchOuts.push(`It is a ${e.category.replace(/_/g, ' ')}, not one of the kinds you asked for.`);
  if (f.feasibility === 'fits') why.push('Fits your dates, travel and time as far as is known.');
  if (f.feasibility === 'poor_fit') for (const c of e.sessions.find((s) => s.sessionId === e.chosenSessionId)?.checks.filter((x) => x.status === 'poor_fit' || x.status === 'conflict') ?? []) watchOuts.push(c.text);
  if (e.value.learningEvidence === 'well_documented') why.push('What you would actually do is well described (activities, supervision, feedback or outputs).');
  if (e.value.learningEvidence === 'little_evidence') watchOuts.push('Little is published about what participants actually do.');
  if (f.cost === 'free') why.push('No cost to take part.');
  else if (f.cost === 'within_budget') why.push(e.cost!.verdictText);
  else if (e.cost) watchOuts.push(e.cost.verdictText);
  for (const u of e.unresolved.filter((x) => x.material).slice(0, 4)) watchOuts.push(u.text);
  return { why, watchOuts: [...new Set(watchOuts)] };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Merge syndicated duplicates (same organizer, title and session dates); genuinely different sessions stay separate. */
export function dedupeOptions(options: readonly OptionEvaluation[]): Array<{ e: OptionEvaluation; alsoListedAs: string[] }> {
  const groups = new Map<string, OptionEvaluation[]>();
  for (const e of options) {
    const org = norm(e.organizerLine);
    const dates = e.sessions.map((s) => `${s.start}:${s.end}:${s.format}`).sort().join('|');
    const costs = (e.cost?.knownTotals ?? []).map((m) => `${m.amount}${m.currency}`).join('|');
    const k = `${org}#${norm(e.title)}#${dates}#${costs}#${e.eligibility.state}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.values()].map((g) => {
    const sorted = [...g].sort((a, b) => (a.verification.status === 'recent' ? 0 : 1) - (b.verification.status === 'recent' ? 0 : 1) || a.opportunityId.localeCompare(b.opportunityId));
    return { e: sorted[0]!, alsoListedAs: sorted.slice(1).map((x) => x.opportunityId) };
  });
}

export interface Shortlist {
  feasibleNow: RankedOption[];
  conditional: RankedOption[];
  /** Options another organizer would otherwise crowd out of the list. */
  moreFromSameOrganizer: Array<{ organizer: string; count: number }>;
}

const MAX_PER_ORGANIZER = 2;

export function rankAndShortlist(options: readonly OptionEvaluation[], brief: Brief): { shortlist: Shortlist; ranked: RankedOption[] } {
  const candidates = dedupeOptions(options.filter((o) => o.bucket === 'feasible_now' || o.bucket === 'conditional'));
  const ranked: RankedOption[] = candidates
    .map(({ e, alsoListedAs }) => {
      const features = featuresOf(e, brief);
      const { why, watchOuts } = explain(e, features);
      return { evaluation: e, features, score: score(features, brief.weights), why, watchOuts, includedAs: 'ranked' as const, alsoListedAs };
    })
    .filter((r) => r.features.goalFit !== 'none' || brief.topics.length === 0)
    .sort((a, b) => bucketOrder(a) - bucketOrder(b) || b.score - a.score || knownCost(a.evaluation) - knownCost(b.evaluation) || a.evaluation.title.localeCompare(b.evaluation.title) || a.evaluation.opportunityId.localeCompare(b.evaluation.opportunityId));

  const picked: RankedOption[] = [];
  const perOrganizer = new Map<string, number>();
  const crowded = new Map<string, number>();
  for (const r of ranked) {
    const org = r.evaluation.organizerLine;
    const n = perOrganizer.get(org) ?? 0;
    if (n >= MAX_PER_ORGANIZER) {
      crowded.set(org, (crowded.get(org) ?? 0) + 1);
      continue;
    }
    if (picked.length >= brief.maxResults) continue;
    picked.push(r);
    perOrganizer.set(org, n + 1);
  }
  // Include an accessible alternative when the list would otherwise be only paid or uncertain options (09R13).
  const accessible = (r: RankedOption) => r.features.cost === 'free';
  if (picked.length > 0 && !picked.some(accessible)) {
    const alt = ranked.find((r) => accessible(r) && !picked.includes(r));
    if (alt) {
      if (picked.length >= brief.maxResults) picked.pop();
      picked.push({ ...alt, includedAs: 'accessible_alternative' });
    }
  }
  for (const p of picked) promoteShortlisted(p.evaluation);
  const feasibleNow = picked.filter((p) => p.evaluation.bucket === 'feasible_now');
  const conditional = picked.filter((p) => p.evaluation.bucket === 'conditional');
  return {
    shortlist: { feasibleNow, conditional, moreFromSameOrganizer: [...crowded.entries()].map(([organizer, count]) => ({ organizer: organizer.replace(/^Run by /, '').replace(/\.$/, ''), count })) },
    ranked,
  };
}

function bucketOrder(r: RankedOption): number {
  return r.evaluation.bucket === 'feasible_now' ? 0 : 1;
}

export interface RouteIdea {
  kind: 'school_project' | 'public_institution' | 'independent_learning' | 'volunteering' | 'supervision_note';
  text: string;
  /** Always false: an idea, not a verified program. */
  verifiedProgram: false;
}

/** Accessible, self-directed or school-based routes. Ideas, never invented programs (09R13, 09T14). */
export function routeIdeas(brief: Brief): RouteIdea[] {
  const topic = brief.topics.length > 0 ? brief.topics.map(topicLabel).join(' or ').toLowerCase() : 'the subject you choose';
  const ideas: RouteIdea[] = [
    { kind: 'school_project', text: `Ask a teacher at your school whether they would supervise a small project in ${topic}. School-based work comes with supervision and usually no fees.`, verifiedProgram: false },
    { kind: 'public_institution', text: 'Check the official pages of your local library, museum or a nearby university’s outreach office for free events; confirm the dates and age rules there.', verifiedProgram: false },
    { kind: 'independent_learning', text: `Work through a free introductory course in ${topic} from a recognized university or public education platform, and keep a short log of what you make and learn.`, verifiedProgram: false },
  ];
  if (brief.topics.includes('community_service') || brief.categories.includes('volunteering')) ideas.push({ kind: 'volunteering', text: 'Local organizations that publish a youth volunteering policy (minimum age, supervision, training) can offer regular, low-cost involvement.', verifiedProgram: false });
  if (brief.topics.some((t) => ['biology', 'chemistry', 'psychology', 'medicine', 'biomedical_science', 'sciences', 'general_science'].includes(t))) ideas.push({ kind: 'supervision_note', text: 'A project involving people, animals or hazardous materials needs qualified supervision and the relevant approval before it starts.', verifiedProgram: false });
  return ideas;
}

export interface NoResult {
  message: string;
  searched: { topics: string[]; categories: string[]; coverage: string; window: string; discovery: string };
  excludedBecause: Array<{ reason: string; count: number }>;
  relaxations: string[];
  alternatives: RouteIdea[];
}

const RELAXABLE: Record<string, (n: number, e: OptionEvaluation[]) => string> = {
  overnight_not_possible: (n) => `${n} option${n === 1 ? '' : 's'} would need overnight stays. If a short stay away became possible, ${n === 1 ? 'it' : 'they'} could be checked again.`,
  dates_outside_availability: (n) => `${n} option${n === 1 ? '' : 's'} fall${n === 1 ? 's' : ''} outside your available dates. Widening the dates would bring ${n === 1 ? 'it' : 'them'} back into the search.`,
  format_mismatch: (n) => `${n} option${n === 1 ? ' is' : 's are'} only available in a format you ruled out.`,
  over_budget: (n, es) => {
    const over = es.flatMap((e) => (e.cost?.overBy ? [formatMoney(e.cost.overBy)] : []));
    return `${n} option${n === 1 ? ' costs' : 's cost'} more than your limit${over.length > 0 ? ` (by ${over.join(', ')})` : ''}.`;
  },
  outside_your_hours: (n) => `${n} online option${n === 1 ? ' runs' : 's run'} outside the hours you are available.`,
};

/** An honest no-result answer: the search boundary, why options dropped out, what could be relaxed, and accessible routes. */
export function noResult(evaluations: readonly OptionEvaluation[], brief: Brief, coverage: string, discovery: string): NoResult {
  const excluded = evaluations.filter((e) => e.bucket === 'excluded');
  const reasonCounts = new Map<string, number>();
  for (const e of excluded) for (const f of e.failures) reasonCounts.set(f.code.replace(/^eligibility:.*/, 'eligibility'), (reasonCounts.get(f.code.replace(/^eligibility:.*/, 'eligibility')) ?? 0) + 1);
  for (const b of ['closed', 'unannounced', 'stale'] as const) {
    const n = evaluations.filter((e) => e.bucket === b).length;
    if (n > 0) reasonCounts.set(b, n);
  }
  const label: Record<string, string> = {
    eligibility: 'a published eligibility condition is not met',
    closed: 'closed, full or past its deadline',
    unannounced: 'next cycle not announced yet',
    stale: 'details need to be re-checked',
  };
  const relaxations: string[] = [];
  // Only a single blocking reason counts as relaxable; an eligibility rule is never presented as something to get around.
  const single = (e: OptionEvaluation): HardFailure | null => (e.failures.length === 1 && !e.failures[0]!.code.startsWith('eligibility') ? e.failures[0]! : null);
  const byCode = new Map<string, OptionEvaluation[]>();
  for (const e of excluded) {
    const f = single(e);
    if (f && RELAXABLE[f.code]) byCode.set(f.code, [...(byCode.get(f.code) ?? []), e]);
  }
  for (const [code, es] of byCode) relaxations.push(RELAXABLE[code]!(es.length, es));
  const cheapest = excluded.filter((e) => e.failures.some((f) => f.code === 'over_budget') && e.cost?.knownTotals.length === 1).sort((a, b) => compareMoney(a.cost!.knownTotals[0]!, b.cost!.knownTotals[0]!))[0];
  if (cheapest) relaxations.push(`The lowest known cost among options over your limit is ${formatMoney(cheapest.cost!.knownTotals[0]!)}.`);
  return {
    message: 'No verified opportunity currently meets all of your hard constraints. Nothing has been made up to fill the gap; below is what was searched, why options dropped out, and other routes that may serve the same goal.',
    searched: {
      topics: brief.topics.map(topicLabel),
      categories: brief.categories.map((c) => c.replace(/_/g, ' ')),
      coverage,
      window: brief.windows.length > 0 ? brief.windows.map((w) => `${w.start}${w.end ? ` to ${w.end}` : ''}`).join('; ') : 'any dates',
      discovery,
    },
    excludedBecause: [...reasonCounts.entries()].map(([k, count]) => ({ reason: label[k] ?? k.replace(/_/g, ' '), count })),
    relaxations,
    alternatives: routeIdeas(brief),
  };
}
