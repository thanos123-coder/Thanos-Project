import { OfficialResearchAgent, type EvidencePacket } from '../../src/agents/a11-research/agent.js';
import { InstitutionClaimStore } from '../../src/agents/a11-research/claims.js';
import { InstitutionRegistry } from '../../src/agents/a11-research/entities.js';
import { registerInstitutionTools, type OfficialQuery, type OfficialSearchProvider } from '../../src/agents/a11-research/tools.js';
import type { FetchedPage, ResearchProviders, SearchHit } from '../../src/agents/a09-opportunities/research.js';
import { registerOpportunityTools } from '../../src/agents/a09-opportunities/tools.js';
import { OpportunityCatalog } from '../../src/agents/a09-opportunities/catalog.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import { connectInstitutionClaims } from '../../src/system/institution-wiring.js';
import { seedInstitutions, seedPages, TEXT, PAGES } from '../fixtures/institutions.js';
import { makeKernel } from './kernel.js';

/**
 * Agent 11 harness: the real kernel, record service, tool gateway, institution
 * registry and claim store, with a scripted fetcher and official search.
 */
export function makeResearchHarness(opts: { model?: ModelGateway; pages?: ReadonlyArray<keyof typeof PAGES>; search?: boolean; now?: string } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const kopts: Parameters<typeof makeKernel>[0] = { model };
  if (opts.now) kopts.now = opts.now;
  const h = makeKernel(kopts);
  const registry = new InstitutionRegistry();
  seedInstitutions(registry);
  seedPages(registry, opts.pages ?? []);
  const store = new InstitutionClaimStore(() => h.clock.nowIso());
  const fetches: string[] = [];
  const pages = new Map<string, Partial<FetchedPage>>();
  const searches: Array<{ query: OfficialQuery; text: string }> = [];
  let hits: SearchHit[] = [];
  const providers: ResearchProviders = {
    fetch: {
      fetch: async (url) => {
        fetches.push(url);
        const o = pages.get(url);
        const text = o?.text ?? TEXT[url];
        if (text === undefined && !o) throw new Error('not found');
        return { finalUrl: url, status: 200, contentType: 'text/html', text: text ?? '', ...o };
      },
    },
  };
  // The fetch tool is shared with Agent 09; registering it through its module keeps one implementation.
  registerOpportunityTools(h.kernel.gateway, new OpportunityCatalog(() => h.clock.nowIso()), providers);
  const search: OfficialSearchProvider = { search: async (query, text) => (searches.push({ query, text }), hits) };
  registerInstitutionTools(h.kernel.gateway, registry, store, opts.search === false ? undefined : search);
  connectInstitutionClaims(h.kernel, store);
  h.kernel.registerSpecialist(new OfficialResearchAgent(model));

  const run = async (scope: Record<string, unknown>, extra: { budget?: { maxToolCalls?: number; maxModelCalls?: number } } = {}) => {
    const spec: Parameters<typeof h.task>[0] = { role: '11', purpose: 'college_research', objective: 'college_research', completionContract: 'evidence_packet_v1', scope };
    if (extra.budget) spec.budget = extra.budget;
    const req = h.task(spec);
    const out = await h.kernel.invoke(req);
    return out as typeof out & { result: ResultEnvelope<EvidencePacket> };
  };
  const ok = async (scope: Record<string, unknown>, extra: Parameters<typeof run>[1] = {}) => {
    const out = await run(scope, extra);
    if (!out.accepted) throw new Error(`research task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 800)}`);
    return out.result;
  };
  const research = (over: Record<string, unknown>, extra: Parameters<typeof run>[1] = {}) => ok({ action: 'research', institution: 'Aldermere College', cycle: '2027', applicantCategory: 'first_year', decision: 'deadline_check', ...over }, extra);
  const toolCalls = (taskId: string) => h.kernel.audit.list({ taskId }).filter((e) => e.kind === 'tool_call' || e.kind === 'tool_denied').map((e) => e.name);
  return {
    ...h,
    model,
    registry,
    store,
    fetches,
    pages,
    searches,
    setHits: (x: SearchHit[]) => {
      hits = x;
    },
    run,
    ok,
    research,
    toolCalls,
  };
}
