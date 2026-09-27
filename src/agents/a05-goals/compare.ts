import { formatMoney, type Money } from '../../shared/money.js';
import { countryName } from '../../shared/places.js';
import type { SourceRecord } from '../../shared/sources.js';
import { diffDays } from '../../shared/time.js';
import { preferredConditions, type GoalContext, type Hypothesis } from './explore.js';
import type { KnowledgeResult, LaborMarketRecord, SubjectProfile } from './knowledge.js';

/**
 * Option comparison, decision aids and field explanations (05R05, 05R06,
 * 05R10, "Decision comparison design", "Mapping majors to occupations").
 *
 * Ratings are qualitative and traceable. A weighted total appears only when
 * the student chose weights, and it is labelled as a reflection of those
 * weights, not an objective answer. Hard constraints are kept apart from
 * preferences, and prestige is never a default dimension.
 */

export type Rating = 'strong' | 'some' | 'weak' | 'unclear';
const RATING_VALUE: Record<Rating, number | null> = { strong: 3, some: 2, weak: 1, unclear: null };

export interface Dimension {
  key: string;
  label: string;
  /** Optional weight chosen by the student (0-5). */
  weight: number | null;
}

export interface ComparisonCell {
  optionKey: string;
  dimensionKey: string;
  rating: Rating;
  basis: string;
}

export interface Comparison {
  options: Array<{ key: string; label: string }>;
  dimensions: Dimension[];
  cells: ComparisonCell[];
  hardConstraints: Array<{ optionKey: string; issue: string }>;
  totals: Array<{ optionKey: string; weightedTotal: number; ratedDimensions: number }> | null;
  totalsNote: string | null;
  reputationNote: string | null;
  missingInformation: string[];
}

export const DEFAULT_DIMENSIONS: readonly Dimension[] = [
  { key: 'subject_interest', label: 'Interest in the subject', weight: null },
  { key: 'preferred_methods', label: 'Fit with how you like to work', weight: null },
  { key: 'preparation', label: 'Preparation so far', weight: null },
  { key: 'route_clarity', label: 'Clarity of the route', weight: null },
];

const PRESTIGE = /\b(prestige|prestigious|reputation|ranking|rank|elite|top school|famous)\b/i;

