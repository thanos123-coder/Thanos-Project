import type { z } from 'zod';
import type { InstitutionRegistry, OfficialPageSchema } from '../../src/agents/a11-research/entities.js';

/**
 * Fictional institutions, platforms and official pages for Agent 11 tests.
 * Every name, domain, date and amount is synthetic and must never be read as
 * a real college requirement.
 */

export const NORTHFIELD = 'northfield_u';
export const LAKESIDE = 'northfield_lakeside';
export const HARBOR = 'northfield_harbor';
export const ALDERMERE = 'aldermere_c';
export const ARCH = 'aldermere_architecture';
export const KESTREL = 'kestrel_u';
export const UCAP = 'ucap';

export const URL = {
  aldermereDeadlines: 'https://admissions.aldermere.example.edu/apply/deadlines',
  aldermereAid: 'https://finaid.aldermere.example.edu/deadlines',
  aldermereRequirements: 'https://admissions.aldermere.example.edu/apply/requirements',
  aldermereArchitecture: 'https://arch.aldermere.example.edu/admission',
  aldermereCosts: 'https://finaid.aldermere.example.edu/cost',
  aldermereStats: 'https://ir.aldermere.example.edu/common-data-set',
  aldermereArchive: 'https://admissions.aldermere.example.edu/archive/deadlines-2024',
  aldermereScholarships: 'https://scholarships.aldermere.example.edu/presidential',
  aldermerePortal: 'https://apply.aldermere.example.edu/portal/checklist',
  aldermerePrompts: 'https://admissions.aldermere.example.edu/apply/essays',
  lakesideDeadlines: 'https://lakeside.northfield.example.edu/admissions/dates',
  lakesideCs: 'https://cs.northfield.example.edu/lakeside/admission',
  kestrelScholarship: 'https://www.kestrel.example.ac.uk/funding/excellence-award',
  kestrelFees: 'https://www.kestrel.example.ac.uk/fees',
  ucapPrompts: 'https://www.ucap.example.org/essay-prompts',
  searchHitDeadlines: 'https://admissions.aldermere.example.edu/first-year/key-dates',
  forum: 'https://forum.example.net/aldermere-deadline',
} as const;

export function seedInstitutions(r: InstitutionRegistry): void {
  r.add({ id: NORTHFIELD, kind: 'institution', name: 'Northfield University', aliases: ['NFU'], parentId: null, country: 'US', officialDomains: ['northfield.example.edu'], attributes: { control: 'public' } });
  r.add({ id: LAKESIDE, kind: 'campus', name: 'Lakeside Campus', aliases: ['Lakeside'], parentId: NORTHFIELD, country: 'US', attributes: { jurisdiction: 'Lake State' } });
  r.add({ id: HARBOR, kind: 'campus', name: 'Harbor Campus', aliases: ['Harbor'], parentId: NORTHFIELD, country: 'US', attributes: { jurisdiction: 'Harbor State' } });
  r.add({ id: 'northfield_cs_lakeside', kind: 'program', name: 'Computer Science', parentId: LAKESIDE, country: 'US', attributes: { degree: 'BS', accessRoute: 'later_competitive_selection' } });
  r.add({ id: 'northfield_cs_harbor', kind: 'program', name: 'Computer Science', parentId: HARBOR, country: 'US', attributes: { degree: 'BA', accessRoute: 'direct_entry' } });

  r.add({ id: ALDERMERE, kind: 'institution', name: 'Aldermere College', aliases: ['Aldermere'], parentId: null, country: 'US', officialDomains: ['aldermere.example.edu'], attributes: { control: 'private' } });
  r.add({ id: ARCH, kind: 'program', name: 'Architecture', parentId: ALDERMERE, country: 'US', attributes: { degree: 'BArch', accessRoute: 'direct_entry' } });

  r.add({ id: KESTREL, kind: 'institution', name: 'Kestrel University', parentId: null, country: 'GB', officialDomains: ['kestrel.example.ac.uk'], attributes: { control: 'public' } });
  r.add({ id: 'kestrel_economics', kind: 'program', name: 'Economics', parentId: KESTREL, country: 'GB', attributes: { degree: 'BSc', accessRoute: 'direct_entry' } });

  r.add({ id: 'riverside_us', kind: 'institution', name: 'Riverside College', parentId: null, country: 'US', officialDomains: ['riverside.example.edu'] });
  r.add({ id: 'riverside_ca', kind: 'institution', name: 'Riverside College', parentId: null, country: 'CA', officialDomains: ['riverside.example.ca'] });

  r.add({ id: UCAP, kind: 'platform', name: 'Unified College Application', parentId: null, country: 'US', officialDomains: ['ucap.example.org'] });
}

/** Registered official pages, each with the office that controls its facts. */
export function seedPages(r: InstitutionRegistry, which: ReadonlyArray<keyof typeof PAGES> = Object.keys(PAGES) as Array<keyof typeof PAGES>): void {
  for (const k of which) r.addPage(PAGES[k]);
}

