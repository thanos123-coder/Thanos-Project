/**
 * The question library and planner (17 "Adaptive question planning", "A
 * practical question library").
 *
 * Each question has one purpose. The planner asks one principal question at
 * a time, follows the student's own words, and moves from a general label to
 * a specific moment, then to what the student did and chose, then to their
 * own view of it. It never supplies a scene, a feeling or a lesson, never
 * presumes a trait or an admissions value, and never asks for the most
 * painful experience. The questions are original examples for this product,
 * not institution prompts.
 */

export const QUESTION_PURPOSES = ['open', 'factual', 'decision', 'choice', 'curiosity', 'responsibility', 'perspective', 'ownership', 'boundary', 'choose'] as const;
export type QuestionPurpose = (typeof QUESTION_PURPOSES)[number];

export interface LibraryQuestion {
  id: string;
  purpose: QuestionPurpose;
  text: string;
  /** How the question reads when it can follow the student's own phrase. */
  withPhrase: ((phrase: string) => string) | null;
  listenFor: string;
}

export const LIBRARY: readonly LibraryQuestion[] = [
  { id: 'open_ordinary', purpose: 'open', text: 'What is something you spend time on that a list of activities would miss?', withPhrase: null, listenFor: 'Student-chosen material without a prestige assumption' },
  { id: 'open_week', purpose: 'open', text: 'Think about an ordinary week. What is one thing in it you would miss if it stopped?', withPhrase: null, listenFor: 'An everyday responsibility or interest' },
  { id: 'open_question', purpose: 'open', text: 'Is there a question you keep coming back to, even when no one asks you to?', withPhrase: null, listenFor: 'A sustained curiosity' },
  { id: 'open_changed_mind', purpose: 'open', text: 'Can you think of a time you changed your mind about something, even something small?', withPhrase: null, listenFor: 'A changing understanding' },
  { id: 'specific_moment', purpose: 'factual', text: 'Can you remember one particular occasion when that happened?', withPhrase: (p) => `You mentioned “${p}”. Can you think of one particular moment connected to that?`, listenFor: 'A concrete anchor, with uncertainty preserved' },
  { id: 'what_before', purpose: 'factual', text: 'What was going on just before that?', withPhrase: null, listenFor: 'Context in the student’s words' },
  { id: 'student_action', purpose: 'decision', text: 'What did you decide to do next?', withPhrase: null, listenFor: 'The student’s own contribution' },
  { id: 'whose_decision', purpose: 'decision', text: 'What part of that decision was yours?', withPhrase: null, listenFor: 'The student’s portion of a shared decision' },
  { id: 'other_option', purpose: 'choice', text: 'What other option did you consider at the time?', withPhrase: null, listenFor: 'A real tradeoff rather than a manufactured lesson' },
  { id: 'why_that', purpose: 'choice', text: 'What made you decide to do it that way?', withPhrase: null, listenFor: 'The student’s reason, if they have one' },
  { id: 'keep_looking', purpose: 'curiosity', text: 'What question made you keep looking into it?', withPhrase: null, listenFor: 'An authentic intellectual interest' },
  { id: 'responsibility', purpose: 'responsibility', text: 'What would someone else need to understand about that responsibility?', withPhrase: null, listenFor: 'Context the student wants to share' },
  { id: 'differently_now', purpose: 'perspective', text: 'Do you understand that moment differently now?', withPhrase: null, listenFor: 'The student’s interpretation, including no change' },
  { id: 'noticed', purpose: 'perspective', text: 'What did you notice then that you might not have noticed before?', withPhrase: null, listenFor: 'What the student observed, not an imposed meaning' },
  { id: 'sounds_right', purpose: 'ownership', text: 'Does that description sound right to you, or would you put it differently?', withPhrase: null, listenFor: 'Correction and ownership' },
  { id: 'stay_or_switch', purpose: 'boundary', text: 'Would you like to stay with this topic, try another, or pause?', withPhrase: null, listenFor: 'An explicit choice about continuing' },
  { id: 'which_further', purpose: 'choose', text: 'Which of these experiences do you actually want to think about further?', withPhrase: null, listenFor: 'Student preference rather than a model-selected story' },
];

export function question(id: string): LibraryQuestion {
  const q = LIBRARY.find((x) => x.id === id);
  if (!q) throw new Error(`Unknown question ${id}`);
  return q;
}

/** The order a single experience is explored in; the student can leave it at any point. */
const DEEPEN: readonly string[] = ['specific_moment', 'student_action', 'why_that', 'differently_now', 'sounds_right', 'stay_or_switch'];

/**
 * The next question for the current story: the first step in the sequence
 * not yet asked for it, skipping steps the answer already covered.
 */
export function nextQuestionId(askedForStory: readonly string[], covered: ReadonlySet<QuestionPurpose>): string {
  for (const id of DEEPEN) {
    if (askedForStory.includes(id)) continue;
    if (covered.has(question(id).purpose)) continue;
    return id;
  }
  return 'stay_or_switch';
}

/** When an answer is brief or the student feels stuck: choices about process, never content to adopt (17 "When the student seems stuck"). */
export const PROCESS_CHOICES = ['Look back over a recent ordinary week', 'Go back to something you already do or care about', 'Compare two small moments', 'Stop for now'] as const;

/** Alternative entry points for a student who says nothing interesting has happened (17T01). No hardship, travel or prestige is assumed. */
export const ORDINARY_ENTRY_POINTS = ['open_week', 'open_question', 'open_changed_mind'] as const;

/** Leading questions insert a trait or a value the student has not given (17 "Do not ask leading questions"). */
export const LEADING = /\b(prove[sd]?|proves your|exceptional|most painful|hardest thing|worst (moment|thing)|overc[oa]me|adversity|trauma|how did (this|that) make you (a )?(stronger|better)|what did you learn about leadership|show(s|ed)? (your )?(leadership|resilience|grit))\b/i;
