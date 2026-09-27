import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { MoneySchema } from '../../shared/money.js';
import { SourceRecordSchema, canEstablishConsequentialClaim, type SourceRecord } from '../../shared/sources.js';

/**
 * Verified subject information for exploration (05R05-05R07).
 *
 * Three kinds of content with different rules:
 * - Subject overviews: general descriptions of what a field studies and how.
 *   They are editorial, labelled as general, and never stand in for a
 *   program's curriculum ("a major's title is not its curriculum").
 * - Labor-market records and professional-route notes: consequential, so they
 *   are served only with an authoritative, current source record, and always
 *   carry their geography, definition, year and measure.
 * - Experiment templates: low-cost ways to learn about fit, with time, cost,
 *   access needs and alternatives. Sponsorship is disclosed and never used for
 *   ordering (05T13).
 */

export const CONDITIONS = ['collaboration', 'independence', 'practical_work', 'reading', 'writing', 'making', 'quantitative', 'fieldwork', 'studio', 'clinical', 'presenting', 'programming'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const SubjectProfileSchema = z
  .object({
    key: z.string().regex(/^[a-z_]+$/),
    label: z.string().min(1),
    summary: z.string().min(1),
    typicalQuestions: z.array(z.string()).min(1),
    methods: z.array(z.string()).min(1),
    workProducts: z.array(z.string()).min(1),
    conditions: z.array(z.enum(CONDITIONS)),
    /** School subjects that commonly help. Programs set their own requirements; formal checks belong to Agent 06. */
    helpfulSchoolSubjects: z.array(z.string()),
    /** How programs with the same name can differ (05R05). */
    variesAcrossPrograms: z.string().min(1),
    adjacent: z.array(z.string()),
    /** Pairs of interests that together suggest this field (e.g. biology + visual design -> science communication). */
    bridges: z.array(z.array(z.string()).min(2)).default([]),
    occupationLinks: z.array(
      z
        .object({
          occupationKey: z.string(),
          label: z.string(),
          /** Further steps beyond the degree (graduate study, licensing, portfolio, experience). */
          additionalRequirements: z.array(z.string()),
          regulated: z.boolean(),
        })
        .strict(),
    ),
    /** The field leads to professions that are regulated in many countries; routes must be verified per country. */
    regulatedProfessions: z.array(z.string()).default([]),
    /** Commonly needed beyond grades, e.g. a portfolio. Programs vary; verify per program. */
    oftenRequires: z.array(z.string()).default([]),
    keywords: z.array(z.string().min(2)).min(1),
    provenance: z
      .object({
        kind: z.enum(['editorial_general_overview', 'verified_source']),
        sourceId: z.string().nullable(),
        reviewStatus: z.enum(['pending_expert_review', 'expert_reviewed']),
        version: z.string(),
      })
      .strict(),
  })
  .strict();
export type SubjectProfile = z.infer<typeof SubjectProfileSchema>;

export const LaborMarketRecordSchema = z
  .object({
    id: z.string(),
    occupationKey: z.string(),
    /** The publisher's own occupation definition, e.g. an SOC title. */
    occupationDefinition: z.string(),
    geography: z.string().regex(/^[A-Z]{2}$/),
    dataYear: z.number().int(),
    measure: z.enum(['median_annual_wage', 'median_hourly_wage', 'employment_projection_percent', 'typical_entry_education']),
    value: z.union([MoneySchema, z.number(), z.string()]),
    sourceId: z.string(),
  })
  .strict();
export type LaborMarketRecord = z.infer<typeof LaborMarketRecordSchema>;

export const RouteNoteSchema = z
  .object({
    id: z.string(),
    subjectKey: z.string(),
    profession: z.string(),
    country: z.string().regex(/^[A-Z]{2}$/),
    summary: z.string(),
    sourceId: z.string(),
  })
  .strict();
export type RouteNote = z.infer<typeof RouteNoteSchema>;

export const ExperimentTemplateSchema = z
  .object({
    id: z.string(),
    subjectKeys: z.array(z.string()).min(1),
    /** A specific task focus, when the experiment tests one kind of work (05T04). */
    taskFocus: z.array(z.string()).default([]),
    learningQuestion: z.string().min(10),
    activity: z.string().min(10),
    timeBudget: z.object({ sessions: z.number().int().positive(), minutesPerSession: z.number().int().positive() }).strict(),
    cost: z.object({ kind: z.enum(['free', 'low_cost', 'paid']), amount: MoneySchema.nullable() }).strict(),
    needs: z.array(z.enum(['device', 'internet', 'school_access', 'external_contact', 'travel', 'materials'])),
    /** Alternatives when a need cannot be met (device, language, disability, time). */
    alternatives: z.array(z.string()),
    reflectionPrompt: z.string().min(10),
    publicSharingRequired: z.literal(false),
    /** Disclosed for transparency only; never used to choose or order experiments. */
    sponsorship: z.object({ sponsor: z.string(), paidReferral: z.boolean() }).strict().nullable().default(null),
    /** Prepared questions for an informational conversation; nothing is sent without authorization. */
    contactQuestions: z.array(z.string()).default([]),
  })
  .strict();
export type ExperimentTemplate = z.infer<typeof ExperimentTemplateSchema>;

export class SubjectKnowledgeRegistry {
  private readonly profiles = new Map<string, SubjectProfile>();
  private readonly labor: LaborMarketRecord[] = [];
  private readonly routes: RouteNote[] = [];
  private readonly experiments = new Map<string, ExperimentTemplate>();
  private readonly sources = new Map<string, SourceRecord>();

  addSource(s: SourceRecord): void {
    this.sources.set(s.id, SourceRecordSchema.parse(s));
  }

  addProfile(p: SubjectProfile): void {
    this.profiles.set(p.key, SubjectProfileSchema.parse(p));
  }

  addLaborRecord(r: LaborMarketRecord): void {
    this.labor.push(LaborMarketRecordSchema.parse(r));
  }

  addRouteNote(r: RouteNote): void {
    this.routes.push(RouteNoteSchema.parse(r));
  }

  addExperiment(e: ExperimentTemplate): void {
    this.experiments.set(e.id, ExperimentTemplateSchema.parse(e));
  }

  profile(key: string): SubjectProfile | undefined {
    return this.profiles.get(key);
  }

  allProfiles(): SubjectProfile[] {
    return [...this.profiles.values()];
  }

  /** Consequential records are served only with a current authoritative source. */
  private usable(sourceId: string): SourceRecord | undefined {
    const s = this.sources.get(sourceId);
    return s && canEstablishConsequentialClaim(s) ? s : undefined;
  }

  laborFor(occupationKeys: readonly string[]): Array<{ record: LaborMarketRecord; source: SourceRecord }> {
    return this.labor.filter((r) => occupationKeys.includes(r.occupationKey)).flatMap((r) => {
      const source = this.usable(r.sourceId);
      return source ? [{ record: r, source }] : [];
    });
  }

  routesFor(subjectKeys: readonly string[]): Array<{ note: RouteNote; source: SourceRecord }> {
    return this.routes.filter((r) => subjectKeys.includes(r.subjectKey)).flatMap((r) => {
      const source = this.usable(r.sourceId);
      return source ? [{ note: r, source }] : [];
    });
  }

  experimentsFor(subjectKeys: readonly string[] | null): ExperimentTemplate[] {
    return [...this.experiments.values()].filter((e) => subjectKeys === null || e.subjectKeys.some((k) => subjectKeys.includes(k)));
  }

  source(id: string): SourceRecord | undefined {
    return this.sources.get(id);
  }
}

export interface KnowledgeResult {
  profiles: SubjectProfile[];
  labor: Array<{ record: LaborMarketRecord; source: SourceRecord }>;
  routes: Array<{ note: RouteNote; source: SourceRecord }>;
  experiments: ExperimentTemplate[];
}

/** Public, non-personal subject information. The arguments carry no student data. */
export function registerKnowledgeTools(gateway: ToolGateway, registry: SubjectKnowledgeRegistry): void {
  gateway.register({
    name: 'sources.read_verified',
    description: 'Read general subject overviews, experiment templates, and verified labor-market and professional-route records.',
    kind: 'read',
    args: z
      .object({
        subjectKeys: z.array(z.string().regex(/^[a-z_]+$/)).max(40).nullable(),
        include: z.array(z.enum(['profiles', 'labor', 'routes', 'experiments'])).min(1),
      })
      .strict(),
    handler: async (inv, args): Promise<KnowledgeResult> => {
      const keys: string[] | null = args.subjectKeys;
      const profiles = keys === null ? registry.allProfiles() : keys.map((k) => registry.profile(k)).filter((p): p is SubjectProfile => !!p);
      const occupationKeys = profiles.flatMap((p) => p.occupationLinks.map((o) => o.occupationKey));
      const result: KnowledgeResult = {
        profiles: args.include.includes('profiles') ? profiles : [],
        labor: args.include.includes('labor') ? registry.laborFor(occupationKeys) : [],
        routes: args.include.includes('routes') ? registry.routesFor(profiles.map((p) => p.key)) : [],
        experiments: args.include.includes('experiments') ? registry.experimentsFor(keys) : [],
      };
      for (const p of result.profiles) if (p.provenance.sourceId) inv.context.servedSourceIds.add(p.provenance.sourceId);
      for (const l of result.labor) inv.context.servedSourceIds.add(l.source.id);
      for (const r of result.routes) inv.context.servedSourceIds.add(r.source.id);
      return result;
    },
  });
}
