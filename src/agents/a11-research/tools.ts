import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { AccessDeniedError } from '../../shared/errors.js';
import { isPublicHttpsUrl, type SearchHit } from '../a09-opportunities/research.js';
import { claimRef, ClaimInputSchema, PredicateSchema, type ClaimRecord, type InstitutionClaimStore, type SourceSnapshot, type UpsertOutcome } from './claims.js';
import { OFFICES, type CoverageEntry, type InstitutionEntity, type InstitutionRegistry, type OfficialPage, type Resolution } from './entities.js';

/**
 * Tools over the shared institutional evidence store. Public claims are
 * shared across authorized tasks; a student's private evidence is visible
 * only to that student's tasks (11T16). Only the researcher (role 11) writes.
 * Every claim a tool serves is recorded on the task, so results can cite it.
 */

/** Official-source search: structured and minimal. It has no field that could carry a name, a story or a family detail (11T12). */
export const OfficialQuerySchema = z
  .object({
    institutionId: z.string().regex(/^[a-z0-9_]+$/),
    office: z.enum(OFFICES),
    topic: z.enum(['deadlines', 'costs', 'requirements', 'program_access', 'statistics', 'rounds', 'prompts', 'aid_rules', 'scholarships']),
    cycle: z.string().regex(/^\d{4}$/).nullable(),
  })
  .strict();
export type OfficialQuery = z.infer<typeof OfficialQuerySchema>;

export interface OfficialSearchProvider {
  /** Receives only the validated structured query and its rendered text. */
  search(query: OfficialQuery, text: string): Promise<SearchHit[]>;
}

const TOPIC_WORDS: Record<OfficialQuery['topic'], string> = {
  deadlines: 'application deadlines',
  costs: 'tuition and cost of attendance',
  requirements: 'admission requirements',
  program_access: 'admission to the major',
  statistics: 'common data set',
  rounds: 'early action early decision policy',
  prompts: 'essay questions',
  aid_rules: 'financial aid policy',
  scholarships: 'scholarship eligibility and nomination',
};

export function renderOfficialQuery(q: OfficialQuery, institution: InstitutionEntity): string {
  const site = institution.officialDomains[0] ? ` site:${institution.officialDomains[0]}` : '';
  return `"${institution.name}" ${TOPIC_WORDS[q.topic]}${q.cycle ? ` ${q.cycle}` : ''}${site}`.replace(/\s+/g, ' ').trim();
}

const SnapshotSchema = z
  .object({
    sourceId: z.string().min(1),
    url: z.string().url(),
    finalUrl: z.string().url(),
    ownerEntityId: z.string().regex(/^[a-z0-9_]+$/),
    office: z.enum(OFFICES),
    retrievedAt: z.string().min(1),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    archived: z.boolean(),
    passages: z.array(z.object({ passageId: z.string().min(1), heading: z.string().nullable(), cycle: z.string().nullable(), text: z.string() }).strict()).max(400),
  })
  .strict();

export interface RetrievalStatus {
  url: string;
  last: { sourceId: string; retrievedAt: string } | null;
}

export interface ReadClaimsResult {
  claims: ClaimRecord[];
  lineage: InstitutionEntity[];
  coverage: CoverageEntry | null;
  pages: OfficialPage[];
}

