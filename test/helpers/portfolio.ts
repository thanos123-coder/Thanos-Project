import { PortfolioStrategistAgent, type PortfolioPayload } from '../../src/agents/a14-portfolio/agent.js';
import { InstitutionClaimStore, type Predicate, type RoundRuleValue } from '../../src/agents/a11-research/claims.js';
import { InstitutionRegistry } from '../../src/agents/a11-research/entities.js';
import { registerInstitutionTools } from '../../src/agents/a11-research/tools.js';
import { ScholarshipCatalog, type ScholarshipInput } from '../../src/agents/a16-scholarships/catalog.js';
import { registerScholarshipTools } from '../../src/agents/a16-scholarships/tools.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { Actor } from '../../src/shared/permissions.js';
import { connectInstitutionClaims } from '../../src/system/institution-wiring.js';
import { connectScholarshipCatalog } from '../../src/system/scholarship-wiring.js';
import { scholarship } from '../fixtures/scholarships.js';
import { makeKernel, said, stated, TENANT } from './kernel.js';

/**
 * Agent 14 harness. Every institution, platform, rule, date, fee and award
 * here is fictional; none describes a real college's policy.
 *
 * Larkspur University (private) runs a restrictive early round that limits
 * other private early applications, with exceptions for public institutions
 * and scholarship requirements. Brightwater Institute (private) runs an
 * unrestricted early action. Copperfield State (public) runs an unrestricted
 * early action. Wrenfield College runs a binding early decision whose
 * agreement on file is from an older cycle, and an Early Decision II round
 * open only after a deferral or denial elsewhere. Ashby College is less
 * selective but costly. Maplecrest University admits to the institution with
 * a later competitive selection into nursing. Three UK universities use the
 * fictional Undergraduate Admissions Service, which allows five choices.
 */

export const LARKSPUR = 'larkspur_u';
export const BRIGHTWATER = 'brightwater_i';
export const COPPERFIELD = 'copperfield_su';
export const WRENFIELD = 'wrenfield_c';
export const ASHBY = 'ashby_c';
export const MAPLECREST = 'maplecrest_u';
export const UCAP = 'ucap';
export const UAS = 'uas';

export function seedPortfolioInstitutions(r: InstitutionRegistry): void {
  r.add({ id: LARKSPUR, kind: 'institution', name: 'Larkspur University', parentId: null, country: 'US', officialDomains: ['larkspur.example.edu'], attributes: { control: 'private' } });
  r.add({ id: BRIGHTWATER, kind: 'institution', name: 'Brightwater Institute', parentId: null, country: 'US', officialDomains: ['brightwater.example.edu'], attributes: { control: 'private' } });
  r.add({ id: COPPERFIELD, kind: 'institution', name: 'Copperfield State University', parentId: null, country: 'US', officialDomains: ['copperfield.example.edu'], attributes: { control: 'public' } });
  r.add({ id: WRENFIELD, kind: 'institution', name: 'Wrenfield College', parentId: null, country: 'US', officialDomains: ['wrenfield.example.edu'], attributes: { control: 'private' } });
  r.add({ id: ASHBY, kind: 'institution', name: 'Ashby College', parentId: null, country: 'US', officialDomains: ['ashby.example.edu'], attributes: { control: 'private' } });
  r.add({ id: MAPLECREST, kind: 'institution', name: 'Maplecrest University', parentId: null, country: 'US', officialDomains: ['maplecrest.example.edu'], attributes: { control: 'private' } });
  r.add({ id: 'maplecrest_nursing', kind: 'program', name: 'Nursing', parentId: MAPLECREST, country: 'US', attributes: { degree: 'BSN' } });
  for (const [id, name] of [['harrowgate_u', 'Harrowgate University'], ['thornbury_u', 'Thornbury University'], ['elmsworth_u', 'Elmsworth University']] as const) {
    r.add({ id, kind: 'institution', name, parentId: null, country: 'GB', officialDomains: [`${id.split('_')[0]}.example.ac.uk`], attributes: { control: 'public' } });
    r.add({ id: `${id}_econ`, kind: 'program', name: 'Economics', parentId: id, country: 'GB', attributes: { degree: 'BSc', accessRoute: 'direct_entry' } });
    r.add({ id: `${id}_history`, kind: 'program', name: 'History', parentId: id, country: 'GB', attributes: { degree: 'BA', accessRoute: 'direct_entry' } });
  }
  r.add({ id: UCAP, kind: 'platform', name: 'Unified College Application', parentId: null, country: 'US', officialDomains: ['ucap.example.org'] });
  r.add({ id: UAS, kind: 'platform', name: 'Undergraduate Admissions Service', parentId: null, country: 'GB', officialDomains: ['uas.example.org.uk'] });
}

