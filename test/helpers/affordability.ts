import { AffordabilityPlannerAgent, type AffordabilityPayload } from '../../src/agents/a15-affordability/agent.js';
import { registerFinanceTools, type ExchangeRateProvider } from '../../src/agents/a15-affordability/tools.js';
import { InstitutionClaimStore, type ClaimInput as InstitutionClaimInput, type ClaimRecord } from '../../src/agents/a11-research/claims.js';
import { InstitutionRegistry } from '../../src/agents/a11-research/entities.js';
import { registerInstitutionTools } from '../../src/agents/a11-research/tools.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import { DocumentStore } from '../../src/agents/a03-document-interpreter/documents.js';
import { registerDocumentTools } from '../../src/agents/a03-document-interpreter/tools.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { AttendanceBudget, FundingAward } from '../../src/shared/fields.js';
import type { Actor } from '../../src/shared/permissions.js';
import { connectInstitutionClaims } from '../../src/system/institution-wiring.js';
import { ALDERMERE, KESTREL, seedInstitutions } from '../fixtures/institutions.js';
import { makeKernel, said, TENANT } from './kernel.js';

export interface CostSeed {
  predicate: 'tuition' | 'mandatory_fees' | 'housing' | 'meals' | 'books_supplies' | 'health_insurance' | 'transport' | 'personal' | 'cost_of_attendance' | 'application_fee' | 'enrollment_deposit';
  amount: string;
  currency?: string;
  period?: 'academic_year' | 'semester' | 'term' | 'quarter' | 'month' | 'credit' | 'one_time' | 'program_total';
  feeCategory?: 'all' | 'domestic' | 'international' | 'in_state' | 'out_of_state' | 'home' | 'overseas';
  includes?: string[];
  billed?: boolean | null;
  status?: 'verified' | 'provisional' | 'historical';
  cycle?: string;
}

/**
 * Agent 15 harness: the real kernel, record service, permission checks,
 * institution claim store and document store, with a scripted exchange-rate
 * provider. Official costs are seeded as anchored claims, the way Agent 11
 * stores them.
 */
