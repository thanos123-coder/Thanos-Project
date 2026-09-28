import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { RoleIdSchema, type Handoff } from '../../shared/envelopes.js';
import type { FitPriority } from '../../shared/fields.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import { artifactRef } from '../a04-record-steward/service.js';
import type { DerivedArtifact, MutationResponse } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { claimRef, type ClaimRecord } from '../a11-research/claims.js';
import type { Resolution } from '../a11-research/entities.js';
import type { CatalogEntry, ReadClaimsResult } from '../a11-research/tools.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import { dominates, FIT_DIMENSIONS, normalizePriorities, order, PRESTIGE_PROXIES, scoreCandidate, sensitivity, type Candidate, type DimensionResult, type FitDimension, type Priority, type Scored } from './fit.js';

/**
 * Agent 12 — College and program fit matcher.
 *
 * Helps the student find options they could reasonably want to attend by
 * comparing verified attributes with the student's own priorities. Fit is
 * not a prediction of admission and not a ranking of institutions or of the
 * student. Eligibility (06), admissions uncertainty (13), affordability (15)
 * and the portfolio (14) are carried as separate dimensions and never
 * overwritten by a score. Missing evidence stays visible and never raises a
 * rank; commercial relationships never change it.
 */

const DIMENSION_NAMES = [...Object.keys(FIT_DIMENSIONS), ...PRESTIGE_PROXIES] as unknown as [string, ...string[]];

const CandidateInputSchema = z
  .object({
    optionRef: z.string().min(1).max(200).optional(),
    institution: z.string().min(1).max(200),
    campus: z.string().max(200).nullable().default(null),
    program: z.string().max(200).nullable().default(null),
    suppliedBy: z.enum(['student', 'counselor']).default('student'),
    commercial: z.object({ partner: z.boolean().default(false), sponsored: z.boolean().default(false) }).strict().default({ partner: false, sponsored: false }),
  })
  .strict();

export const FitScopeSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('match'),
      goal: z.enum(['initial_list', 'choose_between', 'replace_unaffordable', 'test_preference']).default('initial_list'),
      cycle: z.string().regex(/^\d{4}$/),
      useCatalog: z.boolean().default(true),
      countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(30).optional(),
      candidates: z.array(CandidateInputSchema).max(20).default([]),
      /** Catalog entries marked as partners or sponsored; recorded for disclosure only. */
      commercial: z.record(z.string(), z.object({ partner: z.boolean().default(false), sponsored: z.boolean().default(false) }).strict()).default({}),
      limit: z.number().int().min(3).max(12).default(6),
      /** Questions the student asked that belong to other roles, e.g. an admission chance. */
      asks: z.array(z.enum(['admission_chance'])).default([]),
      /** Browsing behaviour; recorded but never turned into a preference (12T15). */
      interactionSignals: z.array(z.object({ optionRef: z.string(), kind: z.enum(['view', 'click', 'save']), count: z.number().int().nonnegative() }).strict()).max(100).default([]),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('decide'),
      decisions: z.array(z.object({ optionRef: z.string().min(1).max(200), decision: z.enum(['explore', 'retain', 'reject', 'undecided']), reason: z.string().max(300).nullable().default(null) }).strict()).min(1).max(20),
      conversationId: z.string().min(1).default('conv_fit'),
      turnId: z.string().min(1).default('t_fit'),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_priority'),
      priority: z.object({ dimension: z.enum(DIMENSION_NAMES), kind: z.enum(['hard_constraint', 'preference']), statement: z.string().min(1).max(300), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).nullable(), weight: z.number().int().min(0).max(5).nullable(), provisional: z.boolean() }).strict(),
      /** A priority is stored only when the student confirms it; behaviour is never enough (12 step 6). */
      confirmedByStudent: z.boolean(),
      conversationId: z.string().min(1).default('conv_fit'),
      turnId: z.string().min(1).default('t_fit'),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
]);
export type FitScope = z.infer<typeof FitScopeSchema>;

// ---------------------------------------------------------------- payload

const DimOut = z.object({ dimension: z.string(), label: z.string(), match: z.enum(['strong', 'mixed', 'weak', 'unknown']), why: z.string(), sourceRef: z.string().nullable(), weight: z.number() }).strict();
const HardOut = z.object({ dimension: z.string(), statement: z.string(), result: z.enum(['pass', 'fail', 'unknown', 'conditional']), why: z.string() }).strict();

const CardSchema = z
  .object({
    optionRef: z.string(),
    name: z.string(),
    unit: z.object({ institution: z.string(), campus: z.string().nullable(), program: z.string().nullable(), entityId: z.string().nullable() }).strict(),
    suppliedBy: z.enum(['catalog', 'student', 'counselor']),
    rank: z.number().int().positive().nullable(),
    state: z.enum(['feasible', 'exploration', 'excluded']),
    eligibility: z.enum(['supported', 'conditional', 'ineligible', 'unknown']),
    affordability: z.enum(['supported', 'conditional', 'gap_identified', 'unknown', 'not_calculated']),
    programAccess: z.object({ route: z.string(), condition: z.string() }).strict().nullable(),
    hardConstraints: z.array(HardOut),
    dimensions: z.array(DimOut),
    reasons: z.array(z.string()).max(2),
    drawback: z.string().nullable(),
    openQuestion: z.string().nullable(),
    conditions: z.array(z.string()),
    score: z.object({ min: z.number(), max: z.number(), possible: z.number() }).strict().nullable(),
    fitBand: z.enum(['strong', 'mixed', 'weak', 'incomplete']).nullable(),
    completeness: z.number(),
    notDominated: z.boolean().nullable(),
    disclosure: z.string().nullable(),
    studentDecision: z.object({ decision: z.string(), reason: z.string().nullable() }).strict().nullable(),
  })
  .strict();