export function compareOptions(
  profiles: readonly SubjectProfile[],
  hypotheses: readonly Hypothesis[],
  ctx: GoalContext,
  requested: ReadonlyArray<{ key: string; label: string; weight?: number | null }> | null,
  studentRatings: Readonly<Record<string, Readonly<Record<string, Rating>>>>,
  verifiedRouteCountries: ReadonlyMap<string, readonly string[]>,
): Comparison {
  let reputationNote: string | null = null;
  const dims: Dimension[] = (requested ?? DEFAULT_DIMENSIONS).map((d) => {
    if (PRESTIGE.test(d.key) || PRESTIGE.test(d.label)) {
      // Unpack what "reputation" means instead of using prestige as a score.
      reputationNote = 'You mentioned reputation. It helps to say what you mean by it: teaching quality, research access, professional recognition, community, or something else. Later college research can look at those specific features.';
    }
    return { key: d.key, label: d.label, weight: d.weight ?? null };
  });
  const conditions = preferredConditions(ctx);
  const cells: ComparisonCell[] = [];
  const hard: Comparison['hardConstraints'] = [];
  const missing = new Set<string>();
  for (const p of profiles) {
    const h = hypotheses.find((x) => x.subjectKeys.includes(p.key));
    for (const d of dims) {
      const student = studentRatings[p.key]?.[d.key];
      if (student) {
        cells.push({ optionKey: p.key, dimensionKey: d.key, rating: student, basis: 'Your own rating.' });
        continue;
      }
      switch (d.key) {
        case 'subject_interest': {
          const rating: Rating = !h ? 'unclear' : h.support === 'several_examples' ? 'strong' : h.support === 'emerging' || h.support === 'mixed' ? 'some' : 'weak';
          cells.push({ optionKey: p.key, dimensionKey: d.key, rating, basis: h ? `${h.evidence.filter((e) => e.direction === 'supports').length} example(s) from what you said${h.evidence.some((e) => e.direction === 'against') ? ', with some mixed experiences' : ''}.` : 'Not enough examples yet.' });
          if (!h) missing.add(`More examples of what you enjoy relating to ${p.label.toLowerCase()}.`);
          break;
        }
        case 'preferred_methods': {
          if (conditions.length === 0) {
            cells.push({ optionKey: p.key, dimensionKey: d.key, rating: 'unclear', basis: 'You have not said how you like to work yet.' });
            missing.add('How you like to work (for example hands-on, in a team, reading and writing).');
            break;
          }
          const overlap = conditions.filter((c) => p.conditions.includes(c.condition));
          cells.push({ optionKey: p.key, dimensionKey: d.key, rating: overlap.length >= 2 ? 'strong' : overlap.length === 1 ? 'some' : 'weak', basis: overlap.length > 0 ? `Typical work includes ${overlap.map((c) => c.condition.replace(/_/g, ' ')).join(' and ')}, which you said you like.` : 'Typical work here is different from how you said you like to work.' });
          break;
        }
        case 'preparation': {
          const have = ctx.courses.filter((c) => c.broadSubject && p.helpfulSchoolSubjects.includes(c.broadSubject));
          const rating: Rating = p.helpfulSchoolSubjects.length === 0 ? 'unclear' : have.length >= Math.min(2, p.helpfulSchoolSubjects.length) ? 'strong' : have.length > 0 ? 'some' : 'unclear';
          // Grades are not used here: preparation can develop, and a grade is not a ceiling.
          cells.push({ optionKey: p.key, dimensionKey: d.key, rating, basis: have.length > 0 ? `Courses on record: ${have.map((c) => c.name).join(', ')}.` : 'Courses that commonly help are not on record yet; specific programs set their own requirements.' });
          break;
        }
        case 'route_clarity': {
          if (p.regulatedProfessions.length === 0) {
            cells.push({ optionKey: p.key, dimensionKey: d.key, rating: 'some', basis: 'Several routes exist and none needs a professional license by default.' });
            break;
          }
          const verified = verifiedRouteCountries.get(p.key) ?? [];
          const needed = ctx.countryContext.filter((c) => !verified.includes(c));
          cells.push({ optionKey: p.key, dimensionKey: d.key, rating: needed.length === 0 && ctx.countryContext.length > 0 ? 'some' : 'unclear', basis: needed.length > 0 || ctx.countryContext.length === 0 ? `Leads to a regulated profession; the route must be checked for ${needed.length > 0 ? needed.map(countryName).join(', ') : 'the countries you are considering'}.` : 'The professional route has been checked for the countries you are considering.' });
          break;
        }
        default:
          cells.push({ optionKey: p.key, dimensionKey: d.key, rating: 'unclear', basis: 'Add your own rating for this dimension.' });
      }
    }
    for (const req of p.oftenRequires) hard.push({ optionKey: p.key, issue: `Many programs ask for ${req}; check the specific programs you are considering.` });
  }
  const weighted = dims.some((d) => d.weight !== null && d.weight > 0);
  const totals = weighted
    ? profiles.map((p) => {
        let total = 0;
        let rated = 0;
        for (const d of dims) {
          if (!d.weight) continue;
          const v = RATING_VALUE[cells.find((c) => c.optionKey === p.key && c.dimensionKey === d.key)!.rating];
          if (v === null) continue;
          total += v * d.weight;
          rated += 1;
        }
        return { optionKey: p.key, weightedTotal: total, ratedDimensions: rated };
      })
    : null;
  return {
    options: profiles.map((p) => ({ key: p.key, label: p.label })),
    dimensions: dims,
    cells,
    hardConstraints: hard,
    totals,
    totalsNote: totals ? 'These totals only reflect the weights you chose and the ratings shown; they are not an objective answer about which path is best. Unclear ratings are left out.' : null,
    reputationNote,
    missingInformation: [...missing],
  };
}

// ------------------------------------------------------------------ decision aid

export interface DecisionAid {
  deadline: string | null;
  daysUntilDeadline: number | null;
  decisionKind: 'school_course_choice' | 'university_application';
  options: Array<{ key: string; label: string; lessReversible: string[]; reversible: string[] }>;
  keepOptionsOpen: string[];
  checkBeforeDeciding: string[];
  /** The student chooses; the app never picks. */
  recommendedOption: null;
}

export function decisionAid(profiles: readonly SubjectProfile[], kind: DecisionAid['decisionKind'], deadline: string | null, today: string): DecisionAid {
  const options = profiles.map((p) => {
    if (kind === 'school_course_choice') {
      return {
        key: p.key,
        label: p.label,
        lessReversible: p.helpfulSchoolSubjects.length > 0 ? [`Dropping ${p.helpfulSchoolSubjects.map((s) => s.replace(/_/g, ' ')).join(' or ')} now could make later requirements for ${p.label.toLowerCase()} harder to meet.`] : [],
        reversible: ['Your interests and exploration can keep developing after this choice.'],
      };
    }
    return {
      key: p.key,
      label: p.label,
      lessReversible: [`At some universities the subject you apply to decides the program you are admitted to, and switching later can be limited. ${p.variesAcrossPrograms}`],
      reversible: ['At other universities students choose or change their major after starting; each university’s policy needs checking.'],
    };
  });
  const union = [...new Set(profiles.flatMap((p) => p.helpfulSchoolSubjects))];
  return {
    deadline,
    daysUntilDeadline: deadline ? diffDays(today, deadline) : null,
    decisionKind: kind,
    options,
    keepOptionsOpen: kind === 'school_course_choice' && union.length > 0 ? [`If your timetable allows, keeping ${union.map((s) => s.replace(/_/g, ' ')).join(', ')} preserves more of these routes. Whether they fit together is a question for your school.`] : ['Apply where you can keep more than one route open, if that matters to you, and check each program’s rules on changing subject.'],
    checkBeforeDeciding: ['The exact subject requirements of the specific programs you are considering (checked against official sources).', kind === 'school_course_choice' ? 'Which course combinations your school can actually timetable.' : 'Each university’s policy on changing major or program.'],
    recommendedOption: null,
  };
}

