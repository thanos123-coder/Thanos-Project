import { z } from 'zod';
import { CostComponentKindSchema, CostComponentSchema, MoneySchema } from '../../shared/money.js';
import { SourceRecordSchema, canEstablishConsequentialClaim, type SourceRecord } from '../../shared/sources.js';
import { stableStringify } from '../../shared/hash.js';
import { CalendarDateSchema, LocalTimeSchema, PublishedDeadlineSchema, TimezoneSchema } from '../../shared/time.js';
import { RuleNodeSchema } from '../a06-eligibility/rules.js';
import { isTopic, topicRelation } from './topics.js';

/**
 * The shared public opportunity catalog (09 "Efficiency and quality
 * measurement": "Separate a shared public opportunity catalog from private
 * student matching").
 *
 * Two kinds of entry are kept apart:
 *  - curated opportunities, whose organizer, cycle, eligibility and cost facts
 *    were checked against authoritative pages by the team that maintains the
 *    catalog ("Begin with a bounded set of regions and opportunity categories
 *    that the team can verify and maintain"), and
 *  - discovered leads, which only show that a listing exists. Agent 09 can add
 *    leads, never verified facts: a search snippet or third-party list is a
 *    discovery aid, not a complete eligibility statement (09R03).
 *
 * The catalog holds no student data.
 */

const CC = z.string().regex(/^[A-Z]{2}$/, 'Expected an ISO 3166-1 alpha-2 country code');

export const OPPORTUNITY_CATEGORIES = [
  'course',
  'workshop',
  'competition',
  'supervised_research',
  'volunteering',
  'public_program',
  'creative',
  'work_experience',
  'summer_program',
  'club_or_community',
  'independent_learning',
] as const;
export const OpportunityCategorySchema = z.enum(OPPORTUNITY_CATEGORIES);
export type OpportunityCategory = z.infer<typeof OpportunityCategorySchema>;

export const FORMATS = ['in_person', 'online', 'hybrid'] as const;
const TopicKeySchema = z.string().refine(isTopic, { message: 'Unknown topic key' });

export const SessionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    start: CalendarDateSchema,
    end: CalendarDateSchema,
    format: z.enum(FORMATS),
    location: z.object({ country: CC, region: z.string().nullable(), city: z.string().nullable(), venue: z.string().nullable() }).strict().nullable(),
    /** Published daily times. `timezone: null` means the organizer did not say which timezone the times are in. */
    schedule: z.object({ timezone: TimezoneSchema.nullable(), dailyStart: LocalTimeSchema, dailyEnd: LocalTimeSchema, weekdays: z.array(z.number().int().min(1).max(7)).min(1) }).strict().nullable(),
    residential: z.boolean(),
    /** Participation needs overnight stays even when the program itself is not residential. */
    overnightRequired: z.boolean(),
    hoursPerWeek: z.number().positive().nullable(),
    status: z.enum(['scheduled', 'full', 'cancelled']).default('scheduled'),
  })
  .strict()
  .refine((s) => s.end >= s.start, 'session end is before its start');
export type Session = z.infer<typeof SessionSchema>;
export type SessionInput = z.input<typeof SessionSchema>;

export const AidSchema = z
  .object({
    kind: z.enum(['fee_waiver', 'need_based', 'merit', 'travel_grant', 'other']),
    covers: z.array(CostComponentKindSchema).min(1),
    /** A published amount, 'full' for the covered components, or null when not stated. */
    amount: z.union([MoneySchema, z.literal('full')]).nullable(),
    eligibility: z.string().min(1),
    deadline: PublishedDeadlineSchema.nullable(),
    decisionTiming: z.string().nullable(),
    sourceId: z.string().min(1),
  })
  .strict();
export type Aid = z.infer<typeof AidSchema>;

export const CycleSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    year: z.number().int().min(2000).max(2100),
    /** As published. 'past' marks recurring history, e.g. last summer's participants page. */
    status: z.enum(['open', 'upcoming', 'closed', 'filled', 'cancelled', 'past']),
    applicationOpens: PublishedDeadlineSchema.nullable().default(null),
    applicationDeadline: PublishedDeadlineSchema.nullable(),
    /** Applications are reviewed as they arrive; no fixed deadline. */
    rolling: z.boolean().default(false),
    sessions: z.array(SessionSchema).min(1),
    /** Required and optional cost components as published; an empty list with costsPublished=false means costs are unclear. */
    costs: z.array(CostComponentSchema),
    costsPublished: z.boolean(),
    aid: z.array(AidSchema).default([]),
    refund: z.object({ text: z.string().min(1), sourceId: z.string().min(1) }).strict().nullable().default(null),
    sourceId: z.string().min(1),
    retrievedAt: z.string().min(1),
  })
  .strict();
