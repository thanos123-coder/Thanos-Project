import type { RulePackageInput, RuleNode } from '../../src/agents/a06-eligibility/rules.js';
import type { SourceRecord } from '../../src/shared/sources.js';

/**
 * Synthetic rule packages for tests. Every institution here is fictional
 * ("Example University") and marked synthetic; none describes a real policy.
 */

export function source(id: string, title = 'Example University admissions requirements', type: SourceRecord['sourceType'] = 'official_program'): SourceRecord {
  return {
    id,
    version: `${id}_v1`,
    publisher: 'Example University (synthetic)',
    canonicalUrl: `https://admissions.example.edu/${id}`,
    title,
    sourceType: type,
    scope: { institutionRef: 'example_university', cycle: '2027' },
    retrievedAt: '2026-09-20T09:00:00.000Z',
    contentHash: 'a'.repeat(64),
    permittedUse: 'quote_only',
    reviewStatus: 'expert_reviewed',
  };
}

const cite = (quote: string, sourceId = 'src_program') => ({ sourceId, quote });

export const mathHL: RuleNode = {
  kind: 'predicate',
  id: 'math_level_required',
  label: 'Mathematics at Higher Level, grade 6 or above',
  predicate: { type: 'subject_result', subjectKeys: ['ib.math_aa', 'ib.math_ai'], levels: ['IB_HL'], minimumGrade: { scaleRef: 'ib_subject_1_7', original: '6' }, attemptPolicy: 'unspecified' },
  stages: ['application', 'offer', 'enrollment'],
  mandatory: true,
  futureCompletionPermittedAt: ['application', 'offer'],
  evidence: { application: 'self_report_ok', offer: 'self_report_ok', enrollment: 'official_required' },
  source: cite('Applicants must offer Mathematics (Analysis and Approaches or Applications and Interpretation) at Higher Level with a grade of 6.'),
};

export const qualificationQ: RuleNode = {
  kind: 'predicate',
  id: 'qualification_q',
  label: 'IB Diploma',
  predicate: { type: 'qualification', credentialIds: ['IB_DIPLOMA'] },
  stages: ['application', 'offer', 'enrollment'],
  mandatory: true,
  futureCompletionPermittedAt: ['application', 'offer'],
  evidence: {},
  source: cite('Applicants should be completing or have completed the IB Diploma.'),
};

export const languageRoutes: RuleNode = {
  kind: 'any',
  id: 'english_language',
  label: 'English language requirement (one route)',
  children: [
    {
      kind: 'predicate',
      id: 'english_route_a_toefl',
      label: 'Route A: TOEFL iBT overall band 5 or above',
      predicate: { type: 'test_score', family: 'TOEFL_IBT', acceptedVersions: ['toefl_ibt_band_1_6'], component: 'total', minimum: 5, sectionMinimums: [], acceptsIssuerSuperscore: false, administeredOnOrAfter: '2025-09' },
      stages: ['application', 'offer', 'enrollment'],
      mandatory: true,
      futureCompletionPermittedAt: [],
      evidence: { application: 'self_report_ok', enrollment: 'official_required' },
      source: cite('TOEFL iBT: overall band score of 5.0.'),
    },
    {
      kind: 'predicate',
      id: 'english_route_b_schooling',
      label: 'Route B: at least four years of schooling taught in English',
      predicate: { type: 'schooling_language_years', languages: ['en'], minimumYears: 4 },
      stages: ['application', 'offer', 'enrollment'],
      mandatory: true,
      futureCompletionPermittedAt: [],
      evidence: {},
      source: cite('Applicants who have completed at least four years of full-time education taught in English may be exempt.'),
    },
    {
      kind: 'predicate',
      id: 'english_route_c_waiver',
      label: 'Route C: an approved English language waiver',
      predicate: { type: 'waiver_approved', waiverRef: 'example_english_waiver' },
      stages: ['application', 'offer', 'enrollment'],
      mandatory: true,
      futureCompletionPermittedAt: [],
      evidence: {},
      source: cite('A waiver may be requested; it applies only once approved.'),
    },
  ],
};

export function engineeringPackage(overrides: Partial<RulePackageInput> = {}): RulePackageInput {
  return {
    id: 'example_university_beng',
    version: '3',
    institutionRef: 'example_university',
    institutionName: 'Example University (synthetic)',
    programRef: 'beng_engineering',
    programName: 'BEng Engineering',
    campusRef: null,
    degreeLevel: 'undergraduate_first_degree',
    entryCycle: '2027',
    applicantCategories: ['first_year'],
    qualificationSystems: ['IB_DP'],
    stagesCovered: ['application', 'offer', 'enrollment'],
    sources: [source('src_program'), source('src_central', 'Example University central admissions page', 'official_institution')],
    reviewStatus: 'reviewed',
    reviewedBy: 'admissions_reviewer_1',
    reviewedAt: '2026-09-21T12:00:00.000Z',
    rules: { kind: 'all', id: 'root', label: 'All mandatory requirements', children: [qualificationQ, mathHL, languageRoutes] },
    testingPolicies: [],
    sourceConflicts: [],
    synthetic: true,
    ...overrides,
  };
}

/** A second program that does not depend on mathematics, for targeted-invalidation tests. */
export function historyPackage(): RulePackageInput {
  return {
    ...engineeringPackage(),
    id: 'example_university_ba_history',
    programRef: 'ba_history',
    programName: 'BA History',
    rules: { kind: 'all', id: 'root', label: 'All mandatory requirements', children: [qualificationQ, languageRoutes] },
  };
}
