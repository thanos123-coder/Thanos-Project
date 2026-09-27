import { z } from 'zod';
import { PartialDateSchema, isStrictlyBefore, type PartialDate } from './time.js';

/**
 * Standardized test records.
 *
 * Data dictionary: "Test score: test, administration, scale/version,
 * components, report status. Invalid shortcut: a bare number with no date or
 * format." A score is stored exactly as the issuer reports it. This module has
 * no function that computes a composite, a superscore, or a cross-version
 * conversion: those are issuer- and institution-defined (spec 03, 07T09, 07T10).
 */

export const TEST_FAMILIES = ['SAT', 'ACT', 'TOEFL_IBT', 'IELTS_ACADEMIC', 'IELTS_GENERAL', 'DUOLINGO_ENGLISH_TEST', 'AP', 'OTHER'] as const;
export type TestFamily = (typeof TEST_FAMILIES)[number];
export const TestFamilySchema = z.enum(TEST_FAMILIES);

export interface ScoreRange {
  min: number;
  max: number;
  step: number;
}

export interface TestVersion {
  id: string;
  family: TestFamily;
  label: string;
  /** Known section keys and their ranges. `null` means issuer-labelled sections are accepted within `openSectionRange`. */
  sections: Record<string, ScoreRange & { optional?: boolean }> | null;
  openSectionRange?: ScoreRange;
  /** Issuer-reported total or composite (never recomputed by this system). */
  total: (ScoreRange & { label: string }) | null;
  /** Administrations on or after this date (inclusive) may use this version. Informational. */
  effectiveFrom?: PartialDate;
  /** Administrations on or before this date may use this version. Informational. */
  effectiveTo?: PartialDate;
  notes: string;
}

/**
 * Reference version registry. Effective dates are informational only: the
 * version of a specific result comes from the score report itself. Mismatches
 * are flagged for review, never silently corrected.
 */
