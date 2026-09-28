import type { RoleId } from '../../shared/envelopes.js';
import type { Purpose } from '../../shared/permissions.js';

/** The single purpose each specialist works under; a coordinator cannot choose a broader one. */
export const ROLE_PURPOSE: Readonly<Record<Exclude<RoleId, '01'>, Purpose>> = {
  '02': 'intake',
  '03': 'document_import',
  '04': 'record_maintenance',
  '05': 'exploration',
  '06': 'eligibility_check',
  '07': 'academic_planning',
  '08': 'experience_review',
  '09': 'opportunity_research',
  '10': 'project_mentoring',
  '11': 'college_research',
  '12': 'fit_matching',
  '13': 'admissions_context',
  '14': 'application_strategy',
  '15': 'financial_planning',
  '16': 'scholarship_matching',
  '17': 'essay_exploration',
  '18': 'narrative_review',
};

/** Student-facing names for what each specialist does. */
export const ROLE_WORK: Readonly<Record<Exclude<RoleId, '01'>, string>> = {
  '02': 'Questions for you',
  '03': 'Your document',
  '04': 'Your record',
  '05': 'Exploring subjects',
  '06': 'Program requirements',
  '07': 'Course and testing plan',
  '08': 'Your activities',
  '09': 'Opportunities',
  '10': 'Your project',
  '11': 'Official college information',
  '12': 'Your college list',
  '13': 'How selective it is',
  '14': 'Your application plan',
  '15': 'Costs and funding',
  '16': 'Scholarships',
  '17': 'Finding your essay material',
  '18': 'Your application writing',
};
