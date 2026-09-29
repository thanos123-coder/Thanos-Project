import type { TestScoreRecord } from '../../shared/assessments.js';
import type { StatisticValue } from '../a11-research/claims.js';

/**
 * The qualitative assessment (13 "Qualitative assessment contract",
 * "Interpreting descriptive statistics").
 *
 * A small vocabulary with operational definitions replaces any invented
 * percentage. Statistics are explained with their cohort, year, denominator
 * and population before they are used; a score range is never a minimum or a
 * threshold; round statistics never imply a causal benefit; and a favourable
 * category requires evidence that is relevant to the applicant and the
 * program. The app calls an option "safe" only for a verified open or
 * guaranteed route whose conditions are met.
 */

export const SELECTION_STATES = ['formally_ineligible', 'eligibility_unresolved', 'selection_evidence_insufficient', 'highly_uncertain_selection', 'plausible_option_with_material_uncertainty', 'verified_open_admission'] as const;
export type SelectionState = (typeof SELECTION_STATES)[number];

/** Operational definitions shown with every assessment. */
export const DEFINITIONS: Readonly<Record<SelectionState, string>> = {
  formally_ineligible: 'A formal entry requirement is not met, according to the eligibility check. No selection category is given until that changes.',
  eligibility_unresolved: 'Whether you meet the formal entry requirements is not settled yet, so selection is not assessed.',
  selection_evidence_insufficient: 'There is not enough comparable evidence to place this option in a category. This is not a negative finding.',
  highly_uncertain_selection: 'Most applicants in the relevant group are not admitted, or the evidence cannot separate you from them. Strong applicants are also turned down.',
  plausible_option_with_material_uncertainty: 'The relevant applicant group is admitted at a moderate or high rate and your checked academic context is comparable. The outcome is still uncertain.',
  verified_open_admission: 'A verified open or guaranteed admission route whose stated conditions you meet. This is the only case the app calls safe.',
};

/** Product rule, stated openly: a group admit rate below this is "highly uncertain" for everyone in it. */
export const PLAUSIBLE_MIN_RATE = 40;
/** Statistics older than this many years are not used for a category. */
export const MAX_STAT_AGE_YEARS = 3;

export interface StatClaim {
  claimId: string;
  qualifier: string;
  value: StatisticValue;
}

const POPULATION_LABEL: Record<StatisticValue['cohort']['population'], string> = {
  first_year_applicants: 'first-year applicants',
  first_year_admits: 'admitted first-year students',
  first_year_enrolled: 'enrolled first-year students',
  enrolled_score_submitters: 'enrolled first-year students who submitted scores',
  transfer_applicants: 'transfer applicants',
  transfer_admits: 'admitted transfer students',
  program_applicants: 'applicants to the program',
  program_admits: 'students admitted to the program',
  aided_first_year_students: 'first-year students who received aid',
  all_undergraduates: 'all undergraduates',
};

export function cohortYear(v: StatisticValue): number | null {
  const m = /(20\d\d)/.exec(v.cohort.year);
  return m ? Number(m[1]) : null;
}

/** "In fall 2025, 15% of first-year applicants were admitted (1,873 of 12,480)" — never "your chance". */
export function explainStatistic(s: StatClaim): string {
  const v = s.value;
  const who = POPULATION_LABEL[v.cohort.population];
  const val = v.value.kind === 'number' ? `${v.value.value}${v.value.unit === 'percent' ? '%' : ''}` : v.value.kind === 'suppressed' ? 'suppressed (not zero)' : 'not reported';
  const round = roundOf(s.qualifier);
  const scope = round ? ` in the ${round.replace(/_/g, ' ')} round` : '';
  switch (v.measure) {
    case 'admit_rate':
      return `${v.cohort.year}: ${val} of ${who}${scope} were admitted${v.denominator ? ` (denominator: ${v.denominator})` : ''}. This describes a past group; it is not anyone's personal probability.`;
    case 'score_25th':
    case 'score_75th':
    case 'score_50th':
      return `${v.cohort.year}: the ${v.measure === 'score_25th' ? '25th' : v.measure === 'score_75th' ? '75th' : '50th'} percentile ${v.scoreType ?? 'score'} among ${who} was ${val}. It is not a minimum or a cutoff.`;
    default:
      return `${v.cohort.year}: ${v.measure.replace(/_/g, ' ')} for ${who}${scope} was ${val}.`;
  }
}

export function roundOf(qualifier: string): 'early_decision' | 'early_action' | 'regular' | null {
  if (/early_decision/.test(qualifier)) return 'early_decision';
  if (/early_action/.test(qualifier)) return 'early_action';
  if (/regular/.test(qualifier)) return 'regular';
  return null;
}

/** The admit rate for the student's own group and scope, if one is published and recent enough. */
export function scopedAdmitRate(stats: readonly StatClaim[], opts: { population: 'first_year_applicants' | 'transfer_applicants' | 'program_applicants'; cycle: number }): { stat: StatClaim; stale: boolean } | null {
  const rates = stats.filter((s) => s.value.measure === 'admit_rate' && s.value.cohort.population === opts.population && roundOf(s.qualifier) === null && s.value.value.kind === 'number');
  const newest = [...rates].sort((a, b) => (cohortYear(b.value) ?? 0) - (cohortYear(a.value) ?? 0))[0];
  if (!newest) return null;
  const y = cohortYear(newest.value);
  return { stat: newest, stale: y === null || opts.cycle - y > MAX_STAT_AGE_YEARS };
}