export const TEST_VERSIONS: Readonly<Record<string, TestVersion>> = {
  sat_400_1600: {
    id: 'sat_400_1600',
    family: 'SAT',
    label: 'SAT (400-1600 total; paper and digital administrations)',
    sections: {
      evidence_based_reading_writing: { min: 200, max: 800, step: 10 },
      math: { min: 200, max: 800, step: 10 },
    },
    total: { min: 400, max: 1600, step: 10, label: 'Total score' },
    notes: 'Delivery format (paper or digital) is recorded separately. Superscoring is an institution policy.',
  },
  act_four_section: {
    id: 'act_four_section',
    family: 'ACT',
    label: 'ACT (English, Math, Reading, Science; composite of four sections)',
    sections: {
      english: { min: 1, max: 36, step: 1 },
      math: { min: 1, max: 36, step: 1 },
      reading: { min: 1, max: 36, step: 1 },
      science: { min: 1, max: 36, step: 1 },
      writing: { min: 2, max: 12, step: 1, optional: true },
    },
    total: { min: 1, max: 36, step: 1, label: 'Composite (issuer-reported)' },
    effectiveTo: '2025-12',
    notes: 'Earlier ACT format. Its composite must not be recalculated or merged with an enhanced-format composite.',
  },
  act_enhanced: {
    id: 'act_enhanced',
    family: 'ACT',
    label: 'Enhanced ACT (composite from English, Math, Reading; Science optional)',
    sections: {
      english: { min: 1, max: 36, step: 1 },
      math: { min: 1, max: 36, step: 1 },
      reading: { min: 1, max: 36, step: 1 },
      science: { min: 1, max: 36, step: 1, optional: true },
      stem: { min: 1, max: 36, step: 1, optional: true },
      writing: { min: 2, max: 12, step: 1, optional: true },
    },
    total: { min: 1, max: 36, step: 1, label: 'Composite (issuer-reported)' },
    effectiveFrom: '2025-04',
    notes:
      'ACT reports the enhanced composite from English, Math and Reading; Science is optional and contributes to a STEM score. Administration context and geography determine which format applied.',
  },
  toefl_ibt_0_120: {
    id: 'toefl_ibt_0_120',
    family: 'TOEFL_IBT',
    label: 'TOEFL iBT (sections 0-30, total 0-120)',
    sections: {
      reading: { min: 0, max: 30, step: 1 },
      listening: { min: 0, max: 30, step: 1 },
      speaking: { min: 0, max: 30, step: 1 },
      writing: { min: 0, max: 30, step: 1 },
    },
    total: { min: 0, max: 120, step: 1, label: 'Total score' },
    effectiveTo: '2026-01',
    notes: 'Scale used before the January 2026 score-scale update.',
  },
  toefl_ibt_band_1_6: {
    id: 'toefl_ibt_band_1_6',
    family: 'TOEFL_IBT',
    label: 'TOEFL iBT (band scale 1-6 in half-band steps, from January 2026)',
    sections: {
      reading: { min: 1, max: 6, step: 0.5 },
      listening: { min: 1, max: 6, step: 0.5 },
      speaking: { min: 1, max: 6, step: 0.5 },
      writing: { min: 1, max: 6, step: 0.5 },
    },
    total: { min: 1, max: 6, step: 0.5, label: 'Overall band score' },
    effectiveFrom: '2026-01',
    notes:
      'ETS introduced a 1-6 band scale in January 2026. During a transition period reports also show a comparable 0-120 score; store it separately as comparableLegacyTotal. Institutions set their own requirements.',
  },
  ielts_academic_0_9: {
    id: 'ielts_academic_0_9',
    family: 'IELTS_ACADEMIC',
    label: 'IELTS Academic (bands 0-9 in half-band steps)',
    sections: {
      listening: { min: 0, max: 9, step: 0.5 },
      reading: { min: 0, max: 9, step: 0.5 },
      writing: { min: 0, max: 9, step: 0.5 },
      speaking: { min: 0, max: 9, step: 0.5 },
    },
    total: { min: 0, max: 9, step: 0.5, label: 'Overall band score' },
    notes: 'Academic and General Training are different tests.',
  },
  ielts_general_0_9: {
    id: 'ielts_general_0_9',
    family: 'IELTS_GENERAL',
    label: 'IELTS General Training (bands 0-9 in half-band steps)',
    sections: {
      listening: { min: 0, max: 9, step: 0.5 },
      reading: { min: 0, max: 9, step: 0.5 },
      writing: { min: 0, max: 9, step: 0.5 },
      speaking: { min: 0, max: 9, step: 0.5 },
    },
    total: { min: 0, max: 9, step: 0.5, label: 'Overall band score' },
    notes: 'Not interchangeable with IELTS Academic.',
  },
  duolingo_10_160: {
    id: 'duolingo_10_160',
    family: 'DUOLINGO_ENGLISH_TEST',
    label: 'Duolingo English Test (10-160)',
    sections: null,
    openSectionRange: { min: 10, max: 160, step: 5 },
    total: { min: 10, max: 160, step: 5, label: 'Overall score' },
    notes: 'Subscore names are taken from the issuer report.',
  },
  ap_1_5: {
    id: 'ap_1_5',
    family: 'AP',
    label: 'AP Exam (1-5)',
    sections: null,
    total: { min: 1, max: 5, step: 1, label: 'Exam score' },
    notes: 'One record per AP subject; the subject is stored in subjectLabel.',
  },
};

export const TestScoreRecordSchema = z
  .object({
    family: TestFamilySchema,
    /** Registry version id, or null when the report's version could not be established. */
    versionRef: z.string().nullable(),
    /** For subject tests such as AP, the subject exactly as reported. */
    subjectLabel: z.string().nullable().default(null),
    administrationDate: PartialDateSchema,
    deliveryFormat: z.enum(['paper', 'digital_test_center', 'online_at_home', 'computer_test_center', 'unknown']).default('unknown'),
    sections: z.record(z.string(), z.number()),
    /** Total or composite exactly as the issuer reports it; null when not reported. */
    reportedTotal: z.number().nullable(),
    /** A comparable score on an earlier scale, when the issuer reports one (e.g. TOEFL transition). */
    comparableLegacyTotal: z.number().nullable().default(null),
    /** How the reported numbers were combined by the issuer. */
    combination: z.enum(['single_administration', 'issuer_superscore', 'issuer_best_of', 'unknown']).default('single_administration'),
    reportStatus: z.enum(['official', 'self_reported', 'unofficial_practice', 'unknown']),
  })
  .strict();
export type TestScoreRecord = z.infer<typeof TestScoreRecordSchema>;

export interface ScoreIssue {
  field: string;
  code: 'unknown_version' | 'family_mismatch' | 'unknown_section' | 'out_of_range' | 'step_mismatch' | 'date_outside_version_window' | 'missing_required_section';
  message: string;
  severity: 'error' | 'warning';
}

function onStep(value: number, range: ScoreRange): boolean {
  const k = (value - range.min) / range.step;
  return Math.abs(k - Math.round(k)) < 1e-9;
}

