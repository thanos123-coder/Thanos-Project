import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { detectInjectionSignals } from '../../runtime/untrusted.js';
import { sha256Hex } from '../../shared/hash.js';
import { countryName } from '../../shared/places.js';
import { LeadInputSchema, OpportunityCategorySchema, type CatalogQueryResult, type Lead, type Opportunity, type OpportunityCatalog } from './catalog.js';
import { GeneralizedQuerySchema, isPublicHttpsUrl, MAX_PAGE_CHARS, renderQueryText, type FetchOutcome, type ResearchProviders, type SearchHit } from './research.js';
import { isTopic } from './topics.js';

export interface SearchOutcome {
  available: boolean;
  queryText: string;
  results: SearchHit[];
  /** Set when the provider failed (e.g. timed out); earlier work is unaffected. */
  error?: string;
}

/**
 * Tools for Agent 09. None of them accepts student data: the catalog and the
 * research tools are public by construction, and matching happens locally in
 * the agent against the scoped record view.
 */
export function registerOpportunityTools(gateway: ToolGateway, catalog: OpportunityCatalog, providers: ResearchProviders = {}): void {
  gateway.register({
    name: 'opportunities.read_catalog',
    description: 'Read curated opportunities (organizer, cycles, eligibility, costs, logistics, value evidence), discovered leads and the catalog coverage statement.',
    kind: 'read',
    args: z
      .object({
        topics: z.array(z.string().refine(isTopic)).max(12).default([]),
        categories: z.array(OpportunityCategorySchema).max(11).default([]),
        country: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
        ids: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(20).optional(),
      })
      .strict(),
    handler: async (inv, args): Promise<CatalogQueryResult> => {
      const filter: Parameters<OpportunityCatalog['query']>[0] = { topics: args.topics, categories: args.categories, country: args.country };
      if (args.ids) filter.ids = args.ids;
      const r = catalog.query(filter);
      for (const s of r.sources) inv.context.servedSourceIds.add(s.id);
      return r;
    },
  });

  gateway.register({
    name: 'opportunities.upsert_catalog',
    description: 'Record a discovered lead (never a verified fact), or the outcome of reopening an official page for a shortlisted opportunity.',
    kind: 'write',
    args: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('lead'), lead: LeadInputSchema }).strict(),
      z.object({ kind: z.literal('observation'), opportunityId: z.string().regex(/^[a-z0-9_]+$/), sourceId: z.string().min(1), outcome: z.enum(['unchanged', 'changed', 'inaccessible']) }).strict(),
    ]),
    handler: async (inv, args): Promise<{ status: 'recorded' | 'already_curated' | 'unknown_opportunity'; lead?: Lead; opportunity?: Opportunity }> => {
      if (args.kind === 'lead') {
        if (catalog.coversUrl(args.lead.url)) return { status: 'already_curated' };
        return { status: 'recorded', lead: catalog.recordLead(args.lead) };
      }
      const o = catalog.recordObservation(args.opportunityId, { sourceId: args.sourceId, outcome: args.outcome, observedAt: inv.context.clock.nowIso() });
      return o ? { status: 'recorded', opportunity: o } : { status: 'unknown_opportunity' };
    },
  });

  gateway.register({
    name: 'research.search_public',
    description: 'Search public sources with a generalized query (topics, categories, country or city, format, audience, year). The query cannot contain personal details.',
    kind: 'public_research',
    args: z.object({ query: GeneralizedQuerySchema }).strict(),
    handler: async (_inv, args): Promise<SearchOutcome> => {
      const queryText = renderQueryText(args.query, countryName);
      if (!providers.search) return { available: false, queryText, results: [] };
      let hits: SearchHit[];
      try {
        hits = await providers.search.search(args.query, queryText);
      } catch (e) {
        // A provider failure is reported, not turned into results (XT16).
        return { available: true, queryText, results: [], error: e instanceof Error ? e.message.slice(0, 200) : 'search failed' };
      }
      const results = hits
        .filter((h) => isPublicHttpsUrl(h.url))
        .slice(0, 10)
        .map((h) => ({ url: h.url, title: h.title.slice(0, 300), snippet: h.snippet.slice(0, 1000), publisher: h.publisher ? h.publisher.slice(0, 200) : null }));
      return { available: true, queryText, results };
    },
  });

  gateway.register({
    name: 'research.fetch_public',
    description: 'Retrieve a public https page as untrusted text. Pages behind sign-in, CAPTCHA or paywalls are reported as inaccessible and never bypassed.',
    kind: 'public_research',
    args: z.object({ url: z.string().url().refine(isPublicHttpsUrl, { message: 'Only public https pages on named hosts may be fetched' }) }).strict(),
    handler: async (inv, args): Promise<FetchOutcome> => {
      const url = args.url;
      if (!providers.fetch) return { accessible: false, url, reason: 'not_configured', detail: 'No page retrieval is configured in this deployment.' };
      let page: Awaited<ReturnType<NonNullable<ResearchProviders['fetch']>['fetch']>>;
      try {
        page = await providers.fetch.fetch(url);
      } catch (e) {
        return { accessible: false, url, reason: 'network_error', detail: e instanceof Error ? e.message.slice(0, 200) : 'fetch failed' };
      }
      if (!isPublicHttpsUrl(page.finalUrl)) return { accessible: false, url, reason: 'redirect_blocked', detail: 'The page redirected to an address that may not be fetched.' };
      if (page.loginRequired) return { accessible: false, url, reason: 'login_required', detail: 'The page requires signing in; it was not accessed.' };
      if (page.captcha) return { accessible: false, url, reason: 'captcha', detail: 'The page is protected by a CAPTCHA; it was not bypassed.' };
      if (page.paywall) return { accessible: false, url, reason: 'paywall', detail: 'The page is behind paid access; it was not bypassed.' };
      if (page.automatedAccessDisallowed) return { accessible: false, url, reason: 'automated_access_disallowed', detail: 'The site does not permit automated retrieval.' };
      if (page.status >= 400) return { accessible: false, url, reason: 'http_error', detail: `The page returned status ${page.status}.` };
      if (!/^(text\/html|text\/plain|application\/pdf)\b/i.test(page.contentType)) return { accessible: false, url, reason: 'unsupported_content', detail: `Unsupported content type ${page.contentType.slice(0, 60)}.` };
      return {
        accessible: true,
        url,
        finalUrl: page.finalUrl,
        retrievedAt: inv.context.clock.nowIso(),
        contentHash: sha256Hex(page.text),
        text: page.text.slice(0, MAX_PAGE_CHARS),
        truncated: page.text.length > MAX_PAGE_CHARS,
        injectionSignals: detectInjectionSignals(page.text).map((s) => s.pattern),
      };
    },
  });
}
