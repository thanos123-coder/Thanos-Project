import { describe, expect, it } from 'vitest';
import { EligibilityAgent, type EligibilityPayload } from '../../src/agents/a06-eligibility/agent.js';
import { combineAll, combineAny, combineAtLeast, deriveOverall, negate, type RuleState } from '../../src/agents/a06-eligibility/engine.js';
import type { RulePackageInput } from '../../src/agents/a06-eligibility/rules.js';
import { absent } from '../../src/shared/absence.js';
import type { Actor } from '../../src/shared/permissions.js';
import type { EligibilityScopeInput } from '../../src/shared/scope.js';
import { engineeringPackage, historyPackage, languageRoutes, mathHL, qualificationQ, source } from '../fixtures/rule-packages.js';
import { extracted, ibCourse, makeKernel, stated } from '../helpers/kernel.js';

const scope = (over: Partial<EligibilityScopeInput> = {}): EligibilityScopeInput => ({
  institutionRef: 'example_university',
  programRef: 'beng_engineering',
  degreeLevel: 'undergraduate_first_degree',
  entryCycle: '2027',
  applicantCategory: 'first_year',
  decisionStage: 'offer',
  campusRef: null,
  ...over,
});

function setup(pkgs: RulePackageInput[] = [engineeringPackage()]) {
  const h = makeKernel();
  h.kernel.registerSpecialist(new EligibilityAgent());
  for (const p of pkgs) h.kernel.rules.add(p);
  return h;
}

/** Base facts: IB DP student, IB Diploma in progress, 5 years schooling in English. */
function baseFacts(actor: Actor) {
  return [
    stated(actor, 'education.qualification_system', { id: 'IB_DP', label: 'IB Diploma Programme' }),
    extracted(actor, 'qualification', 'q1', 'credential', { id: 'IB_DIPLOMA', label: 'IB Diploma' }, 'IB Diploma Programme'),
    extracted(actor, 'qualification', 'q1', 'status', 'in_progress', 'Candidate'),
    stated(actor, 'education.schooling_language', { language: 'en', yearsOfInstruction: 5 }),
  ];
}

async function check(h: ReturnType<typeof setup>, s: EligibilityScopeInput = scope()) {
  const req = h.task({ role: '06', purpose: 'eligibility_check', objective: 'check_program_requirements', completionContract: 'eligibility_finding_v1', scope: { eligibility: s } });
  const out = await h.kernel.invoke(req);
  if (!out.accepted) throw new Error(`result rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload)}`);
  return { out, p: out.result.payload as EligibilityPayload };
}

const finding = (p: EligibilityPayload, id: string) => p.findings.find((f) => f.ruleId === id)!;

describe('three-valued requirement logic (truth tables)', () => {
  const S: RuleState[] = ['met', 'not_met', 'unknown', 'not_applicable'];
  it('AND / OR / NOT follow the specified semantics for every pair', () => {
    for (const a of S) {
      for (const b of S) {
        const and = combineAll([a, b]);
        const or = combineAny([a, b]);
        const applicable = [a, b].filter((x) => x !== 'not_applicable');
        if (applicable.length === 0) {
          expect(and).toBe('not_applicable');
          expect(or).toBe('not_applicable');
          continue;
        }
        expect(and).toBe(applicable.includes('not_met') ? 'not_met' : applicable.includes('unknown') ? 'unknown' : 'met');
        expect(or).toBe(applicable.includes('met') ? 'met' : applicable.every((x) => x === 'not_met') ? 'not_met' : 'unknown');
      }
      expect(negate(negate(a))).toBe(a);
    }
    expect(negate('unknown')).toBe('unknown');
  });

  it('at-least-n counts met and unknown correctly', () => {
    expect(combineAtLeast(['met', 'met', 'unknown'], 2)).toBe('met');
    expect(combineAtLeast(['met', 'unknown', 'not_met'], 2)).toBe('unknown');
    expect(combineAtLeast(['met', 'not_met', 'not_met'], 2)).toBe('not_met');
  });

  it('the overall finding is derived, and a hard negative needs both evaluations to agree', () => {
    expect(deriveOverall('met', 'met')).toBe('apparently_meets');
    expect(deriveOverall('unknown', 'met')).toBe('conditionally_on_track');
    expect(deriveOverall('not_met', 'met')).toBe('conditionally_on_track');
    expect(deriveOverall('not_met', 'not_met')).toBe('requirement_not_met');
    expect(deriveOverall('not_met', 'unknown')).toBe('unresolved');
    expect(deriveOverall('unknown', 'unknown')).toBe('unresolved');
    expect(deriveOverall('not_applicable', 'not_applicable')).toBe('unresolved');
  });
});

