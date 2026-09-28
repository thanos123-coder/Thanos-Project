/**
 * The fit matcher's deterministic core (12 "Hard constraints and exceptions",
 * "Explainable comparison", "Tradeoffs and sensitivity").
 *
 * Each student priority is compared with sourced evidence on one dimension
 * and gives strong, mixed, weak or unknown. Hard constraints are applied
 * first with three-valued logic: unknown is never passed. Preferences are
 * scored with weights the student can see and change; an unknown dimension
 * contributes a range from its worst to its best value, and options are
 * ordered by their worst case, so missing evidence can never raise an
 * option's rank. Prestige proxies share one bounded weight so correlated
 * reputation signals cannot quietly dominate the list.
 */

export const FIT_DIMENSIONS = {
  academic_interest: { label: 'access to your subjects', kind: 'interest' },
  direct_program_access: { label: 'direct entry to your subject', kind: 'access' },
  subject_flexibility: { label: 'flexibility across subjects', kind: 'ordinal', attribute: 'subject_flexibility' },
  setting: { label: 'setting', kind: 'categorical', attribute: 'setting' },
  city_size: { label: 'city size', kind: 'categorical', attribute: 'city_size' },
  teaching_format: { label: 'teaching format', kind: 'categorical', attribute: 'teaching_format' },
  language_of_instruction: { label: 'language of instruction', kind: 'categorical', attribute: 'language_of_instruction' },
  duration_years: { label: 'program length', kind: 'max_number', attribute: 'duration_years' },
  undergraduate_research: { label: 'undergraduate research', kind: 'boolean', attribute: 'undergraduate_research' },
  housing_guarantee: { label: 'guaranteed housing', kind: 'boolean', attribute: 'housing_guarantee' },
  accreditation: { label: 'accreditation', kind: 'categorical', attribute: 'accreditation' },
  support_service: { label: 'support you need', kind: 'support', attribute: 'support_service' },
  location_countries: { label: 'location', kind: 'country' },
  max_annual_cost: { label: 'cost', kind: 'affordability' },
  reputation: { label: 'reputation (as you asked)', kind: 'prestige' },
} as const;
export type FitDimension = keyof typeof FIT_DIMENSIONS;

/** Signals that all measure prestige; they are merged into one bounded "reputation" setting (12T13). */
export const PRESTIGE_PROXIES = ['reputation', 'ranking', 'selectivity', 'famous_alumni', 'prestige', 'admit_rate'] as const;
export const MAX_PRESTIGE_WEIGHT = 2;

export type Match = 'strong' | 'mixed' | 'weak' | 'unknown';
export const MATCH_VALUE: Record<Exclude<Match, 'unknown'>, number> = { strong: 2, mixed: 1, weak: 0 };

export interface Priority {
  dimension: FitDimension;
  kind: 'hard_constraint' | 'preference';
  statement: string;
  value: string | number | boolean | string[] | null;
  weight: number | null;
  provisional: boolean;
  holder: 'student' | 'supporter' | 'reported_other';
  claimId: string;
}

export interface Evidence {
  value: unknown;
  sourceRef: string;
  text: string | null;
}

export interface Candidate {
  optionRef: string;
  entityId: string | null;
  name: string;
  institutionName: string;
  country: string | null;
  programName: string | null;
  aliases: string[];
  suppliedBy: 'catalog' | 'student' | 'counselor';
  attributes: Partial<Record<string, Evidence>>;
  access: (Evidence & { route: string; guaranteed: boolean | null }) | null;
  affordability: { state: 'supported' | 'conditional' | 'gap_identified' | 'unknown'; conditions: string[]; ref: string; stale: boolean } | null;
  eligibility: { state: 'supported' | 'conditional' | 'ineligible' | 'unknown'; ref: string | null };
  /** Sponsored or partner status: labeled, never used in ranking (12T06). */
  commercial: { partner: boolean; sponsored: boolean };
}

export interface DimensionResult {
  dimension: FitDimension;
  label: string;
  match: Match;
  why: string;
  sourceRef: string | null;
  weight: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['and', 'the', 'for', 'with', 'a', 'an', 'of', 'to', 'in', 'on', 'my', 'i', 'need', 'needs', 'have', 'be', 'or']);
const tokens = (s: string) => norm(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t));

