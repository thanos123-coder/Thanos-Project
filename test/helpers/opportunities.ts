import { OpportunityScoutAgent, type OpportunityPayload } from '../../src/agents/a09-opportunities/agent.js';
import { OpportunityCatalog, type OpportunityInput } from '../../src/agents/a09-opportunities/catalog.js';
import type { FetchedPage, GeneralizedQuery, ResearchProviders, SearchHit } from '../../src/agents/a09-opportunities/research.js';
import { registerOpportunityTools } from '../../src/agents/a09-opportunities/tools.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { Actor } from '../../src/shared/permissions.js';
import type { SourceRecord } from '../../src/shared/sources.js';
import { connectOpportunityCatalog } from '../../src/system/opportunity-wiring.js';
import { COVERAGE, PAGE_TEXT } from '../fixtures/opportunities.js';
import { makeKernel, stated } from './kernel.js';

export function makeOpportunityHarness(opts: { model?: ModelGateway; search?: boolean; fetch?: boolean } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const catalog = new OpportunityCatalog(() => h.clock.nowIso());
  catalog.setCoverage({ ...COVERAGE, categories: [...COVERAGE.categories] });
  const searches: Array<{ query: GeneralizedQuery; text: string }> = [];
  const fetches: string[] = [];
  let hits: SearchHit[] = [];
  const pages = new Map<string, Partial<FetchedPage>>();
  const providers: ResearchProviders = {};
  if (opts.search !== false) providers.search = { search: async (query, text) => (searches.push({ query, text }), hits) };
  if (opts.fetch !== false) {
    providers.fetch = {
      fetch: async (url) => {
        fetches.push(url);
        const o = pages.get(url);
        const text = o?.text ?? PAGE_TEXT[url];
        if (text === undefined && !o) throw new Error('not found');
        return { finalUrl: url, status: 200, contentType: 'text/html', text: text ?? '', ...o };
      },
    };
  }
  registerOpportunityTools(h.kernel.gateway, catalog, providers);
  connectOpportunityCatalog(h.kernel, catalog);
  h.kernel.registerSpecialist(new OpportunityScoutAgent(model));

  const add = (sources: SourceRecord[], opportunities: OpportunityInput[]) => {
    for (const s of sources) catalog.addSource(s);
    for (const o of opportunities) catalog.curate(o);
  };
  const run = async (scope: Record<string, unknown>, extra: { allowedTools?: string[] } = {}) => {
    const spec: Parameters<typeof h.task>[0] = { role: '09', purpose: 'opportunity_research', objective: 'opportunity_research', completionContract: 'opportunity_dossier_v1', scope };
    if (extra.allowedTools) spec.allowedTools = extra.allowedTools;
    const req = h.task(spec);
    return (await h.kernel.invoke(req)) as Awaited<ReturnType<typeof h.kernel.invoke>> & { result: ResultEnvelope<OpportunityPayload> };
  };
  const ok = async (scope: Record<string, unknown>, extra: { allowedTools?: string[] } = {}) => {
    const out = await run(scope, extra);
    if (!out.accepted) throw new Error(`opportunity task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 600)}`);
    return out.result;
  };
  const shortlist = (request: Record<string, unknown> = {}, extra: { allowedTools?: string[] } = {}) => ok({ action: 'shortlist', request }, extra);
  const cards = (r: ResultEnvelope<OpportunityPayload>) => [...(r.payload.shortlist?.feasibleNow ?? []), ...(r.payload.shortlist?.conditional ?? [])];
  const card = (r: ResultEnvelope<OpportunityPayload>, id: string) => cards(r).find((c) => c.opportunityId === id);
  return {
    ...h,
    model,
    catalog,
    searches,
    fetches,
    pages,
    setHits: (x: SearchHit[]) => {
      hits = x;
    },
    add,
    run,
    ok,
    shortlist,
    cards,
    card,
  };
}

/** Amara (synthetic): lives in Athens, cannot travel overnight, €150 total including transport, wants to explore engineering. */
export function amara(student: Actor, over: Record<string, unknown> = {}) {
  const v = {
    location: { country: 'GR', region: 'Attica', city: 'Athens' },
    timezone: 'Europe/Athens',
    travel: { overnightTravelPossible: false, maxTravelMinutes: 60, travelDuringTermPossible: null },
    budget: { amount: { amount: '150.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all', appliesTo: 'per_opportunity' },
    windows: [{ start: '2027-06-20', end: '2027-08-31', ongoing: false }],
    weekly: { min: 10, max: 25 },
    birth: '2010-05-10',
    stage: 'secondary',
    graduation: '2028-06',
    residence: 'GR',
    citizenships: ['NG'],
    device: 'reliable_own_device',
    interest: 'I want to explore engineering and building things',
    ...over,
  } as Record<string, unknown>;
  const claims = [
    stated(student, 'constraints.location_broad', v['location']),
    stated(student, 'constraints.timezone', v['timezone']),
    stated(student, 'constraints.travel', v['travel']),
    stated(student, 'constraints.availability_windows', v['windows']),
    stated(student, 'constraints.weekly_hours_available', v['weekly']),
    stated(student, 'education.stage', v['stage']),
    stated(student, 'education.expected_graduation', v['graduation']),
    stated(student, 'identity.birth_date', v['birth']),
    stated(student, 'identity.residence_country', v['residence']),
    stated(student, 'identity.citizenships', v['citizenships']),
    stated(student, 'constraints.device_access', v['device']),
    stated(student, 'description', { text: v['interest'], lens: 'interest' }, { entity: 'interest', entityId: 'i1' }),
  ];
  if (v['budget'] !== null) claims.push(stated(student, 'constraints.opportunity_budget', v['budget']));
  if (v['dailyHours']) claims.push(stated(student, 'constraints.daily_available_hours', v['dailyHours']));
  return claims;
}
