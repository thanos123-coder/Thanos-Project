import { z } from 'zod';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import type { Handoff, ResultStatus, Uncertainty } from '../../shared/envelopes.js';
import { AccessDeniedError } from '../../shared/errors.js';
import { APPLICANT_CATEGORIES, EligibilityScopeSchema, scopeKey, type ApplicantCategory, type EligibilityScope } from '../../shared/scope.js';
import { calendarDateInZone } from '../../shared/time.js';
import { failedResult, makeResult, readView, type SpecialistAgent } from '../common/specialist.js';
import { StudentFacts } from '../common/student-facts.js';
import { deriveOverall, evaluateTree, type AtomicFinding, type GroupFinding, type OverallFinding, type RuleState } from './engine.js';
import type { RuleLookup } from './registry.js';
import { packageVersionRef, type RulePackage } from './rules.js';

/**
 * Agent 06 — Curriculum and eligibility contextualizer.
 *
 * Determines how the student's actual record relates to a specific
 * institution's published requirements for an exact program, applicant
 * category, entry cycle and decision stage. Output is a requirement-by-
 * requirement finding. It never predicts admission, certifies credentials,
 * decides exceptions, or treats a minimum requirement as a competitive target.
 */

export const EligibilityTaskScopeSchema = z.object({ eligibility: EligibilityScopeSchema }).strict();

const ResolutionSchema = z.object({ kind: z.string(), text: z.string(), owner: z.string() }).strict();
const RuleStateSchema = z.enum(['met', 'not_met', 'unknown', 'not_applicable']);

export const AtomicFindingSchema = z
  .object({
    ruleId: z.string(),
    label: z.string(),
    mandatory: z.boolean(),
    state: RuleStateSchema,
    stateWithPermittedRoutes: RuleStateSchema,
    explanation: z.string(),
    resolution: ResolutionSchema.optional(),
    futureConditions: z.array(z.string()),
    claimIds: z.array(z.string()),
    source: z.object({ sourceId: z.string(), section: z.string().optional(), quote: z.string() }).strict(),
    publishedRemedy: z.string().optional(),
    inputFields: z.array(z.string()).default([]),
  })
  .strict();

export const EligibilityPayloadSchema = z
  .object({
    scope: EligibilityScopeSchema,
    scopeKey: z.string(),
    rulePackage: z.object({ ref: z.string(), institutionName: z.string(), programName: z.string(), entryCycle: z.string(), synthetic: z.boolean() }).strict().nullable(),
    coverage: z.object({ status: z.enum(['supported', 'no_rule_package', 'rule_package_not_reviewed', 'cycle_not_published', 'credential_not_supported', 'category_not_supported']), note: z.string() }).strict(),
    overall: z.enum(['apparently_meets', 'conditionally_on_track', 'requirement_not_met', 'unresolved', 'outside_supported_coverage']),
    rootState: RuleStateSchema.nullable(),
    rootStateWithPermittedRoutes: RuleStateSchema.nullable(),
    explanation: z.string(),
    findings: z.array(AtomicFindingSchema),
    groups: z.array(z.object({ ruleId: z.string(), label: z.string(), kind: z.string(), state: RuleStateSchema, stateWithPermittedRoutes: RuleStateSchema, childIds: z.array(z.string()) }).strict()),
    perCategory: z.array(z.object({ category: z.enum(APPLICANT_CATEGORIES), overall: z.string() }).strict()),
    futureConditions: z.array(z.string()),
    limitations: z.array(z.string()),
    historicalContext: z.object({ packageRef: z.string(), entryCycle: z.string(), note: z.string() }).strict().nullable(),
    admissionProbability: z.null(),
    institutionalDecision: z.literal(false),
    competitivenessAssessed: z.literal(false),
  })
  .strict();
export type EligibilityPayload = z.infer<typeof EligibilityPayloadSchema>;

