import { describe, expect, it } from 'vitest';
import * as P from '../../../src/agents/a02-intake/parsers.js';

describe('intake parsers', () => {
  it('parses number words, including the one-hundred-fifty vs one-thousand-fifty distinction', () => {
    expect(P.wordsToNumber('one hundred and fifty')).toBe(150);
    expect(P.wordsToNumber('one thousand fifty')).toBe(1050);
    expect(P.wordsToNumber('a thousand and fifty')).toBe(1050);
    expect(P.wordsToNumber('fifteen')).toBe(15);
    expect(P.wordsToNumber('fifty')).toBe(50);
    expect(P.findNumbers('I can spend one hundred and fifty euros').map((n) => n.value)).toEqual([150]);
    expect(P.findNumbers('about 1,050 or 150').map((n) => n.value)).toEqual([1050, 150]);
  });

  it('parses budgets without guessing currency or scope', () => {
    expect(P.parseBudget('up to €150 including transport')).toMatchObject({ budget: { amount: { amount: '150.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all' }, missing: [] });
    expect(P.parseBudget('about 200')).toMatchObject({ missing: ['currency', 'scope'] });
    expect(P.parseBudget('ideally 300 dollars for tuition')).toMatchObject({ budget: { kind: 'preference', amount: { currency: 'USD' } } });
    expect(P.parseBudget('150 or 1050 euros').conflictingAmounts).toEqual([150, 1050]);
  });

  it('parses weekly hours and keeps vague answers vague', () => {
    expect(P.parseHoursPerWeek('maybe 3 hours a week')).toEqual({ min: 3, max: 3 });
    expect(P.parseHoursPerWeek('2-4 hours')).toEqual({ min: 2, max: 4 });
    expect(P.parseHoursPerWeek('an hour a day on weekdays')).toEqual({ min: 5, max: 5 });
    expect(P.parseHoursPerWeek('a few hours')).toBe('vague');
  });

  it('finds countries, systems and year labels without converting them', () => {
    expect(P.findCountries('I am Greek but not American')).toEqual(['GR']);
    expect(P.findQualificationSystem('we do the IB')).toEqual({ id: 'IB_DP', label: 'IB Diploma Programme' });
    expect(P.findYearLabel("I'm in Year 12")).toBe('Year 12');
    expect(P.looksLikeStreetAddress('12 Ermou Street, Athens 10563')).toBe(true);
    expect(P.looksLikeStreetAddress('Athens')).toBe(false);
  });

  it('attributes preferences to the right person', () => {
    expect(P.attributeClauses('I want design but my parents want medicine')).toEqual([
      { holder: 'student', holderLabel: null, text: 'I want design' },
      { holder: 'reported_other', holderLabel: 'parents', text: 'my parents want medicine' },
    ]);
  });

  it('recognizes control answers and tentative wording', () => {
    expect(P.controlAnswer("I don't know")).toBe('dont_know');
    expect(P.controlAnswer('prefer not to say')).toBe('declined');
    expect(P.controlAnswer('skip')).toBe('skip');
    expect(P.controlAnswer('not decided yet')).toBe('not_decided');
    expect(P.isTentative('I might graduate in June')).toBe(true);
    expect(P.isTentative('I graduate in June')).toBe(false);
    expect(P.modeChangeRequest('can we do a mock interview?')).toBe('interview_practice');
  });
});