export function makeAffordabilityHarness(opts: { model?: ModelGateway; rates?: ExchangeRateProvider | 'none' } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const registry = new InstitutionRegistry();
  seedInstitutions(registry);
  const store = new InstitutionClaimStore(() => h.clock.nowIso());
  registerInstitutionTools(h.kernel.gateway, registry, store);
  connectInstitutionClaims(h.kernel, store);
  const rateCalls: Array<{ from: string; to: string }> = [];
  const provider: ExchangeRateProvider | undefined =
    opts.rates === 'none'
      ? undefined
      : opts.rates ?? {
          rate: async (from, to) => {
            rateCalls.push({ from, to });
            if (from === 'USD' && to === 'EUR') return { rate: '0.90', asOf: '2026-09-25' };
            if (from === 'GBP' && to === 'EUR') return { rate: '1.15', asOf: '2026-09-25' };
            throw new Error('no rate');
          },
        };
  registerFinanceTools(h.kernel.gateway, provider);
  const documents = new DocumentStore(h.clock, h.ids, h.kernel.records.permissions, null, undefined, 'test-secret');
  registerDocumentTools(h.kernel.gateway, documents, h.kernel.records.permissions);
  h.kernel.records.registerDerivativeStore(documents);
  h.kernel.registerSpecialist(new AffordabilityPlannerAgent(model));

  let n = 0;
  /** Seed official cost claims for an entity, each anchored to a passage of a recorded snapshot. */
  const costs = (entityId: string, seeds: CostSeed[], extra: InstitutionClaimInput[] = []): ClaimRecord[] => {
    n += 1;
    const sourceId = `src_cost_${n}`;
    const url = entityId.startsWith('kestrel') ? `https://www.kestrel.example.ac.uk/fees/${n}` : `https://finaid.aldermere.example.edu/cost/${n}`;
    const quote = (s: CostSeed) => `${s.predicate.replace(/_/g, ' ')} ${s.feeCategory ?? 'all'} ${s.amount} ${s.currency ?? 'USD'} per ${s.period ?? 'academic_year'}`;
    store.recordSnapshot({ sourceId, url, finalUrl: url, ownerEntityId: entityId, office: 'financial_aid', retrievedAt: h.clock.nowIso(), contentHash: 'd'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle: '2027', text: [...seeds.map(quote), ...extra.map((e) => e.anchor.quote)].join('\n') }] });
    const out: ClaimRecord[] = [];
    const inst = entityId.startsWith('kestrel') ? KESTREL : ALDERMERE;
    for (const s of seeds) {
      const o = store.upsert({
        subject: { entityId, institutionId: inst, campusId: null, programId: entityId === inst ? null : entityId },
        cycle: s.cycle ?? '2027',
        applicantCategory: 'first_year',
        predicate: s.predicate,
        qualifier: s.feeCategory ?? 'all',
        value: { amount: { amount: s.amount, currency: s.currency ?? 'USD' }, period: s.period ?? 'academic_year', feeCategory: s.feeCategory ?? 'all', includes: s.includes ?? [], billed: s.billed ?? null },
        sourceOwner: { entityId: inst, office: 'financial_aid', name: inst === KESTREL ? 'Kestrel University' : 'Aldermere College' },
        anchor: { sourceId, url, finalUrl: url, passageId: `${sourceId}#p1`, section: null, page: null, quote: quote(s) },
        retrievedAt: h.clock.nowIso(),
        status: s.status ?? 'verified',
        extraction: 'curated',
        extractionConfidence: 'high',
      });
      if (o.status === 'rejected') throw new Error(`cost claim rejected: ${o.issues.join('; ')}`);
      out.push(o.claim);
    }
    for (const e of extra) {
      const o = store.upsert({ ...e, anchor: { ...e.anchor, sourceId, url, finalUrl: url, passageId: `${sourceId}#p1` } });
      if (o.status === 'rejected') throw new Error(`claim rejected: ${o.issues.join('; ')}`);
      out.push(o.claim);
    }
    return out;
  };

  /** An official policy or rule claim (outside awards, estimator scope, aid timing, program length). */
  const rule = (predicate: 'outside_award_policy' | 'estimator_scope' | 'aid_application_timing' | 'program_attribute', value: unknown, quote: string, entityId = ALDERMERE): InstitutionClaimInput => ({
    subject: { entityId, institutionId: entityId.startsWith('kestrel') ? KESTREL : ALDERMERE, campusId: null, programId: null },
    cycle: '2027',
    applicantCategory: 'first_year',
    predicate,
    qualifier: '',
    value,
    sourceOwner: { entityId: ALDERMERE, office: 'financial_aid', name: 'Aldermere College' },
    anchor: { sourceId: 'x', url: 'https://finaid.aldermere.example.edu/x', finalUrl: 'https://finaid.aldermere.example.edu/x', passageId: null, section: null, page: null, quote },
    retrievedAt: h.clock.nowIso(),
    status: 'verified',
    extraction: 'curated',
    extractionConfidence: 'high',
  });

  const funding = (entityId: string, v: Partial<FundingAward> & Pick<FundingAward, 'name' | 'kind' | 'amount'>) => {
    const value: FundingAward = { provider: 'Aldermere College', period: 'one_academic_year', coveredCosts: null, stage: 'offered', optionRef: null, renewal: null, basis: 'unknown', eligibilityProgram: null, disbursesOn: null, externalRefs: [], ...v };
    return h.seed([buildClaim({ entity: 'funding_award', entityId, attribute: 'definition', value, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`${v.name} ${v.amount.amount}`)], actor: h.student, viaRole: 'ui' })]);
  };

  /** The student's own money. */
  const savings = (max: string, extra: Partial<AttendanceBudget> = {}, currency = 'USD') =>
    h.seed([buildClaim({ entity: 'attendance_budget', entityId: 'own', attribute: 'definition', value: { min: null, max: { amount: max, currency }, period: 'annual', includesTravelAndPersonal: true, basis: 'student_estimate', availableFrom: null, ...extra } satisfies AttendanceBudget, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`I have ${max} saved`)], actor: h.student, viaRole: 'ui' })]);

  /** The student's estimate of what family may give (not a commitment). */
  const familyEstimate = (max: string, extra: Partial<AttendanceBudget> = {}, currency = 'USD') =>
    h.seed([buildClaim({ entity: 'attendance_budget', entityId: 'family', attribute: 'definition', value: { min: null, max: { amount: max, currency }, period: 'annual', includesTravelAndPersonal: true, basis: 'student_estimate', availableFrom: null, ...extra } satisfies AttendanceBudget, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`my parents might give ${max}`)], actor: h.student, viaRole: 'ui', holder: { kind: 'reported_other', label: 'parents' } })]);

  const parent: Actor = { id: 'acct_parent_1', kind: 'supporter', tenantId: TENANT };
  let granted = false;
  /** A supporter's own confirmed commitment. */
  const supporterCommitment = (max: string, extra: Partial<AttendanceBudget> = {}, currency = 'USD') => {
    if (!granted) {
      h.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['counseling', 'financial_planning'], categories: ['financial'], access: ['read', 'write'], policyBasis: 'student_invitation' });
      granted = true;
    }
    return h.seed([buildClaim({ entity: 'attendance_budget', entityId: 'family', attribute: 'definition', value: { min: null, max: { amount: max, currency }, period: 'annual', includesTravelAndPersonal: true, basis: 'supporter_confirmed', availableFrom: null, ...extra } satisfies AttendanceBudget, origin: 'supporter_statement', evidence: [said(`We can contribute ${max} a year`)], actor: parent, viaRole: 'ui', holder: { kind: 'supporter', actorId: parent.id } })], parent);
  };

  const run = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const spec: Parameters<typeof h.task>[0] = { role: '15', purpose: 'financial_planning', objective: 'financial_planning', completionContract: 'affordability_ledger_v1', scope };
    if (extra.actor) spec.actor = extra.actor;
    const out = await h.kernel.invoke(h.task(spec));
    return out as typeof out & { result: ResultEnvelope<AffordabilityPayload> };
  };
  const ok = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const out = await run(scope, extra);
    if (!out.accepted) throw new Error(`affordability task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 800)}`);
    return out.result;
  };
  const option = (over: Record<string, unknown> = {}) => ({ optionRef: 'aldermere', institution: 'Aldermere College', cycle: '2027', ...over });
  const compare = (over: Record<string, unknown> = {}, options: Array<Record<string, unknown>> = [option()]) => ok({ action: 'compare', options, ...over });
  const toolCalls = (taskId: string) => h.kernel.audit.list({ taskId }).map((e) => `${e.name}:${e.outcome}`);
  return { ...h, model, registry, store, documents, rateCalls, parent, costs, rule, funding, savings, familyEstimate, supporterCommitment, run, ok, option, compare, toolCalls };
}

/** The worked example's fictional annual costs: 50,000 in total. */
export const WORKED_COSTS: CostSeed[] = [
  { predicate: 'tuition', amount: '32000.00', includes: ['mandatory_fees'], billed: true },
  { predicate: 'housing', amount: '12000.00', includes: ['meals'], billed: true },
  { predicate: 'books_supplies', amount: '1500.00', billed: false },
  { predicate: 'transport', amount: '1500.00', billed: false },
  { predicate: 'health_insurance', amount: '1000.00', billed: true },
  { predicate: 'personal', amount: '2000.00', billed: false },
];
