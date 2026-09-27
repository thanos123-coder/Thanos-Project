/**
 * Subject taxonomy. Credential-specific subject keys (e.g. `ib.math_aa`) map to
 * a broad subject (`mathematics`) for search and for flagging *possible*
 * matches. A broad match is never an equivalence: "'Mathematics' can be mapped
 * to a broad subject for search, but that does not establish equivalence to
 * calculus, a particular IB course, or a university prerequisite" (spec 03).
 */

const BROAD: Readonly<Record<string, string>> = {
  'ib.math_aa': 'mathematics',
  'ib.math_ai': 'mathematics',
  'ib.physics': 'physics',
  'ib.chemistry': 'chemistry',
  'ib.biology': 'biology',
  'ib.computer_science': 'computer_science',
  'ib.economics': 'economics',
  'ib.english_a_lang_lit': 'english',
  'ib.english_a_literature': 'english',
  'ib.english_b': 'english',
  'ib.history': 'history',
  'ib.visual_arts': 'visual_arts',
  'ib.music': 'music',
  'a_level.mathematics': 'mathematics',
  'a_level.further_mathematics': 'mathematics',
  'a_level.physics': 'physics',
  'a_level.chemistry': 'chemistry',
  'a_level.biology': 'biology',
  'a_level.computer_science': 'computer_science',
  'a_level.economics': 'economics',
  'a_level.english_literature': 'english',
  'ap.calculus_ab': 'mathematics',
  'ap.calculus_bc': 'mathematics',
  'ap.statistics': 'mathematics',
  'ap.physics_1': 'physics',
  'ap.physics_c_mechanics': 'physics',
  'ap.chemistry': 'chemistry',
  'ap.biology': 'biology',
  'ap.computer_science_a': 'computer_science',
  'us.algebra_2': 'mathematics',
  'us.precalculus': 'mathematics',
  'us.calculus': 'mathematics',
  'us.physics': 'physics',
  'us.chemistry': 'chemistry',
  'us.biology': 'biology',
};

export const BROAD_SUBJECTS: ReadonlySet<string> = new Set(Object.values(BROAD));

/** Broad subject for a key: itself if already broad, the mapped parent if specific, otherwise undefined. */
export function broadSubjectOf(key: string): string | undefined {
  if (BROAD_SUBJECTS.has(key)) return key;
  return BROAD[key];
}

/** A course recorded only with a broad subject may correspond to a specific required subject; this needs review. */
export function isPossibleSubjectMatch(courseKey: string, requiredKey: string): boolean {
  const a = broadSubjectOf(courseKey);
  const b = broadSubjectOf(requiredKey);
  return a !== undefined && a === b;
}