describe('Agent 06 — Curriculum and eligibility contextualizer', () => {
  it('06T01 a mandatory course level that is unknown keeps the overall finding unresolved', async () => {
    const h = setup();
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: null, grade: '7', status: 'predicted' })]);
    const { p, out } = await check(h);
    expect(p.overall).toBe('unresolved');
    expect(finding(p, 'math_level_required').state).toBe('unknown');
    expect(finding(p, 'math_level_required').resolution?.text).toMatch(/level/);
    expect(out.result.status).toBe('needs_student_input');
    expect(out.result.uncertainties.some((u) => u.affects === 'rule:math_level_required')).toBe(true);
  });

  it('06T02 one OR alternative met and another unknown: the group is met', async () => {
    const h = setup();
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_HL', grade: '7', status: 'final' }), extracted(h.student, 'qualification', 'q1', 'status', 'completed', 'Awarded', { supersedes: [] })]);
    const { p } = await check(h);
    const lang = p.groups.find((g) => g.ruleId === 'english_language')!;
    expect(finding(p, 'english_route_b_schooling').state).toBe('met');
    expect(finding(p, 'english_route_a_toefl').state).toBe('unknown');
    expect(lang.state).toBe('met');
  });

  it('06T03 one AND requirement not met: the group is not met with the exact reason', async () => {
    const h = setup();
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_SL', grade: '7', status: 'final' })]);
    const { p } = await check(h);
    expect(p.overall).toBe('requirement_not_met');
    expect(finding(p, 'math_level_required').state).toBe('not_met');
    expect(finding(p, 'math_level_required').explanation).toMatch(/SL, not the required level/);
    expect(p.explanation).toMatch(/Mathematics at Higher Level/);
    expect(p.explanation).toMatch(/not about you/);
  });

  it('06T04 a predicted result above a final-grade threshold stays conditional (or unresolved where not permitted)', async () => {
    const h = setup();
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_HL', grade: '7', status: 'predicted' })]);
    const offer = await check(h, scope({ decisionStage: 'offer' }));
    expect(offer.p.overall).toBe('conditionally_on_track');
    expect(finding(offer.p, 'math_level_required').state).toBe('unknown');
    expect(finding(offer.p, 'math_level_required').stateWithPermittedRoutes).toBe('met');
    expect(offer.p.futureConditions.join()).toMatch(/Final grade in Mathematics: Analysis and Approaches of at least 6/);
    const enroll = await check(h, scope({ decisionStage: 'enrollment' }));
    expect(enroll.p.overall).toBe('unresolved');
    expect(finding(enroll.p, 'math_level_required').stateWithPermittedRoutes).toBe('unknown');
  });

  it('06T05 a similar course title without content equivalence is not a prerequisite match', async () => {
    const h = setup();
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c_math', { subject: 'mathematics', basis: 'broad_taxonomy', name: 'Mathematics', level: 'IB_HL', grade: '7', status: 'final' })]);
    const { p } = await check(h);
    expect(finding(p, 'math_level_required').state).toBe('unknown');
    expect(finding(p, 'math_level_required').resolution?.kind).toBe('qualified_review');
    expect(p.overall).toBe('unresolved');
  });

  it('06T06 a country route with several combined conditions keeps and evaluates all of them', async () => {
    const greek: RulePackageInput = {
      ...engineeringPackage(),
      id: 'example_university_beng_gr',
      qualificationSystems: ['GR_APOLYTIRIO'],
      rules: {
        kind: 'all',
        id: 'root',
        label: 'Greek qualification route',
        children: [
          { kind: 'predicate', id: 'gr_apolytirio', label: 'Apolytirio with an overall mark of at least 19/20', predicate: { type: 'qualification', credentialIds: ['GR_APOLYTIRIO'], minimumTotal: { scaleRef: 'twenty_point_0_20', original: '19' } }, stages: ['application', 'offer', 'enrollment'], mandatory: true, futureCompletionPermittedAt: [], evidence: {}, source: { sourceId: 'src_program', quote: 'Apolytirio with an overall score of at least 19.' } },
          { kind: 'predicate', id: 'gr_additional_exam', label: 'An additional subject examination in Mathematics', predicate: { type: 'subject_result', subjectKeys: ['gr.panhellenic_math'], minimumGrade: { scaleRef: 'twenty_point_0_20', original: '18' }, attemptPolicy: 'unspecified' }, stages: ['application', 'offer', 'enrollment'], mandatory: true, futureCompletionPermittedAt: [], evidence: {}, source: { sourceId: 'src_program', quote: 'plus Panhellenic examination in Mathematics at 18 or above.' } },
        ],
      },
    };
    const h = setup([greek]);
    h.seed([
      stated(h.student, 'education.qualification_system', { id: 'GR_APOLYTIRIO', label: 'Greek Apolytirio' }),
      extracted(h.student, 'qualification', 'q1', 'credential', { id: 'GR_APOLYTIRIO', label: 'Apolytirio' }, 'Apolytirio'),
      extracted(h.student, 'qualification', 'q1', 'status', 'awarded', 'Awarded'),
      extracted(h.student, 'qualification', 'q1', 'total', { original: '19,4', scaleRef: 'twenty_point_0_20', status: 'final', weighting: null }, '19,4'),
    ]);
    const { p } = await check(h);
    expect(finding(p, 'gr_apolytirio').state).toBe('met');
    expect(finding(p, 'gr_additional_exam').state).toBe('unknown');
    expect(p.overall).not.toBe('apparently_meets'); // the school-leaving mark alone is not the whole route
  });

  it('06T07 school country and citizenship remain separate categories', async () => {
    const pkg = engineeringPackage({
      rules: { kind: 'all', id: 'root', label: 'root', children: [{ kind: 'predicate', id: 'citizen_rule', label: 'Citizenship condition', predicate: { type: 'category', fact: 'citizenship', operator: 'in', values: ['GR'] }, stages: ['application', 'offer', 'enrollment'], mandatory: true, futureCompletionPermittedAt: [], evidence: {}, source: { sourceId: 'src_program', quote: 'Open to citizens of Greece.' } }] },
    });
    const h = setup([pkg]);
    h.seed([...baseFacts(h.student), stated(h.student, 'education.school_country', 'GR'), stated(h.student, 'identity.residence_country', 'GR'), stated(h.student, 'identity.citizenships', ['US'])]);
    const { p } = await check(h);
    expect(finding(p, 'citizen_rule').state).toBe('not_met'); // studying in Greece does not make the student a Greek citizen
  });

  it('06T08 self-report is enough at application but enrollment needs official evidence', async () => {
    const h = setup();
    h.seed([
      ...baseFacts(h.student).slice(0, 3),
      stated(h.student, 'education.schooling_language', { language: 'el', yearsOfInstruction: 12 }),
      ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_HL', grade: '7', status: 'final' }),
      stated(h.student, 'record', { family: 'TOEFL_IBT', versionRef: 'toefl_ibt_band_1_6', subjectLabel: null, administrationDate: '2026-06-10', deliveryFormat: 'computer_test_center', sections: { reading: 5.5, listening: 5, speaking: 5, writing: 5 }, reportedTotal: 5, comparableLegacyTotal: null, combination: 'single_administration', reportStatus: 'self_reported' }, { entity: 'test_attempt', entityId: 't1' }),
    ]);
    const app = await check(h, scope({ decisionStage: 'application' }));
    expect(finding(app.p, 'english_route_a_toefl').state).toBe('met');
    const enr = await check(h, scope({ decisionStage: 'enrollment' }));
    expect(finding(enr.p, 'english_route_a_toefl').state).toBe('unknown');
    expect(finding(enr.p, 'english_route_a_toefl').resolution?.kind).toBe('official_evidence');
  });

  it('06T09 a requested but unapproved waiver is never treated as approved', async () => {
    const h = setup();
    h.seed([
      ...baseFacts(h.student).slice(0, 3),
      stated(h.student, 'education.schooling_language', { language: 'el', yearsOfInstruction: 12 }),
      ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_HL', grade: '7', status: 'final' }),
      stated(h.student, 'state', { waiverRef: 'example_english_waiver', institutionRef: 'example_university', state: 'pending' }, { entity: 'waiver', entityId: 'w1' }),
    ]);
    const { p } = await check(h);
    expect(finding(p, 'english_route_c_waiver').state).toBe('unknown');
    expect(finding(p, 'english_route_c_waiver').explanation).toMatch(/pending/);
    expect(p.groups.find((g) => g.ruleId === 'english_language')!.state).toBe('unknown');
  });

  it('06T10 a program page that conflicts with the central page is preserved and routed for review', async () => {
    const pkg = engineeringPackage({ sourceConflicts: [{ id: 'conflict_1', description: 'The program page lists band 5.5; the central page lists band 5.', sourceIds: ['src_program', 'src_central'], affectedRuleIds: ['english_route_a_toefl'], status: 'unresolved', question: 'For BEng Engineering 2027 first-year applicants, is the TOEFL requirement band 5 (central page) or 5.5 (program page)?' }] });
    const h = setup([pkg]);
    h.seed([
      ...baseFacts(h.student).slice(0, 3),
      stated(h.student, 'education.schooling_language', { language: 'el', yearsOfInstruction: 12 }),
      ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_HL', grade: '7', status: 'final' }),
    ]);
    const { p, out } = await check(h);
    const f = finding(p, 'english_route_a_toefl');
    expect(f.state).toBe('unknown');
    expect(f.resolution).toMatchObject({ kind: 'source_clarification', owner: '11' });
    expect(out.result.handoffs.some((x) => x.toRole === '11')).toBe(true);
  });

  it('06T11 a rule from a previous cycle is never carried forward', async () => {
    const h = setup([engineeringPackage({ entryCycle: '2026', id: 'example_university_beng_2026' })]);
    h.seed(baseFacts(h.student));
    const { p, out } = await check(h, scope({ entryCycle: '2027' }));
    expect(p.overall).toBe('unresolved');
    expect(p.coverage.status).toBe('cycle_not_published');
    expect(p.findings).toEqual([]);
    expect(p.historicalContext?.entryCycle).toBe('2026');
    expect(out.result.status).toBe('needs_source');
  });

  it('06T12 a special GPA calculation is never satisfied by a generic GPA', async () => {
    const pkg = engineeringPackage({ rules: { kind: 'all', id: 'root', label: 'root', children: [{ kind: 'predicate', id: 'inst_gpa', label: 'Institution GPA of 3.4', predicate: { type: 'institution_gpa', calculationRef: 'example_gpa_10_11', minimum: 3.4 }, stages: ['application', 'offer', 'enrollment'], mandatory: true, futureCompletionPermittedAt: [], evidence: {}, source: { sourceId: 'src_program', quote: 'GPA of 3.4 calculated from grades 10-11 with honors weighting.' } }] } });
    const h = setup([pkg]);
    h.seed([...baseFacts(h.student), stated(h.student, 'result', { calculationRef: 'school_unweighted', value: 3.9, scaleNote: 'school GPA' }, { entity: 'gpa_calculation', entityId: 'g1' })]);
    const { p } = await check(h);
    expect(finding(p, 'inst_gpa').state).toBe('unknown');
    expect(finding(p, 'inst_gpa').explanation).toMatch(/general GPA cannot be substituted/);
  });

  it('06T13 a contextual route needs explicit criteria; nothing is inferred from demographic proxies', async () => {
    const pkg = engineeringPackage({ rules: { kind: 'any', id: 'root', label: 'root', children: [mathHL, { kind: 'predicate', id: 'contextual', label: 'Contextual offer route', predicate: { type: 'contextual_criterion', criteriaRef: 'example_widening_access' }, stages: ['application', 'offer', 'enrollment'], mandatory: true, futureCompletionPermittedAt: [], evidence: {}, source: { sourceId: 'src_program', quote: 'Applicants meeting published contextual criteria may receive an adjusted offer.' } }] } });
    const h = setup([pkg]);
    h.seed([...baseFacts(h.student), stated(h.student, 'identity.residence_country', 'GR'), stated(h.student, 'education.school_name', 'Example Lyceum'), ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_SL', grade: '5', status: 'final' })]);
    const { p } = await check(h);
    expect(finding(p, 'contextual').state).toBe('unknown');
    expect(finding(p, 'contextual').explanation).toMatch(/explicit published criteria/);
    expect(p.overall).not.toBe('apparently_meets');
  });

  it('06T14 an applicant who may be transfer rather than first-year gets conditional findings', async () => {
    const h = setup([engineeringPackage({ applicantCategories: ['first_year', 'transfer'] })]);
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_HL', grade: '7', status: 'final' })]);
    const { p, out } = await check(h, scope({ applicantCategory: absent('unknown_to_student') }));
    expect(p.overall).toBe('unresolved');
    expect(p.perCategory.map((c) => c.category)).toEqual(['first_year', 'transfer']);
    expect(out.result.status).toBe('needs_student_input');
    expect(out.result.handoffs.find((x) => x.toRole === '02')?.unresolved.join()).toMatch(/applicant category/);
  });

  it('06T15 a corrected transcript recomputes only the affected findings', async () => {
    const h = setup([engineeringPackage(), historyPackage()]);
    h.seed([...baseFacts(h.student)]);
    const levelClaim = h.seed(ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_SL', grade: '7', status: 'final' }));
    const eng = await check(h, scope());
    const hist = await check(h, scope({ programRef: 'ba_history' }));
    expect(eng.p.overall).toBe('requirement_not_met');
    const artifacts = () => h.kernel.records.listArtifacts(h.ui, 'tenant_a', h.studentId, { kind: 'eligibility_finding' });
    expect(artifacts().filter((a) => a.status === 'current')).toHaveLength(2);
    const levelId = levelClaim.createdClaimIds[2]!;
    const fix = h.seed([extracted(h.student, 'course', 'c_math', 'level', { original: 'HL', normalized: 'IB_HL' }, 'HL', { supersedes: [levelId] })]);
    const stale = artifacts().filter((a) => a.status === 'stale');
    expect(stale.map((a) => a.scopeKey)).toEqual([eng.p.scopeKey]);
    expect(fix.invalidatedArtifactIds).toHaveLength(1);
    expect(artifacts().find((a) => a.scopeKey === hist.p.scopeKey)!.status).toBe('current');
    const again = await check(h, scope());
    expect(again.p.overall).toBe('conditionally_on_track');
  });

  it('06T16 meeting all published minimums carries no guarantee or competitiveness claim', async () => {
    const h = setup();
    h.seed([
      stated(h.student, 'education.qualification_system', { id: 'IB_DP', label: 'IB Diploma Programme' }),
      extracted(h.student, 'qualification', 'q1', 'credential', { id: 'IB_DIPLOMA', label: 'IB Diploma' }, 'IB Diploma'),
      extracted(h.student, 'qualification', 'q1', 'status', 'awarded', 'Awarded'),
      stated(h.student, 'education.schooling_language', { language: 'en', yearsOfInstruction: 6 }),
      ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_HL', grade: '7', status: 'final' }),
    ]);
    const { p, out } = await check(h);
    expect(p.overall).toBe('apparently_meets');
    expect(p.admissionProbability).toBeNull();
    expect(p.institutionalDecision).toBe(false);
    expect(p.competitivenessAssessed).toBe(false);
    expect(p.limitations.join(' ')).toMatch(/does not guarantee admission/);
    expect(out.result.summary).not.toMatch(/guarantee|you are eligible|will be admitted/i);
  });
});

describe('Agent 06 — coverage, validation and safety', () => {
  it('a draft (unreviewed) rule package can neither affirm nor exclude eligibility', async () => {
    const h = setup([engineeringPackage({ reviewStatus: 'draft', reviewedBy: undefined, reviewedAt: undefined } as never)]);
    h.seed(baseFacts(h.student));
    const { p } = await check(h);
    expect(p.overall).toBe('outside_supported_coverage');
    expect(p.coverage.status).toBe('rule_package_not_reviewed');
  });

  it('a reviewed rule package citing a retracted, stale or unofficial source is refused (06R03)', () => {
    const withSource = (over: Partial<ReturnType<typeof source>>) => engineeringPackage({ sources: [{ ...source('src_program'), ...over }, source('src_central', 'Example University central admissions page', 'official_institution')] });
    for (const over of [{ reviewStatus: 'retracted' as const }, { reviewStatus: 'stale' as const }, { sourceType: 'third_party_listing' as const }]) {
      expect(() => setup([withSource(over)])).toThrow(/Invalid rule package/);
    }
    // A draft may still hold such a source while it waits for review; it never decides anything.
    expect(() => setup([{ ...withSource({ reviewStatus: 'retracted' }), reviewStatus: 'draft' } as never])).not.toThrow();
  });

  it('an unsupported credential is not given an eligibility decision (XT17)', async () => {
    const h = setup();
    h.seed([stated(h.student, 'education.qualification_system', { id: 'FR_BAC', label: 'French Baccalauréat' })]);
    const { p } = await check(h);
    expect(p.overall).toBe('outside_supported_coverage');
    expect(p.coverage.status).toBe('credential_not_supported');
  });

  it('no rule package at all is honestly outside coverage', async () => {
    const h = setup([]);
    h.seed(baseFacts(h.student));
    const { p } = await check(h, scope({ programRef: 'unknown_program' }));
    expect(p.overall).toBe('outside_supported_coverage');
  });

  it('an unconfirmed consequential statement cannot produce a hard negative', async () => {
    const h = setup();
    const { buildClaim } = await import('../../src/agents/a04-record-steward/claims.js');
    const { said } = await import('../helpers/kernel.js');
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', grade: '7', status: 'final' }), buildClaim({ entity: 'course', entityId: 'c_math', attribute: 'level', value: { original: 'SL', normalized: 'IB_SL' }, origin: 'student_statement', evidence: [said('I think it is SL')], actor: h.student, viaRole: 'ui' })]);
    const { p } = await check(h);
    expect(finding(p, 'math_level_required').state).toBe('unknown');
    expect(finding(p, 'math_level_required').resolution?.kind).toBe('confirm_fact');
    expect(p.overall).toBe('unresolved');
  });

  it('a TOEFL report on a scale the institution does not list is never converted', async () => {
    const pkg = engineeringPackage({ rules: { kind: 'all', id: 'root', label: 'root', children: [qualificationQ, { ...(languageRoutes as { children: unknown[] }).children[0] as object, predicate: { type: 'test_score', family: 'TOEFL_IBT', acceptedVersions: ['toefl_ibt_0_120'], component: 'total', minimum: 90, sectionMinimums: [], acceptsIssuerSuperscore: false } } as never] } });
    const h = setup([pkg]);
    h.seed([...baseFacts(h.student), stated(h.student, 'record', { family: 'TOEFL_IBT', versionRef: 'toefl_ibt_band_1_6', subjectLabel: null, administrationDate: '2026-06-10', deliveryFormat: 'computer_test_center', sections: { reading: 5.5, listening: 5, speaking: 5, writing: 5 }, reportedTotal: 5, comparableLegacyTotal: 98, combination: 'single_administration', reportStatus: 'official' }, { entity: 'test_attempt', entityId: 't1' })]);
    const { p } = await check(h);
    const f = finding(p, 'english_route_a_toefl');
    expect(f.state).toBe('unknown');
    expect(f.explanation).toMatch(/No conversion between scales is made/);
  });

  it('the contract rejects an overall finding that does not follow from the rule states', async () => {
    const h = setup();
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_SL', grade: '7', status: 'final' })]);
    const tampering = new (class extends EligibilityAgent {
      override async handle(ctx: Parameters<EligibilityAgent['handle']>[0]) {
        const r = await super.handle(ctx);
        return { ...r, payload: { ...(r.payload as EligibilityPayload), overall: 'apparently_meets' as const } };
      }
    })();
    const h2 = makeKernel();
    h2.kernel.registerSpecialist(tampering);
    h2.kernel.rules.add(engineeringPackage());
    h2.seed([...baseFacts(h2.student), ...ibCourse(h2.student, 'c_math', { subject: 'ib.math_aa', level: 'IB_SL', grade: '7', status: 'final' })]);
    const out = await h2.kernel.invoke(h2.task({ role: '06', purpose: 'eligibility_check', objective: 'check', completionContract: 'eligibility_finding_v1', scope: { eligibility: scope() } }));
    expect(out.accepted).toBe(false);
    expect(out.issues.join()).toMatch(/does not follow from the rule states/);
    void h;
  });

  it('repeated attempts with different results stay unresolved unless the policy is published', async () => {
    const h = setup();
    h.seed([...baseFacts(h.student), ...ibCourse(h.student, 'c1', { subject: 'ib.math_aa', level: 'IB_HL', grade: '5', status: 'final', attempt: 1, courseKey: 'math_aa_hl' }), ...ibCourse(h.student, 'c2', { subject: 'ib.math_aa', level: 'IB_HL', grade: '6', status: 'final', attempt: 2, courseKey: 'math_aa_hl' })]);
    const { p } = await check(h);
    expect(finding(p, 'math_level_required').state).toBe('unknown');
    expect(finding(p, 'math_level_required').explanation).toMatch(/Several attempts/);
  });
});

void source;
