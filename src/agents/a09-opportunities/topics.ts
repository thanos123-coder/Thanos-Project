import { BUILTIN_PROFILES } from '../a05-goals/content.js';
import { matchSubjects } from '../a05-goals/explore.js';

/**
 * A controlled topic vocabulary. Interests are matched to these keys locally;
 * only the keys (never the student's own words) can reach a public search
 * provider (09 "Search brief and minimum personal data", 09T13).
 */

/** Umbrella topics and the specific topics they include. */
const UMBRELLAS: Readonly<Record<string, readonly string[]>> = {
  engineering: ['civil_engineering', 'mechanical_engineering', 'electrical_engineering', 'robotics'],
  sciences: ['biology', 'chemistry', 'physics', 'environmental_science', 'biomedical_science', 'general_science'],
  computing: ['computer_science', 'data_science', 'robotics'],
  health: ['medicine', 'nursing', 'biomedical_science', 'psychology'],
  arts: ['fine_art', 'music', 'visual_communication_design', 'creative_writing'],
  social_studies: ['economics', 'history', 'political_science', 'law'],
  media: ['journalism_media', 'science_communication', 'creative_writing'],
};

const EXTRA_TOPICS: Readonly<Record<string, { label: string; keywords: readonly string[] }>> = {
  engineering: { label: 'Engineering', keywords: ['engineering', 'engineer', 'engineers'] },
  sciences: { label: 'Science', keywords: ['sciences'] },
  computing: { label: 'Computing', keywords: ['computing', 'tech'] },
  health: { label: 'Health', keywords: ['health', 'health care'] },
  arts: { label: 'Arts', keywords: ['the arts', 'arts'] },
  social_studies: { label: 'Social studies', keywords: ['social studies', 'social sciences'] },
  media: { label: 'Media', keywords: ['media'] },
  robotics: { label: 'Robotics', keywords: ['robotics', 'robots', 'robot'] },
  general_science: { label: 'General science', keywords: ['science', 'experiments'] },
  sustainability: { label: 'Sustainability', keywords: ['sustainability', 'climate action'] },
  community_service: { label: 'Community service', keywords: ['volunteering', 'volunteer', 'community service', 'helping my community'] },
  creative_writing: { label: 'Creative writing', keywords: ['creative writing', 'poetry', 'fiction', 'short stories'] },
  entrepreneurship: { label: 'Entrepreneurship', keywords: ['entrepreneurship', 'start a business', 'startup'] },
};

export const TOPIC_KEYS: ReadonlySet<string> = new Set([...BUILTIN_PROFILES.map((p) => p.key), ...Object.keys(EXTRA_TOPICS)]);

export function isTopic(key: string): boolean {
  return TOPIC_KEYS.has(key);
}

export function topicLabel(key: string): string {
  return BUILTIN_PROFILES.find((p) => p.key === key)?.label ?? EXTRA_TOPICS[key]?.label ?? key.replace(/_/g, ' ');
}

/** Words used when a topic is rendered into a public search query. */
export function topicSearchTerm(key: string): string {
  return topicLabel(key).toLowerCase().replace(/ and .*$/, '');
}

const NEGATED_BEFORE = /\b(not|never|no longer|don'?t|do not|doesn'?t|hate|hated|dislike|disliked|not interested in|nothing to do with)\b[^.;,!?]{0,25}$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Topic keys the text supports (negated mentions are ignored). Local processing only. */
export function topicsFromText(text: string): string[] {
  const out = new Set<string>();
  for (const m of matchSubjects(text, BUILTIN_PROFILES)) if (m.direction === 'supports') out.add(m.key);
  for (const [key, t] of Object.entries(EXTRA_TOPICS)) {
    for (const kw of t.keywords) {
      const re = new RegExp(`(?<![\\p{L}])${escapeRe(kw)}(?![\\p{L}])`, 'iu');
      const m = re.exec(text);
      if (m && !NEGATED_BEFORE.test(text.slice(0, m.index))) {
        out.add(key);
        break;
      }
    }
  }
  // A specific topic already covers the generic "science" mention.
  if (out.has('general_science') && [...out].some((k) => (UMBRELLAS['sciences'] ?? []).includes(k) && k !== 'general_science')) out.delete('general_science');
  return [...out].sort();
}

function expand(key: string): Set<string> {
  return new Set([key, ...(UMBRELLAS[key] ?? []), ...Object.entries(UMBRELLAS).filter(([, members]) => members.includes(key)).map(([u]) => u)]);
}

/**
 * How an opportunity's topics relate to the student's: a direct match (same
 * topic, or a specific topic inside the umbrella the student named), a related
 * field (an adjacent subject), or none.
 */
export function topicRelation(studentTopics: readonly string[], opportunityTopics: readonly string[]): { relation: 'direct' | 'related' | 'none'; matched: string[] } {
  const direct = new Set<string>();
  for (const s of studentTopics) {
    const own = new Set([s, ...(UMBRELLAS[s] ?? [])]);
    for (const o of opportunityTopics) {
      const theirs = new Set([o, ...(UMBRELLAS[o] ?? [])]);
      if ([...own].some((k) => theirs.has(k))) direct.add(o);
    }
  }
  if (direct.size > 0) return { relation: 'direct', matched: [...direct].sort() };
  const related = new Set<string>();
  for (const s of studentTopics) {
    const adjacent = new Set(BUILTIN_PROFILES.filter((p) => expand(s).has(p.key)).flatMap((p) => p.adjacent));
    for (const o of opportunityTopics) if ([...expand(o)].some((k) => adjacent.has(k)) || [...expand(s)].some((k) => expand(o).has(k))) related.add(o);
  }
  return related.size > 0 ? { relation: 'related', matched: [...related].sort() } : { relation: 'none', matched: [] };
}
