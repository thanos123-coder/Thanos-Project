import { describe, expect, it } from 'vitest';
import { absent } from '../../src/shared/absence.js';
import { validateTestScore, sameScale, type TestScoreRecord } from '../../src/shared/assessments.js';
import { compareGrades, meetsGradeThreshold, parseGrade, parseLocalizedNumber, REFERENCE_SCALES, type GradingScale } from '../../src/shared/grades.js';
import {
  CurrencyMismatchError,
  addMoney,
  checkAffordability,
  compareMoney,
  convertMoney,
  formatMoney,
  money,
  totalCoveredCosts,
  type CostComponent,
} from '../../src/shared/money.js';

describe('money', () => {
  it('is exact decimal arithmetic', () => {
    expect(addMoney(money('0.10', 'EUR'), money('0.20', 'EUR'))).toEqual({ amount: '0.30', currency: 'EUR' });
    expect(money(150, 'EUR')).toEqual({ amount: '150.00', currency: 'EUR' });
    expect(money(1500, 'JPY')).toEqual({ amount: '1500', currency: 'JPY' });
  });

  it('never combines currencies without a dated rate', () => {
    expect(() => addMoney(money(1, 'EUR'), money(1, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => compareMoney(money(1, 'EUR'), money(1, 'USD'))).toThrow(CurrencyMismatchError);
    const c = convertMoney(money(100, 'USD'), { from: 'USD', to: 'EUR', rate: '0.9215', asOf: '2026-09-27', source: 'test fixture' });
    expect(c).toMatchObject({ money: { amount: '92.15', currency: 'EUR' }, estimate: true });
  });

  it('formats for students', () => {
    expect(formatMoney(money(150, 'EUR'))).toBe('€150');
    expect(formatMoney(money('1050.5', 'EUR'))).toBe('€1,050.50');
    expect(formatMoney(money(20, 'CHF'))).toBe('20 CHF');
  });

  const budget = { amount: money(150, 'EUR'), kind: 'hard_cap' as const, covers: 'all' as const, appliesTo: 'per_opportunity' as const };

  it('free tuition with unknown travel is unresolved, not affordable (09T04)', () => {
    const costs: CostComponent[] = [
      { component: 'tuition', amount: money(0, 'EUR'), estimate: false, required: true },
      { component: 'travel', amount: absent('not_supplied'), estimate: false, required: true },
    ];
    expect(checkAffordability(costs, budget)).toMatchObject({ verdict: 'unresolved', reason: 'unknown_components' });
  });

  it('a known total above the cap is over budget even with unknowns', () => {
    const costs: CostComponent[] = [
      { component: 'tuition', amount: money(0, 'EUR'), estimate: false, required: true },
      { component: 'travel', amount: money(180, 'EUR'), estimate: true, required: true },
      { component: 'meals', amount: absent('not_supplied'), estimate: false, required: true },
    ];
    expect(checkAffordability(costs, budget)).toMatchObject({ verdict: 'over_budget', overBy: { amount: '30.00' } });
  });

  it('budget scope matters: a tuition-only budget ignores travel', () => {
    const tuitionOnly = { ...budget, covers: ['tuition'] as ('tuition')[] };
    const costs: CostComponent[] = [
      { component: 'tuition', amount: money(120, 'EUR'), estimate: false, required: true },
      { component: 'travel', amount: absent('not_supplied'), estimate: false, required: true },
    ];
    expect(checkAffordability(costs, tuitionOnly).verdict).toBe('within_budget');
    expect(checkAffordability(costs, budget).verdict).toBe('unresolved');
  });

  it('a total that includes an estimate or a converted amount says so', () => {
    const exact: CostComponent[] = [{ component: 'tuition', amount: money(100, 'EUR'), estimate: false, required: true }];
    expect(totalCoveredCosts(exact, budget).includesEstimates).toBe(false);
    const estimated: CostComponent[] = [...exact, { component: 'travel', amount: money(20, 'EUR'), estimate: true, required: true }];
    expect(totalCoveredCosts(estimated, budget)).toMatchObject({ known: { amount: '120.00' }, includesEstimates: true });
    const converted: CostComponent[] = [...exact, { component: 'travel', amount: money(10, 'USD'), estimate: false, required: true }];
    const rate = { from: 'USD', to: 'EUR', rate: '0.90', asOf: '2026-09-01', source: 'test rate' };
    expect(totalCoveredCosts(converted, budget, [rate])).toMatchObject({ known: { amount: '109.00' }, includesEstimates: true });
  });

  it('a foreign-currency cost without a rate stays unresolved', () => {
    const costs: CostComponent[] = [{ component: 'tuition', amount: money(100, 'USD'), estimate: false, required: true }];
    expect(checkAffordability(costs, budget)).toMatchObject({ verdict: 'unresolved', reason: 'unconvertible_currency' });
  });
});

describe('grades are preserved and never converted across scales', () => {
  it('parses a decimal comma on a bounded scale (03T11 context)', () => {
    expect(parseGrade({ original: '18,5', scaleRef: 'twenty_point_0_20', status: 'final', weighting: null })).toEqual({ ok: true, kind: 'numeric', value: 18.5 });
  });

  it('detects decimal-separator ambiguity instead of guessing', () => {
    expect(parseLocalizedNumber('1,234')).toBe('ambiguous');
    expect(parseLocalizedNumber('1,234', { min: 0, max: 20 })).toBe(1.234);
    expect(parseLocalizedNumber('1.234,5')).toBe(1234.5);
    expect(parseLocalizedNumber('1,234.5')).toBe(1234.5);
  });

  it('a dash without a legend is never zero or fail (03T06)', () => {
    expect(parseGrade({ original: '-', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null })).toEqual({ ok: false, reason: 'symbol_without_legend' });
  });

  it('flags out-of-range values', () => {
    expect(parseGrade({ original: '8', scaleRef: 'ib_subject_1_7', status: 'final', weighting: null })).toEqual({ ok: false, reason: 'out_of_range' });
  });

  it('compares only on the same scale', () => {
    const a = { original: '6', scaleRef: 'ib_subject_1_7', status: 'final' as const, weighting: null };
    const b = { original: '5', scaleRef: 'ib_subject_1_7', status: 'final' as const, weighting: null };
    const c = { original: '18', scaleRef: 'twenty_point_0_20', status: 'final' as const, weighting: null };
    expect(compareGrades(a, b)).toBe(1);
    expect(compareGrades(a, c)).toBe('incomparable');
    expect(compareGrades({ original: 'A*', scaleRef: 'a_level_letter', status: 'final', weighting: null }, { original: 'A', scaleRef: 'a_level_letter', status: 'final', weighting: null })).toBe(1);
    expect(meetsGradeThreshold(a, { original: '6', scaleRef: 'ib_subject_1_7' })).toBe(true);
    expect(meetsGradeThreshold(c, { original: '6', scaleRef: 'ib_subject_1_7' })).toBe('unknown');
  });

  it('on a scale where lower is better, a lower number is the better grade', () => {
    const oneToSix: GradingScale = { id: 'one_to_six', name: 'Grades 1 (best) to 6', kind: 'numeric', min: 1, max: 6, step: 0.1, direction: 'lower_is_better', origin: 'document_legend' };
    const scales = { ...REFERENCE_SCALES, one_to_six: oneToSix };
    const g = (original: string) => ({ original, scaleRef: 'one_to_six', status: 'final' as const, weighting: null });
    expect(compareGrades(g('1.3'), g('2.0'), scales)).toBe(1);
    expect(meetsGradeThreshold(g('1.7'), { original: '2.5', scaleRef: 'one_to_six' }, scales)).toBe(true);
    expect(meetsGradeThreshold(g('3.0'), { original: '2.5', scaleRef: 'one_to_six' }, scales)).toBe(false);
  });
});

describe('test scores keep version, date and scale together', () => {
  const toeflNew: TestScoreRecord = {
    family: 'TOEFL_IBT',
    versionRef: 'toefl_ibt_band_1_6',
    subjectLabel: null,
    administrationDate: '2026-03-14',
    deliveryFormat: 'computer_test_center',
    sections: { reading: 5, listening: 5.5, speaking: 4.5, writing: 5 },
    reportedTotal: 5,
    comparableLegacyTotal: 102,
    combination: 'single_administration',
    reportStatus: 'official',
  };

  it('accepts a valid band-scale report (03T12)', () => {
    expect(validateTestScore(toeflNew)).toEqual([]);
  });

  it('rejects values that do not fit the stated scale', () => {
    const wrong = { ...toeflNew, sections: { ...toeflNew.sections, reading: 27 }, reportedTotal: 98 };
    const issues = validateTestScore(wrong);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['out_of_range']));
    const halfStep = { ...toeflNew, sections: { ...toeflNew.sections, reading: 4.25 } };
    expect(validateTestScore(halfStep).map((i) => i.code)).toContain('step_mismatch');
  });

  it('warns when an administration date predates the stated version', () => {
    const early = { ...toeflNew, administrationDate: '2025-11-02' };
    expect(validateTestScore(early).map((i) => i.code)).toContain('date_outside_version_window');
  });

  it('different ACT formats are never the same scale (07T09)', () => {
    const legacy: TestScoreRecord = { ...toeflNew, family: 'ACT', versionRef: 'act_four_section', sections: { english: 30, math: 28, reading: 31, science: 27 }, reportedTotal: 29, comparableLegacyTotal: null, administrationDate: '2024-10-26' };
    const enhanced: TestScoreRecord = { ...legacy, versionRef: 'act_enhanced', sections: { english: 31, math: 29, reading: 32 }, reportedTotal: 31, administrationDate: '2025-10-25' };
    expect(validateTestScore(legacy)).toEqual([]);
    expect(validateTestScore(enhanced)).toEqual([]);
    expect(sameScale(legacy, enhanced)).toBe(false);
  });
});
