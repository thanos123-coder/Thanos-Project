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
};
