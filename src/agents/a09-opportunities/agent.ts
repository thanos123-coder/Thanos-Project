import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import type { ExternalActionProposal, Handoff, ResultStatus, Uncertainty } from '../../shared/envelopes.js';
import { AccessDeniedError } from '../../shared/errors.js';
import { findCity, countryName } from '../../shared/places.js';
import { canEstablishConsequentialClaim, type SourceRecord } from '../../shared/sources.js';
import { calendarDateInZone, type CalendarDate } from '../../shared/time.js';
import type { DerivedArtifact } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { mentionsPrivateDetail } from '../a02-intake/parsers.js';
import { StudentFacts } from '../common/student-facts.js';
import { failedResult, makeResult, readView, type SpecialistAgent } from '../common/specialist.js';
import { BriefRequestSchema, readBrief, type Brief, type BriefRequest } from './brief.js';
import { opportunityRef, type CatalogQueryResult, type Lead, type Opportunity } from './catalog.js';
import { readLeadPage } from './extract.js';
import { ADMISSIONS_NOTE, evaluateOpportunity, promoteShortlisted, refreshActionReadiness, type OptionEvaluation } from './match.js';
import { noResult, rankAndShortlist, routeIdeas, type NoResult, type RankedOption, type RouteIdea, type Shortlist } from './rank.js';
import type { GeneralizedQueryInput } from './research.js';
import type { SearchOutcome } from './tools.js';
import type { FetchOutcome } from './research.js';
import { topicLabel } from './topics.js';

/**
 * Agent 09 — Opportunity research scout.
 *
 * Finds opportunities a student can realistically access and explains why each
 * may be useful: a verified dossier and a transparent match to the student's
 * own goals and constraints. A good result can be three well-supported
 * options, a local alternative, or an honest finding that nothing verified
 * fits. It never applies, contacts an organizer, pays, enrolls or arranges a
 * meeting: contact is only ever proposed for explicit approval (09T16).
 */

const NotifySchema = z.enum(['material_changes', 'all_changes', 'none']);

export const OpportunityScopeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('shortlist'), request: BriefRequestSchema }).strict(),
  z.object({ action: z.literal('dossier'), opportunityId: z.string().regex(/^[a-z0-9_]+$/), request: BriefRequestSchema.default(BriefRequestSchema.parse({})), question: z.enum(['details', 'worth_it']).default('details') }).strict(),
  z.object({ action: z.literal('save'), opportunityId: z.string().regex(/^[a-z0-9_]+$/), request: BriefRequestSchema.default(BriefRequestSchema.parse({})), notify: NotifySchema.default('material_changes') }).strict(),
  z.object({ action: z.literal('refresh_saved'), savedId: z.string().min(1), request: BriefRequestSchema.default(BriefRequestSchema.parse({})) }).strict(),
  z
    .object({
      action: z.literal('prepare_contact'),
      opportunityId: z.string().regex(/^[a-z0-9_]+$/),
      /** The student's own questions; when empty, questions are drafted from what the organizer alone can answer. */
      questions: z.array(z.string().min(3).max(300)).max(5).default([]),
      signature: z.string().min(1).max(80).optional(),
      request: BriefRequestSchema.default(BriefRequestSchema.parse({})),
    })
    .strict(),
]);
export type OpportunityScope = z.infer<typeof OpportunityScopeSchema>;

export type OptionCard = OptionEvaluation & {
  ranking: { score: number; dimensions: RankedOption['features']; why: string[]; watchOuts: string[]; includedAs: RankedOption['includedAs']; alsoListedAs: string[] } | null;
};

export interface LeadView {
  leadId: string;
  title: string;
  url: string;
  publisher: string | null;
  state: 'discovered';
  howFound: string;
  pageSays: Array<{ field: string; quote: string }>;
  cycleNote: string;
  /** Always null: a lead never carries a current deadline (09T01). */
  currentDeadline: null;
  stillToCheck: string[];
}

export interface OpportunityPayload {
  action: OpportunityScope['action'];
  brief: {
    topics: string[];
    topicsFrom: Brief['topicsFrom'];
    categories: string[];
    hardConstraints: string[];
    preferences: string[];
    location: string | null;
  };
  shortlist: { feasibleNow: OptionCard[]; conditional: OptionCard[]; moreFromSameOrganizer: Shortlist['moreFromSameOrganizer'] } | null;
  alsoConsidered: Array<{ opportunityId: string; title: string; bucket: string; reasons: string[] }>;
  leads: LeadView[];
  noResult: NoResult | null;
  alternatives: RouteIdea[];
  questions: Array<{ question: string; why: string; affects: string[] }>;
  dossier: OptionCard | null;
  worthIt: { thisOption: { title: string; cost: string; learningEvidence: string; activities: string[]; credential: string }; alternatives: Array<{ opportunityId: string; title: string; cost: string; learningEvidence: string; bucket: string }>; ideas: RouteIdea[]; note: string } | null;
  saved: { savedId: string; opportunityId: string; catalogVersion: number; notify: z.infer<typeof NotifySchema>; savedAt: string; monitoring: string; evaluation: OptionCard } | null;
  changes: { previousSavedId: string; previousVersion: number; version: number; summary: string[]; material: boolean; notify: { send: boolean; reason: string } } | null;
  contactDraft: { destination: string; organizer: string; exactContent: string; proposalId: string; sent: false } | null;
  coverage: string;
  searchLog: Array<{ queryText: string; results: number }>;
  notices: Array<{ code: string; message: string }>;
  externalActionsTaken: false;
}

const CardSchema = z.custom<OptionCard>((v) => !!v && typeof v === 'object' && typeof (v as OptionCard).opportunityId === 'string' && Array.isArray((v as OptionCard).unresolved));