export type Cycle = z.infer<typeof CycleSchema>;
export type CycleInput = z.input<typeof CycleSchema>;

/**
 * Opportunity-specific eligibility conditions evaluated locally by Agent 09,
 * alongside the shared rule tree (age at the organizer's reference date,
 * citizenship, residence, prerequisites), which Agent 06's engine evaluates.
 */
export const RequirementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('still_in_secondary_on'), id: z.string().min(1), label: z.string().min(1), date: CalendarDateSchema, sourceId: z.string().min(1), quote: z.string().min(1) }).strict(),
  z.object({ type: z.literal('education_stage_in'), id: z.string().min(1), label: z.string().min(1), stages: z.array(z.enum(['secondary', 'completed_secondary', 'gap_year', 'postsecondary', 'other'])).min(1), sourceId: z.string().min(1), quote: z.string().min(1) }).strict(),
  z.object({ type: z.literal('graduation_year_between'), id: z.string().min(1), label: z.string().min(1), earliest: z.number().int().nullable(), latest: z.number().int().nullable(), sourceId: z.string().min(1), quote: z.string().min(1) }).strict(),
  z.object({ type: z.literal('residence_region_in'), id: z.string().min(1), label: z.string().min(1), country: CC, regions: z.array(z.string().min(1)).min(1), sourceId: z.string().min(1), quote: z.string().min(1) }).strict(),
  /** A condition only the student can answer, e.g. prior participation or being able to attend every session. */
  z.object({ type: z.literal('declaration'), id: z.string().min(1), label: z.string().min(1), kind: z.enum(['prior_participation', 'attendance', 'consent', 'other']), question: z.string().min(1), sourceId: z.string().min(1), quote: z.string().min(1) }).strict(),
]);
export type Requirement = z.infer<typeof RequirementSchema>;

export const SELECTION_ROUTES = ['open_application', 'first_come', 'drop_in', 'nomination_required', 'qualifying_competition', 'school_nomination', 'invitation_only'] as const;
export const DIRECT_ROUTES: ReadonlySet<string> = new Set(['open_application', 'first_come', 'drop_in']);

export const CONCERN_KINDS = [
  'unsupported_guarantee',
  'pressure_to_pay',
  'unclear_costs',
  'excessive_personal_info',
  'missing_contact',
  'inconsistent_organizer',
  'implied_endorsement',
  'missing_policies',
  'other',
] as const;

