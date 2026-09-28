import type { CycleInput, OpportunityInput, SessionInput } from '../../src/agents/a09-opportunities/catalog.js';
import { sha256Hex } from '../../src/shared/hash.js';
import type { SourceRecord } from '../../src/shared/sources.js';

/**
 * Synthetic opportunities. Every organizer, program, date and amount here is
 * fictional (spec: "The date and opportunity in this object are fictional").
 * Now is 2026-09-27; the student's summer window is 2027-06-20 to 2027-08-31.
 */

export const PAGE_TEXT: Record<string, string> = {};

export function source(id: string, url: string, opts: { publisher?: string; type?: SourceRecord['sourceType']; text?: string; review?: SourceRecord['reviewStatus']; retrievedAt?: string } = {}): SourceRecord {
  const text = opts.text ?? `Official page ${id}`;
  PAGE_TEXT[url] = text;
  return {
    id,
    version: 'v1',
    publisher: opts.publisher ?? 'Example Organizer',
    canonicalUrl: url,
    title: `Page ${id}`,
    sourceType: opts.type ?? 'organizer_official',
    scope: {},
    retrievedAt: opts.retrievedAt ?? '2026-09-20T09:00:00Z',
    contentHash: sha256Hex(text),
    permittedUse: 'quote_only',
    reviewStatus: opts.review ?? 'verified',
  };
}

export function session(over: Partial<SessionInput> = {}): SessionInput {
  return {
    id: 's1',
    label: 'Session A',
    start: '2027-07-05',
    end: '2027-07-09',
    format: 'in_person',
    location: { country: 'GR', region: 'Attica', city: 'Athens', venue: 'Community Hall' },
    schedule: { timezone: 'Europe/Athens', dailyStart: '10:00', dailyEnd: '14:00', weekdays: [1, 2, 3, 4, 5] },
    residential: false,
    overnightRequired: false,
    hoursPerWeek: 20,
    ...over,
  };
}

export function cycle(src: string, over: Partial<CycleInput> = {}): CycleInput {
  return {
    id: 'c2027',
    label: 'Summer 2027',
    year: 2027,
    status: 'open',
    applicationDeadline: { date: '2027-03-15', time: '17:00', timezone: 'Europe/Athens', originalText: 'Applications close 15 March 2027 at 17:00 (Athens time)' },
    sessions: [session()],
    costs: [{ component: 'tuition', amount: { amount: '0.00', currency: 'EUR' }, estimate: false, required: true, sourceRef: src }],
    costsPublished: true,
    sourceId: src,
    retrievedAt: '2026-09-20T09:00:00Z',
    ...over,
  };
}

/** A valid curated opportunity whose every fact cites `src`. */
export function opportunity(id: string, src: string, over: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    id,
    title: `Program ${id}`,
    category: 'workshop',
    topics: ['engineering'],
    summary: 'Participants design, build and test small structures with guidance from engineers.',
    organizer: { name: `Organizer ${id}`, kind: 'nonprofit', officialUrl: `https://${id.replace(/_/g, '-')}.example.org/`, sourceId: src },
    host: null,
    cycles: [cycle(src)],
    eligibility: { published: true, rules: null, requirements: [], sourceId: src },
    selection: { route: 'open_application', description: null, pathways: [], stages: [], sourceId: src },
    value: { activities: ['Design and test a small bridge model'], curriculum: 'Five sessions on forces, materials and testing', supervision: 'qualified_staff', feedback: true, outputs: ['A tested prototype and a short presentation'], credential: 'participation_certificate', creditNote: null, sourceId: src },
    safety: { supervisionRequired: false, priorReview: [], safeguardingPolicyUrl: `https://${id.replace(/_/g, '-')}.example.org/safeguarding`, parentalConsentRequired: null },
    contact: { kind: 'organizer_email', address: `info@${id.replace(/_/g, '-')}.example.org`, sourceId: src },
    discovery: { via: 'curated_directory', ref: 'directory_fixture' },
    ...over,
  };
}

export const COVERAGE = { countries: ['GR'], includesOnline: true, categories: ['workshop', 'course', 'competition', 'volunteering', 'summer_program', 'supervised_research', 'public_program'] as const, maintainedBy: 'Catalog team (fixture)', lastReviewedAt: '2026-09-15T00:00:00Z' };