export type FitCard = z.infer<typeof CardSchema>;

export const FitPayloadSchema = z
  .object({
    action: z.string(),
    goal: z.string().nullable(),
    version: z.number().int().nonnegative(),
    cards: z.array(CardSchema),
    more: z.array(CardSchema),
    exploration: z.array(CardSchema),
    excluded: z.array(CardSchema),
    sponsored: z.array(z.object({ optionRef: z.string(), name: z.string(), label: z.literal('sponsored') }).strict()),
    weights: z.record(z.string(), z.number()),
    views: z.array(z.object({ view: z.string(), optionRefs: z.array(z.string()), basis: z.string() }).strict()),
    sensitivity: z.object({ fragile: z.boolean(), close: z.boolean(), notes: z.array(z.string()) }).strict().nullable(),
    changes: z.array(z.object({ optionRef: z.string(), beforeRank: z.number().nullable(), afterRank: z.number().nullable(), because: z.array(z.string()) }).strict()),
    preferenceConflicts: z.array(z.object({ dimension: z.string(), student: z.string().nullable(), supporter: z.string(), question: z.string() }).strict()),
    gap: z.object({ constraints: z.array(z.object({ statement: z.string(), source: z.enum(['your_choice', 'institution_rule']), excluded: z.number() }).strict()), alternatives: z.array(z.string()) }).strict().nullable(),
    research: z.array(z.object({ optionRef: z.string(), dimension: z.string(), why: z.string() }).strict()),
    tableOnly: z.boolean(),
    questions: z.array(z.object({ code: z.string(), question: z.string() }).strict()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    recorded: z.array(z.string()),
    admissionProbability: z.null(),
  })
  .strict();
export type FitPayload = z.infer<typeof FitPayloadSchema>;

export const FIT_CONTRACT: ContractDefinition<FitPayload> = {
  id: 'fit_shortlist_v1',
  role: '12',
  payload: FitPayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    const ranked = [...p.cards, ...p.more];
    for (const c of ranked) {
      if (c.state !== 'feasible') issues.push(`${c.optionRef}: only feasible options are ranked`);
      if (c.hardConstraints.some((h) => h.result === 'fail')) issues.push(`${c.optionRef}: fails a hard constraint but is listed as feasible`);
      if (c.eligibility === 'ineligible') issues.push(`${c.optionRef}: an ineligible option cannot be ranked`);
    }
    for (let i = 1; i < ranked.length; i += 1) if (!p.tableOnly && ranked[i - 1]!.score && ranked[i]!.score && ranked[i - 1]!.score!.min < ranked[i]!.score!.min) issues.push('ranking does not follow the conservative scores');
    if (p.tableOnly && ranked.some((c) => c.score !== null)) issues.push('a comparison table must not carry scores');
    for (const s of p.sponsored) if (ranked.some((c) => c.optionRef === s.optionRef)) issues.push(`${s.optionRef}: sponsored content inside the organic ranking`);
    if (/\b\d{1,3}\s?% (match|fit|chance)\b|\bmatch percentage\b|\byour chances? (of|for) (admission|getting in) (is|are)\b/i.test(JSON.stringify(p))) issues.push('no match percentage or admission chance may be stated');
    return issues;
  },
};

// ---------------------------------------------------------------- reading

function prioritiesFrom(view: RecordView): { priorities: Priority[]; claimIds: string[] } {
  const priorities: Priority[] = [];
  const claimIds: string[] = [];
  for (const f of view.view.fields) {
    if (f.field.entity !== 'fit_priority' || f.field.attribute !== 'definition' || f.state !== 'current' || !f.current) continue;
    const v = f.current.value as FitPriority;
    if (!v || typeof v !== 'object' || !('dimension' in v)) continue;
    if (!(v.dimension in FIT_DIMENSIONS) && !(PRESTIGE_PROXIES as readonly string[]).includes(v.dimension)) continue;
    claimIds.push(f.current.claimId);
    priorities.push({ dimension: v.dimension as FitDimension, kind: v.kind, statement: v.statement, value: v.value, weight: v.weight, provisional: v.provisional, holder: f.holder?.kind ?? 'student', claimId: f.current.claimId });
  }
  return { priorities, claimIds };
}

function decisionsFrom(view: RecordView): Map<string, { decision: string; reason: string | null; claimId: string }> {
  const out = new Map<string, { decision: string; reason: string | null; claimId: string }>();
  for (const id of view.entityIds('option_decision')) {
    const v = view.value<{ optionRef: string; decision: string; reason: string | null }>('option_decision', id, 'definition');
    const f = view.field('option_decision', id, 'definition');
    if (v && f?.current) out.set(v.optionRef, { decision: v.decision, reason: v.reason, claimId: f.current.claimId });
  }
  return out;
}