export const OpportunitySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    title: z.string().min(1),
    category: OpportunityCategorySchema,
    topics: z.array(TopicKeySchema).min(1),
    /** Factual description of what participants do, in the catalog's own words. */
    summary: z.string().min(1),
    organizer: z
      .object({
        name: z.string().min(1),
        kind: z.enum(['university', 'school', 'nonprofit', 'government', 'museum_or_library', 'company', 'other']),
        officialUrl: z.string().url(),
        sourceId: z.string().min(1),
      })
      .strict(),
    /** Where it happens and how that place relates to the operator. A venue is not necessarily the operator (09R04). */
    host: z.object({ name: z.string().min(1), relation: z.enum(['same_as_organizer', 'venue_only', 'partner', 'unknown']), note: z.string().nullable() }).strict().nullable(),
    /** Commercial relationships, disclosed and never used by the ranking (09R11, 09T09). */
    sponsorship: z.object({ paidPlacement: z.boolean(), affiliateCommission: z.boolean(), sponsor: z.string().nullable() }).strict().default({ paidPlacement: false, affiliateCommission: false, sponsor: null }),
    cycles: z.array(CycleSchema),
    eligibility: z
      .object({
        published: z.boolean(),
        rules: RuleNodeSchema.nullable(),
        requirements: z.array(RequirementSchema).default([]),
        sourceId: z.string().nullable(),
      })
      .strict(),
    selection: z
      .object({
        route: z.enum(SELECTION_ROUTES),
        description: z.string().nullable(),
        /** Qualification routes per country, e.g. the national contest that nominates finalists (09T03). */
        pathways: z.array(z.object({ country: z.union([CC, z.literal('ANY')]), organizer: z.string().min(1), url: z.string().url().nullable(), sourceId: z.string().min(1) }).strict()).default([]),
        stages: z.array(z.string().min(1)).default([]),
        sourceId: z.string().nullable(),
      })
      .strict(),
    team: z.object({ minSize: z.number().int().positive(), maxSize: z.number().int().positive(), memberRules: z.string().nullable(), schoolAffiliationRequired: z.boolean() }).strict().nullable().default(null),
    value: z
      .object({
        activities: z.array(z.string().min(1)),
        curriculum: z.string().nullable(),
        supervision: z.enum(['qualified_staff', 'organizer_vetted_mentor', 'unverified_individual', 'self_directed', 'unknown']),
        feedback: z.boolean().nullable(),
        outputs: z.array(z.string().min(1)),
        credential: z.enum(['credit_bearing', 'noncredit_certificate', 'participation_certificate', 'competitive_award', 'none', 'unknown']),
        creditNote: z.string().nullable(),
        sourceId: z.string().nullable(),
      })
      .strict(),
    /** Claims the organizer makes about itself, stored verbatim and never repeated as fact (09T10). */
    marketingClaims: z.array(z.object({ text: z.string().min(1), kind: z.enum(['admission_guarantee', 'admission_advantage', 'selectivity', 'outcome', 'endorsement', 'urgency']), sourceId: z.string().min(1) }).strict()).default([]),
    /** Concerns found by the catalog team, with the evidence (a concern is not proof of fraud). */
    concerns: z.array(z.object({ kind: z.enum(CONCERN_KINDS), evidence: z.string().min(1), sourceId: z.string().nullable() }).strict()).default([]),
    safety: z
      .object({
        supervisionRequired: z.boolean(),
        /** Approvals that must be in place before work begins (e.g. a fair's review committee for human participants). */
        priorReview: z.array(z.object({ area: z.enum(['human_participants', 'animals', 'hazardous_materials', 'biological_agents', 'other']), body: z.string().min(1), beforeWorkBegins: z.boolean(), sourceId: z.string().min(1) }).strict()).default([]),
        safeguardingPolicyUrl: z.string().url().nullable(),
        parentalConsentRequired: z.boolean().nullable(),
      })
      .strict(),
    accessibility: z.object({ statement: z.string().nullable(), sourceId: z.string().nullable() }).strict().default({ statement: null, sourceId: null }),
    /** The organizer's published contact channel. Never a private individual. */
    contact: z.object({ kind: z.enum(['organizer_email', 'organizer_form']), address: z.string().min(3), sourceId: z.string().min(1) }).strict().nullable(),
    discovery: z.object({ via: z.enum(['curated_directory', 'organizer_site', 'search', 'third_party_listing']), ref: z.string().min(1) }).strict(),
  })
  .strict();
export type OpportunityInput = z.input<typeof OpportunitySchema>;
export type OpportunityData = z.infer<typeof OpportunitySchema>;

export interface Reverification {
  sourceId: string;
  outcome: 'unchanged' | 'changed' | 'inaccessible';
  observedAt: string;
}

export interface Opportunity extends OpportunityData {
  /** Catalog version of this entry; bumped on every curated update. */
  version: number;
  verification: { status: 'source_verified'; reviewedAt: string; needsReview: boolean; lastObservation: Reverification | null };
}

/** Reference used in derived-artifact inputs so a change to this opportunity invalidates saved matches (09T15). */
export function opportunityRef(id: string): string {
  return `opportunity:${id}`;
}

export const LeadInputSchema = z
  .object({
    title: z.string().min(1).max(300),
    url: z.string().url(),
    publisher: z.string().max(200).nullable(),
    snippet: z.string().max(1000),
    discoveredVia: z.enum(['search', 'third_party_listing']),
    /** Topic and category keys of the generalized query that surfaced it (never student data). */
    topics: z.array(TopicKeySchema).max(6),
    category: OpportunityCategorySchema.nullable(),
    /** Verbatim passages from the listing page, when it was read. Unverified. */
    pageSays: z.array(z.object({ field: z.string().min(1).max(40), quote: z.string().min(1).max(400) }).strict()).max(20).default([]),
    /** The page describes a cycle that has already happened (e.g. last year's results). */
    pastCycleOnly: z.boolean().nullable().default(null),
    injectionSignals: z.array(z.string()).max(10).default([]),
  })
  .strict();
export type LeadInput = z.input<typeof LeadInputSchema>;

export interface Lead extends z.infer<typeof LeadInputSchema> {
  id: string;
  state: 'discovered';
  discoveredAt: string;
  updatedAt: string;
}

export const CatalogCoverageSchema = z
  .object({
    countries: z.array(CC),
    includesOnline: z.boolean(),
    categories: z.array(OpportunityCategorySchema),
    maintainedBy: z.string().min(1),
    lastReviewedAt: z.string().min(1),
  })
  .strict();
export type CatalogCoverage = z.infer<typeof CatalogCoverageSchema>;

