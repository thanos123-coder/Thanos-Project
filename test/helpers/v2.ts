import { ROLE_PURPOSE } from '../../src/agents/a01-orchestrator/roles.js';
import type { Predicate } from '../../src/agents/a11-research/claims.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { ScholarshipInput } from '../../src/agents/a16-scholarships/catalog.js';
import type { ResultEnvelope, RoleId } from '../../src/shared/envelopes.js';
import type { FundingAward } from '../../src/shared/fields.js';
import type { Actor } from '../../src/shared/permissions.js';
import { seedPortfolioInstitutions } from './portfolio.js';
import { said, TENANT } from './kernel.js';
import { makeSystem } from './system.js';

/**
 * The volume-two cross-agent harness: the whole CounselorSystem with every
 * specialist and shared store, seeded with fictional institutions, official
 * claims, scholarships, policies and student facts. Scenarios run through the
 * real tool gateway, record service, invalidation and orchestration.
 */

const CONTRACT: Record<string, string> = {
  '10': 'project_plan_v1',
  '11': 'evidence_packet_v1',
  '12': 'fit_shortlist_v1',
  '13': 'admissions_uncertainty_v1',
  '14': 'portfolio_plan_v1',
  '15': 'affordability_ledger_v1',
  '16': 'scholarship_matches_v1',
  '17': 'story_session_v1',
  '18': 'narrative_review_v1',
};

export const USD = (amount: string) => ({ amount, currency: 'USD' });

