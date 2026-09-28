import type { ScholarshipInput } from '../../src/agents/a16-scholarships/catalog.js';
import type { Clause } from '../../src/agents/a16-scholarships/rules.js';

/**
 * Fictional scholarships for Agent 16 tests. Every provider, award, amount and
 * date is synthetic; none describes a real scholarship.
 */

const src = (id: string, url: string) => ({ sourceRef: `ssrc_${id}`, url, retrievedAt: '2026-09-20T10:00:00Z' });
const leaf = (clauseId: string, kind: Extract<Clause, { leaf: unknown }>['leaf']['kind'], text: string, params: Record<string, unknown>, sourceRef: string): Clause => ({ leaf: { clauseId, kind, text, sourceRef, params } });

export function scholarship(id: string, over: Partial<ScholarshipInput> = {}): ScholarshipInput {
  const url = `https://awards.example.org/${id}`;
  return {
    scholarshipId: id,
    name: `Award ${id}`,
    provider: { name: `Provider ${id}`, kind: 'foundation', officialDomains: ['awards.example.org'], institutionEntityId: null },
    cycle: '2027',
    cycleStatus: 'current',
    applicationUrl: `${url}/apply`,
    sources: [src(id, url)],
    applicantLevels: ['undergraduate_incoming'],
    consideration: 'separate_application',
    origin: 'external',
    basis: 'merit',
    award: { kind: 'fixed', amount: { amount: '2000.00', currency: 'USD' }, duration: 'one_time', portability: 'portable' },
    rule: leaf(`${id}_grad`, 'graduation_between', 'Applicants must graduate from secondary school between January and August 2027.', { from: '2027-01', to: '2027-08' }, `ssrc_${id}`),
    stages: [{ stageId: 'application', kind: 'award_application', label: 'Award application', owner: 'student', deadline: { date: '2027-02-15', time: '17:00', timezone: 'America/New_York', sourceRef: `ssrc_${id}` }, details: { essays: 1 } }],
    trust: { status: 'verified_provider', evidence: ['Linked from the provider’s own site'], checkedAt: '2026-09-20T10:00:00Z' },
    ...over,
  };
}

/** Portable, fixed, low effort; requires US schooling. */
export const HARBOR_ROTARY: ScholarshipInput = scholarship('harbor_rotary', {
  name: 'Harbor Rotary Scholarship',
  provider: { name: 'Harbor Rotary Club', kind: 'community_organization', officialDomains: ['harborrotary.example.org'], institutionEntityId: null },
  applicationUrl: 'https://harborrotary.example.org/scholarship/apply',
  sources: [src('harbor_rotary', 'https://harborrotary.example.org/scholarship')],
  award: { kind: 'fixed', amount: { amount: '5000.00', currency: 'USD' }, duration: 'one_academic_year', portability: 'portable' },
  rule: { all: [leaf('hr_grad', 'graduation_between', 'Graduating seniors of the class of 2027.', { from: '2027-01', to: '2027-08' }, 'ssrc_harbor_rotary'), leaf('hr_school', 'school_country_in', 'Must attend a high school in the United States.', { countries: ['US'] }, 'ssrc_harbor_rotary')] },
  stages: [{ stageId: 'application', kind: 'award_application', label: 'Rotary application', owner: 'student', deadline: { date: '2027-02-15', time: null, timezone: null, sourceRef: 'ssrc_harbor_rotary' }, details: { essays: 1, references: 1 } }],
  topics: ['community_service'],
});