const GUARANTEE_WORDS = /\b(guarantee[sd]?|will be (admitted|accepted)|certain(ly)? (to be )?(admitted|accepted)|you are eligible|you('| a)re in)\b/i;

export const ELIGIBILITY_CONTRACT: ContractDefinition<EligibilityPayload> = {
  id: 'eligibility_finding_v1',
  role: '06',
  payload: EligibilityPayloadSchema,
  semantic: (p, result) => {
    const issues: string[] = [];
    if (p.coverage.status === 'supported' && p.rootState !== null && p.rootStateWithPermittedRoutes !== null) {
      const derived = deriveOverall(p.rootState, p.rootStateWithPermittedRoutes);
      const categoryUnknown = typeof p.scope.applicantCategory !== 'string';
      if (!categoryUnknown && derived !== p.overall) issues.push(`overall ${p.overall} does not follow from the rule states (expected ${derived})`);
    }
    if (p.coverage.status !== 'supported' && !['outside_supported_coverage', 'unresolved'].includes(p.overall)) issues.push('an unsupported case cannot receive an eligibility decision');
    for (const f of p.findings) {
      if (f.mandatory && f.state === 'unknown' && !f.resolution) issues.push(`rule ${f.ruleId} is unknown but names no resolution`);
      if (f.state === 'met' && f.resolution) issues.push(`rule ${f.ruleId} is met but lists an unresolved input`);
    }
    if (p.overall === 'apparently_meets' && p.findings.some((f) => f.mandatory && f.state === 'not_met' && !isInsideSatisfiedAlternative(f, p))) {
      issues.push('overall says requirements appear met while a mandatory rule is not met outside any satisfied alternative');
    }
    if (GUARANTEE_WORDS.test(result.summary) || GUARANTEE_WORDS.test(p.explanation)) issues.push('the explanation implies a guarantee or an institutional decision');
    return issues;
  },
};

/** A not_met finding is acceptable under an overall "meets" only if an OR/at-least group containing it is met. */
function isInsideSatisfiedAlternative(f: z.infer<typeof AtomicFindingSchema>, p: EligibilityPayload): boolean {
  const parents = p.groups.filter((g) => g.childIds.includes(f.ruleId));
  return parents.some((g) => (g.kind === 'any' || g.kind === 'at_least') && g.state === 'met') || parents.some((g) => isGroupInsideSatisfied(g.ruleId, p, new Set()));
}

function isGroupInsideSatisfied(id: string, p: EligibilityPayload, seen: Set<string>): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const parents = p.groups.filter((g) => g.childIds.includes(id));
  return parents.some((g) => ((g.kind === 'any' || g.kind === 'at_least') && g.state === 'met') || isGroupInsideSatisfied(g.ruleId, p, seen));
}

const LIMITATIONS = [
  'Meeting published minimum requirements does not guarantee admission; the institution makes every decision.',
  'This checks eligibility only. Competitiveness, fit and affordability are separate questions.',
  'Requirements can change; the rule set used here is identified by version and should be rechecked before you act.',
];

export class EligibilityAgent implements SpecialistAgent {
  readonly role = '06' as const;
  readonly contracts = [ELIGIBILITY_CONTRACT];

  async handle(ctx: TaskContext) {
    const parsed = EligibilityTaskScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The eligibility question was not specific enough to check.', 'invalid_scope');
    const scope = parsed.data.eligibility;
    try {
      return await this.evaluate(ctx, scope);
    } catch (e) {
      if (e instanceof AccessDeniedError) return failedResult(ctx, 'blocked', 'The information needed for this check is not available with the current permissions.', e.code);
      throw e;
    }
  }

  private async evaluate(ctx: TaskContext, scope: EligibilityScope) {
    // 06R01/06R03: retrieve the rule package for the exact scope.
    const lookup = await ctx.call<RuleLookup>('rules.read_verified', {
      institutionRef: scope.institutionRef,
      programRef: scope.programRef,
      degreeLevel: scope.degreeLevel,
      entryCycle: scope.entryCycle,
      campusRef: scope.campusRef,
    });
    // 06R04: read only the academic and category facts the rule needs.
    const view = await readView(ctx, 'local', {
      entityTypes: ['student', 'course', 'qualification', 'test_attempt', 'waiver', 'gpa_calculation', 'contextual_criterion', 'age_attestation'],
    });
    const facts = new StudentFacts(view);
    const base = {
      scope,
      scopeKey: scopeKey(scope),
      findings: [] as AtomicFinding[],
      groups: [] as GroupFinding[],
      perCategory: [] as Array<{ category: ApplicantCategory; overall: string }>,
      futureConditions: [] as string[],
      limitations: LIMITATIONS,
      historicalContext: null as EligibilityPayload['historicalContext'],
      admissionProbability: null,
      institutionalDecision: false as const,
      competitivenessAssessed: false as const,
      rootState: null as RuleState | null,
      rootStateWithPermittedRoutes: null as RuleState | null,
    };

    // 06R02: validate coverage before any rule match.
    if (lookup.status === 'not_covered') {
      const payload: EligibilityPayload = { ...base, rulePackage: null, coverage: { status: 'no_rule_package', note: 'This app has no reviewed rule set for this program yet.' }, overall: 'outside_supported_coverage', explanation: 'This program is outside the rule sets this app has reviewed, so no eligibility decision is made here. The official program page and admissions office remain the authority.' };
      return this.finish(ctx, payload, view.recordVersion, [], [], [], [this.researchHandoff(scope, 'No reviewed rule package covers this program.')]);
    }
    if (lookup.status === 'cycle_not_published') {
      const h = lookup.historical[0]!;
      const payload: EligibilityPayload = {
        ...base,
        rulePackage: null,
        coverage: { status: 'cycle_not_published', note: `Requirements for the ${scope.entryCycle} entry cycle have not been published or reviewed yet.` },
        overall: 'unresolved',
        explanation: `Requirements for entry in ${scope.entryCycle} are not published yet. The ${h.entryCycle} rules are shown only as historical context and are not applied to your cycle.`,
        historicalContext: { packageRef: packageVersionRef(h), entryCycle: h.entryCycle, note: 'Historical context only; last cycle’s rules are never carried forward automatically.' },
      };
      return this.finish(ctx, payload, view.recordVersion, [], [], [], [this.researchHandoff(scope, 'Recheck when the new cycle’s requirements are published.')]);
    }
    if (lookup.status === 'not_reviewed') {
      const payload: EligibilityPayload = { ...base, rulePackage: this.pkgRef(lookup.package), coverage: { status: 'rule_package_not_reviewed', note: 'The rule set for this program is still waiting for expert review.' }, overall: 'outside_supported_coverage', explanation: 'A draft rule set exists but has not been reviewed by an admissions specialist, so it cannot confirm or rule out eligibility.' };
      return this.finish(ctx, payload, view.recordVersion, [packageVersionRef(lookup.package)], [], [], [this.researchHandoff(scope, 'Rule package awaiting expert review.')]);
    }
    const pkg = lookup.package;
    const pkgRef = this.pkgRef(pkg);

    // Credential coverage: a readable document is not the same as a supported credential (XT17).
    const system = facts.student<{ id: string; label: string }>('education.qualification_system');
    if (system.status === 'usable' && !pkg.qualificationSystems.includes(system.value!.id)) {
      const payload: EligibilityPayload = { ...base, rulePackage: pkgRef, coverage: { status: 'credential_not_supported', note: `${system.value!.label} has not been validated for this program's rule set.` }, overall: 'outside_supported_coverage', explanation: `The reviewed rules for this program have not been validated for ${system.value!.label}. The institution's own guidance for that qualification is the authority; no equivalence is assumed.` };
      return this.finish(ctx, payload, view.recordVersion, [packageVersionRef(pkg)], system.claimIds, [system.fieldKey], [this.humanReviewHandoff(scope, `Credential ${system.value!.label} is not covered by the reviewed rule package.`)]);
    }

    const asOf = calendarDateInZone(ctx.clock.nowIso(), 'UTC');
    const category = typeof scope.applicantCategory === 'string' ? scope.applicantCategory : null;
    if (category !== null && !pkg.applicantCategories.includes(category)) {
      const payload: EligibilityPayload = { ...base, rulePackage: pkgRef, coverage: { status: 'category_not_supported', note: `The reviewed rules cover ${pkg.applicantCategories.join(', ')} applicants only.` }, overall: 'outside_supported_coverage', explanation: `The reviewed rules for this program do not cover ${category.replace('_', '-')} applicants.` };
      return this.finish(ctx, payload, view.recordVersion, [packageVersionRef(pkg)], [], [], [this.researchHandoff(scope, 'Applicant category not covered.')]);
    }

    // 06R05-06R08: evaluate for the known category, or conditionally for each candidate category (06T14).
    const categories: ApplicantCategory[] = category !== null ? [category] : pkg.applicantCategories;
    const evals = categories.map((c) => ({ category: c, tree: evaluateTree({ facts, stage: scope.decisionStage, applicantCategory: c, pkg, asOf }) }));
    const primary = evals[0]!.tree;
    const perCategory = category === null ? evals.map((e) => ({ category: e.category, overall: deriveOverall(e.tree.achieved, e.tree.route) })) : [];
    const overall: OverallFinding = category === null ? 'unresolved' : deriveOverall(primary.achieved, primary.route);
    const findings = primary.atomic;
    const futureConditions = [...new Set(findings.flatMap((f) => f.futureConditions))];
    const explanation = this.explain(overall, findings, futureConditions, pkg, scope, category === null);
    const payload: EligibilityPayload = {
      ...base,
      rulePackage: pkgRef,
      coverage: { status: 'supported', note: 'Checked against a reviewed rule set for this exact program, cycle and stage.' },
      overall,
      rootState: primary.achieved,
      rootStateWithPermittedRoutes: primary.route,
      explanation,
      findings,
      groups: primary.groups,
      perCategory,
      futureConditions,
    };
    const claimIds = [...new Set([...evals.flatMap((e) => e.tree.claimIds), ...system.claimIds])];
    const deps = [...new Set([...evals.flatMap((e) => e.tree.dependencies), system.fieldKey])];
    // Only fields that are not settled go to intake: unconfirmed or conflicting values first, then missing ones.
    const rank = (k: string): number => {
      const f = view.fieldByKey(k);
      if (!f) return 1;
      if (f.state === 'conflict' || f.needsConfirmation) return 0;
      return f.state === 'current' ? 9 : 1;
    };
    return this.finish(ctx, payload, view.recordVersion, [packageVersionRef(pkg)], claimIds, deps, this.handoffsFor(findings, scope, category === null, rank), pkg.sources.map((s) => s.id));
  }

  private pkgRef(p: RulePackage): EligibilityPayload['rulePackage'] {
    return { ref: packageVersionRef(p), institutionName: p.institutionName, programName: p.programName, entryCycle: p.entryCycle, synthetic: p.synthetic };
  }

  /** Explanation composed only from the rule states (06R10). */
  private explain(overall: OverallFinding, findings: AtomicFinding[], conditions: string[], pkg: RulePackage, scope: EligibilityScope, categoryUnknown: boolean): string {
    const where = `${pkg.programName} at ${pkg.institutionName} (entry ${pkg.entryCycle}, ${scope.decisionStage.replace(/_/g, ' ')} stage)`;
    const mandatory = findings.filter((f) => f.mandatory);
    const firstUnknown = mandatory.find((f) => f.state === 'unknown' && f.resolution);
    switch (overall) {
      case 'apparently_meets':
        return `For ${where}, your recorded qualifications appear to meet each mandatory published condition. The institution remains the decision maker.`;
      case 'conditionally_on_track':
        return `For ${where}, you appear to be on track, provided that: ${conditions.join('; ')}. Planned or predicted results are not treated as achieved.`;
      case 'requirement_not_met': {
        const unmet = mandatory.filter((f) => f.state === 'not_met');
        const first = unmet[0];
        return `For ${where}, a published requirement is currently not met: ${first ? `${first.label} — ${first.explanation}` : 'see the findings'}.${first?.publishedRemedy ? ` Published alternative: ${first.publishedRemedy}` : ''} This is about one requirement, not about you.`;
      }
      case 'unresolved':
        if (categoryUnknown) return `For ${where}, the result depends on whether you apply as a first-year or transfer applicant, so it stays conditional until that is confirmed.`;
        return `For ${where}, this cannot be settled from the available evidence yet.${firstUnknown?.resolution ? ` The next thing needed: ${firstUnknown.resolution.text}` : ''} This is not the same as being ineligible.`;
      case 'outside_supported_coverage':
        return `For ${where}, this case is outside the reviewed coverage.`;
    }
  }

  // 06R11: concrete gaps go to planning (07), unsettled student facts to intake (02) or documents (03), policy ambiguity to source research or review.
  private handoffsFor(findings: AtomicFinding[], scope: EligibilityScope, categoryUnknown: boolean, rank: (fieldKey: string) => number = () => 1): Handoff[] {
    const out: Handoff[] = [];
    const unresolved = findings.filter((f) => f.mandatory && f.state !== 'met' && f.state !== 'not_applicable' && f.resolution);
    const byOwner = (owners: string[]) => unresolved.filter((f) => owners.includes(f.resolution!.owner));
    const studentFacts = byOwner(['02', 'student']).filter((f) => f.resolution!.kind === 'needed_fact' || f.resolution!.kind === 'confirm_fact');
    if (studentFacts.length > 0 || categoryUnknown) {
      out.push({ toRole: '02', reason: 'Consequential facts are missing or unconfirmed for an eligibility rule.', requestedOutcome: 'Ask targeted questions and return attributed facts.', inputRefs: [...studentFacts.map((f) => `rule:${f.ruleId}`), ...mostUrgent([...new Set(studentFacts.flatMap((f) => f.inputFields))], rank).map((k) => `field:${k}`)], unresolved: [...studentFacts.map((f) => f.resolution!.text), ...(categoryUnknown ? ['Confirm applicant category (any college study after secondary school?)'] : [])], completionCondition: 'Each listed fact is confirmed, declined, or recorded as unknown.' });
    }
    const docs = byOwner(['03']);
    if (docs.length > 0) out.push({ toRole: '03', reason: 'A document would resolve an eligibility input.', requestedOutcome: 'Extract the specific field from an uploaded school record.', inputRefs: docs.map((f) => `rule:${f.ruleId}`), unresolved: docs.map((f) => f.resolution!.text), completionCondition: 'The field is extracted with a source anchor or marked unreadable.' });
    const planning = findings.filter((f) => f.mandatory && (f.futureConditions.length > 0 || (f.state === 'not_met' && f.publishedRemedy)));
    if (planning.length > 0) out.push({ toRole: '07', reason: 'Requirement gaps or future conditions need a feasible plan.', requestedOutcome: 'Plan courses or tests that address the named conditions.', inputRefs: planning.map((f) => `rule:${f.ruleId}`), unresolved: planning.flatMap((f) => [...f.futureConditions, ...(f.publishedRemedy ? [f.publishedRemedy] : [])]), completionCondition: 'Each condition has a feasible step or an explicit unresolved dependency.' });
    const sources = byOwner(['11', 'institution']);
    if (sources.length > 0) out.push({ toRole: '11', reason: 'Official sources conflict or an institution instruction is needed.', requestedOutcome: 'Resolve which published rule governs this applicant scope.', inputRefs: sources.map((f) => `rule:${f.ruleId}`), unresolved: sources.map((f) => f.resolution!.text), completionCondition: 'The governing rule is identified with an official source, or a draft inquiry is prepared for the student.' });
    const review = byOwner(['human_review']);
    if (review.length > 0) out.push(this.humanReviewHandoff(scope, review.map((f) => f.resolution!.text).join(' ')));
    return out;
  }

  private researchHandoff(scope: EligibilityScope, reason: string): Handoff {
    return { toRole: '11', reason, requestedOutcome: 'Retrieve and verify the official requirements for this exact scope.', inputRefs: [`program:${scope.institutionRef}/${scope.programRef}`], unresolved: [], completionCondition: 'A reviewed rule package exists or the gap is explained.' };
  }

  private humanReviewHandoff(scope: EligibilityScope, reason: string): Handoff {
    return { toRole: '34', reason, requestedOutcome: 'Qualified review of an equivalence or rule interpretation.', inputRefs: [`program:${scope.institutionRef}/${scope.programRef}`], unresolved: [reason], completionCondition: 'A qualified reviewer records a scoped decision, or the student is given a referral question.' };
  }

  private async finish(
    ctx: TaskContext,
    payload: EligibilityPayload,
    recordVersion: number,
    ruleVersions: string[],
    claimIds: string[],
    dependencies: string[],
    handoffs: Handoff[],
    sourceIds: string[] = [],
  ) {
    const uncertainties: Uncertainty[] = payload.findings
      .filter((f) => f.mandatory && f.state === 'unknown' && f.resolution)
      .map((f) => ({ affects: `rule:${f.ruleId}`, description: f.explanation.length >= 10 ? f.explanation : `${f.label}: unresolved`, resolution: f.resolution!.text, consequence: 'blocks_decision' as const }));
    if (payload.coverage.status !== 'supported') uncertainties.push({ affects: `scope:${payload.scopeKey}`, description: payload.coverage.note, resolution: 'Check the official program requirements directly or request research for this program.', consequence: 'blocks_decision' });
    const status: ResultStatus = statusFor(payload);
    // Store the finding as a derived artifact so later corrections invalidate it.
    await ctx.call('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind: 'eligibility_finding',
      scopeKey: payload.scopeKey,
      payload,
      inputClaimIds: claimIds,
      inputFieldKeys: dependencies,
      ruleVersions,
      sourceIds,
      recordVersion,
      categoryFloor: 'findings',
    });
    return makeResult(ctx, {
      status,
      summary: payload.explanation,
      payload,
      claimIds,
      recordVersion,
      ruleVersions,
      sourceVersions: sourceIds,
      sourceRefs: sourceIds,
      uncertainties,
      handoffs,
      completionReason: `eligibility_${payload.overall}`,
    });
  }
}

/** The unsettled fields to ask about: unconfirmed or conflicting ones if there are any, otherwise the missing ones. */
function mostUrgent(keys: readonly string[], rank: (k: string) => number): string[] {
  const open = keys.filter((k) => rank(k) < 9);
  if (open.length === 0) return [];
  const best = Math.min(...open.map(rank));
  return open.filter((k) => rank(k) === best);
}

function statusFor(p: EligibilityPayload): ResultStatus {
  if (p.overall !== 'unresolved') return 'completed';
  const owners = new Set(p.findings.filter((f) => f.mandatory && f.state === 'unknown' && f.resolution).map((f) => f.resolution!.owner));
  if (typeof p.scope.applicantCategory !== 'string' || owners.has('02') || owners.has('03') || owners.has('student')) return 'needs_student_input';
  if (owners.has('11') || owners.has('institution')) return 'needs_source';
  if (owners.has('human_review')) return 'needs_human_review';
  if (p.coverage.status === 'cycle_not_published') return 'needs_source';
  return 'partial';
}