const ELIGIBILITY_MAP: Record<string, Candidate['eligibility']['state']> = { apparently_meets: 'supported', conditionally_on_track: 'conditional', requirement_not_met: 'ineligible', unresolved: 'unknown', outside_supported_coverage: 'unknown' };

// ---------------------------------------------------------------- the agent

type Scope<A extends FitScope['action']> = Extract<FitScope, { action: A }>;

export class FitMatcherAgent implements SpecialistAgent {
  readonly role = '12' as const;
  readonly contracts = [FIT_CONTRACT];

  /** Filtering and scoring are deterministic; a model would only explain or clarify. */
  constructor(private readonly model: ModelGateway) {}

  get modelConfigured(): boolean {
    return this.model.configured;
  }

  async handle(ctx: TaskContext) {
    const parsed = FitScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The matching request was incomplete.', 'invalid_scope');
    const s = parsed.data;
    if (s.action === 'decide') return this.decide(ctx, s);
    if (s.action === 'set_priority') return this.setPriority(ctx, s);
    return this.match(ctx, s);
  }

  private empty(action: string, goal: string | null): FitPayload {
    return { action, goal, version: 0, cards: [], more: [], exploration: [], excluded: [], sponsored: [], weights: {}, views: [], sensitivity: null, changes: [], preferenceConflicts: [], gap: null, research: [], tableOnly: false, questions: [], notices: [], recorded: [], admissionProbability: null };
  }

  // ------------------------------------------------------------ match (steps 1-7)

