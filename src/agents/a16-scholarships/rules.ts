import { z } from 'zod';
import { partialDateBounds, type CalendarDate, type PartialDate } from '../../shared/time.js';

/**
 * Scholarship eligibility rules (16 "Rule representation").
 *
 * Verified requirements are compiled into explicit AND, OR and exclusion
 * clauses; each leaf keeps the source that states it. Every leaf evaluates to
 * true, false or unknown, and the combination follows three-valued logic:
 * a required clause that is unknown leaves the result "potentially eligible",
 * one that is false makes it "ineligible", and only a fully satisfied rule
 * with no exclusion is "eligible within the checked scope". Competitive
 * selection qualities are never clauses unless the sponsor makes them
 * prerequisites.
 */

export const LEAF_KINDS = [
  'graduation_between',
  'education_stage_in',
  'first_undergraduate_degree',
  'citizenship_in',
  'residence_in',
  'school_country_in',
  'age_between_on',
  'applying_to',
  'first_choice_program',
  'financial_need',
  'custom',
] as const;
export type LeafKind = (typeof LEAF_KINDS)[number];

/** Clauses that touch protected or private characteristics: asked only when needed, with a reason, and skippable (16 "Eligibility data and privacy"). */
export const SENSITIVE_KINDS = new Set<LeafKind>(['citizenship_in', 'residence_in', 'financial_need', 'age_between_on']);

const Country = z.string().regex(/^[A-Z]{2}$/);

