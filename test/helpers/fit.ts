import { FitMatcherAgent, type FitPayload } from '../../src/agents/a12-fit/agent.js';
import { InstitutionClaimStore } from '../../src/agents/a11-research/claims.js';
import { InstitutionRegistry } from '../../src/agents/a11-research/entities.js';
import { registerInstitutionTools } from '../../src/agents/a11-research/tools.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { FitPriority } from '../../src/shared/fields.js';
import type { Actor } from '../../src/shared/permissions.js';
import { connectInstitutionClaims } from '../../src/system/institution-wiring.js';
import { makeKernel, said, TENANT } from './kernel.js';

/**
 * Three fictional programs mirroring the specification's worked comparison:
 * A offers the subject directly but strains the budget, B is affordable with
 * a later competitive selection for the specialization, and C is broad and
 * flexible but further from home. All names and facts are synthetic.
 */
export const A = 'coralwood_marine_bio';
export const B = 'fernhill_biology';
export const C = 'tidewater_las';

export function makeFitHarness(opts: { model?: ModelGateway } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const registry = new InstitutionRegistry();
  registry.add({ id: 'coralwood_u', kind: 'institution', name: 'Coralwood University', parentId: null, country: 'US', officialDomains: ['coralwood.example.edu'] });
  registry.add({ id: A, kind: 'program', name: 'Marine Biology', parentId: 'coralwood_u', country: 'US', attributes: { degree: 'BS', accessRoute: 'direct_entry' } });
  registry.add({ id: 'fernhill_c', kind: 'institution', name: 'Fernhill College', parentId: null, country: 'US', officialDomains: ['fernhill.example.edu'] });
  registry.add({ id: B, kind: 'program', name: 'Biology', aliases: ['Marine Biology track'], parentId: 'fernhill_c', country: 'US', attributes: { degree: 'BS' } });
  registry.add({ id: 'tidewater_c', kind: 'institution', name: 'Tidewater College', parentId: null, country: 'CA', officialDomains: ['tidewater.example.ca'] });
  registry.add({ id: C, kind: 'program', name: 'Liberal Arts and Sciences', aliases: ['Biology', 'Marine Biology concentration'], parentId: 'tidewater_c', country: 'CA', attributes: { degree: 'BA', accessRoute: 'direct_entry' } });
  registry.add({ id: 'quillon_u', kind: 'institution', name: 'Quillon University', parentId: null, country: 'US', officialDomains: ['quillon.example.edu'] });
  registry.add({ id: 'quillon_history', kind: 'program', name: 'History', parentId: 'quillon_u', country: 'US', attributes: { accessRoute: 'direct_entry' } });
  const store = new InstitutionClaimStore(() => h.clock.nowIso());
  registerInstitutionTools(h.kernel.gateway, registry, store);
  connectInstitutionClaims(h.kernel, store);
  h.kernel.registerSpecialist(new FitMatcherAgent(model));

  let n = 0;
  const claims: { aSetting?: ReturnType<typeof attribute> } = {};
  const institutionOf = (id: string) => registry.institutionOf(id)!;
  /** An official program attribute or access claim, anchored to a recorded passage. */
  const attribute = (entityId: string, attribute: string, value: unknown, text = `${attribute}: ${JSON.stringify(value)}`) => {
    n += 1;
    const inst = institutionOf(entityId);
    const url = `https://${inst.officialDomains[0]}/facts/${n}`;
    const sourceId = `src_fit_${n}`;
    store.recordSnapshot({ sourceId, url, finalUrl: url, ownerEntityId: entityId, office: 'department', retrievedAt: h.clock.nowIso(), contentHash: 'e'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle: '2027', text }] });
    const o = store.upsert({ subject: { entityId, institutionId: inst.id, campusId: null, programId: entityId === inst.id ? null : entityId }, cycle: '2027', applicantCategory: 'all', predicate: 'program_attribute', qualifier: attribute, value: { attribute, value, text }, sourceOwner: { entityId: inst.id, office: 'department', name: inst.name }, anchor: { sourceId, url, finalUrl: url, passageId: `${sourceId}#p1`, section: null, page: null, quote: text }, retrievedAt: h.clock.nowIso(), status: 'verified', extraction: 'curated', extractionConfidence: 'high' });
    if (o.status === 'rejected') throw new Error(o.issues.join('; '));
    return o.claim;
  };
  /** The same official page corrected: a new version of the same claim (same source URL), as the source monitor would record it. */
  const correct = (claim: ReturnType<typeof attribute>, value: unknown, text: string) => {
    n += 1;
    const sourceId = `src_fit_${n}`;
    store.recordSnapshot({ sourceId, url: claim.anchor.url, finalUrl: claim.anchor.url, ownerEntityId: claim.subject.entityId, office: 'department', retrievedAt: h.clock.nowIso(), contentHash: 'a'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle: '2027', text }] });
    const { claimId: _id, version: _v, conflictLinks: _c, nextReviewDue: _n, recordedAt: _r, dependents: _d, ...input } = claim;
    const o = store.upsert({ ...input, value: { ...(claim.value as object), value, text }, anchor: { ...claim.anchor, sourceId, passageId: `${sourceId}#p1`, quote: text }, retrievedAt: h.clock.nowIso(), status: 'verified' });
    if (o.status === 'rejected') throw new Error(o.issues.join('; '));
    return o;
  };
  const access = (entityId: string, route: 'direct_entry' | 'later_competitive_selection' | 'open_after_prerequisites', text: string) => {
    n += 1;
    const inst = institutionOf(entityId);
    const url = `https://${inst.officialDomains[0]}/access/${n}`;
    const sourceId = `src_fit_${n}`;
    store.recordSnapshot({ sourceId, url, finalUrl: url, ownerEntityId: entityId, office: 'department', retrievedAt: h.clock.nowIso(), contentHash: 'f'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle: '2027', text }] });
    const o = store.upsert({ subject: { entityId, institutionId: inst.id, campusId: null, programId: entityId }, cycle: '2027', applicantCategory: 'all', predicate: 'program_access_route', qualifier: '', value: { route, guaranteed: route === 'direct_entry' ? true : false, text }, sourceOwner: { entityId: inst.id, office: 'department', name: inst.name }, anchor: { sourceId, url, finalUrl: url, passageId: `${sourceId}#p1`, section: null, page: null, quote: text }, retrievedAt: h.clock.nowIso(), status: 'verified', extraction: 'curated', extractionConfidence: 'high' });
    if (o.status === 'rejected') throw new Error(o.issues.join('; '));
    return o.claim;
  };
  /** The worked example's evidence. */
  const worked = () => {
    attribute(A, 'subject_flexibility', 'low');
    claims.aSetting = attribute(A, 'setting', 'urban');
    attribute(B, 'subject_flexibility', 'medium');
    attribute(B, 'setting', 'suburban');
    access(B, 'later_competitive_selection', 'Students apply to the Marine Biology track after the first year; places are limited and admission to Fernhill does not guarantee a place.');
    attribute(C, 'subject_flexibility', 'high');
    attribute(C, 'setting', 'suburban');
  };
  const affordability = (optionRef: string, state: 'supported' | 'conditional' | 'gap_identified' | 'unknown', conditions: string[] = []) =>
    h.kernel.records.putDerived({ ...h.ui, viaRole: '15' }, { tenantId: TENANT, studentId: h.studentId, kind: 'affordability_scenario', scopeKey: optionRef, payload: { optionRef, state, currency: 'USD', netEducationalCost: '0.00', gapBeforeFinancing: null, assumptions: [], conditions }, inputClaimIds: [], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
  const priority = (v: Partial<FitPriority> & Pick<FitPriority, 'dimension' | 'statement'>, actor: Actor = h.student) =>
    h.seed([buildClaim({ entity: 'fit_priority', entityId: v.dimension, attribute: 'definition', value: { kind: 'preference', value: null, weight: 3, provisional: false, ...v } satisfies FitPriority, origin: actor.kind === 'student' ? 'student_statement' : 'supporter_statement', ...(actor.kind === 'student' ? { confirmation: 'student_confirmed' as const } : {}), evidence: [said(v.statement)], actor, viaRole: 'ui', ...(actor.kind === 'supporter' ? { holder: { kind: 'supporter' as const, actorId: actor.id } } : {}) })], actor);
  const parent: Actor = { id: 'acct_parent_fit', kind: 'supporter', tenantId: TENANT };
  const grantParent = () => h.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['counseling', 'fit_matching'], categories: ['goals_preferences'], access: ['read', 'write'], policyBasis: 'student_invitation' });

  const run = async (scope: Record<string, unknown>) => {
    const out = await h.kernel.invoke(h.task({ role: '12', purpose: 'fit_matching', objective: 'fit_matching', completionContract: 'fit_shortlist_v1', scope }));
    return out as typeof out & { result: ResultEnvelope<FitPayload> };
  };
  const ok = async (scope: Record<string, unknown>) => {
    const out = await run(scope);
    if (!out.accepted) throw new Error(`fit task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 800)}`);
    return out.result;
  };
  const match = (over: Record<string, unknown> = {}) => ok({ action: 'match', cycle: '2027', ...over });
  const card = (r: ResultEnvelope<FitPayload>, ref: string) => [...r.payload.cards, ...r.payload.more, ...r.payload.exploration, ...r.payload.excluded].find((c) => c.optionRef === ref);
  const rankOf = (r: ResultEnvelope<FitPayload>) => [...r.payload.cards, ...r.payload.more].map((c) => c.optionRef);
  return { ...h, model, registry, store, attribute, correct, claims, access, worked, affordability, priority, parent, grantParent, run, ok, match, card, rankOf };
}
