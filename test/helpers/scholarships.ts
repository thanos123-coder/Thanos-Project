import { ScholarshipAdvisorAgent, type ScholarshipPayload } from '../../src/agents/a16-scholarships/agent.js';
import { ScholarshipCatalog, type ScholarshipInput } from '../../src/agents/a16-scholarships/catalog.js';
import { registerScholarshipTools } from '../../src/agents/a16-scholarships/tools.js';
import { OpportunityCatalog } from '../../src/agents/a09-opportunities/catalog.js';
import type { FetchedPage } from '../../src/agents/a09-opportunities/research.js';
import { registerOpportunityTools } from '../../src/agents/a09-opportunities/tools.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { Actor } from '../../src/shared/permissions.js';
import { connectScholarshipCatalog } from '../../src/system/scholarship-wiring.js';
import { ALL_SCHOLARSHIPS } from '../fixtures/scholarships.js';
import { makeKernel, said, stated } from './kernel.js';

/** Agent 16 harness: real kernel, record, gateway, policy registry and catalog, with a scripted page fetcher. */
export function makeScholarshipHarness(opts: { model?: ModelGateway; catalog?: readonly ScholarshipInput[] } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const catalog = new ScholarshipCatalog(() => h.clock.nowIso());
  for (const s of opts.catalog ?? ALL_SCHOLARSHIPS) catalog.curate(s);
  registerScholarshipTools(h.kernel.gateway, catalog);
  connectScholarshipCatalog(h.kernel, catalog);
  const pages = new Map<string, Partial<FetchedPage>>();
  const fetches: string[] = [];
  registerOpportunityTools(h.kernel.gateway, new OpportunityCatalog(() => h.clock.nowIso()), {
    fetch: {
      fetch: async (url) => {
        fetches.push(url);
        const o = pages.get(url);
        if (!o) throw new Error('not found');
        return { finalUrl: url, status: 200, contentType: 'text/html', text: '', ...o };
      },
    },
  });
  h.kernel.registerSpecialist(new ScholarshipAdvisorAgent(model));

  /** A typical fictional student: US high school senior, class of 2027. */
  const senior = (over: Record<string, unknown> = {}) => {
    const v: Record<string, unknown> = { stage: 'secondary', graduation: '2027-06', school: 'US', citizenships: ['US'], residence: 'US', postsecondary: 'none', ...over };
    const claims = [];
    if (v['stage'] !== null) claims.push(stated(h.student, 'education.stage', v['stage']));
    if (v['graduation'] !== null) claims.push(stated(h.student, 'education.expected_graduation', v['graduation']));
    if (v['school'] !== null) claims.push(stated(h.student, 'education.school_country', v['school']));
    if (v['citizenships'] !== null) claims.push(stated(h.student, 'identity.citizenships', v['citizenships']));
    if (v['residence'] !== null) claims.push(stated(h.student, 'identity.residence_country', v['residence']));
    if (v['postsecondary'] !== null) claims.push(stated(h.student, 'education.postsecondary_enrollment', v['postsecondary']));
    h.seed(claims);
  };
  const applying = (id: string, institutionRef: string, programRef: string | null, rank: number | null = null) => {
    const claims = [buildClaim({ entity: 'application', entityId: id, attribute: 'definition', value: { optionRef: id, institutionRef, campusRef: null, programRef, cycle: '2027', roundRef: null, system: 'direct' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`applying to ${institutionRef}`)], actor: h.student, viaRole: 'ui' })];
    if (rank !== null) claims.push(buildClaim({ entity: 'application', entityId: id, attribute: 'choice_rank', value: { rank, label: rank === 1 ? 'first_choice' : 'other' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`choice ${rank}`)], actor: h.student, viaRole: 'ui' }));
    return h.seed(claims);
  };
  const run = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const spec: Parameters<typeof h.task>[0] = { role: '16', purpose: 'scholarship_matching', objective: 'scholarship_matching', completionContract: 'scholarship_matches_v1', scope };
    if (extra.actor) spec.actor = extra.actor;
    const out = await h.kernel.invoke(h.task(spec));
    return out as typeof out & { result: ResultEnvelope<ScholarshipPayload> };
  };
  const ok = async (scope: Record<string, unknown>) => {
    const out = await run(scope);
    if (!out.accepted) throw new Error(`scholarship task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 800)}`);
    return out.result;
  };
  const shortlist = (over: Record<string, unknown> = {}) => ok({ action: 'shortlist', cycle: '2027', ...over });
  const opp = (r: ResultEnvelope<ScholarshipPayload>, id: string) => r.payload.opportunities.find((o) => o.scholarshipId === id);
  return { ...h, model, catalog, pages, fetches, senior, applying, run, ok, shortlist, opp };
}