export const OpportunityPayloadSchema = z
  .object({
    action: z.enum(['shortlist', 'dossier', 'save', 'refresh_saved', 'prepare_contact']),
    brief: z.object({ topics: z.array(z.string()), topicsFrom: z.string(), categories: z.array(z.string()), hardConstraints: z.array(z.string()), preferences: z.array(z.string()), location: z.string().nullable() }).strict(),
    shortlist: z.object({ feasibleNow: z.array(CardSchema), conditional: z.array(CardSchema), moreFromSameOrganizer: z.array(z.object({ organizer: z.string(), count: z.number() }).strict()) }).strict().nullable(),
    alsoConsidered: z.array(z.object({ opportunityId: z.string(), title: z.string(), bucket: z.string(), reasons: z.array(z.string()) }).strict()),
    leads: z.array(z.custom<LeadView>((v) => !!v && typeof v === 'object' && (v as LeadView).state === 'discovered' && (v as LeadView).currentDeadline === null)),
    noResult: z.custom<NoResult>().nullable(),
    alternatives: z.array(z.custom<RouteIdea>((v) => !!v && typeof v === 'object' && (v as RouteIdea).verifiedProgram === false)),
    questions: z.array(z.object({ question: z.string(), why: z.string(), affects: z.array(z.string()) }).strict()),
    dossier: CardSchema.nullable(),
    worthIt: z.custom<OpportunityPayload['worthIt']>().nullable(),
    saved: z.custom<OpportunityPayload['saved']>().nullable(),
    changes: z.custom<OpportunityPayload['changes']>().nullable(),
    contactDraft: z.object({ destination: z.string(), organizer: z.string(), exactContent: z.string(), proposalId: z.string(), sent: z.literal(false) }).strict().nullable(),
    coverage: z.string(),
    searchLog: z.array(z.object({ queryText: z.string(), results: z.number() }).strict()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    externalActionsTaken: z.literal(false),
  })
  .strict();

const GUARANTEE = /\b(guarantee[ds]?|guaranteed admission|will (get you|definitely get) (in|admitted)|certain to be (admitted|accepted)|boosts? your (admission )?chances)\b/i;
const NEGATED = /\b(no (program|one) can guarantee|cannot guarantee|can'?t guarantee|not guaranteed|does not guarantee|no guarantee|not evidence of an admissions advantage)\b/i;
const EVASION = /\b(lie about|misstate|use (an|a) (older|different) (birth ?date|age)|pretend to be|claim (to be|you are) older|work ?around the (age|rule)|get around the (age|rule)|ask for an (age )?exception)\b/i;

function allCards(p: OpportunityPayload): OptionCard[] {
  return [...(p.shortlist?.feasibleNow ?? []), ...(p.shortlist?.conditional ?? []), ...(p.dossier ? [p.dossier] : []), ...(p.saved ? [p.saved.evaluation] : [])];
}

export const OPPORTUNITY_CONTRACT: ContractDefinition<OpportunityPayload> = {
  id: 'opportunity_dossier_v1',
  role: '09',
  payload: OpportunityPayloadSchema as unknown as z.ZodType<OpportunityPayload>,
  semantic: (p, result) => {
    const issues: string[] = [];
    for (const c of p.shortlist?.feasibleNow ?? []) if (c.bucket !== 'feasible_now') issues.push(`${c.opportunityId} is listed as currently feasible but is ${c.bucket}`);
    for (const c of p.shortlist?.conditional ?? []) if (c.bucket !== 'conditional') issues.push(`${c.opportunityId} is listed as conditional but is ${c.bucket}`);
    for (const c of allCards(p)) {
      const id = c.opportunityId;
      if (c.actionReady) {
        if (c.actionReadyBlockers.length > 0) issues.push(`${id} is action ready with open blockers`);
        if (c.deadline?.kind === 'deadline' && c.deadline.instantUtc === null) issues.push(`${id} is action ready without an exact deadline`);
        if (c.eligibility.state !== 'appears_met') issues.push(`${id} is action ready with eligibility ${c.eligibility.state}`);
        if (!c.cost || (c.cost.verdict !== 'free' && c.cost.verdict !== 'within_budget') || c.cost.unknownComponents.length > 0) issues.push(`${id} is action ready without settled costs`);
        if (c.concerns.some((x) => x.pause) || c.safety.some((x) => x.pause)) issues.push(`${id} is action ready despite a concern that needs review`);
        if (!c.route.direct) issues.push(`${id} is action ready although entry is through another route`);
        if (c.cycle?.status !== 'open') issues.push(`${id} is action ready although applications are not open`);
      }
      // A missing deadline timezone stays unresolved (09T08).
      if (c.deadline?.kind === 'deadline' && c.deadline.published?.timezone === null && !c.unresolved.some((u) => u.code === 'deadline_timezone')) issues.push(`${id} has a deadline without a timezone that is not marked unresolved`);
      // Aid is never counted (09T05); "free" means every required cost is known and zero.
      if (c.cost?.verdict === 'free' && (c.cost.unknownComponents.length > 0 || c.cost.knownTotals.some((m) => Number(m.amount) !== 0))) issues.push(`${id} is called free although it has costs`);
      if (c.bucket === 'unannounced' && c.deadline !== null) issues.push(`${id} has no announced cycle but carries a deadline`);
      if (c.eligibility.conditions.some((x) => x.state === 'not_met' && x.question !== null && /\bage\b/i.test(x.explanation))) issues.push(`${id} offers a question about an age restriction it does not meet`);
      for (const t of [...(c.ranking?.why ?? []), c.nextAction.text]) if (GUARANTEE.test(t) && !NEGATED.test(t)) issues.push(`${id} presents a guarantee as fact`);
      if (c.bucket === 'excluded' && EVASION.test(JSON.stringify(c))) issues.push(`${id} suggests a way around a rule`);
    }
    const leadIds = new Set(p.leads.map((l) => l.leadId));
    for (const c of allCards(p)) if (leadIds.has(c.opportunityId)) issues.push(`${c.opportunityId} is both a lead and a verified option`);
    for (const n of p.notices) if (GUARANTEE.test(n.message) && !NEGATED.test(n.message)) issues.push('a notice presents a guarantee as fact');
    if (GUARANTEE.test(result.summary) && !NEGATED.test(result.summary)) issues.push('the summary presents a guarantee as fact');
    if (p.contactDraft && result.externalActions.length === 0) issues.push('a contact draft must be proposed for approval, not sent');
    return issues;
  },
};

const LOCAL_ENTITIES = ['student', 'interest', 'preference', 'hypothesis', 'commitment', 'age_attestation', 'course', 'qualification'];
const MAX_FINALIST_CHECKS = 3;
const MAX_NEW_LEADS = 4;
const MAX_LEAD_READS = 2;

interface Context {
  view: RecordView;
  brief: Brief;
  facts: StudentFacts;
  today: CalendarDate;
}

export class OpportunityScoutAgent implements SpecialistAgent {
  readonly role = '09' as const;
  readonly contracts = [OPPORTUNITY_CONTRACT];

  constructor(private readonly model: ModelGateway) {}

  async handle(ctx: TaskContext) {
    const parsed = OpportunityScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The opportunity request was incomplete.', 'invalid_scope');
    try {
      const s = parsed.data;
      switch (s.action) {
        case 'shortlist':
          return await this.shortlist(ctx, s.request);
        case 'dossier':
          return await this.dossier(ctx, s);
        case 'save':
          return await this.save(ctx, s);
        case 'refresh_saved':
          return await this.refreshSaved(ctx, s);
        case 'prepare_contact':
          return await this.prepareContact(ctx, s);
      }
    } catch (e) {
      if (e instanceof AccessDeniedError) return failedResult(ctx, 'blocked', 'That is not available with the current permissions.', e.code);
      throw e;
    }
  }

  // ---------------------------------------------------------------- shared steps

  private async load(ctx: TaskContext, req: BriefRequest): Promise<Context> {
    // Local view: sensitive conditions are evaluated here and never leave the agent.
    const view = await readView(ctx, 'local', { entityTypes: LOCAL_ENTITIES });
    const brief = readBrief(view, req);
    const today = calendarDateInZone(ctx.clock.nowIso(), brief.timezone ?? 'UTC');
    return { view, brief, facts: new StudentFacts(view), today };
  }

  private async readCatalog(ctx: TaskContext, brief: Brief, ids?: readonly string[]): Promise<CatalogQueryResult> {
    const args: Record<string, unknown> = { topics: brief.topics.slice(0, 12), categories: brief.categories };
    // Only narrow by country when the student cannot travel away from home anyway.
    if (brief.travel?.overnightTravelPossible !== true) args['country'] = brief.location?.country ?? brief.residenceCountry ?? null;
    if (ids) args['ids'] = ids;
    return ctx.call<CatalogQueryResult>('opportunities.read_catalog', ids ? { ids } : args);
  }

  private evaluateAll(c: Context, catalog: CatalogQueryResult, nowIso: string): OptionEvaluation[] {
    const sources = new Map<string, SourceRecord>(catalog.sources.map((s) => [s.id, s]));
    const usable = (id: string | null) => {
      if (!id) return false;
      const s = sources.get(id);
      return !!s && canEstablishConsequentialClaim(s);
    };
    return catalog.opportunities.map((o) => evaluateOpportunity(o, c.brief, c.facts, { today: c.today, nowIso, sources, usable }));
  }

  /** Reopen the decisive official page of shortlisted options (09R12). */
  private async verifyFinalists(ctx: TaskContext, cards: readonly OptionEvaluation[], catalog: CatalogQueryResult): Promise<string[]> {
    const notes: string[] = [];
    if (!ctx.request.allowedTools.includes('research.fetch_public')) return notes;
    for (const e of cards.slice(0, MAX_FINALIST_CHECKS)) {
      const o = catalog.opportunities.find((x) => x.id === e.opportunityId);
      const cycle = o?.cycles.find((c) => c.id === e.cycle?.id);
      const source = cycle ? catalog.sources.find((s) => s.id === cycle.sourceId) : undefined;
      if (!o || !cycle || !source) continue;
      const r = await ctx.tryCall<FetchOutcome>('research.fetch_public', { url: source.canonicalUrl });
      if (!r.ok) break;
      const f = r.value;
      if (!f.accessible && f.reason === 'not_configured') break;
      let outcome: 'unchanged' | 'changed' | 'inaccessible';
      if (!f.accessible) {
        outcome = 'inaccessible';
        e.verification = { status: 'page_inaccessible', text: `The official page could not be reopened today (${f.detail}) Details were last checked ${cycle.retrievedAt.slice(0, 10)}; please confirm them on the organizer’s site.`, checkedAt: cycle.retrievedAt };
      } else if (f.contentHash === source.contentHash) {
        outcome = 'unchanged';
        e.verification = { status: 'reverified_unchanged', text: `The official page was reopened today and matches the reviewed version.`, checkedAt: f.retrievedAt };
      } else {
        outcome = 'changed';
        e.verification = { status: 'page_changed', text: 'The official page has changed since it was reviewed, so dates, costs or conditions may be different now.', checkedAt: f.retrievedAt };
        e.unresolved.push({ code: 'verification', text: e.verification.text, question: null, owner: 'catalog_team', material: true });
        if (e.bucket === 'feasible_now') {
          e.bucket = 'conditional';
          e.state = 'feasibility_assessed';
        }
      }
      await ctx.tryCall('opportunities.upsert_catalog', { kind: 'observation', opportunityId: o.id, sourceId: source.id, outcome });
      refreshActionReadiness(e);
      promoteShortlisted(e);
      if (outcome !== 'unchanged') notes.push(`${e.title}: ${e.verification.text}`);
    }
    return notes;
  }

  /** Staged discovery of new public leads with generalized queries (09R02, 09R03, 09T13). */
  private async discover(ctx: TaskContext, c: Context, catalog: CatalogQueryResult): Promise<{ leads: Lead[]; log: OpportunityPayload['searchLog']; ran: boolean }> {
    const log: OpportunityPayload['searchLog'] = [];
    if (!ctx.request.allowedTools.includes('research.search_public')) return { leads: [], log, ran: false };
    const b = c.brief;
    const stage = c.view.studentValue<string>('education.stage');
    const city = b.location?.city && findCity(b.location.city)?.city.toLowerCase() === b.location.city.trim().toLowerCase() ? findCity(b.location.city)!.city : null;
    const lowCost = !b.budget || b.aidNeeded === 'yes' || Number(b.budget.amount.amount) <= 300;
    const base: GeneralizedQueryInput = {
      topics: b.topics.slice(0, 3),
      categories: b.categories.slice(0, 3),
      country: b.format.required === 'online' ? null : b.location?.country ?? null,
      city: b.format.required === 'online' ? null : city,
      format: b.format.required ?? 'any',
      audience: stage === 'secondary' ? 'secondary_students' : stage === 'completed_secondary' || stage === 'gap_year' ? 'recent_graduates' : 'young_people',
      costFocus: lowCost ? 'free_or_low_cost' : 'any',
      year: Number((b.windows[0]?.start ?? c.today).slice(0, 4)),
    };
    // Low-cost coverage is intentional: the second query looks for free options even when money is not tight.
    const queries: GeneralizedQueryInput[] = [base, ...(base.costFocus === 'any' ? [{ ...base, costFocus: 'free_or_low_cost' as const }] : [])];
    const hits: SearchOutcome['results'] = [];
    let ran = false;
    for (const q of queries) {
      const r = await ctx.tryCall<SearchOutcome>('research.search_public', { query: q });
      if (!r.ok || !r.value.available) break;
      ran = true;
      log.push({ queryText: r.value.queryText, results: r.value.results.length });
      for (const h of r.value.results) if (!hits.some((x) => x.url === h.url)) hits.push(h);
    }
    const leads: Lead[] = [];
    let reads = 0;
    for (const h of hits) {
      if (leads.length >= MAX_NEW_LEADS) break;
      if (catalog.leads.some((l) => l.url === h.url)) continue;
      let pageSays: Array<{ field: string; quote: string }> = [];
      let pastCycleOnly: boolean | null = null;
      let injectionSignals: string[] = [];
      if (reads < MAX_LEAD_READS && ctx.request.allowedTools.includes('research.fetch_public')) {
        reads += 1;
        const f = await ctx.tryCall<FetchOutcome>('research.fetch_public', { url: h.url });
        if (f.ok && f.value.accessible) {
          const reading = await readLeadPage(this.model, ctx, { url: h.url, text: f.value.text }, c.today);
          pageSays = reading.pageSays;
          pastCycleOnly = reading.pastCycleOnly;
          injectionSignals = f.value.injectionSignals;
        }
      }
      const r = await ctx.tryCall<{ status: string; lead?: Lead }>('opportunities.upsert_catalog', {
        kind: 'lead',
        lead: { title: h.title, url: h.url, publisher: h.publisher, snippet: h.snippet, discoveredVia: 'search', topics: b.topics.slice(0, 6), category: b.categories[0] ?? null, pageSays, pastCycleOnly, injectionSignals },
      });
      if (r.ok && r.value.lead) leads.push(r.value.lead);
    }
    return { leads, log, ran };
  }

  private coverageText(catalog: CatalogQueryResult): string {
    const cov = catalog.coverage;
    if (!cov) return 'The opportunity catalog has no coverage statement, so the search boundary is unclear.';
    return `Curated catalog covering ${cov.countries.map(countryName).join(', ') || 'no countries'}${cov.includesOnline ? ' and online options' : ''}, for ${cov.categories.map((c) => c.replace(/_/g, ' ')).join(', ')}; maintained by ${cov.maintainedBy}, last reviewed ${cov.lastReviewedAt.slice(0, 10)}. This is not every opportunity that exists.`;
  }

  private briefView(b: Brief): OpportunityPayload['brief'] {
    return {
      topics: b.topics.map(topicLabel),
      topicsFrom: b.topicsFrom,
      categories: b.categories.map((c) => c.replace(/_/g, ' ')),
      hardConstraints: b.hardConstraints,
      preferences: b.preferences,
      location: b.location ? [b.location.city, b.location.region, countryName(b.location.country)].filter(Boolean).join(', ') : null,
    };
  }

  private emptyPayload(action: OpportunityScope['action'], b: Brief, coverage: string): OpportunityPayload {
    return { action, brief: this.briefView(b), shortlist: null, alsoConsidered: [], leads: [], noResult: null, alternatives: [], questions: [], dossier: null, worthIt: null, saved: null, changes: null, contactDraft: null, coverage, searchLog: [], notices: [], externalActionsTaken: false };
  }

  private questionsFrom(b: Brief, cards: readonly OptionEvaluation[]): OpportunityPayload['questions'] {
    const out = new Map<string, { question: string; why: string; affects: string[] }>();
    for (const m of b.missing.filter((x) => !x.blocking)) out.set(m.question, { question: m.question, why: m.why, affects: [] });
    for (const e of cards) {
      for (const u of e.unresolved) {
        if (!u.question || !u.material || u.owner !== 'student') continue;
        const q = out.get(u.question) ?? { question: u.question, why: u.text, affects: [] };
        if (!q.affects.includes(e.opportunityId)) q.affects.push(e.opportunityId);
        out.set(u.question, q);
      }
    }
    return [...out.values()].slice(0, 8);
  }

  private card(e: OptionEvaluation, r?: RankedOption): OptionCard {
    return { ...e, ranking: r ? { score: r.score, dimensions: r.features, why: r.why, watchOuts: r.watchOuts, includedAs: r.includedAs, alsoListedAs: r.alsoListedAs } : null };
  }

  private leadView(l: Lead): LeadView {
    const cycleNote = l.pastCycleOnly === true ? 'This page describes a cycle that has already happened. No current dates are known, and none are estimated from it.' : 'Whether this listing is current has not been verified.';
    const stillToCheck = ['Who runs it (the organizer’s own site, not only a listing)', 'Whether there is a current cycle, and its dates and deadline with timezone', 'Who is eligible', 'The full cost, including travel', 'What participants actually do'];
    if (l.pageSays.some((p) => p.field === 'admission_claim')) stillToCheck.push('The page makes claims about admission; no program can guarantee admission');
    if (l.injectionSignals.length > 0) stillToCheck.push('The page contains text addressed to automated systems; it was treated as data only');
    return { leadId: l.id, title: l.title, url: l.url, publisher: l.publisher, state: 'discovered', howFound: l.discoveredVia === 'search' ? 'Found through a public search' : 'Found on a third-party list', pageSays: l.pageSays, cycleNote, currentDeadline: null, stillToCheck };
  }

  private servedClaims(ctx: TaskContext, ...lists: ReadonlyArray<readonly string[]>): string[] {
    return [...new Set(lists.flat())].filter((id) => ctx.servedClaimIds.has(id));
  }

  private servedSources(ctx: TaskContext, cards: readonly OptionEvaluation[]): string[] {
    return [...new Set(cards.flatMap((c) => c.sourceIds))].filter((id) => ctx.servedSourceIds.has(id));
  }

  private async store(ctx: TaskContext, c: Context, kind: string, scopeKey: string, payload: unknown, cards: readonly OptionEvaluation[], opportunityIds: readonly string[]): Promise<Pick<DerivedArtifact, 'id' | 'status'>> {
    return ctx.call<Pick<DerivedArtifact, 'id' | 'status'>>('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind,
      scopeKey,
      payload,
      inputClaimIds: this.servedClaims(ctx, c.brief.claimIds, ...cards.map((x) => x.claimIds)),
      inputFieldKeys: [...new Set([...c.brief.fieldKeys, ...cards.flatMap((x) => x.fieldKeys)])],
      // A curated change to any of these opportunities makes the stored result stale (09R14, 09T15).
      sourceIds: [...new Set([...opportunityIds.map(opportunityRef), ...this.servedSources(ctx, cards)])],
      recordVersion: c.view.recordVersion,
    });
  }

  // ---------------------------------------------------------------- actions

  private async shortlist(ctx: TaskContext, req: BriefRequest) {
    const c = await this.load(ctx, req);
    const b = c.brief;
    const blocking = b.missing.filter((m) => m.blocking);
    if (blocking.length > 0) {
      const payload = this.emptyPayload('shortlist', b, 'No search was run yet.');
      payload.questions = b.missing.map((m) => ({ question: m.question, why: m.why, affects: [] }));
      if (b.prestigeFraming) payload.notices.push({ code: 'goal_first', message: 'A famous name or a high fee is not a measure of what you would learn. Knowing what you want to learn or contribute makes it possible to find something that is actually worth your time.' });
      return makeResult(ctx, { status: 'needs_student_input', summary: 'Before searching, one question: what would you like to learn, make or contribute?', payload, claimIds: this.servedClaims(ctx, b.claimIds), recordVersion: c.view.recordVersion, completionReason: 'learning_goal_needed' });
    }

    const catalog = await this.readCatalog(ctx, b);
    const nowIso = ctx.clock.nowIso();
    const evaluations = this.evaluateAll(c, catalog, nowIso);
    const { shortlist } = rankAndShortlist(evaluations, b);
    const finalists = [...shortlist.feasibleNow, ...shortlist.conditional].map((r) => r.evaluation);
    const verificationNotes = await this.verifyFinalists(ctx, finalists, catalog);
    // Verification can move an option from "feasible now" to "conditional".
    const picked = [...shortlist.feasibleNow, ...shortlist.conditional];
    const feasibleNow = picked.filter((r) => r.evaluation.bucket === 'feasible_now');
    const conditional = picked.filter((r) => r.evaluation.bucket === 'conditional');

    let discovery: Awaited<ReturnType<OpportunityScoutAgent['discover']>> = { leads: [], log: [], ran: false };
    if (req.discover && feasibleNow.length < 2) discovery = await this.discover(ctx, c, catalog);
    const leads = [...new Map([...catalog.leads, ...discovery.leads].map((l) => [l.id, l])).values()].map((l) => this.leadView(l));

    const coverage = this.coverageText(catalog);
    const payload = this.emptyPayload('shortlist', b, coverage);
    payload.shortlist = { feasibleNow: feasibleNow.map((r) => this.card(r.evaluation, r)), conditional: conditional.map((r) => this.card(r.evaluation, r)), moreFromSameOrganizer: shortlist.moreFromSameOrganizer };
    const pickedIds = new Set(picked.map((r) => r.evaluation.opportunityId));
    payload.alsoConsidered = evaluations
      .filter((e) => !pickedIds.has(e.opportunityId))
      .map((e) => ({ opportunityId: e.opportunityId, title: e.title, bucket: e.bucket, reasons: e.bucket === 'excluded' ? e.failures.map((f) => f.text) : e.bucket === 'conditional' || e.bucket === 'feasible_now' ? ['Ranked below the options shown.'] : [e.cycleNote ?? e.nextAction.text] }));
    payload.leads = leads;
    payload.searchLog = discovery.log;
    payload.questions = this.questionsFrom(b, finalists);
    const top = feasibleNow[0] ?? conditional[0];
    const expensiveOrUncertain = !top || top.features.cost !== 'free' || top.evaluation.bucket === 'conditional';
    if (expensiveOrUncertain) payload.alternatives = routeIdeas(b);
    if (picked.length === 0) {
      payload.noResult = noResult(evaluations, b, coverage, discovery.ran ? `A public search found ${leads.length} unverified lead${leads.length === 1 ? '' : 's'}, listed separately.` : 'No public search was run.');
      payload.alternatives = payload.noResult.alternatives;
    }
    for (const n of verificationNotes) payload.notices.push({ code: 'verification', message: n });
    payload.notices.push({ code: 'admissions', message: ADMISSIONS_NOTE });
    if (leads.length > 0) payload.notices.push({ code: 'leads_unverified', message: 'Leads found through search are listed separately. They have not been checked against the organizer’s own pages, so they are not recommendations.' });

    const cards = [...feasibleNow, ...conditional].map((r) => r.evaluation);
    const artifact = await this.store(ctx, c, 'opportunity_shortlist', 'opportunity_shortlist', payload, cards, evaluations.map((e) => e.opportunityId));

    const handoffs: Handoff[] = [];
    const studentQuestions = payload.questions.filter((q) => q.affects.length > 0);
    if (studentQuestions.length > 0) handoffs.push({ toRole: '02', reason: 'Some options depend on facts only the student can give.', requestedOutcome: 'Ask these targeted questions and record the answers.', inputRefs: [`artifact:${artifact.id}`], unresolved: studentQuestions.map((q) => q.question).slice(0, 6), completionCondition: 'Each question is answered, declined, or marked unknown.' });
    if (cards.some((e) => e.unresolved.some((u) => u.material && u.owner === 'qualified_adult'))) handoffs.push({ toRole: '34', reason: 'An option raises a legitimacy or safety concern that needs a qualified adult.', requestedOutcome: 'Review the concern with the student and a parent, guardian or school counselor before any action.', inputRefs: cards.filter((e) => e.unresolved.some((u) => u.owner === 'qualified_adult')).map((e) => `opportunity:${e.opportunityId}`), unresolved: [], completionCondition: 'A qualified adult has reviewed the concern.' });

    const uncertainties: Uncertainty[] = cards
      .flatMap((e) => e.unresolved.filter((u) => u.material).slice(0, 2).map((u) => ({ affects: `opportunity:${e.opportunityId}`, description: u.text.length >= 10 ? u.text : `${e.title}: ${u.text}`, resolution: u.question ?? (u.owner === 'organizer' ? 'Ask the organizer or check the official page.' : 'Review with a qualified adult.'), consequence: 'changes_decision' as const })))
      .slice(0, 20);
    const status: ResultStatus = picked.length === 0 ? 'completed' : feasibleNow.length > 0 ? 'completed' : 'partial';
    const summary = picked.length === 0
      ? 'No verified opportunity currently meets all of your constraints. The search boundary, the reasons options dropped out and other routes are listed.'
      : [
          feasibleNow.length > 0 ? `Fits now: ${feasibleNow.map((r) => `${r.evaluation.title}${r.evaluation.actionReady ? ' (ready for you to review)' : ''}`).join('; ')}.` : 'Nothing fits fully yet.',
          conditional.length > 0 ? `Conditional: ${conditional.map((r) => r.evaluation.title).join('; ')}.` : '',
          leads.length > 0 ? `${leads.length} unverified lead${leads.length === 1 ? '' : 's'} listed separately.` : '',
        ].filter(Boolean).join(' ');
    return makeResult(ctx, {
      status,
      summary,
      payload,
      claimIds: this.servedClaims(ctx, b.claimIds, ...cards.map((e) => e.claimIds)),
      recordVersion: c.view.recordVersion,
      sourceRefs: this.servedSources(ctx, cards),
      uncertainties,
      handoffs,
      completionReason: picked.length === 0 ? 'no_verified_match' : 'shortlisted',
    });
  }

  private async one(ctx: TaskContext, c: Context, id: string): Promise<{ catalog: CatalogQueryResult; o: Opportunity; e: OptionEvaluation } | null> {
    const catalog = await this.readCatalog(ctx, c.brief, [id]);
    const o = catalog.opportunities.find((x) => x.id === id);
    if (!o) return null;
    const [e] = this.evaluateAll(c, { ...catalog, opportunities: [o] }, ctx.clock.nowIso());
    return { catalog, o, e: e! };
  }

  private async dossier(ctx: TaskContext, s: Extract<OpportunityScope, { action: 'dossier' }>) {
    const c = await this.load(ctx, s.request);
    const found = await this.one(ctx, c, s.opportunityId);
    if (!found) return failedResult(ctx, 'failed', 'That opportunity is not in the verified catalog.', 'unknown_opportunity');
    const { catalog, e } = found;
    const notes = await this.verifyFinalists(ctx, [e], catalog);
    const payload = this.emptyPayload('dossier', c.brief, this.coverageText(catalog));
    payload.dossier = this.card(e);
    for (const n of notes) payload.notices.push({ code: 'verification', message: n });
    let cards: OptionEvaluation[] = [e];
    if (s.question === 'worth_it') {
      // Compare actual learning and practical value against alternatives at the stated cost (09 "Learning value and admissions claims").
      const others = await this.readCatalog(ctx, { ...c.brief, topics: c.brief.topics.length > 0 ? c.brief.topics : found.o.topics });
      const alts = this.evaluateAll(c, { ...others, opportunities: others.opportunities.filter((x) => x.id !== e.opportunityId) }, ctx.clock.nowIso())
        .filter((x) => x.bucket === 'feasible_now' || x.bucket === 'conditional')
        .sort((a, b) => costRank(a) - costRank(b) || a.title.localeCompare(b.title))
        .slice(0, 3);
      cards = [e, ...alts];
      payload.worthIt = {
        thisOption: { title: e.title, cost: costText(e), learningEvidence: e.value.learningEvidence.replace(/_/g, ' '), activities: e.value.activities, credential: e.value.credential },
        alternatives: alts.map((a) => ({ opportunityId: a.opportunityId, title: a.title, cost: costText(a), learningEvidence: a.value.learningEvidence.replace(/_/g, ' '), bucket: a.bucket })),
        ideas: routeIdeas(c.brief),
        note: `Whether it is worth it depends on what you would actually do and learn compared with these alternatives, not on its name or price. ${ADMISSIONS_NOTE}`,
      };
    }
    payload.questions = this.questionsFrom(c.brief, [e]);
    return makeResult(ctx, {
      status: e.unresolved.some((u) => u.material) ? 'partial' : 'completed',
      summary: `${e.title}: ${e.bucket === 'feasible_now' ? 'fits your constraints as far as is known' : e.bucket === 'conditional' ? 'possible, with open conditions' : e.nextAction.text}.`,
      payload,
      claimIds: this.servedClaims(ctx, c.brief.claimIds, ...cards.map((x) => x.claimIds)),
      recordVersion: c.view.recordVersion,
      sourceRefs: this.servedSources(ctx, cards),
      completionReason: 'dossier',
    });
  }

  private monitoringText(notify: z.infer<typeof NotifySchema>): string {
    return `Changes to this opportunity's dates, status, eligibility, costs or safety information will mark this saved match as out of date. ${notify === 'none' ? 'You chose not to be notified; the change shows the next time you look.' : notify === 'all_changes' ? 'You will be told about any change.' : 'You will be told only when a change affects your plan; routine page edits will not alarm you.'}`;
  }

  private async save(ctx: TaskContext, s: Extract<OpportunityScope, { action: 'save' }>) {
    const c = await this.load(ctx, s.request);
    const found = await this.one(ctx, c, s.opportunityId);
    if (!found) return failedResult(ctx, 'failed', 'That opportunity is not in the verified catalog.', 'unknown_opportunity');
    const { e, o } = found;
    const payload = this.emptyPayload('save', c.brief, this.coverageText(found.catalog));
    const savedAt = ctx.clock.nowIso();
    const card = this.card(e);
    payload.saved = { savedId: '', opportunityId: o.id, catalogVersion: o.version, notify: s.notify, savedAt, monitoring: this.monitoringText(s.notify), evaluation: card };
    if (e.bucket === 'excluded' || e.bucket === 'closed') payload.notices.push({ code: 'saved_unavailable', message: `Saved, but it does not currently fit: ${e.nextAction.text}` });
    const artifact = await this.store(ctx, c, 'opportunity_saved', `saved:${o.id}`, payload, [e], [o.id]);
    payload.saved.savedId = artifact.id;
    const handoffs = this.savedHandoffs(e, artifact.id);
    return makeResult(ctx, {
      status: 'completed',
      summary: `${e.title} is saved. It will be marked out of date if its dates, status, conditions or costs change.`,
      payload,
      claimIds: this.servedClaims(ctx, c.brief.claimIds, e.claimIds),
      recordVersion: c.view.recordVersion,
      sourceRefs: this.servedSources(ctx, [e]),
      handoffs,
      completionReason: 'saved',
    });
  }

  private savedHandoffs(e: OptionEvaluation, savedId: string, supersedes?: string): Handoff[] {
    const handoffs: Handoff[] = [];
    if (e.deadline?.kind === 'deadline' && e.bucket !== 'closed' && e.bucket !== 'excluded') {
      const d = e.deadline.published!;
      handoffs.push({
        toRole: '30',
        reason: supersedes ? 'A saved opportunity changed; its timeline entries must be replaced.' : 'The student saved an opportunity with an application deadline.',
        requestedOutcome: `${supersedes ? `Mark the milestones from ${supersedes} as superseded and ` : ''}offer the official deadline "${d.originalText}"${d.timezone ? '' : ' (timezone not published; keep it marked unresolved)'} and a separately labelled planning buffer.`,
        inputRefs: [`artifact:${savedId}`, ...(supersedes ? [`artifact:${supersedes}`] : [])],
        unresolved: e.unresolved.filter((u) => u.code.startsWith('deadline')).map((u) => u.text),
        completionCondition: 'The student accepts or declines the milestones.',
      });
    }
    if (e.bucket === 'feasible_now' || e.bucket === 'conditional') {
      const s = e.sessions.find((x) => x.sessionId === e.chosenSessionId);
      handoffs.push({ toRole: '07', reason: 'A saved opportunity has dates and a weekly workload.', requestedOutcome: `Check that ${s ? `${s.start} to ${s.end}` : 'these dates'} and the workload fit the academic and testing plan.`, inputRefs: [`artifact:${savedId}`], unresolved: [], completionCondition: 'Conflicts with the plan are identified or ruled out.' });
      if (['supervised_research', 'competition', 'creative', 'independent_learning'].includes(e.category)) handoffs.push({ toRole: '10', reason: 'The saved opportunity involves a project.', requestedOutcome: 'Help the student plan the project work within their weekly time, with any required supervision and approvals before work begins.', inputRefs: [`artifact:${savedId}`], unresolved: e.safety.map((f) => f.text), completionCondition: 'A project plan the student accepts.' });
    }
    return handoffs;
  }

  /** Re-evaluate a saved opportunity after a change; the new result supersedes the old one (09R14, 09T15). */
  private async refreshSaved(ctx: TaskContext, s: Extract<OpportunityScope, { action: 'refresh_saved' }>) {
    const [old] = await ctx.call<DerivedArtifact[]>('artifacts.read', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, artifactId: s.savedId });
    if (!old || old.kind !== 'opportunity_saved') return failedResult(ctx, 'failed', 'That saved opportunity was not found.', 'unknown_saved_opportunity');
    const prev = (old.payload as OpportunityPayload).saved!;
    const c = await this.load(ctx, s.request);
    const found = await this.one(ctx, c, prev.opportunityId);
    const payload = this.emptyPayload('refresh_saved', c.brief, found ? this.coverageText(found.catalog) : 'The opportunity is no longer in the catalog.');
    if (!found) {
      payload.notices.push({ code: 'withdrawn', message: 'This opportunity is no longer in the verified catalog, so it is no longer shown as available.' });
      return makeResult(ctx, { status: 'completed', summary: 'This saved opportunity is no longer listed, so it is no longer shown as available.', payload, recordVersion: c.view.recordVersion, completionReason: 'saved_withdrawn' });
    }
    const { e, o } = found;
    const summary = diffSaved(prev.evaluation, e);
    const material = summary.length > 0;
    const anyChange = material || prev.catalogVersion !== o.version;
    const send = prev.notify === 'none' ? false : prev.notify === 'all_changes' ? anyChange : material;
    payload.changes = {
      previousSavedId: old.id,
      previousVersion: prev.catalogVersion,
      version: o.version,
      summary: summary.length > 0 ? summary : ['Nothing that affects your plan changed.'],
      material,
      notify: { send, reason: prev.notify === 'none' ? 'You chose not to be notified.' : send ? 'The change affects your plan.' : 'Only a routine change; no notification.' },
    };
    const card = this.card(e);
    payload.saved = { savedId: '', opportunityId: o.id, catalogVersion: o.version, notify: prev.notify, savedAt: prev.savedAt, monitoring: this.monitoringText(prev.notify), evaluation: card };
    let cards: OptionEvaluation[] = [e];
    if (e.bucket === 'closed' || e.bucket === 'excluded' || e.bucket === 'stale') {
      // Offer verified alternatives when a saved program closes or no longer fits.
      const others = await this.readCatalog(ctx, { ...c.brief, topics: c.brief.topics.length > 0 ? c.brief.topics : o.topics });
      const evals = this.evaluateAll(c, { ...others, opportunities: others.opportunities.filter((x) => x.id !== o.id) }, ctx.clock.nowIso());
      const { shortlist } = rankAndShortlist(evals, { ...c.brief, topics: c.brief.topics.length > 0 ? c.brief.topics : o.topics, maxResults: 3 });
      payload.shortlist = { feasibleNow: shortlist.feasibleNow.map((r) => this.card(r.evaluation, r)), conditional: shortlist.conditional.map((r) => this.card(r.evaluation, r)), moreFromSameOrganizer: shortlist.moreFromSameOrganizer };
      cards = [e, ...[...shortlist.feasibleNow, ...shortlist.conditional].map((r) => r.evaluation)];
      if (shortlist.feasibleNow.length + shortlist.conditional.length === 0) payload.alternatives = routeIdeas({ ...c.brief, topics: c.brief.topics.length > 0 ? c.brief.topics : o.topics });
    }
    const artifact = await this.store(ctx, c, 'opportunity_saved', `saved:${o.id}`, payload, cards, [o.id]);
    payload.saved.savedId = artifact.id;
    const handoffs = material ? this.savedHandoffs(e, artifact.id, old.id) : [];
    return makeResult(ctx, {
      status: 'completed',
      summary: material ? `${e.title} changed: ${summary.join(' ')}` : `${e.title}: nothing that affects your plan changed.`,
      payload,
      claimIds: this.servedClaims(ctx, c.brief.claimIds, ...cards.map((x) => x.claimIds)),
      recordVersion: c.view.recordVersion,
      sourceRefs: this.servedSources(ctx, cards),
      handoffs,
      completionReason: material ? 'saved_updated' : 'saved_unchanged',
    });
  }

  /** Prepare the exact message for the organizer's published channel; nothing is sent (09T16). */
  private async prepareContact(ctx: TaskContext, s: Extract<OpportunityScope, { action: 'prepare_contact' }>) {
    const c = await this.load(ctx, s.request);
    const found = await this.one(ctx, c, s.opportunityId);
    if (!found) return failedResult(ctx, 'failed', 'That opportunity is not in the verified catalog.', 'unknown_opportunity');
    const { o, e } = found;
    // Only the organizer's published channel; never a private individual (09 "Research supervision and youth safety").
    if (!o.contact) return failedResult(ctx, 'failed', 'The organizer does not publish a contact channel, so no message can be prepared.', 'no_official_contact');
    const questions = s.questions.length > 0 ? s.questions : draftQuestions(e);
    const payload = this.emptyPayload('prepare_contact', c.brief, this.coverageText(found.catalog));
    if (s.questions.some(mentionsPrivateDetail)) payload.notices.push({ code: 'private_detail', message: 'Your message mentions personal details. The organizer may not need them to answer; you can remove them before approving.' });
    const exactContent = [
      'Hello,',
      '',
      `I am interested in ${o.title}${e.cycle ? ` (${e.cycle.label})` : ''} and have ${questions.length === 1 ? 'a question' : 'a few questions'}:`,
      ...questions.map((q, i) => `${i + 1}. ${q}`),
      '',
      s.signature ? `Thank you,\n${s.signature}` : 'Thank you.',
    ].join('\n');
    const proposal = await ctx.call<ExternalActionProposal>('actions.propose', { kind: 'contact_organizer', destination: o.contact.address, exactContent, consequence: `This message would be sent to ${o.organizer.name} at their published ${o.contact.kind === 'organizer_email' ? 'email address' : 'contact form'}. Nothing is sent unless you approve it, and you can also send it yourself.` });
    payload.contactDraft = { destination: o.contact.address, organizer: o.organizer.name, exactContent, proposalId: proposal.id, sent: false };
    payload.dossier = this.card(e);
    return makeResult(ctx, {
      status: 'needs_student_input',
      summary: `A message to ${o.organizer.name} is ready for you to review. Nothing has been sent.`,
      payload,
      claimIds: this.servedClaims(ctx, c.brief.claimIds, e.claimIds),
      recordVersion: c.view.recordVersion,
      sourceRefs: this.servedSources(ctx, [e]),
      externalActions: [proposal],
      completionReason: 'contact_proposed',
    });
  }
}

