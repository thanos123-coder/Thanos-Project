import { z } from 'zod';
import { findCity } from '../../shared/places.js';
import { OpportunityCategorySchema, type OpportunityCategory } from './catalog.js';
import { isTopic, topicSearchTerm } from './topics.js';

/**
 * Public research primitives (09R02, 09R03, "Failure handling and source changes").
 *
 * Privacy by construction (09T13): a public search can only be described by a
 * generalized query made of controlled vocabulary — topic keys, opportunity
 * categories, a country code, a known city name, a format, a broad audience
 * and a year. The argument schema has no free-text field, so a student's name,
 * address, birth date, grades or family details cannot reach a search
 * provider even if a model or a bug tried to put them there. Sensitive
 * conditions (age, citizenship, residence) are checked locally afterwards
 * against the official eligibility text.
 *
 * Access controls are respected: a page behind a sign-in, CAPTCHA or paywall,
 * or one the site does not permit automated access to, is reported as
 * inaccessible and never bypassed.
 */

const KnownCitySchema = z
  .string()
  .max(60)
  .refine((v) => findCity(v)?.city.toLowerCase() === v.trim().toLowerCase(), { message: 'Only a recognized city name may be used, never an address' });

export const GeneralizedQuerySchema = z
  .object({
    topics: z.array(z.string().refine(isTopic, { message: 'Unknown topic key' })).min(1).max(3),
    categories: z.array(OpportunityCategorySchema).max(3).default([]),
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
    city: KnownCitySchema.nullable().default(null),
    format: z.enum(['online', 'in_person', 'any']),
    audience: z.enum(['secondary_students', 'recent_graduates', 'young_people']),
    costFocus: z.enum(['free_or_low_cost', 'any']),
    year: z.number().int().min(2000).max(2100).nullable(),
  })
  .strict();
export type GeneralizedQuery = z.infer<typeof GeneralizedQuerySchema>;
export type GeneralizedQueryInput = z.input<typeof GeneralizedQuerySchema>;

const CATEGORY_WORDS: Record<OpportunityCategory, string> = {
  course: 'course',
  workshop: 'workshop',
  competition: 'competition',
  supervised_research: 'research program',
  volunteering: 'volunteering',
  public_program: 'public program',
  creative: 'creative program',
  work_experience: 'work experience',
  summer_program: 'summer program',
  club_or_community: 'club',
  independent_learning: 'free course',
};

const AUDIENCE_WORDS: Record<GeneralizedQuery['audience'], string> = {
  secondary_students: 'for high school students',
  recent_graduates: 'for recent school graduates',
  young_people: 'for young people',
};

/** The only text a search provider ever receives, rendered from the validated query. */
export function renderQueryText(q: GeneralizedQuery, countryLabel: (code: string) => string): string {
  const parts = [
    q.costFocus === 'free_or_low_cost' ? 'free' : '',
    q.format === 'online' ? 'online' : q.format === 'in_person' ? 'in-person' : '',
    q.topics.map(topicSearchTerm).join(' '),
    q.categories.length > 0 ? q.categories.map((c) => CATEGORY_WORDS[c]).join(' OR ') : 'program',
    AUDIENCE_WORDS[q.audience],
    q.city ?? '',
    q.country ? countryLabel(q.country) : '',
    q.year !== null ? String(q.year) : '',
  ];
  return parts.filter((p) => p.length > 0).join(' ').replace(/\s+/g, ' ').trim();
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  publisher: string | null;
}

export interface SearchProvider {
  /** Receives the validated structured query and its rendered text. Nothing else. */
  search(query: GeneralizedQuery, text: string): Promise<SearchHit[]>;
}

export interface FetchedPage {
  finalUrl: string;
  status: number;
  contentType: string;
  /** Plain text of the page. */
  text: string;
  /** Access-control signals reported by the fetcher. */
  loginRequired?: boolean;
  captcha?: boolean;
  paywall?: boolean;
  /** The site does not permit automated retrieval (robots or terms). */
  automatedAccessDisallowed?: boolean;
}

export interface FetchProvider {
  /**
   * Retrieve a public page. Implementations must resolve the host and refuse
   * private, loopback and link-local addresses at connection time as well
   * (the URL check below cannot see DNS rebinding).
   */
  fetch(url: string): Promise<FetchedPage>;
}

export interface ResearchProviders {
  search?: SearchProvider;
  fetch?: FetchProvider;
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

/**
 * Only public https pages on named hosts: no credentials in the URL, no
 * non-standard port, no IP literals (official pages have names), no
 * single-label or internal names.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '') return false;
  if (u.port !== '' && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  if (host.startsWith('[') || host.includes(':')) return false; // IPv6 literal
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false;
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((l) => l.length === 0)) return false;
  if (labels.every((l) => /^(0x[0-9a-f]+|\d+)$/i.test(l))) return false; // IPv4 in any notation
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1]!) && !/^xn--[a-z0-9-]+$/.test(labels[labels.length - 1]!)) return false;
  return true;
}

export type FetchOutcome =
  | { accessible: true; url: string; finalUrl: string; retrievedAt: string; contentHash: string; text: string; truncated: boolean; injectionSignals: string[] }
  | { accessible: false; url: string; reason: 'not_configured' | 'login_required' | 'captcha' | 'paywall' | 'automated_access_disallowed' | 'redirect_blocked' | 'http_error' | 'unsupported_content' | 'network_error'; detail: string };

export const MAX_PAGE_CHARS = 60_000;