/** Evaluate one priority against one candidate's evidence. */
export function matchPriority(p: Priority, c: Candidate): Omit<DimensionResult, 'weight'> {
  const def = FIT_DIMENSIONS[p.dimension];
  const base = { dimension: p.dimension, label: def.label };
  const unknown = (why: string) => ({ ...base, match: 'unknown' as const, why, sourceRef: null });
  // An option outside the researched catalog has no verified evidence yet: every dimension is unknown, whatever its name suggests (12T12).
  if (c.entityId === null) return unknown(`${c.name} is not in the researched catalog yet; this is checked the same way as every other option.`);
  switch (def.kind) {
    case 'interest': {
      const wanted = Array.isArray(p.value) ? p.value : typeof p.value === 'string' ? [p.value] : [];
      if (!c.programName) return unknown('This option is a whole institution; which of its programs fit is not checked yet.');
      const names = [c.programName, ...c.aliases].map(norm);
      const covered = wanted.filter((w) => names.some((n) => n.includes(norm(w.replace(/_/g, ' ')))));
      const flex = c.attributes['subject_flexibility'];
      if (covered.length === wanted.length && wanted.length > 0) return { ...base, match: 'strong', why: `Offers ${covered.map((w) => w.replace(/_/g, ' ')).join(' and ')}.`, sourceRef: null };
      if (covered.length > 0) return { ...base, match: flex?.value === 'high' ? 'strong' : 'mixed', why: `Offers ${covered.map((w) => w.replace(/_/g, ' ')).join(', ')}${flex?.value === 'high' ? ', with flexibility to explore your other interests' : ''}.`, sourceRef: flex?.sourceRef ?? null };
      return { ...base, match: 'weak', why: `Does not offer ${wanted.map((w) => w.replace(/_/g, ' ')).join(' or ')}.`, sourceRef: null };
    }
    case 'access': {
      if (!c.access) return unknown('How students enter this subject is not verified.');
      const m: Match = c.access.route === 'direct_entry' ? 'strong' : c.access.route === 'open_after_prerequisites' ? 'mixed' : c.access.route === 'later_competitive_selection' ? 'weak' : 'unknown';
      const why = c.access.route === 'direct_entry' ? 'You are admitted directly to the subject.' : c.access.route === 'later_competitive_selection' ? 'Entry to the subject is a later competitive selection after admission; university admission does not guarantee it.' : c.access.route === 'open_after_prerequisites' ? 'Open to students who complete the prerequisite courses.' : 'The entry route is not clear.';
      return { ...base, match: m, why, sourceRef: c.access.sourceRef };
    }
    case 'ordinal': {
      const e = c.attributes[def.attribute];
      if (!e) return unknown(`${def.label} is not verified for this option.`);
      const order = ['low', 'medium', 'high'];
      const want = order.indexOf(String(p.value ?? 'high'));
      const got = order.indexOf(String(e.value));
      const m: Match = got < 0 ? 'unknown' : got >= want ? 'strong' : got === want - 1 ? 'mixed' : 'weak';
      return { ...base, match: m, why: `${def.label[0]!.toUpperCase()}${def.label.slice(1)} is ${String(e.value)}.`, sourceRef: e.sourceRef };
    }
    case 'categorical': {
      const e = c.attributes[def.attribute];
      if (!e) return unknown(`The ${def.label} is not verified for this option.`);
      const want = (Array.isArray(p.value) ? p.value : [p.value]).map((x) => norm(String(x)));
      const got = (Array.isArray(e.value) ? e.value : [e.value]).map((x) => norm(String(x)));
      const ok = got.some((g) => want.includes(g));
      return { ...base, match: ok ? 'strong' : 'weak', why: `The ${def.label} is ${got.join(', ')}.`, sourceRef: e.sourceRef };
    }
    case 'max_number': {
      const e = c.attributes[def.attribute];
      if (!e || typeof e.value !== 'number' || typeof p.value !== 'number') return unknown(`The ${def.label} is not verified for this option.`);
      return { ...base, match: e.value <= p.value ? 'strong' : 'weak', why: `The ${def.label} is ${e.value} years.`, sourceRef: e.sourceRef };
    }
    case 'boolean': {
      const e = c.attributes[def.attribute];
      if (!e || typeof e.value !== 'boolean') return unknown(`Whether it offers ${def.label} is not verified.`);
      return { ...base, match: e.value ? 'strong' : 'weak', why: e.value ? `The institution advertises ${def.label}${def.attribute === 'undergraduate_research' ? ' (whether you can obtain a funded position is a separate question)' : ''}.` : `It does not offer ${def.label}.`, sourceRef: e.sourceRef };
    }
    case 'support': {
      // A functional need is matched against what the institution publishes; absence of public information is not evidence against it (12T10).
      const e = c.attributes[def.attribute];
      const need = tokens(String(p.value ?? p.statement));
      if (!e) return unknown(`Nothing published about “${String(p.value ?? p.statement)}”; this needs a direct question to the institution, in your own words.`);
      const text = Array.isArray(e.value) ? e.value.join(' ') : `${String(e.value)} ${e.text ?? ''}`;
      const hit = need.filter((t) => tokens(text).includes(t));
      return hit.length > 0 ? { ...base, match: 'mixed', why: `The institution describes related support (${hit.join(', ')}); confirm directly that it meets your need.`, sourceRef: e.sourceRef } : unknown(`What is published does not mention “${String(p.value ?? p.statement)}”; ask the institution directly.`);
    }
    case 'country': {
      if (!c.country) return unknown('The location is not known.');
      const want = Array.isArray(p.value) ? p.value : [String(p.value)];
      return { ...base, match: want.includes(c.country) ? 'strong' : 'weak', why: `Located in ${c.country}.`, sourceRef: null };
    }
    case 'affordability': {
      if (!c.affordability || c.affordability.stale) return unknown(c.affordability?.stale ? 'The affordability result is out of date and needs recalculating.' : 'Affordability has not been calculated for this option.');
      const s = c.affordability.state;
      const m: Match = s === 'supported' ? 'strong' : s === 'conditional' ? 'mixed' : s === 'gap_identified' ? 'weak' : 'unknown';
      const why = s === 'supported' ? 'Within the budget in the confirmed scenario.' : s === 'conditional' ? `Affordable only if: ${c.affordability.conditions.join(' ') || 'conditions are met'}.` : s === 'gap_identified' ? 'Leaves a funding gap in the confirmed scenario.' : 'Affordability is unresolved.';
      return { ...base, match: m, why, sourceRef: c.affordability.ref };
    }
    case 'prestige':
      return unknown('No reputation measure is used unless you ask for one; none is verified here.');
  }
}