/**
 * Validate a score record against its version definition. Errors mean the
 * record is internally inconsistent; warnings mean it needs review. Nothing is
 * corrected automatically.
 */
export function validateTestScore(record: TestScoreRecord): ScoreIssue[] {
  const issues: ScoreIssue[] = [];
  if (record.versionRef === null) {
    issues.push({ field: 'versionRef', code: 'unknown_version', message: 'The score scale/version is not established; it cannot be compared with requirements.', severity: 'warning' });
    return issues;
  }
  const version = TEST_VERSIONS[record.versionRef];
  if (!version) {
    issues.push({ field: 'versionRef', code: 'unknown_version', message: `Unknown test version ${record.versionRef}`, severity: 'error' });
    return issues;
  }
  if (version.family !== record.family) {
    issues.push({ field: 'family', code: 'family_mismatch', message: `Version ${version.id} belongs to ${version.family}, not ${record.family}`, severity: 'error' });
  }
  for (const [key, value] of Object.entries(record.sections)) {
    const range = version.sections ? version.sections[key] : version.openSectionRange;
    if (!range) {
      issues.push({ field: `sections.${key}`, code: 'unknown_section', message: `Section ${key} is not part of ${version.label}`, severity: 'error' });
      continue;
    }
    if (value < range.min || value > range.max) {
      issues.push({ field: `sections.${key}`, code: 'out_of_range', message: `${key}=${value} is outside ${range.min}-${range.max}`, severity: 'error' });
    } else if (!onStep(value, range)) {
      issues.push({ field: `sections.${key}`, code: 'step_mismatch', message: `${key}=${value} is not a valid increment of ${range.step}`, severity: 'error' });
    }
  }
  if (version.sections) {
    for (const [key, range] of Object.entries(version.sections)) {
      if (!range.optional && !(key in record.sections) && record.reportStatus === 'official' && Object.keys(record.sections).length > 0) {
        issues.push({ field: `sections.${key}`, code: 'missing_required_section', message: `Official report is missing section ${key}`, severity: 'warning' });
      }
    }
  }
  if (record.reportedTotal !== null && version.total) {
    const t = version.total;
    if (record.reportedTotal < t.min || record.reportedTotal > t.max) {
      issues.push({ field: 'reportedTotal', code: 'out_of_range', message: `Total ${record.reportedTotal} is outside ${t.min}-${t.max}`, severity: 'error' });
    } else if (!onStep(record.reportedTotal, t)) {
      issues.push({ field: 'reportedTotal', code: 'step_mismatch', message: `Total ${record.reportedTotal} is not a valid increment of ${t.step}`, severity: 'error' });
    }
  }
  if (version.effectiveFrom && isStrictlyBefore(record.administrationDate, version.effectiveFrom) === true) {
    issues.push({ field: 'administrationDate', code: 'date_outside_version_window', message: `Administration ${record.administrationDate} predates ${version.label}; confirm the scale on the report.`, severity: 'warning' });
  }
  if (version.effectiveTo && isStrictlyBefore(version.effectiveTo, record.administrationDate) === true) {
    issues.push({ field: 'administrationDate', code: 'date_outside_version_window', message: `Administration ${record.administrationDate} is after the documented use of ${version.label}; confirm the scale on the report.`, severity: 'warning' });
  }
  return issues;
}

/**
 * Two score records can be compared or combined only when they share a family
 * and version. This system never combines them itself; this predicate exists so
 * planners can explain *why* a homemade composite is refused.
 */
export function sameScale(a: TestScoreRecord, b: TestScoreRecord): boolean {
  return a.family === b.family && a.versionRef !== null && a.versionRef === b.versionRef;
}

/** Human-readable, non-computing description of a score record. */
export function describeTestScore(r: TestScoreRecord): string {
  const version = r.versionRef ? TEST_VERSIONS[r.versionRef] : undefined;
  const label = version?.label ?? `${r.family} (scale not established)`;
  const subject = r.subjectLabel ? ` ${r.subjectLabel}` : '';
  const total = r.reportedTotal !== null ? `, ${version?.total?.label ?? 'total'} ${r.reportedTotal}` : '';
  const legacy = r.comparableLegacyTotal !== null ? ` (issuer comparable score ${r.comparableLegacyTotal} on the earlier scale)` : '';
  return `${label}${subject}, administered ${r.administrationDate}${total}${legacy}, ${r.reportStatus.replace(/_/g, ' ')}`;
}