/** A conjunction of citizenship and school location (16T02), and an "up to" amount (16T06). */
export const BEACON_SCHOLARS: ScholarshipInput = scholarship('beacon_scholars', {
  name: 'Beacon Scholars Award',
  provider: { name: 'Beacon Foundation', kind: 'foundation', officialDomains: ['beaconfoundation.example.org'], institutionEntityId: null },
  applicationUrl: 'https://beaconfoundation.example.org/apply',
  sources: [src('beacon_scholars', 'https://beaconfoundation.example.org/eligibility')],
  basis: 'merit',
  award: { kind: 'up_to', max: { amount: '20000.00', currency: 'USD' }, duration: 'one_academic_year', portability: 'portable' },
  rule: {
    all: [
      leaf('bs_citizen', 'citizenship_in', 'U.S. citizens or permanent residents.', { countries: ['US'] }, 'ssrc_beacon_scholars'),
      leaf('bs_school', 'school_country_in', 'Currently attending high school in the United States.', { countries: ['US'] }, 'ssrc_beacon_scholars'),
      leaf('bs_grad', 'graduation_between', 'Graduating in 2027.', { from: '2027-01', to: '2027-12' }, 'ssrc_beacon_scholars'),
      leaf('bs_first', 'first_undergraduate_degree', 'Students already enrolled in college are not eligible.', {}, 'ssrc_beacon_scholars'),
    ],
  },
  selectionCriteria: ['Leadership in school or community', 'Service to others'],
  stages: [{ stageId: 'application', kind: 'award_application', label: 'Beacon application', owner: 'student', deadline: { date: '2026-10-31', time: '23:59', timezone: 'America/New_York', sourceRef: 'ssrc_beacon_scholars' }, details: { essays: 2, references: 2 } }],
  topics: ['leadership', 'community_service'],
});

/** Institutional, nominated, full tuition only, several linked deadlines (16T03, 16T04), exclusive with the merit award (16T07). */
export const ALDERMERE_PRESIDENTIAL: ScholarshipInput = scholarship('aldermere_presidential', {
  name: 'Aldermere Presidential Scholarship',
  provider: { name: 'Aldermere College', kind: 'institution', officialDomains: ['aldermere.example.edu'], institutionEntityId: 'aldermere_c' },
  applicationUrl: 'https://scholarships.aldermere.example.edu/presidential/apply',
  sources: [src('aldermere_presidential', 'https://scholarships.aldermere.example.edu/presidential')],
  origin: 'institutional',
  award: { kind: 'tuition_waiver', coveredCosts: ['tuition'], duration: 'full_degree', renewal: { renewable: true, conditions: ['a 3.3 GPA each year'], maxYears: 4 }, portability: 'destination_restricted', destinations: [{ institutionRef: 'aldermere_c', programRef: null }] },
  rule: { all: [leaf('ap_apply', 'applying_to', 'Applicants for first-year admission to Aldermere College.', { institutions: ['aldermere_c'] }, 'ssrc_aldermere_presidential'), leaf('ap_grad', 'graduation_between', 'Completing secondary school in 2027.', { from: '2027-01', to: '2027-12' }, 'ssrc_aldermere_presidential')] },
  stages: [
    { stageId: 'nomination', kind: 'nomination', label: 'School nomination', owner: 'school', deadline: { date: '2026-11-01', time: null, timezone: null, sourceRef: 'ssrc_aldermere_presidential' }, internalDeadline: 'unknown', details: { perSchoolLimit: 1, nominator: 'your school counselor', refereeMustDiffer: true } },
    { stageId: 'admission', kind: 'admission_application', label: 'Aldermere admission application', owner: 'student', deadline: { date: '2026-11-15', time: null, timezone: null, sourceRef: 'ssrc_aldermere_presidential' }, dependsOn: ['nomination'] },
    { stageId: 'reference', kind: 'reference', label: 'Referee letter', owner: 'referee', deadline: { date: '2026-11-20', time: null, timezone: null, sourceRef: 'ssrc_aldermere_presidential' }, dependsOn: ['nomination'] },
    { stageId: 'application', kind: 'award_application', label: 'Presidential Scholarship application', owner: 'student', deadline: { date: '2026-12-01', time: '23:59', timezone: 'America/New_York', sourceRef: 'ssrc_aldermere_presidential' }, dependsOn: ['nomination', 'admission'], details: { essays: 2 } },
    { stageId: 'interview', kind: 'interview', label: 'Finalist interview', owner: 'sponsor', deadline: null, dependsOn: ['application'], details: { interviewFormat: 'video', assessed: true } },
  ],
  exclusiveWith: [{ scholarshipId: 'aldermere_merit', text: 'Presidential Scholars do not also receive the Aldermere Merit Award.', sourceRef: 'ssrc_aldermere_presidential' }],
  topics: ['leadership'],
});