type RuleInput = Partial<RoundRuleValue> & Pick<RoundRuleValue, 'kind' | 'text'>;

export function makePortfolioHarness(opts: { model?: ModelGateway; now?: string } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model, ...(opts.now ? { now: opts.now } : {}) });
  const registry = new InstitutionRegistry();
  seedPortfolioInstitutions(registry);
  const store = new InstitutionClaimStore(() => h.clock.nowIso());
  registerInstitutionTools(h.kernel.gateway, registry, store);
  connectInstitutionClaims(h.kernel, store);
  const catalog = new ScholarshipCatalog(() => h.clock.nowIso());
  registerScholarshipTools(h.kernel.gateway, catalog);
  connectScholarshipCatalog(h.kernel, catalog);
  h.kernel.registerSpecialist(new PortfolioStrategistAgent(model));

  let n = 0;
  /** A verified official claim anchored to a recorded passage. */
  const official = (entityId: string, predicate: Predicate, qualifier: string, value: unknown, quote: string, o: { cycle?: string | null; status?: 'verified' | 'provisional'; retrievedAt?: string; office?: 'admissions' | 'application_platform' } = {}) => {
    n += 1;
    const owner = registry.institutionOf(entityId)!;
    const url = `https://${owner.officialDomains[0]}/apply/${n}`;
    const sourceId = `src_port_${n}`;
    const retrievedAt = o.retrievedAt ?? h.clock.nowIso();
    const office = o.office ?? (owner.kind === 'platform' ? 'application_platform' : 'admissions');
    const cycle = o.cycle === undefined ? '2027' : o.cycle;
    store.recordSnapshot({ sourceId, url, finalUrl: url, ownerEntityId: entityId, office, retrievedAt, contentHash: 'd'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle, text: quote }] });
    const out = store.upsert({ subject: { entityId, institutionId: owner.id, campusId: null, programId: entityId === owner.id ? null : entityId }, cycle, applicantCategory: 'all', predicate, qualifier, value, sourceOwner: { entityId: owner.id, office, name: owner.name }, anchor: { sourceId, url, finalUrl: url, passageId: `${sourceId}#p1`, section: null, page: null, quote }, retrievedAt, status: o.status ?? 'verified', extraction: 'curated', extractionConfidence: 'high' });
    if (out.status === 'rejected') throw new Error(out.issues.join('; '));
    return out.claim;
  };
  const rule = (entityId: string, round: string, v: RuleInput, o: Parameters<typeof official>[5] = {}) =>
    official(entityId, 'round_rule', round, { round, binding: false, restrictions: [], requiresOutcome: [], decisionRelease: null, replyBy: null, agreementCycle: null, commitmentText: null, ...v }, v.text, o);
  const deadline = (entityId: string, round: string, date: string, time = '23:59', timezone = 'America/New_York', label = 'Eastern Time', o: Parameters<typeof official>[5] = {}) => {
    const text = `${round.replace(/_/g, ' ')} applications must be submitted by ${date} at ${time} ${label}.`;
    return official(entityId, 'application_deadline', round, { date, month: null, time, timezone, timezoneLabel: label, receipt: 'submitted_by', originalText: text }, text, o);
  };
  const prompt = (entityId: string, promptId: string, artifactKind: 'personal_essay' | 'supplement' | 'short_answer' | 'personal_statement', field: string, required = true) => {
    const text = `${field}: tell us about something that matters to you.`;
    return official(entityId, 'writing_prompt', promptId, { promptId, field, text, asks: ['Tell us about something that matters to you.'], required, conditionalOn: null, artifactKind, limit: null }, text);
  };
  const choiceLimit = (platform: string, system: string, maxChoices: number, restrictions: Array<{ rule: string; max: number; text: string }> = []) => {
    const text = `You can choose up to ${maxChoices} courses in one application.`;
    return official(platform, 'application_choice_limit', system, { system, maxChoices, restrictions, text }, text);
  };

  /** The standard fictional rule set used by most tests. */
  const standardRules = () => {
    const out = {
      larkspurRea: rule(LARKSPUR, 'restrictive_early_action', {
        kind: 'restrictive_early_action',
        restrictions: [
          { target: 'any_early_action', exceptions: [{ condition: 'public_institution', text: 'You may apply early to any public college or university whose early round is non-binding.' }, { condition: 'scholarship_requires_early', text: 'You may apply early to another private institution when a scholarship you are applying for requires an early application.' }] },
          { target: 'binding_round', exceptions: [] },
        ],
        text: 'Restrictive Early Action applicants may not apply to another early round or to any binding round, except as listed below.',
      }),
      larkspurRegular: rule(LARKSPUR, 'regular', { kind: 'regular', text: 'Regular Decision places no restrictions on other applications.' }),
      brightwaterEa: rule(BRIGHTWATER, 'early_action', { kind: 'early_action', text: 'Early Action at Brightwater is non-binding and places no restriction on other applications; please respect other institutions’ early policies.' }),
      brightwaterRegular: rule(BRIGHTWATER, 'regular', { kind: 'regular', text: 'Regular Decision places no restrictions on other applications.' }),
      copperfieldEa: rule(COPPERFIELD, 'early_action', { kind: 'early_action', text: 'Copperfield State Early Action is non-binding and unrestricted.' }),
      wrenfieldEd: rule(WRENFIELD, 'early_decision', { kind: 'early_decision', binding: true, restrictions: [{ target: 'early_decision', exceptions: [] }, { target: 'binding_round', exceptions: [] }], agreementCycle: '2025', commitmentText: 'If admitted, I will enroll and withdraw all other applications.', text: 'Early Decision is binding: if admitted, you enroll and withdraw other applications.' }),
      wrenfieldEd2: rule(WRENFIELD, 'early_decision_ii', { kind: 'early_decision', binding: true, restrictions: [{ target: 'binding_round', exceptions: [] }], requiresOutcome: ['deferred_elsewhere', 'denied_elsewhere'], agreementCycle: '2027', commitmentText: 'If admitted, I will enroll and withdraw all other applications.', text: 'Early Decision II is open to students deferred or denied in another institution’s early round.' }),
      ashbyRegular: rule(ASHBY, 'regular', { kind: 'regular', text: 'Regular Decision places no restrictions on other applications.' }),
      maplecrestRegular: rule(MAPLECREST, 'regular', { kind: 'regular', text: 'Regular Decision places no restrictions on other applications.' }),
    };
    deadline(LARKSPUR, 'restrictive_early_action', '2026-11-01');
    deadline(LARKSPUR, 'regular', '2027-01-05');
    deadline(BRIGHTWATER, 'early_action', '2026-11-01');
    deadline(BRIGHTWATER, 'regular', '2027-01-05');
    deadline(COPPERFIELD, 'early_action', '2026-11-15');
    deadline(WRENFIELD, 'early_decision', '2026-11-01');
    deadline(WRENFIELD, 'early_decision_ii', '2027-01-05');
    deadline(ASHBY, 'regular', '2027-01-15');
    deadline(MAPLECREST, 'regular', '2027-01-10');
    return out;
  };

  const affordability = (optionRef: string, state: 'supported' | 'conditional' | 'gap_identified' | 'unknown', fieldKeys: string[] = []) =>
    h.kernel.records.putDerived({ ...h.ui, viaRole: '15' }, { tenantId: TENANT, studentId: h.studentId, kind: 'affordability_scenario', scopeKey: optionRef, payload: { optionRef, state, currency: 'USD', netEducationalCost: '0.00', gapBeforeFinancing: null, assumptions: [], conditions: [] }, inputClaimIds: [], inputFieldKeys: fieldKeys, recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
  const assessment = (optionRef: string, state: 'highly_uncertain_selection' | 'plausible_option_with_material_uncertainty' | 'verified_open_admission' | 'selection_evidence_insufficient') =>
    h.kernel.records.putDerived({ ...h.ui, viaRole: '13' }, { tenantId: TENANT, studentId: h.studentId, kind: 'admissions_assessment', scopeKey: optionRef, payload: { version: 1, state, optionRef, reasons: [] }, inputClaimIds: [], recordVersion: h.kernel.records.recordVersion(TENANT, h.studentId)! });
  const weekly = (min: number, max: number) => h.seed([stated(h.student, 'constraints.weekly_hours_available', { min, max })]);
  const timezone = (zone: string) => h.seed([stated(h.student, 'constraints.timezone', zone)]);
  const setAside = (optionRef: string, reason: string) => h.seed([buildClaim({ entity: 'option_decision', entityId: optionRef, attribute: 'definition', value: { optionRef, decision: 'reject', reason }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(reason)], actor: h.student, viaRole: 'ui' })]);
  const pursue = (scholarshipId: string, stage: 'pursuing' | 'stopped' = 'pursuing') => h.seed([buildClaim({ entity: 'scholarship_application', entityId: scholarshipId, attribute: 'status', value: { opportunityRef: scholarshipId, stage }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`${stage} ${scholarshipId}`)], actor: h.student, viaRole: 'ui' })]);
  const award = (input: ScholarshipInput) => catalog.curate(input);
  /** The amount available for college each year, as Agent 15 reads it. */
  const budget = (max: string) => h.seed([buildClaim({ entity: 'attendance_budget', entityId: 'own', attribute: 'definition', value: { min: null, max: { amount: max, currency: 'USD' }, period: 'annual', includesTravelAndPersonal: true, basis: 'student_estimate', availableFrom: null }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`we can manage ${max} a year`)], actor: h.student, viaRole: 'ui' })]);
  const fictionalScholarship = scholarship;

  const option = (optionRef: string, institution: string, round: string, over: Record<string, unknown> = {}) => ({ optionRef, institution, round, ...over });
  const run = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const spec: Parameters<typeof h.task>[0] = { role: '14', purpose: 'application_strategy', objective: 'application_strategy', completionContract: 'portfolio_plan_v1', scope };
    if (extra.actor) spec.actor = extra.actor;
    const out = await h.kernel.invoke(h.task(spec));
    return out as typeof out & { result: ResultEnvelope<PortfolioPayload> };
  };
  const ok = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const out = await run(scope, extra);
    if (!out.accepted) throw new Error(`portfolio task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 900)}`);
    return out.result;
  };
  const plan = (options: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ok({ action: 'plan', cycle: '2027', options, ...over });
  const opt = (r: ResultEnvelope<PortfolioPayload>, ref: string) => r.payload.options.find((o) => o.optionRef === ref)!;
  const gap = (r: ResultEnvelope<PortfolioPayload>, code: string) => r.payload.coverage?.gaps.filter((g) => g.code === code) ?? [];
  const task = (r: ResultEnvelope<PortfolioPayload>, id: string) => r.payload.tasks.find((t) => t.taskId === id);
  const plans = () => h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'portfolio_plan' });
  return { ...h, model, registry, store, catalog, official, rule, deadline, prompt, choiceLimit, standardRules, affordability, assessment, weekly, timezone, setAside, pursue, award, budget, fictionalScholarship, option, run, ok, plan, opt, gap, task, plans };
}