export const PAGES = {
  aldermereDeadlines: { pageId: 'ald_deadlines', entityId: ALDERMERE, office: 'admissions', url: URL.aldermereDeadlines, covers: ['deadline', 'round'], categories: ['first_year'] },
  aldermereAid: { pageId: 'ald_aid', entityId: ALDERMERE, office: 'financial_aid', url: URL.aldermereAid, covers: ['financial_aid_deadline'], categories: ['first_year'] },
  aldermereRequirements: { pageId: 'ald_requirements', entityId: ALDERMERE, office: 'admissions', url: URL.aldermereRequirements, covers: ['requirement'] },
  aldermereArchitecture: { pageId: 'ald_arch', entityId: ARCH, office: 'department', url: URL.aldermereArchitecture, covers: ['requirement', 'access'] },
  aldermereCosts: { pageId: 'ald_costs', entityId: ALDERMERE, office: 'financial_aid', url: URL.aldermereCosts, covers: ['cost', 'aid_rule'] },
  aldermereStats: { pageId: 'ald_stats', entityId: ALDERMERE, office: 'registrar', url: URL.aldermereStats, covers: ['statistic'] },
  aldermereScholarships: { pageId: 'ald_schol', entityId: ALDERMERE, office: 'scholarship_office', url: URL.aldermereScholarships, covers: ['scholarship_rule', 'scholarship_deadline'] },
  lakesideDeadlines: { pageId: 'nfu_lakeside_dates', entityId: LAKESIDE, office: 'admissions', url: URL.lakesideDeadlines, covers: ['deadline'], categories: ['first_year'] },
  lakesideCs: { pageId: 'nfu_lakeside_cs', entityId: 'northfield_cs_lakeside', office: 'department', url: URL.lakesideCs, covers: ['access', 'requirement'] },
  kestrelScholarship: { pageId: 'kes_award', entityId: KESTREL, office: 'scholarship_office', url: URL.kestrelScholarship, covers: ['scholarship_rule', 'scholarship_deadline'] },
} satisfies Record<string, z.input<typeof OfficialPageSchema>>;

export const TEXT: Record<string, string> = {
  [URL.aldermereDeadlines]: [
    '# First-Year Application Deadlines',
    '',
    '## 2026-27 Application Cycle',
    'Early Action applications are due November 1, 2026.',
    'Regular Decision applications must be submitted by January 5, 2027 at 11:59 p.m. Eastern Time.',
    'Counselor recommendation letters are due January 20, 2027.',
    '',
    '## Frequently Asked Questions',
    'Last year the regular decision deadline was January 10, 2026.',
    '',
    '© 2026 Aldermere College. All rights reserved.',
  ].join('\n'),
  [URL.aldermereAid]: [
    '# Financial Aid Deadlines for Fall 2027 Entry',
    'First-year applicants must submit the CSS Profile deadline materials by February 1, 2027.',
    '',
    'Privacy Policy',
  ].join('\n'),
  [URL.aldermereRequirements]: [
    '# First-Year Admission Requirements for Fall 2027',
    'Aldermere is test-optional for fall 2027 applicants.',
    'International applicants must submit an IELTS score of at least 7.0 or a TOEFL iBT score of at least 100.',
  ].join('\n'),
  [URL.aldermereArchitecture]: [
    '# Architecture Admission for Fall 2027',
    'Applicants to the Bachelor of Architecture must submit a portfolio of 10 to 15 pieces.',
    'Aldermere is test-optional for fall 2027 applicants.',
  ].join('\n'),
  [URL.aldermereCosts]: [
    '# Cost of Attendance 2027-28 Academic Year',
    'Tuition is $58,400 per year.',
    'Mandatory student fees are $1,250 per semester.',
    'Housing costs vary by residence hall.',
    'The net price calculator is designed for families whose parents live and work in the United States and will not accurately estimate aid for families who live abroad.',
  ].join('\n'),
  [URL.aldermereStats]: [
    '# Common Data Set 2025-2026',
    '',
    'First-Year Applicants, Fall 2025',
    'Group | Applicants | Admitted | Enrolled',
    'Total | 12,480 | 1,873 | 612',
    'Transfer | 1,020 | * | 41',
    'Note: * suppressed to protect privacy (fewer than 10 students)',
    '',
    'Enrolled First-Year Students Who Submitted Scores, Fall 2025',
    'Test | 25th percentile | 75th percentile',
    'SAT Math | 690 | 770',
    'ACT Composite | 31 | 34',
  ].join('\n'),
  [URL.aldermereArchive]: [
    '# Deadlines for Fall 2024 Entry',
    'This page is archived and no longer maintained.',
    'Regular Decision applications are due January 3, 2024.',
    '',
    'Last updated: 12 March 2026',
    '© 2026 Aldermere College',
  ].join('\n'),
  [URL.aldermereScholarships]: [
    '# Presidential Scholarship for Fall 2027 Entry',
    'Scholarship applications are due December 1, 2026.',
    'The award is available only to applicants who list Architecture as their first-choice program.',
  ].join('\n'),
  [URL.lakesideDeadlines]: [
    '# Lakeside Campus First-Year Dates for Fall 2027',
    'Regular Decision applications are due January 15, 2027 at 5:00 p.m. Central Time.',
  ].join('\n'),
  [URL.lakesideCs]: [
    '# Computer Science at Lakeside for Fall 2027',
    'Admission to the university does not guarantee admission to the Computer Science major; students apply to the major after the first year through a competitive internal selection.',
  ].join('\n'),
  [URL.kestrelScholarship]: [
    '# Kestrel Excellence Award for 2027 Entry',
    'Scholarship applications close on 31 January 2027 at 12:00 noon UK time.',
    'The award is available only to applicants who hold Kestrel University as their firm choice and Economics as their first-choice programme.',
  ].join('\n'),
  [URL.searchHitDeadlines]: [
    '# Key Dates for Fall 2027',
    'Regular Decision applications are due January 5, 2027.',
  ].join('\n'),
};