export const ALDERMERE_MERIT: ScholarshipInput = scholarship('aldermere_merit', {
  name: 'Aldermere Merit Award',
  provider: { name: 'Aldermere College', kind: 'institution', officialDomains: ['aldermere.example.edu'], institutionEntityId: 'aldermere_c' },
  applicationUrl: null,
  sources: [src('aldermere_merit', 'https://finaid.aldermere.example.edu/merit')],
  origin: 'institutional',
  consideration: 'automatic_with_admission',
  award: { kind: 'fixed', amount: { amount: '10000.00', currency: 'USD' }, duration: 'one_academic_year', renewal: { renewable: true, conditions: ['full-time enrollment'], maxYears: 4 }, portability: 'destination_restricted', destinations: [{ institutionRef: 'aldermere_c', programRef: null }] },
  rule: leaf('am_apply', 'applying_to', 'All first-year applicants are considered.', { institutions: ['aldermere_c'] }, 'ssrc_aldermere_merit'),
  stages: [{ stageId: 'admission', kind: 'admission_application', label: 'Aldermere admission application', owner: 'student', deadline: { date: '2027-01-05', time: null, timezone: null, sourceRef: 'ssrc_aldermere_merit' } }],
  exclusiveWith: [{ scholarshipId: 'aldermere_presidential', text: 'Presidential Scholars do not also receive the Aldermere Merit Award.', sourceRef: 'ssrc_aldermere_merit' }],
});

export const GRADUATE_FELLOWSHIP: ScholarshipInput = scholarship('lumen_graduate_fellowship', { name: 'Lumen Graduate Fellowship', applicantLevels: ['graduate'] });

/** Tied to a first-choice program (16T16). */
export const KESTREL_EXCELLENCE: ScholarshipInput = scholarship('kestrel_excellence', {
  name: 'Kestrel Excellence Award',
  provider: { name: 'Kestrel University', kind: 'institution', officialDomains: ['kestrel.example.ac.uk'], institutionEntityId: 'kestrel_u' },
  applicationUrl: 'https://www.kestrel.example.ac.uk/funding/excellence-award/apply',
  sources: [src('kestrel_excellence', 'https://www.kestrel.example.ac.uk/funding/excellence-award')],
  origin: 'institutional',
  award: { kind: 'fixed', amount: { amount: '3000.00', currency: 'GBP' }, duration: 'one_academic_year', portability: 'destination_restricted', destinations: [{ institutionRef: 'kestrel_u', programRef: 'kestrel_economics' }] },
  rule: leaf('ke_first', 'first_choice_program', 'Available only to applicants who hold Economics at Kestrel as their first choice.', { institutions: ['kestrel_u'], programs: ['kestrel_economics'] }, 'ssrc_kestrel_excellence'),
  stages: [{ stageId: 'application', kind: 'award_application', label: 'Excellence Award form', owner: 'student', deadline: { date: '2027-01-31', time: '12:00', timezone: 'Europe/London', sourceRef: 'ssrc_kestrel_excellence' } }],
});

/** A small local provider with limited public evidence (16T10). */
export const LOCAL_LIBRARY: ScholarshipInput = scholarship('millbrook_library', {
  name: 'Millbrook Library Friends Award',
  provider: { name: 'Friends of Millbrook Library', kind: 'community_organization', officialDomains: [], institutionEntityId: null },
  applicationUrl: null,
  trust: { status: 'unresolved', evidence: ['No official website or known contact is on file.'], checkedAt: '2026-09-20T10:00:00Z' },
});

/** A need-based award with sensitive clauses (16T14). */
export const PEARLGATE: ScholarshipInput = scholarship('pearlgate_access', {
  name: 'Pearlgate Access Scholarship',
  basis: 'need',
  rule: { all: [leaf('pg_res', 'residence_in', 'Residents of the United States.', { countries: ['US'] }, 'ssrc_pearlgate_access'), leaf('pg_need', 'financial_need', 'Applicants must demonstrate financial need.', {}, 'ssrc_pearlgate_access'), leaf('pg_grad', 'graduation_between', 'Class of 2027.', { from: '2027-01', to: '2027-12' }, 'ssrc_pearlgate_access')] },
});

export const ALL_SCHOLARSHIPS = [HARBOR_ROTARY, BEACON_SCHOLARS, ALDERMERE_PRESIDENTIAL, ALDERMERE_MERIT, GRADUATE_FELLOWSHIP, KESTREL_EXCELLENCE, LOCAL_LIBRARY, PEARLGATE];