export interface ScoreComparison {
  scoreType: string;
  studentScore: number;
  reportStatus: TestScoreRecord['reportStatus'];
  p25: number;
  p75: number;
  population: string;
  year: string;
  position: 'below_25th' | 'within_middle_50' | 'above_75th';
  explanation: string;
  statClaimIds: string[];
}

/** Which part of a test record a published score type refers to; null when it cannot be matched without converting. */
function scoreFor(scoreType: string, t: TestScoreRecord): number | null {
  const st = scoreType.toLowerCase();
  if (/\bsat\b/.test(st) && t.family === 'SAT') {
    if (/math/.test(st)) return t.sections['math'] ?? null;
    if (/(reading|writing|erw|verbal)/.test(st)) return t.sections['evidence_based_reading_writing'] ?? null;
    if (/(total|composite)/.test(st)) return t.reportedTotal;
  }
  if (/\bact\b/.test(st) && t.family === 'ACT' && /composite/.test(st)) return t.reportedTotal;
  return null;
}

/**
 * Compare the student's own reported scores with a published middle range.
 * Both selection conditions of the range are kept (13T04): who is described
 * (applicants, admitted or enrolled students) and whether only score
 * submitters are included. Being above the 75th percentile is one academic
 * consideration, never "likely admission" (13T03).
 */
export function compareScores(stats: readonly StatClaim[], tests: readonly TestScoreRecord[]): ScoreComparison[] {
  const out: ScoreComparison[] = [];
  const byType = new Map<string, { p25?: StatClaim; p75?: StatClaim }>();
  for (const s of stats) {
    if ((s.value.measure !== 'score_25th' && s.value.measure !== 'score_75th') || !s.value.scoreType || s.value.value.kind !== 'number') continue;
    const k = `${s.value.scoreType}|${s.value.cohort.population}|${s.value.cohort.year}`;
    const e = byType.get(k) ?? {};
    if (s.value.measure === 'score_25th') e.p25 = s;
    else e.p75 = s;
    byType.set(k, e);
  }
  for (const [k, e] of byType) {
    if (!e.p25 || !e.p75) continue;
    const [scoreType, population, year] = k.split('|') as [string, StatisticValue['cohort']['population'], string];
    const usable = tests.filter((t) => t.reportStatus === 'official' || t.reportStatus === 'self_reported');
    const scores = usable.map((t) => ({ t, s: scoreFor(scoreType, t) })).filter((x): x is { t: TestScoreRecord; s: number } => x.s !== null);
    if (scores.length === 0) continue;
    const best = scores.sort((a, b) => b.s - a.s)[0]!;
    const p25 = (e.p25.value.value as { value: number }).value;
    const p75 = (e.p75.value.value as { value: number }).value;
    const position = best.s < p25 ? 'below_25th' : best.s > p75 ? 'above_75th' : 'within_middle_50';
    const group = POPULATION_LABEL[population];
    const submitters = population === 'enrolled_score_submitters' ? ' The range covers only enrolled students who chose to submit scores, and enrolled students are a subset of those admitted.' : population === 'first_year_enrolled' ? ' The range describes enrolled students, a subset of those admitted.' : '';
    const where = position === 'above_75th' ? `above the middle half (${p25}–${p75})` : position === 'below_25th' ? `below the middle half (${p25}–${p75})` : `within the middle half (${p25}–${p75})`;
    const meaning = position === 'above_75th' ? ' Applicants with scores like this are also turned down; this is one academic consideration, not a sign that admission is likely.' : position === 'below_25th' ? ' A quarter of the group scored lower, so this is not a cutoff; it is one consideration among many.' : ' This is one academic consideration; it does not settle the rest of the selection process.';
    out.push({ scoreType, studentScore: best.s, reportStatus: best.t.reportStatus, p25, p75, population, year, position, explanation: `Your ${scoreType} of ${best.s}${best.t.reportStatus === 'self_reported' ? ' (self-reported)' : ''} is ${where} for ${group}, ${year}.${submitters}${meaning}`, statClaimIds: [e.p25.claimId, e.p75.claimId] });
  }
  return out;
}

/** Round statistics describe different applicant pools; they never establish a benefit for this student (13T05). */
export function roundNote(stats: readonly StatClaim[]): string | null {
  const early = stats.find((s) => s.value.measure === 'admit_rate' && (roundOf(s.qualifier) === 'early_decision' || roundOf(s.qualifier) === 'early_action') && s.value.value.kind === 'number');
  const regular = stats.find((s) => s.value.measure === 'admit_rate' && roundOf(s.qualifier) === 'regular' && s.value.value.kind === 'number');
  if (!early || !regular) return null;
  const e = (early.value.value as { value: number }).value;
  const r = (regular.value.value as { value: number }).value;
  if (e <= r) return null;
  return `The ${roundOf(early.qualifier)!.replace(/_/g, ' ')} admit rate (${e}%) is higher than the regular rate (${r}%). That can reflect who applies early, recruited groups and different selection processes; it does not show how much applying early would change the outcome for you. Whether to apply early is a round decision with its own commitments.`;
}