// ------------------------------------------------------------------ explaining one field

export interface FieldExplanation {
  subjectKey: string;
  label: string;
  topic: 'what_you_study' | 'occupations' | 'earnings' | 'routes';
  generalOverview: { summary: string; typicalQuestions: string[]; methods: string[]; workProducts: string[]; variesAcrossPrograms: string; label: string } | null;
  occupations: Array<{ label: string; additionalRequirements: string[]; regulated: boolean }>;
  occupationNote: string | null;
  earnings: Array<{ occupation: string; measure: string; value: string; geography: string; dataYear: number; sourceId: string; publisher: string }>;
  earningsNotes: string[];
  routes: Array<{ country: string; profession: string; summary: string; sourceId: string }>;
  routesNeedingVerification: Array<{ country: string; profession: string }>;
}

function fmtValue(r: LaborMarketRecord): string {
  const v = r.value;
  if (typeof v === 'number') return r.measure === 'employment_projection_percent' ? `${v}%` : String(v);
  if (typeof v === 'string') return v;
  return formatMoney(v as Money);
}

const MEASURE_LABEL: Record<LaborMarketRecord['measure'], string> = {
  median_annual_wage: 'median annual wage',
  median_hourly_wage: 'median hourly wage',
  employment_projection_percent: 'projected employment change',
  typical_entry_education: 'typical entry-level education',
};

export function explainField(p: SubjectProfile, topic: FieldExplanation['topic'], knowledge: KnowledgeResult, ctx: GoalContext, askedForGuarantee: boolean): FieldExplanation {
  const out: FieldExplanation = { subjectKey: p.key, label: p.label, topic, generalOverview: null, occupations: [], occupationNote: null, earnings: [], earningsNotes: [], routes: [], routesNeedingVerification: [] };
  if (topic === 'what_you_study') {
    out.generalOverview = { summary: p.summary, typicalQuestions: p.typicalQuestions, methods: p.methods, workProducts: p.workProducts, variesAcrossPrograms: p.variesAcrossPrograms, label: 'General overview. Programs with the same name differ; check the curriculum of each program you consider.' };
  }
  if (topic === 'occupations' || topic === 'earnings') {
    out.occupations = p.occupationLinks.map((o) => ({ label: o.label, additionalRequirements: o.additionalRequirements, regulated: o.regulated }));
    out.occupationNote = `${p.label} can lead to several kinds of work. A degree in it does not by itself qualify you for every role listed; some need further study, a portfolio, experience or a license.`;
  }
  if (topic === 'earnings') {
    const sources = new Map<string, SourceRecord>(knowledge.labor.map((l) => [l.source.id, l.source]));
    out.earnings = knowledge.labor
      .filter((l) => p.occupationLinks.some((o) => o.occupationKey === l.record.occupationKey))
      .map((l) => ({ occupation: l.record.occupationDefinition, measure: MEASURE_LABEL[l.record.measure], value: fmtValue(l.record), geography: l.record.geography, dataYear: l.record.dataYear, sourceId: l.record.sourceId, publisher: sources.get(l.record.sourceId)?.publisher ?? 'source' }));
    out.earningsNotes.push('These are figures for the whole occupation, not a starting salary and not a prediction for you. Pay depends on location, experience, employer and many other things.');
    const geos = [...new Set(out.earnings.map((e) => e.geography))];
    const elsewhere = ctx.countryContext.filter((c) => !geos.includes(c));
    if (geos.length > 0 && elsewhere.length > 0) out.earningsNotes.push(`The data describes ${geos.map(countryName).join(', ')} and may not apply to ${elsewhere.map(countryName).join(', ')}.`);
    if (askedForGuarantee) out.earningsNotes.unshift('No one can guarantee a salary for any subject or person, so none is given here.');
    if (out.earnings.length === 0) out.earningsNotes.push('No verified, current earnings data is available for this field here yet.');
  }
  if (topic === 'routes' || topic === 'occupations') {
    for (const r of knowledge.routes.filter((x) => x.note.subjectKey === p.key)) out.routes.push({ country: r.note.country, profession: r.note.profession, summary: r.note.summary, sourceId: r.source.id });
    const countries = ctx.countryContext.length > 0 ? ctx.countryContext : [];
    for (const prof of p.regulatedProfessions) {
      const checked = new Set(out.routes.filter((r) => r.profession === prof).map((r) => r.country));
      const need = countries.filter((c) => !checked.has(c));
      if (countries.length === 0) out.routesNeedingVerification.push({ country: 'unspecified', profession: prof });
      for (const c of need) out.routesNeedingVerification.push({ country: c, profession: prof });
    }
  }
  return out;
}
