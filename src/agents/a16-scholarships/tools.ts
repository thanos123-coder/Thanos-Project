import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { APPLICANT_LEVELS, scholarshipRef, screenListing, type Lead, type Scholarship, type ScholarshipCatalog } from './catalog.js';

/**
 * Scholarship catalog tools. Reads return public catalog records and record
 * every served version as a source, so results can cite exactly what they
 * used. The write tool accepts only public listing information (a name, a
 * provider, a link, the listing's own text) for review; it has no field for
 * the student's details and never sends anything to a provider.
 */
export function registerScholarshipTools(gateway: ToolGateway, catalog: ScholarshipCatalog): void {
  gateway.register({
    name: 'scholarships.read',
    description: 'Search or read the maintained scholarship catalog (current records with their rules, stages, terms and trust status).',
    kind: 'read',
    args: z.discriminatedUnion('op', [
      z.object({ op: z.literal('search'), cycle: z.string().regex(/^\d{4}$/), levels: z.array(z.enum(APPLICANT_LEVELS)).max(4).optional(), includePastCycles: z.boolean().default(false) }).strict(),
      z.object({ op: z.literal('get'), scholarshipId: z.string().min(1) }).strict(),
      z.object({ op: z.literal('leads') }).strict(),
    ]),
    handler: async (inv, args): Promise<Scholarship[] | Lead[]> => {
      if (args.op === 'leads') return catalog.leadsAwaitingReview();
      const out = args.op === 'get' ? [catalog.get(args.scholarshipId)].filter((x): x is Scholarship => x !== undefined) : catalog.list().filter((s) => s.cycle === args.cycle && (args.includePastCycles || s.cycleStatus !== 'past') && (!args.levels || s.applicantLevels.some((l) => args.levels!.includes(l))));
      for (const s of out) inv.context.servedSourceIds.add(scholarshipRef(s.scholarshipId, s.version));
      return out;
    },
  });

  gateway.register({
    name: 'scholarships.write',
    description: 'Submit a scholarship the student found for checking, or report a listing that looks wrong. Only public listing details are accepted.',
    kind: 'write',
    args: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('submit_lead'),
          name: z.string().min(1).max(200),
          providerName: z.string().min(1).max(200),
          url: z.string().url().nullable(),
          /** The listing's own public text (or a retrieved page), used only for screening. */
          listingText: z.string().max(20000),
          currentCycleStated: z.boolean(),
          officialDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(5).default([]),
        })
        .strict(),
      z.object({ kind: z.literal('report'), scholarshipId: z.string().min(1), reason: z.string().min(1).max(500) }).strict(),
    ]),
    handler: async (_inv, args): Promise<{ lead?: Lead; recorded?: boolean }> => {
      if (args.kind === 'report') return catalog.report(args.scholarshipId, args.reason);
      const screening = screenListing({ url: args.url, text: args.listingText, providerName: args.providerName, officialDomains: args.officialDomains, currentCycleStated: args.currentCycleStated });
      return { lead: catalog.submitLead({ name: args.name, providerName: args.providerName, url: args.url, screening }) };
    },
  });
}