  private async match(ctx: TaskContext, s: Scope<'match'>) {
    const p = this.empty('match', s.goal);
    const view = await readView(ctx, 'local', { entityTypes: ['fit_priority', 'option_decision'] });
    const { priorities: all, claimIds } = prioritiesFrom(view);
    const decisions = decisionsFrom(view);
    const student = all.filter((x) => x.holder === 'student');
    const others = all.filter((x) => x.holder !== 'student');
    // A supporter's priority is shown beside the student's, never applied over it (12T09).
    for (const o of others) {
      const mine = student.find((x) => x.dimension === o.dimension);
      if (!mine || JSON.stringify(mine.value) !== JSON.stringify(o.value) || mine.kind !== o.kind) {
        p.preferenceConflicts.push({ dimension: o.dimension, student: mine?.statement ?? null, supporter: o.statement, question: mine ? `You said “${mine.statement}”, and a supporter said “${o.statement}”. Which should the list follow? It follows yours until you decide.` : `A supporter said “${o.statement}”. Do you want this to be one of your priorities? It is not applied unless you say so.` });
      }
    }
    const hard = student.filter((x) => x.kind === 'hard_constraint' && !x.provisional);
    const { priorities: prefs, merged } = normalizePriorities(student.filter((x) => x.kind === 'preference' || x.provisional).map((x) => (x.provisional ? { ...x, kind: 'preference' as const, weight: x.weight ?? 4 } : x)));
    for (const m of merged) p.notices.push({ code: 'prestige_merged', message: m });
    for (const x of student.filter((y) => y.provisional)) p.notices.push({ code: 'provisional', message: `“${x.statement}” is provisional, so it is treated as a strong preference, not a cutoff.` });
    p.weights = Object.fromEntries(prefs.map((x) => [x.dimension, x.weight ?? 3]));

    // Step 3: candidates from the maintained catalog and from the student, through the same process.
    const candidates: Candidate[] = [];
    const sourceRefs = new Set<string>();
    const interests = student.find((x) => x.dimension === 'academic_interest');
    const wanted = interests ? (Array.isArray(interests.value) ? interests.value : [String(interests.value)]).map((w) => w.replace(/_/g, ' ').toLowerCase()) : [];
    let evidenceFailed = false;
    if (s.useCatalog) {
      const cat = await ctx.call<CatalogEntry[]>('institutions.read', { op: 'catalog', ...(s.countries ? { countries: s.countries } : {}) });
      for (const e of cat) {
        const c = await this.candidateFrom(ctx, e.entity.id, e, s.cycle, 'catalog', s.commercial[e.entity.id] ?? { partner: false, sponsored: false }, sourceRefs).catch(() => null);
        if (!c) {
          evidenceFailed = true;
          continue;
        }
        // Stage 1: broadly relevant programs, without any ranking yet.
        const relevant = wanted.length === 0 || !c.programName || wanted.some((w) => [c.programName!, ...c.aliases].some((n) => n.toLowerCase().includes(w))) || c.attributes['subject_flexibility']?.value === 'high';
        if (relevant) candidates.push(c);
      }
    }
    for (const ci of s.candidates) {
      const r = await ctx.call<Resolution>('institutions.read', { op: 'resolve', institution: ci.institution, campus: ci.campus, program: ci.program });
      if (r.status !== 'resolved') {
        // An unfamiliar institution gets the same evidence requirements: everything starts unknown and is researched (12T12).
        candidates.push({ optionRef: ci.optionRef ?? ci.institution.toLowerCase().replace(/[^a-z0-9]+/g, '_'), entityId: null, name: [ci.program, ci.institution].filter(Boolean).join(' at '), institutionName: ci.institution, country: null, programName: ci.program, aliases: [], suppliedBy: ci.suppliedBy, attributes: {}, access: null, affordability: null, eligibility: { state: 'unknown', ref: null }, commercial: ci.commercial });
        continue;
      }
      const existing = candidates.find((c) => c.entityId === r.entity.id);
      if (existing) {
        existing.suppliedBy = ci.suppliedBy;
        if (ci.optionRef) existing.optionRef = ci.optionRef;
        continue;
      }
      const c = await this.candidateFrom(ctx, r.entity.id, { entity: r.entity, institution: r.institution, campus: r.campus }, s.cycle, ci.suppliedBy, ci.commercial, sourceRefs).catch(() => null);
      if (c) {
        if (ci.optionRef) c.optionRef = ci.optionRef;
        candidates.push(c);
      } else evidenceFailed = true;
    }
    // Affordability (15) and eligibility (06) are carried, never recomputed.
    const afford = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'affordability_scenario' });
    const elig = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'eligibility_finding' });
    const usedArtifacts: string[] = [];
    for (const c of candidates) {
      const a = afford.filter((x) => x.scopeKey === c.optionRef && (x.status === 'current' || x.status === 'stale')).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0];
      if (a) {
        const v = a.payload as { state: 'supported' | 'conditional' | 'gap_identified' | 'unknown'; conditions?: string[] };
        c.affordability = { state: v.state, conditions: v.conditions ?? [], ref: artifactRef(a.id), stale: a.status === 'stale' };
        usedArtifacts.push(artifactRef(a.id));
      }
      if (c.entityId) {
        const e = elig.find((x) => x.status === 'current' && (x.scopeKey.includes(`|${c.entityId}|`) || x.scopeKey.startsWith(`${c.entityId}|`)));
        if (e) {
          c.eligibility = { state: ELIGIBILITY_MAP[(e.payload as { overall: string }).overall] ?? 'unknown', ref: artifactRef(e.id) };
          usedArtifacts.push(artifactRef(e.id));
        }
      }
    }

    // Step 3 (continued): hard constraints before any ranking, in three-valued logic.
    const cards: FitCard[] = [];
    const scoredFeasible: Scored[] = [];
    const exclusionCounts = new Map<string, { source: 'your_choice' | 'institution_rule'; n: number }>();
    for (const c of candidates) {
      if (c.commercial.sponsored) {
        p.sponsored.push({ optionRef: c.optionRef, name: c.name, label: 'sponsored' });
        continue;
      }
      const hardResults = hard.map((h) => {
        const { priorities: [hp] } = normalizePriorities([h]);
        const d = scoreCandidate(c, [hp!]).dims[0]!;
        const result: FitCard['hardConstraints'][number]['result'] = d.match === 'strong' ? 'pass' : d.match === 'weak' ? 'fail' : d.match === 'mixed' ? 'conditional' : 'unknown';
        return { dimension: h.dimension, statement: h.statement, result, why: d.why };
      });
      const scored = scoreCandidate(c, prefs);
      const failed = hardResults.filter((h) => h.result === 'fail');
      const state: FitCard['state'] = failed.length > 0 || c.eligibility.state === 'ineligible' ? 'excluded' : hardResults.some((h) => h.result === 'unknown') || c.entityId === null ? 'exploration' : 'feasible';
      for (const f of failed) exclusionCounts.set(f.statement, { source: 'your_choice', n: (exclusionCounts.get(f.statement)?.n ?? 0) + 1 });
      if (c.eligibility.state === 'ineligible') exclusionCounts.set('Formal entry requirements (checked by the eligibility engine)', { source: 'institution_rule', n: (exclusionCounts.get('Formal entry requirements (checked by the eligibility engine)')?.n ?? 0) + 1 });
      const card = this.card(c, scored, hardResults, state, decisions.get(c.optionRef) ?? null);
      cards.push(card);
      if (state === 'feasible') scoredFeasible.push(scored);
    }
    // Step 4: compare feasible options; ordering uses the worst case so missing evidence cannot lift an option.
    const ranked = order(scoredFeasible);
    const tableOnly = prefs.length === 0 || evidenceFailed;
    if (tableOnly) {
      p.tableOnly = true;
      p.notices.push({ code: 'table_only', message: evidenceFailed ? 'Some evidence could not be retrieved, so no scores are shown; this is a factual comparison of what is known.' : 'You have not set any priorities yet, so no order is suggested; this is a factual comparison. Tell me what matters to you to compare them.' });
    }
    const byRef = new Map(cards.map((c) => [c.optionRef, c]));
    ranked.forEach((sc, i) => {
      const card = byRef.get(sc.candidate.optionRef)!;
      if (tableOnly) {
        card.score = null;
        card.fitBand = null;
        card.notDominated = null;
        return;
      }
      card.rank = i + 1;
      card.notDominated = !ranked.some((o) => o !== sc && dominates(o, sc));
    });
    const feasibleCards = tableOnly ? ranked.map((sc) => byRef.get(sc.candidate.optionRef)!).sort((a, b) => a.name.localeCompare(b.name)) : ranked.map((sc) => byRef.get(sc.candidate.optionRef)!);
    p.cards = feasibleCards.slice(0, s.limit);
    p.more = feasibleCards.slice(s.limit);
    p.exploration = cards.filter((c) => c.state === 'exploration');
    p.excluded = cards.filter((c) => c.state === 'excluded');

    if (!tableOnly && ranked.length > 1) {
      const sens = sensitivity(ranked.map((r) => r.candidate), prefs);
      p.sensitivity = { fragile: sens.fragile, close: sens.close, notes: sens.notes.slice(0, 6).map((n) => `Changing the weight on ${FIT_DIMENSIONS[n.dimension].label} by ${n.change > 0 ? '+1' : '−1'} changes the leading options from ${n.before.join(', ')} to ${n.after.join(', ')}.`) };
      if (sens.fragile || sens.close) p.notices.push({ code: 'close_ranking', message: 'The leading options are close: a small change in your priorities reorders them, so treat the order as a starting point for discussion, not a verdict.' });
      // Evidence that could reverse the order is worth researching (12T14): an option whose best case beats the worst case of the one above it.
      for (let i = 1; i < ranked.length; i += 1) {
        const r = ranked[i]!;
        const above = ranked[i - 1]!;
        if (r.max <= above.min) continue;
        const gaps = r.dims.filter((d) => d.match === 'unknown').sort((a, b) => b.weight - a.weight);
        for (const g of gaps.slice(0, 2)) p.research.push({ optionRef: r.candidate.optionRef, dimension: g.dimension, why: `If ${g.label} turns out well, ${r.candidate.name} could move ahead of ${above.candidate.name}.` });
      }
    }
    for (const c of p.exploration) {
      for (const h of c.hardConstraints.filter((x) => x.result === 'unknown')) p.research.push({ optionRef: c.optionRef, dimension: h.dimension, why: `Your requirement “${h.statement}” is not verified for ${c.name}.` });
      if (c.unit.entityId === null) p.research.push({ optionRef: c.optionRef, dimension: 'catalog', why: `${c.name} is not in the researched catalog yet; it needs the same evidence as every other option.` });
    }
    // Several views of the same list reveal tradeoffs without declaring one "true" profile.
    this.views(p, ranked, prefs);
    // No feasible option: say which constraints create the gap and offer explicit alternatives (12T11).
    if (ranked.length === 0 && cards.length > 0) {
      p.gap = { constraints: [...exclusionCounts].map(([statement, v]) => ({ statement, source: v.source, excluded: v.n })), alternatives: this.alternatives(hard) };
      p.notices.push({ code: 'no_feasible', message: 'No option meets all of your non-negotiables right now. Nothing has been relaxed; the alternatives below are for you to choose from.' });
    }
    if (interests && Array.isArray(interests.value) && interests.value.length > 1) {
      p.notices.push({ code: 'undecided', message: `Options that keep ${interests.value.map((v) => v.replace(/_/g, ' ')).join(' and ')} open are included. Nothing here decides a future career; the list compares routes.` });
      p.questions.push({ code: 'interests', question: `What draws you to ${interests.value.map((v) => v.replace(/_/g, ' ')).join(' and to ')}? Knowing that helps compare programs that let you try both.` });
    }
    for (const c of p.preferenceConflicts) p.questions.push({ code: `conflict_${c.dimension}`, question: c.question });
    if (s.interactionSignals.length > 0) p.notices.push({ code: 'behaviour_not_preference', message: 'Looking at or clicking on options does not change your priorities; only what you tell me does.' });
    if (s.asks.includes('admission_chance')) p.notices.push({ code: 'fit_is_not_chance', message: 'Fit describes how well an option matches what you want. It says nothing about whether you would be admitted; the admissions uncertainty advisor explains what can and cannot be said about that.' });
    const support = student.find((x) => x.dimension === 'support_service');
    if (support) p.notices.push({ code: 'support_need', message: `Your need is described in your own words (“${support.statement}”). No diagnosis or documentation is needed to search; where nothing is published, the question is marked for a direct check with each institution.` });

    // Step 6-7: compare with the previous shortlist and version it.
    const previous = (await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, kind: 'fit_shortlist' })).filter((a) => a.scopeKey === `shortlist_${s.cycle}`).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    p.version = ((previous?.payload as { version?: number } | undefined)?.version ?? 0) + 1;
    if (previous) p.changes = this.changes(previous.payload as StoredShortlist, p);
    const stored: StoredShortlist = { version: p.version, weights: p.weights, cards: [...p.cards, ...p.more].map((c) => ({ optionRef: c.optionRef, rank: c.rank, dims: c.dimensions.map((d) => ({ dimension: d.dimension, match: d.match, sourceRef: d.sourceRef, why: d.why })) })) };
    const artifact = await ctx.call<DerivedArtifact>('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind: 'fit_shortlist',
      scopeKey: `shortlist_${s.cycle}`,
      payload: stored,
      inputClaimIds: [...claimIds, ...[...decisions.values()].map((d) => d.claimId)],
      inputFieldKeys: ['fit_priority:*.definition', 'option_decision:*.definition'],
      sourceIds: [...sourceRefs, ...usedArtifacts],
      recordVersion: view.recordVersion,
    });

    const handoffs: Handoff[] = [];
    const retained = [...p.cards, ...p.more].filter((c) => c.studentDecision?.decision === 'retain');
    if (s.requester !== '14' && (retained.length > 0 || s.goal !== 'test_preference')) handoffs.push({ toRole: '14', reason: retained.length > 0 ? 'The student retained options.' : 'A shortlist is ready for discussion.', requestedOutcome: retained.length > 0 ? 'Build the application portfolio from the retained options and their conditions.' : 'Use the shortlist and its conditions when discussing the portfolio.', inputRefs: [artifactRef(artifact.id)], unresolved: p.exploration.map((c) => c.optionRef), completionCondition: 'Retained options are in the portfolio with their conditions.' });
    if (p.research.length > 0) handoffs.push({ toRole: '11', reason: 'Missing evidence could change the list.', requestedOutcome: `Research ${[...new Set(p.research.map((r) => r.dimension))].join(', ')} for ${[...new Set(p.research.map((r) => r.optionRef))].join(', ')}.`, inputRefs: [...new Set(p.research.map((r) => byRef.get(r.optionRef)?.unit.entityId ?? r.optionRef))], unresolved: [], completionCondition: 'Each gap has official evidence or a recorded unknown.' });
    if (s.asks.includes('admission_chance')) handoffs.push({ toRole: '13', reason: 'The student asked about their chances of admission.', requestedOutcome: 'Explain admissions uncertainty for these options without a personal probability.', inputRefs: [artifactRef(artifact.id)], unresolved: [], completionCondition: 'The student understands what can and cannot be said about admission.' });
    const summary = p.tableOnly
      ? `A factual comparison of ${feasibleCards.length} option${feasibleCards.length === 1 ? '' : 's'}, without scores.`
      : ranked.length === 0
        ? 'No option meets all of your non-negotiables yet.'
        : `${p.cards.length} option${p.cards.length === 1 ? '' : 's'} to discuss${p.more.length > 0 ? ` (${p.more.length} more available)` : ''}, ${p.exploration.length} needing research and ${p.excluded.length} set aside with reasons.`;
    return makeResult(ctx, {
      status: p.questions.length > 0 || p.exploration.length > 0 ? 'partial' : 'completed',
      summary,
      payload: p,
      claimIds: [...claimIds, ...[...decisions.values()].map((d) => d.claimId)],
      recordVersion: view.recordVersion,
      sourceRefs: [...sourceRefs],
      handoffs,
      completionReason: p.tableOnly ? 'comparison_table' : ranked.length === 0 ? 'no_feasible_option' : 'shortlist_ready',
    });
  }

  private async candidateFrom(ctx: TaskContext, entityId: string, e: Pick<CatalogEntry, 'entity' | 'institution' | 'campus'>, cycle: string, suppliedBy: Candidate['suppliedBy'], commercial: Candidate['commercial'], sourceRefs: Set<string>): Promise<Candidate> {
    const read = await ctx.call<ReadClaimsResult>('institutions.read', { op: 'claims', entityId, predicates: ['program_attribute', 'program_access_route'], cycle, includeHistorical: false });
    // The nearest entity's statement wins: a program's own attribute overrides its campus's and institution's.
    const depth = new Map(read.lineage.map((l, i) => [l.id, i]));
    const usable = read.claims.filter((c) => c.status === 'verified' || c.status === 'provisional').sort((a, b) => (depth.get(a.subject.entityId) ?? 9) - (depth.get(b.subject.entityId) ?? 9));
    const attributes: Candidate['attributes'] = {};
    for (const c of usable.filter((x) => x.predicate === 'program_attribute')) {
      const v = c.value as { attribute: string; value: unknown; text: string };
      if (attributes[v.attribute]) continue;
      // The card cites the exact claim version, so a corrected source is recognized as a changed reason (12T16).
      attributes[v.attribute] = { value: v.value, sourceRef: `${claimRef(c.claimId)}@${c.version}`, text: v.text };
      sourceRefs.add(claimRef(c.claimId));
    }
    const ac: ClaimRecord | undefined = usable.find((x) => x.predicate === 'program_access_route');
    let access: Candidate['access'] = null;
    if (ac) {
      const v = ac.value as { route: string; guaranteed: boolean | null; text: string };
      access = { value: v.route, route: v.route, guaranteed: v.guaranteed, sourceRef: `${claimRef(ac.claimId)}@${ac.version}`, text: v.text };
      sourceRefs.add(claimRef(ac.claimId));
    } else if (e.entity.kind === 'program' && e.entity.attributes.accessRoute && e.entity.attributes.accessRoute !== 'unknown') {
      access = { value: e.entity.attributes.accessRoute, route: e.entity.attributes.accessRoute, guaranteed: null, sourceRef: `entity:${e.entity.id}`, text: null };
    }
    return {
      optionRef: entityId,
      entityId,
      name: e.entity.kind === 'program' ? `${e.entity.name} at ${e.institution.name}${e.campus ? ` (${e.campus.name})` : ''}` : e.institution.name,
      institutionName: e.institution.name,
      country: e.institution.country,
      programName: e.entity.kind === 'program' ? e.entity.name : null,
      aliases: e.entity.aliases,
      suppliedBy,
      attributes,
      access,
      affordability: null,
      eligibility: { state: 'unknown', ref: null },
      commercial,
    };
  }

  private card(c: Candidate, sc: Scored, hard: FitCard['hardConstraints'], state: FitCard['state'], decision: { decision: string; reason: string | null } | null): FitCard {
    const strong = sc.dims.filter((d) => d.match === 'strong').sort((a, b) => b.weight - a.weight);
    const weak = sc.dims.filter((d) => d.match === 'weak').sort((a, b) => b.weight - a.weight);
    const unknown = sc.dims.filter((d) => d.match === 'unknown').sort((a, b) => b.weight - a.weight);
    const conditions: string[] = [];
    if (c.access && c.access.route !== 'direct_entry') conditions.push(c.access.route === 'later_competitive_selection' ? 'Entry to the subject is a later competitive selection after admission.' : 'Entry to the subject depends on completing prerequisites.');
    if (c.affordability?.state === 'conditional') conditions.push(`Funding conditional: ${c.affordability.conditions.join(' ') || 'depends on aid that is not confirmed'}.`);
    if (c.eligibility.state === 'conditional') conditions.push('Formal eligibility is conditional on facts or future requirements.');
    for (const h of hard.filter((x) => x.result === 'conditional')) conditions.push(`${h.statement}: ${h.why}`);
    const band = sc.possible === 0 ? null : sc.completeness < 0.5 ? 'incomplete' : sc.min / sc.possible >= 0.66 ? 'strong' : sc.min / sc.possible >= 0.33 ? 'mixed' : 'weak';
    const failed = hard.find((h) => h.result === 'fail');
    return {
      optionRef: c.optionRef,
      name: c.name,
      unit: { institution: c.institutionName, campus: null, program: c.programName, entityId: c.entityId },
      suppliedBy: c.suppliedBy,
      rank: null,
      state,
      eligibility: c.eligibility.state,
      affordability: c.affordability ? (c.affordability.stale ? 'unknown' : c.affordability.state) : 'not_calculated',
      programAccess: c.access ? { route: c.access.route, condition: c.access.route === 'direct_entry' ? 'Direct entry to the subject.' : c.access.route === 'later_competitive_selection' ? 'Admission to the university does not guarantee the subject: students apply to it later, competitively.' : 'Entry depends on completing prerequisites.' } : null,
      hardConstraints: hard,
      dimensions: sc.dims.map((d: DimensionResult) => ({ dimension: d.dimension, label: d.label, match: d.match, why: d.why, sourceRef: d.sourceRef, weight: d.weight })),
      reasons: strong.slice(0, 2).map((d) => d.why),
      drawback: failed ? `Fails your non-negotiable “${failed.statement}”: ${failed.why}` : c.eligibility.state === 'ineligible' ? 'Does not meet the formal entry requirements checked.' : weak[0]?.why ?? conditions[0] ?? null,
      openQuestion: unknown[0] ? unknown[0].why : null,
      conditions,
      score: sc.possible === 0 ? null : { min: sc.min, max: sc.max, possible: sc.possible },
      fitBand: band,
      completeness: Math.round(sc.completeness * 100) / 100,
      notDominated: null,
      disclosure: c.commercial.partner ? 'This institution has a commercial relationship with the app. It does not affect the order.' : null,
      studentDecision: decision ? { decision: decision.decision, reason: decision.reason } : null,
    };
  }

  private views(p: FitPayload, ranked: Scored[], prefs: readonly Priority[]): void {
    const pick = (dims: FitDimension[], view: string, basis: string) => {
      if (!prefs.some((x) => dims.includes(x.dimension))) return;
      const val = (s: Scored) => s.dims.filter((d) => dims.includes(d.dimension)).reduce((a, d) => a + (d.match === 'unknown' ? 0 : d.match === 'strong' ? 2 : d.match === 'mixed' ? 1 : 0), 0);
      const list = [...ranked].sort((a, b) => val(b) - val(a) || b.min - a.min).slice(0, 3).map((s) => s.candidate.optionRef);
      p.views.push({ view, optionRefs: list, basis });
    };
    pick(['max_annual_cost'], 'cost_focused', 'Best on cost in the confirmed scenario.');
    pick(['subject_flexibility', 'academic_interest'], 'academic_flexibility', 'Keeps the most academic options open.');
    pick(['location_countries', 'setting', 'city_size'], 'location_focused', 'Closest to your location preferences.');
  }

  private alternatives(hard: readonly Priority[]): string[] {
    const out: string[] = [];
    const dims = new Set(hard.map((h) => h.dimension));
    if (dims.has('location_countries') || dims.has('setting') || dims.has('city_size')) out.push('Look at a wider set of locations.');
    if (dims.has('academic_interest') || dims.has('direct_program_access')) out.push('Consider a related degree, or a later entry route into your subject.');
    if (dims.has('max_annual_cost')) out.push('Build a revised funding scenario (for example with scholarships you are pursuing), kept separate from confirmed funding.');
    if (out.length === 0) out.push('Review which of your non-negotiables could become a strong preference instead; only you can decide that.');
    return out;
  }

  private changes(prev: StoredShortlist, p: FitPayload): FitPayload['changes'] {
    const out: FitPayload['changes'] = [];
    const now = [...p.cards, ...p.more];
    const weightChanges = Object.keys({ ...prev.weights, ...p.weights }).filter((d) => (prev.weights[d] ?? null) !== (p.weights[d] ?? null)).map((d) => `you changed the weight on ${FIT_DIMENSIONS[d as FitDimension]?.label ?? d} from ${prev.weights[d] ?? 'none'} to ${p.weights[d] ?? 'none'}`);
    const refs = new Set([...prev.cards.map((c) => c.optionRef), ...now.map((c) => c.optionRef)]);
    for (const ref of refs) {
      const before = prev.cards.find((c) => c.optionRef === ref);
      const after = now.find((c) => c.optionRef === ref);
      const because: string[] = [];
      for (const d of after?.dimensions ?? []) {
        const b = before?.dims.find((x) => x.dimension === d.dimension);
        if (b && (b.match !== d.match || b.sourceRef !== d.sourceRef)) because.push(b.sourceRef !== d.sourceRef ? `the evidence for ${d.label} changed (${b.match} → ${d.match}): ${d.why}` : `${d.label} is now ${d.match} (was ${b.match}) because your priority changed`);
      }
      if ((before?.rank ?? null) !== (after?.rank ?? null)) because.push(...weightChanges);
      if (because.length > 0 || (before?.rank ?? null) !== (after?.rank ?? null)) out.push({ optionRef: ref, beforeRank: before?.rank ?? null, afterRank: after?.rank ?? null, because: [...new Set(because)] });
    }
    return out;
  }

  // ------------------------------------------------------------ decisions and priorities

  private async decide(ctx: TaskContext, s: Scope<'decide'>) {
    const p = this.empty('decide', null);
    const view = await readView(ctx, 'local', { entityTypes: ['option_decision'] });
    const claims = s.decisions.map((d) => buildClaim({ entity: 'option_decision', entityId: d.optionRef.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 120), attribute: 'definition', value: { optionRef: d.optionRef, decision: d.decision, reason: d.reason }, origin: 'student_statement', confirmation: ctx.request.actor.kind === 'student' ? 'student_confirmed' : 'unreviewed', evidence: [conversationEvidence(s.conversationId, s.turnId, `${d.decision} ${d.optionRef}${d.reason ? `: ${d.reason}` : ''}`.slice(0, 200), 'text', false)], actor: ctx.request.actor, viaRole: '12' }));
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, 'decisions'), operation: 'add_claims', claims, expectedRecordVersion: view.recordVersion, reason: 'option_decisions' } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', 'Your decisions could not be recorded.', `record_${res.outcome}`);
    p.recorded = s.decisions.map((d) => `${d.optionRef}: ${d.decision}`);
    p.notices.push({ code: 'reversible', message: 'Rejected options stay available with your reasons, so you can reconsider after a budget or interest change.' });
    return makeResult(ctx, { status: 'completed', summary: `Recorded ${s.decisions.length} decision${s.decisions.length === 1 ? '' : 's'}.`, payload: p, recordVersion: res.recordVersion ?? view.recordVersion, completionReason: 'decisions_recorded' });
  }

  private async setPriority(ctx: TaskContext, s: Scope<'set_priority'>) {
    const p = this.empty('set_priority', null);
    if (!s.confirmedByStudent || ctx.request.actor.kind !== 'student') {
      p.notices.push({ code: 'not_confirmed', message: 'A priority is saved only when you confirm it yourself.' });
      return makeResult(ctx, { status: 'needs_student_input', summary: 'Please confirm this priority before it is saved.', payload: p, completionReason: 'confirmation_needed' });
    }
    const view = await readView(ctx, 'local', { entityTypes: ['fit_priority'] });
    const v: FitPriority = { dimension: s.priority.dimension, kind: s.priority.kind, statement: s.priority.statement, value: s.priority.value, weight: s.priority.kind === 'hard_constraint' ? null : s.priority.weight, provisional: s.priority.provisional };
    const claim = buildClaim({ entity: 'fit_priority', entityId: s.priority.dimension, attribute: 'definition', value: v, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [conversationEvidence(s.conversationId, s.turnId, s.priority.statement.slice(0, 200), 'text', false)], actor: ctx.request.actor, viaRole: '12' });
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `priority:${s.priority.dimension}`), operation: 'add_claims', claims: [claim], expectedRecordVersion: view.recordVersion, reason: 'fit_priority' } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', 'The priority could not be recorded.', `record_${res.outcome}`);
    p.recorded = [s.priority.dimension];
    return makeResult(ctx, { status: 'completed', summary: `Saved your priority: ${s.priority.statement}`, payload: p, recordVersion: res.recordVersion ?? view.recordVersion, completionReason: 'priority_recorded' });
  }
}

interface StoredShortlist {
  version: number;
  weights: Record<string, number>;
  cards: Array<{ optionRef: string; rank: number | null; dims: Array<{ dimension: string; match: string; sourceRef: string | null; why: string }> }>;
}