const ORGANIZER_QUESTIONS: Record<string, (e: OptionEvaluation) => string> = {
  deadline_timezone: (e) => `Which timezone does the application deadline (${e.deadline?.published?.originalText ?? 'as published'}) refer to, and at what time does it close?`,
  deadline_time: () => 'At what time of day does the application deadline close?',
  deadline_not_published: () => 'When is the application deadline for this cycle?',
  session_timezone_missing: () => 'Which timezone are the session times given in?',
  session_times_unknown: () => 'At what times of day do the sessions run?',
  location_unknown: () => 'Where will the sessions take place?',
  cost_not_published: () => 'Could you share the full list of costs, including any application fees, deposits and materials?',
  cost_unknown: () => 'Could you confirm the costs that are not listed on the page?',
  eligibility_not_published: () => 'Who is eligible to apply for this cycle?',
  workload_unknown: () => 'About how many hours a week does taking part involve?',
  accessibility_info: () => 'What accessibility support is available for participants?',
  cycle_unannounced: () => 'Will there be another cycle, and when will its dates be announced?',
};

function draftQuestions(e: OptionEvaluation): string[] {
  const qs = e.unresolved.filter((u) => u.owner === 'organizer' && ORGANIZER_QUESTIONS[u.code]).map((u) => ORGANIZER_QUESTIONS[u.code]!(e));
  return qs.length > 0 ? [...new Set(qs)].slice(0, 5) : ['Could you confirm the current dates, costs and who is eligible?'];
}