export function makeV2(opts: { now?: string } = {}) {
  const h = makeSystem(opts.now ? { now: opts.now } : {});
  const { system } = h;
  const registry = system.institutions;
  seedPortfolioInstitutions(registry);
  registry.add({ id: 'aldermere_c', kind: 'institution', name: 'Aldermere College', aliases: ['Aldermere'], parentId: null, country: 'US', officialDomains: ['aldermere.example.edu'], attributes: { control: 'private' } });
  registry.add({ id: 'aldermere_arch', kind: 'program', name: 'Architecture', parentId: 'aldermere_c', country: 'US', attributes: { degree: 'BArch' } });

  let n = 0;
  /** A verified official claim anchored to a recorded passage, as Agent 11 stores it. */
  const official = (entityId: string, predicate: Predicate, qualifier: string, value: unknown, quote: string, o: { status?: 'verified' | 'provisional'; office?: 'admissions' | 'financial_aid' | 'department' | 'application_platform'; url?: string; applicantCategory?: 'all' | 'first_year' } = {}) => {
    n += 1;
    const owner = registry.institutionOf(entityId)!;
    const url = o.url ?? `https://${owner.officialDomains[0]}/page/${n}`;
    const sourceId = `src_v2_${n}`;
    const office = o.office ?? 'admissions';
    system.institutionClaims.recordSnapshot({ sourceId, url, finalUrl: url, ownerEntityId: entityId, office, retrievedAt: system.kernel.clock.nowIso(), contentHash: 'e'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle: '2027', text: quote }] });
    const out = system.institutionClaims.upsert({ subject: { entityId, institutionId: owner.id, campusId: null, programId: entityId === owner.id ? null : entityId }, cycle: '2027', applicantCategory: o.applicantCategory ?? 'all', predicate, qualifier, value, sourceOwner: { entityId: owner.id, office, name: owner.name }, anchor: { sourceId, url, finalUrl: url, passageId: `${sourceId}#p1`, section: null, page: null, quote }, retrievedAt: system.kernel.clock.nowIso(), status: o.status ?? 'verified', extraction: 'curated', extractionConfidence: 'high' });
    if (out.status === 'rejected') throw new Error(out.issues.join('; '));
    return out.claim;
  };
  const deadline = (entityId: string, round: string, date: string, o: { url?: string } = {}) => {
    const text = `${round.replace(/_/g, ' ')} applications must be submitted by ${date} at 23:59 Eastern Time.`;
    return official(entityId, 'application_deadline', round, { date, month: null, time: '23:59', timezone: 'America/New_York', timezoneLabel: 'Eastern Time', receipt: 'submitted_by', originalText: text }, text, o);
  };
  const regular = (entityId: string) => official(entityId, 'round_rule', 'regular', { round: 'regular', kind: 'regular', binding: false, restrictions: [], requiresOutcome: [], decisionRelease: null, replyBy: null, agreementCycle: null, commitmentText: null, text: 'Regular Decision places no restrictions on other applications.' }, 'Regular Decision places no restrictions on other applications.');
  const cost = (entityId: string, predicate: 'tuition' | 'housing' | 'books_supplies' | 'transport' | 'health_insurance' | 'personal', amount: string, includes: string[] = [], billed: boolean | null = null) =>
    official(entityId, predicate, 'all', { amount: USD(amount), period: 'academic_year', feeCategory: 'all', includes, billed }, `${predicate.replace(/_/g, ' ')} all ${amount} USD per academic_year`, { office: 'financial_aid', applicantCategory: 'first_year' });
  /** The fictional worked cost of attendance, as in Agent 15's worked example: 50,000 a year. */
  const workedCosts = (entityId = 'aldermere_c') => {
    cost(entityId, 'tuition', '32000.00', ['mandatory_fees'], true);
    cost(entityId, 'housing', '12000.00', ['meals'], true);
    cost(entityId, 'books_supplies', '1500.00', [], false);
    cost(entityId, 'transport', '1500.00', [], false);
    cost(entityId, 'health_insurance', '1000.00', [], true);
    cost(entityId, 'personal', '2000.00', [], false);
  };
  const outsidePolicy = (entityId: string, value: Record<string, unknown>) => official(entityId, 'outside_award_policy', '', value, String(value['text']), { office: 'financial_aid', applicantCategory: 'first_year' });

  const student = h.student;
  const funding = (entityId: string, v: Partial<FundingAward> & Pick<FundingAward, 'name' | 'kind' | 'amount'>) =>
    h.seed([buildClaim({ entity: 'funding_award', entityId, attribute: 'definition', value: { provider: 'Aldermere College', period: 'one_academic_year', coveredCosts: null, stage: 'offered', optionRef: null, renewal: null, basis: 'unknown', eligibilityProgram: null, disbursesOn: null, externalRefs: [], ...v } satisfies FundingAward, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`${v.name} ${v.amount.amount}`)], actor: student, viaRole: 'ui' })]);
  const budget = (max: string, extra: Record<string, unknown> = {}) => h.seed([buildClaim({ entity: 'attendance_budget', entityId: 'own', attribute: 'definition', value: { min: null, max: USD(max), period: 'annual', includesTravelAndPersonal: true, basis: 'student_estimate', availableFrom: null, ...extra }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`we can manage ${max}`)], actor: student, viaRole: 'ui' })]);
  const stated = (attribute: string, value: unknown) => h.seed([buildClaim({ attribute, value, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(JSON.stringify(value))], actor: student, viaRole: 'ui' })]);
  const award = (s: ScholarshipInput) => system.scholarships.curate(s);

  const run = async (role: Exclude<RoleId, '01'>, scope: Record<string, unknown>, actor: Actor = student) => {
    const request = system.kernel.buildRequest({ tenantId: TENANT, studentId: h.studentId, actor, role, purpose: ROLE_PURPOSE[role], objective: ROLE_PURPOSE[role], completionContract: CONTRACT[role]!, scope });
    const out = await system.kernel.invoke(request);
    return { ...out, request } as typeof out & { request: typeof request; result: ResultEnvelope<any> };
  };
  const ok = async (role: Exclude<RoleId, '01'>, scope: Record<string, unknown>, actor: Actor = student) => {
    const out = await run(role, scope, actor);
    if (!out.accepted) throw new Error(`${role} task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 900)}`);
    return out.result;
  };
  const artifacts = (kind: string) => system.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind });
  const history = (key: string) => system.kernel.records.history(h.ui, TENANT, h.studentId, key);
  const say = (text: string, extra: { modality?: 'text' | 'voice'; segments?: Array<{ text: string; confidence?: number; alternatives: string[] }> } = {}) => {
    const t: Parameters<typeof system.conversations.append>[2] = { conversationId: 'conv_story', role: 'student', actorId: student.id, modality: extra.modality ?? 'text', text };
    if (extra.segments) t.segments = extra.segments;
    return system.conversations.append(TENANT, h.studentId, t);
  };
  return { ...h, registry, official, deadline, regular, cost, workedCosts, outsidePolicy, funding, budget, stated, award, run, ok, artifacts, history, say };
}