export function registerInstitutionTools(gateway: ToolGateway, registry: InstitutionRegistry, store: InstitutionClaimStore, search?: OfficialSearchProvider): void {
  gateway.register({
    name: 'institutions.read',
    description: 'Resolve an institution, campus or program, or read its current claims (with their scope, anchors, dates and status), coverage and registered official pages.',
    kind: 'read',
    args: z.discriminatedUnion('op', [
      z.object({ op: z.literal('resolve'), institution: z.string().min(1).max(200), campus: z.string().max(200).nullable().default(null), program: z.string().max(200).nullable().default(null) }).strict(),
      z
        .object({
          op: z.literal('claims'),
          entityId: z.string().regex(/^[a-z0-9_]+$/),
          predicates: z.array(PredicateSchema).max(40).optional(),
          cycle: z.string().regex(/^\d{4}$/).nullable().default(null),
          includeHistorical: z.boolean().default(false),
        })
        .strict(),
      z.object({ op: z.literal('claim'), claimId: z.string().min(1), version: z.number().int().positive().optional() }).strict(),
      z.object({ op: z.literal('retrievals'), urls: z.array(z.string().url()).min(1).max(40) }).strict(),
    ]),
    handler: async (inv, args): Promise<Resolution | ReadClaimsResult | ClaimRecord | RetrievalStatus[] | null> => {
      if (args.op === 'resolve') return registry.resolve({ institution: args.institution, campus: args.campus, program: args.program });
      // Group research and deduplicate identical fetches (11 "Security and efficiency").
      if (args.op === 'retrievals') return args.urls.map((url: string) => ({ url, last: store.lastRetrieval(url) }));
      const viewer = { tenantId: inv.tenantId, studentId: inv.studentId };
      if (args.op === 'claim') {
        const c = store.get(args.claimId, args.version);
        if (!c) return null;
        if (c.visibility.kind === 'private' && !(c.visibility.tenantId === viewer.tenantId && c.visibility.studentId === viewer.studentId)) return null;
        inv.context.servedSourceIds.add(claimRef(c.claimId));
        return c;
      }
      const lineage = registry.lineage(args.entityId);
      if (lineage.length === 0) throw new AccessDeniedError('invalid_arguments', `Unknown entity ${args.entityId}`);
      // A program inherits institution-, campus- and school-level rules (11 "Entity resolution and coverage").
      const q: Parameters<InstitutionClaimStore['query']>[0] = { entityIds: lineage.map((e) => e.id), cycle: args.cycle, includeHistorical: args.includeHistorical, viewer };
      if (args.predicates) q.predicates = args.predicates;
      const claims = store.query(q);
      for (const c of claims) inv.context.servedSourceIds.add(claimRef(c.claimId));
      const institution = lineage.find((e) => e.kind === 'institution')!;
      return { claims, lineage, coverage: registry.coverageFor(institution.id) ?? null, pages: registry.pagesFor(args.entityId) };
    },
  });

  gateway.register({
    name: 'institutions.write',
    description: 'Record a retrieved source snapshot, store validated claims (new versions are kept, conflicts linked), or register a dependent role.',
    kind: 'write',
    args: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('snapshot'), snapshot: SnapshotSchema }).strict(),
      z.object({ kind: z.literal('claims'), claims: z.array(ClaimInputSchema).min(1).max(60) }).strict(),
      z.object({ kind: z.literal('subscribe'), claimIds: z.array(z.string().min(1)).min(1).max(200), role: z.string().regex(/^\d{2}$/) }).strict(),
      z.object({ kind: z.literal('status'), claimId: z.string().min(1), status: z.enum(['historical', 'unavailable']), reason: z.string().min(1).max(400) }).strict(),
    ]),
    handler: async (inv, args): Promise<{ snapshot?: SourceSnapshot; outcomes?: UpsertOutcome[]; subscribed?: number; claim?: ClaimRecord | null }> => {
      if (args.kind === 'status') {
        const c = store.get(args.claimId);
        if (!c || c.visibility.kind === 'private') return { claim: null };
        return { claim: store.markStatus(args.claimId, args.status, args.reason) ?? null };
      }
      if (args.kind === 'snapshot') {
        if (!isPublicHttpsUrl(args.snapshot.finalUrl)) throw new AccessDeniedError('invalid_arguments', 'Snapshots are only recorded for public https pages');
        return { snapshot: store.recordSnapshot(args.snapshot) };
      }
      if (args.kind === 'subscribe') {
        for (const id of args.claimIds) store.subscribe(id, args.role);
        return { subscribed: args.claimIds.length };
      }
      const outcomes = args.claims.map((c: z.infer<typeof ClaimInputSchema>) => {
        // Private evidence belongs to the task's own student and nobody else.
        if (c.visibility && c.visibility.kind === 'private' && (c.visibility.tenantId !== inv.tenantId || c.visibility.studentId !== inv.studentId)) {
          return { status: 'rejected', issues: ['private evidence can only be stored for the task’s own student'] } as UpsertOutcome;
        }
        const o = store.upsert(c);
        if (o.status !== 'rejected') inv.context.servedSourceIds.add(claimRef(o.claim.claimId));
        return o;
      });
      return { outcomes };
    },
  });

  gateway.register({
    name: 'institutions.search_official',
    description: 'Search for an institution’s official page on a topic. The query is built from the institution’s official name, an office and a topic only.',
    kind: 'public_research',
    args: z.object({ query: OfficialQuerySchema }).strict(),
    handler: async (_inv, args): Promise<{ available: boolean; queryText: string; results: SearchHit[]; error?: string }> => {
      const institution = registry.get(args.query.institutionId);
      if (!institution || institution.kind !== 'institution') throw new AccessDeniedError('invalid_arguments', 'Unknown institution');
      const queryText = renderOfficialQuery(args.query, institution);
      if (!search) return { available: false, queryText, results: [] };
      try {
        const hits = await search.search(args.query, queryText);
        return { available: true, queryText, results: hits.filter((h) => isPublicHttpsUrl(h.url)).slice(0, 10).map((h) => ({ url: h.url, title: h.title.slice(0, 300), snippet: h.snippet.slice(0, 1000), publisher: h.publisher ? h.publisher.slice(0, 200) : null })) };
      } catch (e) {
        return { available: true, queryText, results: [], error: e instanceof Error ? e.message.slice(0, 200) : 'search failed' };
      }
    },
  });
}