export const LeafSchema = z
  .object({
    clauseId: z.string().regex(/^[a-z0-9_]+$/),
    kind: z.enum(LEAF_KINDS),
    /** The sponsor's own wording. */
    text: z.string().min(1).max(600),
    sourceRef: z.string().min(1),
    params: z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        stages: z.array(z.string()).optional(),
        countries: z.array(Country).optional(),
        minAge: z.number().int().optional(),
        maxAge: z.number().int().optional(),
        onDate: z.string().optional(),
        institutions: z.array(z.string()).optional(),
        programs: z.array(z.string()).optional(),
        /** For a custom clause: the question to ask, in plain words. */
        question: z.string().max(300).optional(),
        sensitive: z.boolean().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type Leaf = z.infer<typeof LeafSchema>;

export type Clause = { all: Clause[] } | { any: Clause[] } | { not: Clause } | { leaf: Leaf };
export const ClauseSchema: z.ZodType<Clause> = z.lazy(() =>
  z.union([z.object({ all: z.array(ClauseSchema).min(1) }).strict(), z.object({ any: z.array(ClauseSchema).min(1) }).strict(), z.object({ not: ClauseSchema }).strict(), z.object({ leaf: LeafSchema }).strict()]),
);

export type Truth = 'true' | 'false' | 'unknown';

/** The student facts a rule may use; each is present only when the record holds it and the role may read it. */
export interface EligibilityFacts {
  expectedGraduation?: PartialDate;
  educationStage?: string;
  postsecondaryEnrollment?: 'none' | 'dual_enrollment_while_in_secondary' | 'enrolled_after_secondary';
  citizenships?: string[];
  residenceCountry?: string;
  schoolCountry?: string;
  birthDate?: CalendarDate;
  /** Institutions (and programs) the student is applying to. */
  applications: Array<{ institutionRef: string; programRef: string | null; rank: number | null; rankLabel: string | null }>;
  aidNeeded?: 'yes' | 'no' | 'unsure';
  /** Answers the student gave to custom clauses in this task. */
  answers: Record<string, boolean>;
  /** Facts or clauses the student chose not to answer; they stay unknown and are not asked again. */
  declined: Set<string>;
  /** Fact keys the record holds as an explicit "declined" or "unknown". */
  recordedAbsent: Set<string>;
}

export interface LeafResult {
  clauseId: string;
  kind: LeafKind;
  text: string;
  sourceRef: string;
  truth: Truth;
  reason: string;
  /** The fact the result depends on, for questions and data minimization. */
  fact: string;
  sensitive: boolean;
  declined: boolean;
}

const FACT_OF: Record<LeafKind, string> = {
  graduation_between: 'education.expected_graduation',
  education_stage_in: 'education.stage',
  first_undergraduate_degree: 'education.postsecondary_enrollment',
  citizenship_in: 'identity.citizenships',
  residence_in: 'identity.residence_country',
  school_country_in: 'education.school_country',
  age_between_on: 'identity.birth_date',
  applying_to: 'application.definition',
  first_choice_program: 'application.choice_rank',
  financial_need: 'finance.aid_needed',
  custom: 'answer',
};

export function factOf(leaf: Leaf): string {
  return leaf.kind === 'custom' ? `answer:${leaf.clauseId}` : FACT_OF[leaf.kind];
}

/** Catalog keys a rule needs, so the scoped read asks for nothing else (data minimization). */
export function catalogKeysFor(rule: Clause): string[] {
  const keys = new Set<string>();
  for (const l of leaves(rule)) {
    const f = factOf(l);
    if (f.startsWith('answer:')) continue;
    keys.add(f.startsWith('application.') ? f : `student.${f}`);
    if (f === 'application.choice_rank') keys.add('application.definition');
  }
  return [...keys].sort();
}

export function leaves(c: Clause): Leaf[] {
  if ('leaf' in c) return [c.leaf];
  if ('not' in c) return leaves(c.not);
  return ('all' in c ? c.all : c.any).flatMap(leaves);
}

function ageOn(birth: CalendarDate, on: CalendarDate): number {
  const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function evaluateLeaf(l: Leaf, f: EligibilityFacts): LeafResult {
  const fact = factOf(l);
  const sensitive = SENSITIVE_KINDS.has(l.kind) || l.params.sensitive === true;
  const base = { clauseId: l.clauseId, kind: l.kind, text: l.text, sourceRef: l.sourceRef, fact, sensitive, declined: f.declined.has(fact) || f.declined.has(l.clauseId) };
  const unknown = (reason: string): LeafResult => ({ ...base, truth: 'unknown', reason: base.declined ? 'You chose not to answer this, so it stays open; nothing else depends on it.' : reason });
  const verdict = (ok: boolean, yes: string, no: string): LeafResult => ({ ...base, truth: ok ? 'true' : 'false', reason: ok ? yes : no });
  if (base.declined) return unknown('');
  const p = l.params;
  switch (l.kind) {
    case 'graduation_between': {
      if (!f.expectedGraduation) return unknown('Your expected graduation date is not recorded.');
      const g = partialDateBounds(f.expectedGraduation);
      const from = p.from ? partialDateBounds(p.from).start : '0000-01-01';
      const to = p.to ? partialDateBounds(p.to).end : '9999-12-31';
      if (g.start >= from && g.end <= to) return verdict(true, `You expect to graduate ${f.expectedGraduation}, within the required window.`, '');
      if (g.end < from || g.start > to) return verdict(false, '', `You expect to graduate ${f.expectedGraduation}; the award requires graduation between ${p.from ?? 'any time'} and ${p.to ?? 'any time'}.`);
      return unknown(`Your graduation date (${f.expectedGraduation}) is not precise enough to tell whether it falls in the required window.`);
    }
    case 'education_stage_in':
      if (!f.educationStage) return unknown('Your current stage of education is not recorded.');
      return verdict((p.stages ?? []).includes(f.educationStage), `Your stage (${f.educationStage.replace(/_/g, ' ')}) qualifies.`, `The award is for ${(p.stages ?? []).map((s) => s.replace(/_/g, ' ')).join(' or ')} students; your record says ${f.educationStage.replace(/_/g, ' ')}.`);
    case 'first_undergraduate_degree':
      if (!f.postsecondaryEnrollment) return unknown('Whether you have already enrolled in college after secondary school is not recorded.');
      return verdict(f.postsecondaryEnrollment !== 'enrolled_after_secondary', 'You have not started a degree after secondary school.', 'The award is for a first undergraduate degree, and your record shows college enrollment after secondary school.');
    case 'citizenship_in': {
      if (!f.citizenships || f.citizenships.length === 0) return unknown(f.recordedAbsent.has(fact) ? 'Your citizenship is recorded as not shared.' : 'Your citizenship is not recorded.');
      const ok = f.citizenships.some((c) => (p.countries ?? []).includes(c));
      return verdict(ok, 'Your citizenship meets this requirement.', `The award requires citizenship of ${(p.countries ?? []).join(' or ')}.`);
    }
    case 'residence_in':
      if (!f.residenceCountry) return unknown('Where you live is not recorded.');
      return verdict((p.countries ?? []).includes(f.residenceCountry), 'Where you live meets this requirement.', `The award requires living in ${(p.countries ?? []).join(' or ')}; your record says ${f.residenceCountry}.`);
    case 'school_country_in':
      if (!f.schoolCountry) return unknown('The country of your school is not recorded.');
      return verdict((p.countries ?? []).includes(f.schoolCountry), 'Your school’s location meets this requirement.', `The award requires attending school in ${(p.countries ?? []).join(' or ')}; your school is in ${f.schoolCountry}. Citizenship alone does not satisfy this.`);
    case 'age_between_on': {
      if (!f.birthDate || !p.onDate) return unknown('Your date of birth is not recorded.');
      const a = ageOn(f.birthDate, p.onDate as CalendarDate);
      return verdict((p.minAge === undefined || a >= p.minAge) && (p.maxAge === undefined || a <= p.maxAge), `You meet the age requirement on ${p.onDate}.`, `The award requires an age between ${p.minAge ?? 'any'} and ${p.maxAge ?? 'any'} on ${p.onDate}.`);
    }
    case 'applying_to': {
      if (f.applications.length === 0) return unknown('Your applications are not recorded yet.');
      const ok = f.applications.some((a) => (p.institutions ?? []).includes(a.institutionRef) && (!p.programs || p.programs.length === 0 || (a.programRef !== null && p.programs.includes(a.programRef))));
      return verdict(ok, 'You are applying to a qualifying destination.', `The award is only for applicants to ${[...(p.institutions ?? []), ...(p.programs ?? [])].join(', ')}, which is not among your applications.`);
    }
    case 'first_choice_program': {
      const ranked = f.applications.filter((a) => a.rank !== null);
      if (ranked.length === 0) return unknown('Your order of choices is not recorded, and this award depends on your first choice.');
      const first = [...ranked].sort((a, b) => a.rank! - b.rank!)[0]!;
      const ok = (p.institutions ?? []).includes(first.institutionRef) && (!p.programs || p.programs.length === 0 || (first.programRef !== null && p.programs.includes(first.programRef)));
      return verdict(ok, 'The qualifying program is your first choice.', `The award applies only when ${[...(p.programs ?? []), ...(p.institutions ?? [])].join(' at ')} is your first choice; your first choice is ${first.programRef ?? first.institutionRef}.`);
    }
    case 'financial_need':
      if (!f.aidNeeded || f.aidNeeded === 'unsure') return unknown('Whether you need financial help is not settled; the sponsor decides need with its own forms.');
      return verdict(f.aidNeeded === 'yes', 'You said you need financial help; the sponsor still assesses need on its own forms.', 'You said you do not need financial help, and this award is need-based.');
    case 'custom': {
      const a = f.answers[l.clauseId];
      if (a === undefined) return unknown(p.question ?? `Please check: ${l.text}`);
      return verdict(a, 'You confirmed this requirement.', `You said this does not apply to you: ${l.text}`);
    }
  }
}

export interface RuleEvaluation {
  truth: Truth;
  leaves: LeafResult[];
  failed: LeafResult[];
  unknown: LeafResult[];
}

/**
 * Three-valued evaluation: AND is false if any part is false, OR is true if
 * any part is true; NOT keeps unknown unknown. Only the clauses that decide
 * the outcome are reported as failed or open: a false branch of a satisfied
 * OR is not a reason for anything.
 */
export function evaluateRule(c: Clause, f: EligibilityFacts): RuleEvaluation {
  const all: LeafResult[] = [];
  interface Node {
    truth: Truth;
    failed: LeafResult[];
    unknown: LeafResult[];
  }
  const walk = (x: Clause): Node => {
    if ('leaf' in x) {
      const r = evaluateLeaf(x.leaf, f);
      all.push(r);
      return { truth: r.truth, failed: r.truth === 'false' ? [r] : [], unknown: r.truth === 'unknown' ? [r] : [] };
    }
    if ('not' in x) {
      // An exclusion on one fact is reported as that fact: "an exclusion applies" is the failed reason.
      if ('leaf' in x.not) {
        const r = evaluateLeaf(x.not.leaf, f);
        const flipped: LeafResult = r.truth === 'unknown' ? r : r.truth === 'true' ? { ...r, truth: 'false', reason: `An exclusion applies: ${x.not.leaf.text}` } : { ...r, truth: 'true', reason: 'The exclusion does not apply to you.' };
        all.push(flipped);
        return { truth: flipped.truth, failed: flipped.truth === 'false' ? [flipped] : [], unknown: flipped.truth === 'unknown' ? [flipped] : [] };
      }
      const inner = walk(x.not);
      if (inner.truth === 'unknown') return inner;
      if (inner.truth === 'false') return { truth: 'true', failed: [], unknown: [] };
      const applies = leaves(x.not).map((l): LeafResult => ({ ...evaluateLeaf(l, f), truth: 'false', reason: `An exclusion applies: ${l.text}` }));
      return { truth: 'false', failed: applies, unknown: [] };
    }
    const parts = ('all' in x ? x.all : x.any).map(walk);
    const truths = parts.map((p) => p.truth);
    if ('all' in x) {
      if (truths.includes('false')) return { truth: 'false', failed: parts.flatMap((p) => (p.truth === 'false' ? p.failed : [])), unknown: [] };
      if (truths.includes('unknown')) return { truth: 'unknown', failed: [], unknown: parts.flatMap((p) => (p.truth === 'unknown' ? p.unknown : [])) };
      return { truth: 'true', failed: [], unknown: [] };
    }
    if (truths.includes('true')) return { truth: 'true', failed: [], unknown: [] };
    if (truths.includes('unknown')) return { truth: 'unknown', failed: [], unknown: parts.flatMap((p) => p.unknown) };
    return { truth: 'false', failed: parts.flatMap((p) => p.failed), unknown: [] };
  };
  const root = walk(c);
  return { truth: root.truth, leaves: all, failed: root.failed, unknown: root.unknown };
}
