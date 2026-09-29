import { UncertaintyAdvisorAgent, type UncertaintyPayload } from '../../src/agents/a13-uncertainty/agent.js';
import { NumericModelRegistry, registerModelTools, type ModelCard } from '../../src/agents/a13-uncertainty/models.js';
import { InstitutionClaimStore, type Predicate } from '../../src/agents/a11-research/claims.js';
import { InstitutionRegistry } from '../../src/agents/a11-research/entities.js';
import { registerInstitutionTools } from '../../src/agents/a11-research/tools.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { TestScoreRecord } from '../../src/shared/assessments.js';
import { connectInstitutionClaims } from '../../src/system/institution-wiring.js';
import { connectModelRegistry } from '../../src/system/model-wiring.js';
import { ALDERMERE, seedInstitutions } from '../fixtures/institutions.js';
import { makeKernel, said, stated, TENANT } from './kernel.js';

/** Agent 13 harness: real kernel, record, institution claims, model registry and eligibility artifacts. All data is fictional. */
export function makeUncertaintyHarness(opts: { model?: ModelGateway } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const registry = new InstitutionRegistry();
  seedInstitutions(registry);
  const store = new InstitutionClaimStore(() => h.clock.nowIso());
  registerInstitutionTools(h.kernel.gateway, registry, store);
  connectInstitutionClaims(h.kernel, store);
  const models = new NumericModelRegistry();
  registerModelTools(h.kernel.gateway, models);
  connectModelRegistry(h.kernel, models);
  h.kernel.registerSpecialist(new UncertaintyAdvisorAgent(model));

  let n = 0;
  const upsert = (entityId: string, predicate: Predicate, qualifier: string, value: unknown, quote: string, cycle: string | null = '2027') => {
    n += 1;
    const inst = registry.institutionOf(entityId)!;
    const url = `https://ir.${inst.officialDomains[0]}/data/${n}`;
    const sourceId = `src_unc_${n}`;
    store.recordSnapshot({ sourceId, url, finalUrl: url, ownerEntityId: entityId, office: 'registrar', retrievedAt: h.clock.nowIso(), contentHash: 'c'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle, text: quote }] });
    const o = store.upsert({ subject: { entityId, institutionId: inst.id, campusId: null, programId: entityId === inst.id ? null : entityId }, cycle, applicantCategory: 'all', predicate, qualifier, value, sourceOwner: { entityId: inst.id, office: 'registrar', name: inst.name }, anchor: { sourceId, url, finalUrl: url, passageId: `${sourceId}#p1`, section: null, page: null, quote }, retrievedAt: h.clock.nowIso(), status: 'verified', extraction: 'curated', extractionConfidence: 'high' });
    if (o.status === 'rejected') throw new Error(o.issues.join('; '));
    return o.claim;
  };
  const stat = (entityId: string, measure: string, population: string, year: string, value: number, extra: { scoreType?: string; unit?: 'count' | 'percent' | 'score'; label?: string; category?: string | null } = {}) => {
    const unit = extra.unit ?? (measure === 'admit_rate' ? 'percent' : measure.startsWith('score') ? 'score' : 'count');
    const label = extra.label ?? extra.scoreType ?? 'total';
    return upsert(entityId, 'statistic', `${measure}:${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}:${population}`, { measure, cohort: { population, year, applicantCategory: extra.category ?? null }, denominator: measure === 'admit_rate' ? `${population.replace(/_/g, ' ')} in the same cohort` : null, value: { kind: 'number', value, unit, currency: null }, scoreType: extra.scoreType ?? null, methodology: null, notAThreshold: true }, `${label} ${measure} ${value}`, String(year.match(/20\d\d/)?.[0] ?? '2025'));
  };
  const policyChange = (entityId: string, effectiveCycle: string, description: string) => upsert(entityId, 'selection_policy_change', '', { effectiveCycle, description, affectsComparability: true, text: description }, description);
  const guarantee = (entityId: string, route: 'open_admission' | 'guaranteed_admission', conditions: string[], text: string) => upsert(entityId, 'admission_guarantee', '', { route, conditions, text }, text);
  const programAccess = (entityId: string, route: 'later_competitive_selection' | 'direct_entry', text: string) => upsert(entityId, 'program_access_route', '', { route, guaranteed: route === 'direct_entry', text }, text);
  /** An eligibility finding as Agent 06 stores it. */
  const eligibility = (institutionRef: string, programRef: string, overall: 'apparently_meets' | 'conditionally_on_track' | 'requirement_not_met' | 'unresolved', explanation = 'Checked against the published requirements.') =>
    h.kernel.records.putDerived({ ...h.ui, viaRole: '06' }, { tenantId: TENANT, studentId: h.studentId, kind: 'eligibility_finding', scopeKey: `${institutionRef}|-|${programRef}|bachelor|2027|first_year|application`, payload: { overall, explanation }, inputClaimIds: [], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)!, categoryFloor: 'findings' });
  const score = (id: string, rec: Partial<TestScoreRecord> & Pick<TestScoreRecord, 'family'>) => h.seed([buildClaim({ entity: 'test_attempt', entityId: id, attribute: 'record', value: { versionRef: rec.family === 'SAT' ? 'sat_400_1600' : 'act_enhanced', subjectLabel: null, administrationDate: '2026-06', deliveryFormat: 'unknown', sections: {}, reportedTotal: null, comparableLegacyTotal: null, combination: 'single_administration', reportStatus: 'self_reported', ...rec }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`${rec.family} ${rec.reportedTotal ?? ''}`)], actor: h.student, viaRole: 'ui' })]);
  const qualification = (id: string, label: string) => h.seed([stated(h.student, 'education.qualification_system', { id, label })]);
  const card = (over: Partial<ModelCard> = {}): ModelCard => ({
    modelId: 'admit_estimator',
    version: 1,
    target: 'admitted vs not admitted, first-year applications',
    predictionTime: 'application_time',
    supportedPopulation: { institutions: [ALDERMERE], applicantCategories: ['first_year', 'first_year_international'] },
    dataRights: 'Consented outcomes from partner schools (fictional)',
    features: [{ name: 'test_total', availableAt: 'application_time', provenance: 'student_record', sensitive: false }],
    splitGrouping: 'by_student',
    evaluation: { temporal: true, lockedEvaluationSet: true, brier: 0.18, logLoss: 0.52, overallCalibrationSlope: 0.98, subgroups: [{ name: 'domestic first-year', match: { applicantCategory: 'first_year' }, n: 4200, calibrationSlope: 0.97, calibrationIntercept: 0.01 }, { name: 'international first-year', match: { applicantCategory: 'first_year_international' }, n: 140, calibrationSlope: 0.62, calibrationIntercept: -0.2 }] },
    retirementCondition: 'Retire when a selection policy changes or calibration slope leaves 0.8-1.2 on the locked set.',
    approvedBy: 'model_review_board',
    ...over,
  });

  const run = async (scope: Record<string, unknown>) => {
    const out = await h.kernel.invoke(h.task({ role: '13', purpose: 'admissions_context', objective: 'admissions_context', completionContract: 'admissions_uncertainty_v1', scope }));
    return out as typeof out & { result: ResultEnvelope<UncertaintyPayload> };
  };
  const ok = async (scope: Record<string, unknown>) => {
    const out = await run(scope);
    if (!out.accepted) throw new Error(`uncertainty task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 800)}`);
    return out.result;
  };
  const option = (over: Record<string, unknown> = {}) => ({ optionRef: 'aldermere', institution: 'Aldermere College', cycle: '2027', ...over });
  const assess = (over: Record<string, unknown> = {}, options: Array<Record<string, unknown>> = [option()]) => ok({ action: 'assess', options, ...over });
  return { ...h, model, registry, store, models, stat, policyChange, guarantee, programAccess, eligibility, score, qualification, card, run, ok, option, assess };
}