export interface OpportunityChange {
  opportunityId: string;
  ref: string;
  previousVersion: number;
  version: number;
  /** Which material parts changed (dates, status, eligibility, costs...). Cosmetic edits produce no change event. */
  material: string[];
}

export interface CatalogFilter {
  topics?: readonly string[];
  categories?: readonly OpportunityCategory[];
  country?: string | null;
  ids?: readonly string[];
}

export interface CatalogQueryResult {
  opportunities: Opportunity[];
  leads: Lead[];
  sources: SourceRecord[];
  coverage: CatalogCoverage | null;
}

/** Parts of an entry whose change can affect a student's plan (09 "Failure handling and source changes"). */
function materialParts(o: OpportunityData): Record<string, unknown> {
  return {
    status: o.cycles.map((c) => [c.id, c.status, c.sessions.map((s) => [s.id, s.status])]),
    deadlines: o.cycles.map((c) => [c.id, c.applicationOpens, c.applicationDeadline, c.rolling]),
    dates: o.cycles.map((c) => c.sessions.map((s) => [s.id, s.start, s.end, s.schedule])),
    format_location: o.cycles.map((c) => c.sessions.map((s) => [s.id, s.format, s.location, s.residential, s.overnightRequired])),
    costs: o.cycles.map((c) => [c.id, c.costs, c.costsPublished, c.aid, c.refund]),
    eligibility: o.eligibility,
    selection: o.selection,
    safety: o.safety,
    concerns: [o.concerns, o.marketingClaims],
    organizer: [o.organizer.name, o.host],
    contact: o.contact,
  };
}

export class OpportunityCatalog {
  private readonly opportunities = new Map<string, Opportunity>();
  private readonly history = new Map<string, Opportunity[]>();
  private readonly sources = new Map<string, SourceRecord>();
  private readonly leads = new Map<string, Lead>();
  private coverage: CatalogCoverage | null = null;
  private readonly listeners: Array<(c: OpportunityChange) => void> = [];
  private leadCounter = 0;

  constructor(private readonly now: () => string) {}

  addSource(s: SourceRecord): void {
    this.sources.set(s.id, SourceRecordSchema.parse(s));
  }

  setCoverage(c: CatalogCoverage): void {
    this.coverage = CatalogCoverageSchema.parse(c);
  }