function costRank(e: OptionEvaluation): number {
  if (!e.cost) return 4;
  if (e.cost.verdict === 'free') return 0;
  if (e.cost.verdict === 'within_budget') return 1;
  if (e.cost.unknownComponents.length > 0) return 3;
  return 2;
}

function costText(e: OptionEvaluation): string {
  if (!e.cost) return 'No current cycle, so no cost is known.';
  return e.cost.verdictText;
}

/** What changed for a saved opportunity, in terms that matter to the student's plan. */
function diffSaved(before: OptionEvaluation, after: OptionEvaluation): string[] {
  const out: string[] = [];
  if (before.cycle?.status !== after.cycle?.status || before.bucket !== after.bucket) {
    if (after.bucket === 'closed') out.push(`It is no longer available: ${after.cycleNote ?? 'the cycle closed'}.`);
    else if (after.bucket === 'unannounced') out.push('The current cycle is no longer listed; the next one has not been announced.');
    else if (before.cycle?.status !== after.cycle?.status) out.push(`Its status changed from ${before.cycle?.status ?? 'unknown'} to ${after.cycle?.status ?? 'unknown'}.`);
    else out.push(`It now counts as ${after.bucket.replace(/_/g, ' ')} (before: ${before.bucket.replace(/_/g, ' ')}).`);
  }
  const bd = before.deadline?.published;
  const ad = after.deadline?.published;
  if ((bd?.date ?? null) !== (ad?.date ?? null) || (bd?.time ?? null) !== (ad?.time ?? null) || (bd?.timezone ?? null) !== (ad?.timezone ?? null)) out.push(`The deadline changed from ${bd?.originalText ?? 'none'} to ${ad?.originalText ?? 'none'}.`);
  const sessions = (e: OptionEvaluation) => e.sessions.map((s) => `${s.label} ${s.start} to ${s.end}`).join('; ');
  if (sessions(before) !== sessions(after)) out.push(`The dates changed from ${sessions(before) || 'none'} to ${sessions(after) || 'none'}.`);
  if (before.cost?.verdict !== after.cost?.verdict || JSON.stringify(before.cost?.knownTotals ?? []) !== JSON.stringify(after.cost?.knownTotals ?? [])) out.push(`The cost picture changed: ${after.cost?.verdictText ?? 'no costs are known'}`);
  if (before.eligibility.state !== after.eligibility.state) out.push(`Eligibility changed from ${before.eligibility.state.replace(/_/g, ' ')} to ${after.eligibility.state.replace(/_/g, ' ')}.`);
  return out;
}