export interface Scored {
  candidate: Candidate;
  dims: DimensionResult[];
  min: number;
  max: number;
  possible: number;
  completeness: number;
}

/** Merge prestige proxies into one bounded preference and drop duplicates of a dimension (12T13). */
export function normalizePriorities(ps: readonly Priority[]): { priorities: Priority[]; merged: string[] } {
  const merged: string[] = [];
  const out: Priority[] = [];
  const proxies = ps.filter((p) => (PRESTIGE_PROXIES as readonly string[]).includes(p.dimension));
  for (const p of ps) if (!(PRESTIGE_PROXIES as readonly string[]).includes(p.dimension)) out.push(p);
  if (proxies.length > 0) {
    const w = Math.min(MAX_PRESTIGE_WEIGHT, Math.max(...proxies.map((p) => p.weight ?? 1)));
    out.push({ ...proxies[0]!, dimension: 'reputation', weight: w, statement: proxies.map((p) => p.statement).join('; ') });
    if (proxies.length > 1 || (proxies[0]!.weight ?? 0) > MAX_PRESTIGE_WEIGHT) merged.push(`${proxies.map((p) => p.dimension.replace(/_/g, ' ')).join(', ')} all measure reputation; they count once, with a weight of at most ${MAX_PRESTIGE_WEIGHT}.`);
  }
  return { priorities: out, merged };
}

export function scoreCandidate(c: Candidate, prefs: readonly Priority[]): Scored {
  const dims: DimensionResult[] = prefs.map((p) => ({ ...matchPriority(p, c), weight: p.weight ?? 3 }));
  let min = 0;
  let max = 0;
  let possible = 0;
  let known = 0;
  for (const d of dims) {
    possible += 2 * d.weight;
    if (d.match === 'unknown') max += 2 * d.weight;
    else {
      min += MATCH_VALUE[d.match] * d.weight;
      max += MATCH_VALUE[d.match] * d.weight;
      known += 1;
    }
  }
  return { candidate: c, dims, min, max, possible, completeness: dims.length === 0 ? 1 : known / dims.length };
}

/** Worst case first, then best case, then name: never fame, never a partner relationship. */
export function order(scored: readonly Scored[]): Scored[] {
  return [...scored].sort((a, b) => b.min - a.min || b.max - a.max || a.candidate.name.localeCompare(b.candidate.name));
}

/** A dominates B when it is at least as good on every chosen dimension and better on one, with both known everywhere. */
export function dominates(a: Scored, b: Scored): boolean {
  let better = false;
  for (let i = 0; i < a.dims.length; i += 1) {
    const x = a.dims[i]!;
    const y = b.dims[i]!;
    if (x.match === 'unknown' || y.match === 'unknown') return false;
    if (MATCH_VALUE[x.match] < MATCH_VALUE[y.match]) return false;
    if (MATCH_VALUE[x.match] > MATCH_VALUE[y.match]) better = true;
  }
  return better;
}

export interface Sensitivity {
  fragile: boolean;
  close: boolean;
  notes: Array<{ dimension: FitDimension; change: number; before: string[]; after: string[] }>;
}

/** Nudge each weight by one step; if the leading options reorder, the ranking is fragile (12T05). */
export function sensitivity(cands: readonly Candidate[], prefs: readonly Priority[], top = 3): Sensitivity {
  const baseOrder = order(cands.map((c) => scoreCandidate(c, prefs)));
  const head = (xs: Scored[]) => xs.slice(0, Math.min(top, xs.length)).map((s) => s.candidate.optionRef);
  const before = head(baseOrder);
  const notes: Sensitivity['notes'] = [];
  for (const [i, p] of prefs.entries()) {
    for (const change of [-1, 1]) {
      const w = (p.weight ?? 3) + change;
      if (w < 0 || w > 5) continue;
      const nudged = prefs.map((q, j) => (j === i ? { ...q, weight: w } : q));
      const after = head(order(cands.map((c) => scoreCandidate(c, nudged))));
      if (after.join('|') !== before.join('|')) notes.push({ dimension: p.dimension, change, before, after });
    }
  }
  const close = baseOrder.length > 1 && baseOrder[0]!.min - baseOrder[1]!.min <= 1;
  return { fragile: notes.length > 0, close, notes };
}