  onChange(listener: (c: OpportunityChange) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Add or update a curated entry (catalog maintenance, not an agent tool).
   * Every cited source must be registered. A material change notifies
   * listeners so saved matches become stale.
   */
  curate(input: OpportunityInput): { version: number; material: string[] } {
    const data = OpportunitySchema.parse(input);
    for (const id of citedSourceIds(data)) if (!this.sources.has(id)) throw new Error(`Opportunity ${data.id} cites unregistered source ${id}`);
    const previous = this.opportunities.get(data.id);
    const version = (previous?.version ?? 0) + 1;
    const entry: Opportunity = { ...data, version, verification: { status: 'source_verified', reviewedAt: this.now(), needsReview: false, lastObservation: null } };
    let material: string[] = [];
    if (previous) {
      const a = materialParts(previous);
      const b = materialParts(data);
      material = Object.keys(b).filter((k) => stableStringify(a[k]) !== stableStringify(b[k]));
      this.history.set(data.id, [...(this.history.get(data.id) ?? []), previous]);
    }
    this.opportunities.set(data.id, entry);
    if (previous && material.length > 0) {
      const change: OpportunityChange = { opportunityId: data.id, ref: opportunityRef(data.id), previousVersion: previous.version, version, material };
      for (const l of this.listeners) l(change);
    }
    return { version, material };
  }

  get(id: string): Opportunity | undefined {
    const o = this.opportunities.get(id);
    return o ? structuredClone(o) : undefined;
  }

  /** Earlier versions of an entry, oldest first (the previous and new source versions stay recorded). */
  versions(id: string): Opportunity[] {
    return (this.history.get(id) ?? []).map((o) => structuredClone(o));
  }

  source(id: string): SourceRecord | undefined {
    const s = this.sources.get(id);
    return s ? structuredClone(s) : undefined;
  }

  allLeads(): Lead[] {
    return [...this.leads.values()].map((l) => structuredClone(l));
  }

  query(filter: CatalogFilter): CatalogQueryResult {
    // Deliberately broad (direct and related topics); the local match decides the fit.
    const matchesTopic = (topics: readonly string[]) => !filter.topics || filter.topics.length === 0 || topicRelation(filter.topics, topics).relation !== 'none';
    const opportunities = [...this.opportunities.values()]
      .filter((o) => !filter.ids || filter.ids.includes(o.id))
      .filter((o) => filter.ids || matchesTopic(o.topics))
      .filter((o) => !filter.categories || filter.categories.length === 0 || filter.categories.includes(o.category))
      .filter((o) => !filter.country || o.cycles.some((c) => c.sessions.some((s) => s.format !== 'in_person' || s.location === null || s.location.country === filter.country)))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((o) => structuredClone(o));
    const leads = filter.ids ? [] : [...this.leads.values()].filter((l) => matchesTopic(l.topics)).map((l) => structuredClone(l));
    const ids = new Set(opportunities.flatMap((o) => citedSourceIds(o)));
    return { opportunities, leads, sources: [...ids].map((id) => structuredClone(this.sources.get(id)!)), coverage: this.coverage ? structuredClone(this.coverage) : null };
  }

  /** Record or refresh a discovered lead. A lead never becomes a verified entry through this path. */
  recordLead(input: LeadInput): Lead {
    const data = LeadInputSchema.parse(input);
    const canonical = canonicalUrl(data.url);
    const existing = [...this.leads.values()].find((l) => canonicalUrl(l.url) === canonical);
    const now = this.now();
    if (existing) {
      const updated: Lead = { ...existing, ...data, id: existing.id, state: 'discovered', discoveredAt: existing.discoveredAt, updatedAt: now };
      this.leads.set(existing.id, updated);
      return structuredClone(updated);
    }
    const lead: Lead = { ...data, id: `lead_${++this.leadCounter}`, state: 'discovered', discoveredAt: now, updatedAt: now };
    this.leads.set(lead.id, lead);
    return structuredClone(lead);
  }

  /** Is a URL already covered by a curated entry (organizer or cycle page)? */
  coversUrl(url: string): boolean {
    const c = canonicalUrl(url);
    for (const o of this.opportunities.values()) {
      if (canonicalUrl(o.organizer.officialUrl) === c) return true;
      for (const id of citedSourceIds(o)) {
        const s = this.sources.get(id);
        if (s && canonicalUrl(s.canonicalUrl) === c) return true;
      }
    }
    return false;
  }

  /**
   * Record the result of reopening an official page for a finalist (09R12).
   * A changed page pauses action-ready status until the team reviews it; it
   * does not by itself alarm students (09R14: a routine web change is not a
   * material change).
   */
  recordObservation(opportunityId: string, obs: Reverification): Opportunity | undefined {
    const o = this.opportunities.get(opportunityId);
    if (!o) return undefined;
    o.verification = { ...o.verification, lastObservation: { ...obs }, needsReview: o.verification.needsReview || obs.outcome === 'changed' };
    return structuredClone(o);
  }

  usableSource(id: string | null): SourceRecord | undefined {
    if (!id) return undefined;
    const s = this.sources.get(id);
    return s && canEstablishConsequentialClaim(s) ? structuredClone(s) : undefined;
  }
}

export function citedSourceIds(o: OpportunityData): string[] {
  const ids = new Set<string>([o.organizer.sourceId]);
  for (const c of o.cycles) {
    ids.add(c.sourceId);
    if (c.refund) ids.add(c.refund.sourceId);
    for (const a of c.aid) ids.add(a.sourceId);
    for (const k of c.costs) if (k.sourceRef) ids.add(k.sourceRef);
  }
  if (o.eligibility.sourceId) ids.add(o.eligibility.sourceId);
  for (const r of o.eligibility.requirements) ids.add(r.sourceId);
  if (o.selection.sourceId) ids.add(o.selection.sourceId);
  for (const p of o.selection.pathways) ids.add(p.sourceId);
  if (o.value.sourceId) ids.add(o.value.sourceId);
  for (const m of o.marketingClaims) ids.add(m.sourceId);
  for (const c of o.concerns) if (c.sourceId) ids.add(c.sourceId);
  for (const r of o.safety.priorReview) ids.add(r.sourceId);
  if (o.accessibility.sourceId) ids.add(o.accessibility.sourceId);
  if (o.contact) ids.add(o.contact.sourceId);
  collectRuleSources(o.eligibility.rules, ids);
  return [...ids];
}

function collectRuleSources(node: unknown, ids: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { source?: { sourceId?: string }; children?: unknown[]; child?: unknown };
  if (n.source?.sourceId) ids.add(n.source.sourceId);
  for (const c of n.children ?? []) collectRuleSources(c, ids);
  if (n.child) collectRuleSources(n.child, ids);
}

/** Lower-case host, no fragment, no trailing slash, no tracking parameters: used to deduplicate syndicated listings. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}
