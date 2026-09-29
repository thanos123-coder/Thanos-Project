import type { Measure } from '../../shared/fields.js';

/**
 * Deterministic boundaries for the project mentor. Each is a narrow check in
 * code rather than a model judgment, so its behaviour can be tested and
 * explained.
 */

// ---------------------------------------------------------------- fabricated activity (10T06)

const FAKE = /\b(fake|made[- ]up|make up|invent(ed)?|fabricat\w*|pretend|fictional|on paper( only)?|that (does ?n[o']t|doesn't) (really )?exist|shell)\b/i;
const ACTIVITY = /\b(organi[sz]ations?|non-?profits?|club|charity|charities|foundation|initiative|startup|company|society|project|research|internship|volunteer(ing)? hours?|award)\b/i;
const CLAIM = /\b(say|claim|write|list|put down|pretend) (that )?I (founded|started|led|ran|created|organi[sz]ed|volunteered)\b/i;

/** A request to invent an activity, or to claim one that did not happen, for applications. */
export function requestsFabrication(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.some((s) => (FAKE.test(s) && ACTIVITY.test(s)) || CLAIM.test(s));
}

// ---------------------------------------------------------------- safety and review (10T10)

export const SAFETY_AREAS = ['human_participants', 'personal_data', 'hazardous_materials', 'physical_risk', 'animals', 'microorganisms'] as const;
export type SafetyArea = (typeof SAFETY_AREAS)[number];

const AREA_PATTERNS: ReadonlyArray<{ area: SafetyArea; re: RegExp }> = [
  // Collecting information from people, not merely having members or an audience.
  { area: 'human_participants', re: /\b(survey(ing|s)?|interview(ing|s)? (people|students|classmates|participants)|study participants|test(ing)? (it|the app|my app|this) (on|with) (people|students|classmates|users)|collect(ing)? (data|responses) from (people|students|classmates)|human subjects?|questionnaire|focus group|user study)\b/i },
  { area: 'personal_data', re: /\b(personal (data|information)|health (data|records|information)|names and (emails|addresses|phone numbers)|student records|medical)\b/i },
  { area: 'hazardous_materials', re: /\b(chemicals?|acid|solvents?|reactive|explosive|flammable|toxic|radioactive|pesticides?)\b/i },
  { area: 'physical_risk', re: /\b(high voltage|mains (electricity|power)|lasers?|rockets?|drones? (flight|flying)|power tools|welding|open flame|heating element|batteries? (pack|charging))\b/i },
  { area: 'animals', re: /\b(experiment\w*|test\w*|study|studying|observ\w*) (on |with )?(live )?(animals?|vertebrates?|mice|rats|fish|birds?)\b/i },
  { area: 'microorganisms', re: /\b(bacteria|bacterial|microbes?|microorganisms?|cultur(e|ing) (bacteria|mold|mould|samples)|petri dish(es)?|pathogens?)\b/i },
];

/** Areas that need a responsible adult or review before relevant work starts, from what the student said and chose. */
export function safetyAreas(text: string, declared: readonly SafetyArea[] = []): SafetyArea[] {
  const found = new Set<SafetyArea>(declared);
  for (const p of AREA_PATTERNS) if (p.re.test(text)) found.add(p.area);
  return SAFETY_AREAS.filter((a) => found.has(a));
}

/** Safe routes to keep learning while a review or supervision is not in place (10 "Research safety and authorship boundaries"). */
export const SAFE_ALTERNATIVES = [
  'Study the public documentation and write your own explanation of how it works.',
  'Use a non-sensitive demonstration dataset, where the rules allow it.',
  'Build a private prototype that no one else uses yet.',
  'Do a reading-based investigation and note the questions it raises.',
] as const;

// ---------------------------------------------------------------- language about the student (10T12)

/** Character, motivation or diagnosis words are never used about the student from scheduling behaviour. */
export const CHARACTER_LANGUAGE = /\b(lazy|laziness|unmotivated|lack of motivation|procrastinat\w*|undisciplined|careless|anxious|anxiety|adhd|diagnos\w*|disorder|executive function\w* (deficit|problem)|burn(ed|t)?[- ]out)\b/i;

/** Admissions framing does not belong in a project plan. */
export const ADMISSIONS_FRAMING = /\b(impress (admissions|colleges)|stand out (to|for) (admissions|colleges)|boost (your )?(admission )?chances|look good on (your )?(application|college app)|colleges (love|want to see))\b/i;

// ---------------------------------------------------------------- output states (10T15)

export const OUTPUT_EVIDENCE = ['none', 'student_report', 'submission_confirmation', 'acceptance_notice', 'publication_link', 'supervisor_statement', 'public_url'] as const;
export type OutputEvidence = (typeof OUTPUT_EVIDENCE)[number];

type OutputState = 'idea' | 'prototype' | 'private_demo' | 'deployed' | 'literature_review' | 'draft' | 'submitted' | 'accepted' | 'published' | 'presented';

/**
 * The strongest state the evidence supports. A submission is not a
 * publication, an acceptance needs a notice, and a deployed service needs a
 * public address and, when release needs permission, that permission.
 */
export function supportedOutputState(claimed: OutputState, evidence: OutputEvidence, publicReleaseAllowed: boolean): { state: OutputState; reason: string | null } {
  if (claimed === 'published' && evidence !== 'publication_link') {
    const fallback: OutputState = evidence === 'acceptance_notice' ? 'accepted' : 'submitted';
    return { state: fallback, reason: `Recorded as ${fallback}: published needs a link to the published work.` };
  }
  if (claimed === 'accepted' && evidence !== 'acceptance_notice' && evidence !== 'publication_link') return { state: 'submitted', reason: 'Recorded as submitted: accepted needs the acceptance notice.' };
  if (claimed === 'deployed' && (!publicReleaseAllowed || evidence !== 'public_url')) {
    return { state: 'private_demo', reason: publicReleaseAllowed ? 'Recorded as a private demonstration: a deployed service needs a public address.' : 'Recorded as a private demonstration: public release has not been approved.' };
  }
  return { state: claimed, reason: null };
}

// ---------------------------------------------------------------- measures (10T08)

const IMPACT_WORDS = /\b(helped|served|reached|impacted|benefit(ed|ted)|supported|changed the lives of)\b/i;
/** Measures that count exposure or trying something, not people helped. */
const EXPOSURE_KINDS: ReadonlySet<Measure['kind']> = new Set(['page_views', 'unique_visitors', 'subscribers', 'invited', 'attended', 'participants']);

export interface MeasureCheck {
  measure: Measure;
  question: string | null;
  note: string | null;
}

/** Keep the measured quantity; a claim of help or impact beyond it is asked about, not recorded. */
export function checkMeasure(m: Measure, statedAs: string | null): MeasureCheck {
  if (statedAs && IMPACT_WORDS.test(statedAs) && EXPOSURE_KINDS.has(m.kind)) {
    return {
      measure: m,
      question: `You described this as “${statedAs}”. The number counts ${m.kind.replace(/_/g, ' ')}. What does “helped” mean here, and what shows it happened?`,
      note: `Kept as ${m.kind.replace(/_/g, ' ')}; it is not recorded as people helped.`,
    };
  }
  if (m.kind === 'people_served' && (m.method === 'unknown' || m.method === 'estimated')) {
    return { measure: m, question: 'How was the number of people served counted, and what counts as being served?', note: 'Kept as an estimate.' };
  }
  return { measure: m, question: null, note: null };
}

// ---------------------------------------------------------------- private details (10T14)

const PRIVATE_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: 'email', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: 'phone', re: /(?<!\d)(\+?\d{1,3}[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g },
  { kind: 'date_of_birth', re: /\b(DOB|date of birth|born on)\b[:\s]*[\w\s,/.-]{0,20}\d/gi },
  { kind: 'address', re: /\b\d{1,5}\s+[A-Z][a-z]+(\s[A-Z][a-z]+)?\s(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr)\b\.?/g },
  { kind: 'participant_name', re: /\b([Pp]articipant|[Rr]espondent|[Ss]ubject|[Ii]nterviewee)\s*#?\d*\s*[:-]\s*[A-Z][a-z]+(\s[A-Z][a-z]+)?/g },
  { kind: 'health', re: /\b(diagnosed with|medication|allergic to|disability|mental health)\b/gi },
];

export interface PrivateDetails {
  found: boolean;
  kinds: string[];
  /** The same text with each detail replaced by a placeholder, offered to the student as a redaction. */
  redacted: string;
}

export function detectPrivateDetails(text: string): PrivateDetails {
  const kinds = new Set<string>();
  let redacted = text;
  for (const p of PRIVATE_PATTERNS) {
    redacted = redacted.replace(p.re, (match) => {
      kinds.add(p.kind);
      if (p.kind === 'participant_name') return match.replace(/[:-]\s*.+$/, ': [name removed]');
      if (p.kind === 'health') return '[health detail removed]';
      return `[${p.kind.replace(/_/g, ' ')} removed]`;
    });
  }
  return { found: kinds.size > 0, kinds: [...kinds].sort(), redacted };
}
