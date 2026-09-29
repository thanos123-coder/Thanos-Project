import { z } from 'zod';
import { stableStringify } from '../../shared/hash.js';
import { MoneySchema } from '../../shared/money.js';
import { CalendarDateSchema, type CalendarDate } from '../../shared/time.js';
import { ClauseSchema, type Clause } from './rules.js';

/**
 * The maintained scholarship catalog (16 "Purpose and scope", "Opportunity
 * taxonomy", "Trust and scam screening").
 *
 * A narrow, curated set of verified opportunities with transparent coverage
 * is more useful than a large stale list. Each record keeps provider identity,
 * the official application route, the current cycle, typed award terms, a
 * compiled eligibility rule with a source per clause, the stages and
 * dependencies of the process, and a trust status that is separate from
 * eligibility. Student-submitted leads are screened and kept apart until a
 * curator verifies them.
 */

export const APPLICANT_LEVELS = ['secondary', 'undergraduate_incoming', 'undergraduate_current', 'graduate'] as const;
export const STAGE_KINDS = ['nomination', 'admission_application', 'reference', 'award_application', 'essay', 'video', 'financial_documents', 'interview'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

const Id = z.string().regex(/^[a-z0-9_]+$/).max(120);

export const DeadlineSchema = z
  .object({
    date: CalendarDateSchema,
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    timezone: z.string().nullable(),
    sourceRef: z.string().min(1),
  })
  .strict();

export const StageSchema = z
  .object({
    stageId: Id,
    kind: z.enum(STAGE_KINDS),
    label: z.string().min(1).max(200),
    owner: z.enum(['student', 'school', 'referee', 'sponsor', 'institution']),
    deadline: DeadlineSchema.nullable(),
    /** A school's own earlier cutoff for nominations or references; "unknown" until the student checks. */
    internalDeadline: z.union([CalendarDateSchema, z.literal('unknown')]).nullable().default(null),
    dependsOn: z.array(Id).default([]),
    details: z
      .object({
        perSchoolLimit: z.number().int().positive().nullable().optional(),
        nominator: z.string().max(200).nullable().optional(),
        refereeMustDiffer: z.boolean().nullable().optional(),
        essays: z.number().int().nonnegative().optional(),
        shortAnswers: z.number().int().nonnegative().optional(),
        references: z.number().int().nonnegative().optional(),
        interviewFormat: z.enum(['in_person', 'video', 'phone', 'recorded']).optional(),
        /** An interview that is itself a selection assessment, not practice (16T17). */
        assessed: z.boolean().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type Stage = z.infer<typeof StageSchema>;

export const AwardTermsSchema = z
  .object({
    kind: z.enum(['fixed', 'range', 'up_to', 'tuition_waiver', 'percentage', 'reimbursement', 'named_costs']),
    amount: MoneySchema.nullable().default(null),
    min: MoneySchema.nullable().default(null),
    max: MoneySchema.nullable().default(null),
    percentage: z.number().min(0).max(100).nullable().default(null),
    /** "Full tuition" covers tuition only; living costs, travel and insurance are not included unless named. */
    coveredCosts: z.array(z.string()).nullable().default(null),
    duration: z.enum(['one_time', 'one_academic_year', 'full_degree']).nullable(),
    renewal: z.object({ renewable: z.boolean(), conditions: z.array(z.string()), maxYears: z.number().int().positive().nullable() }).strict().nullable().default(null),
    portability: z.enum(['portable', 'destination_restricted']),
    destinations: z.array(z.object({ institutionRef: z.string().min(1), programRef: z.string().nullable() }).strict()).default([]),
  })
  .strict();
export type AwardTerms = z.infer<typeof AwardTermsSchema>;

export const TRUST_STATUSES = ['verified_provider', 'unresolved', 'suspicious'] as const;
export type TrustStatus = (typeof TRUST_STATUSES)[number];

export const ScholarshipInputSchema = z
  .object({
    scholarshipId: Id,
    name: z.string().min(1).max(200),
    provider: z
      .object({
        name: z.string().min(1).max(200),
        kind: z.enum(['institution', 'foundation', 'company', 'government', 'community_organization', 'other']),
        officialDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).default([]),
        /** The institution entity (Agent 11 registry) for institutional awards. */
        institutionEntityId: z.string().nullable().default(null),
      })
      .strict(),
    cycle: z.string().regex(/^\d{4}$/),
    cycleStatus: z.enum(['current', 'past', 'not_announced']),
    applicationUrl: z.string().url().nullable(),
    sources: z.array(z.object({ sourceRef: z.string().min(1), url: z.string().url(), retrievedAt: z.string().min(1) }).strict()).min(1),
    applicantLevels: z.array(z.enum(APPLICANT_LEVELS)).min(1),
    consideration: z.enum(['automatic_with_admission', 'separate_application']),
    origin: z.enum(['institutional', 'external']),
    basis: z.enum(['merit', 'need', 'merit_and_need', 'other']),
    award: AwardTermsSchema,
    rule: ClauseSchema,
    /** Published selection considerations: described, never scored as eligibility. */
    selectionCriteria: z.array(z.string().min(1).max(300)).default([]),
    stages: z.array(StageSchema).min(1),
    exclusiveWith: z.array(z.object({ scholarshipId: Id, text: z.string().min(1), sourceRef: z.string().min(1) }).strict()).default([]),
    /** Consideration requires applying for admission in this round (e.g. early_action); a round-rule exception may cite it (14T02). */
    requiresAdmissionRound: z.object({ institutionRef: z.string().min(1), round: z.string().regex(/^[a-z0-9_]+$/), sourceRef: z.string().min(1) }).strict().nullable().default(null),
    topics: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
    trust: z.object({ status: z.enum(TRUST_STATUSES), evidence: z.array(z.string()).default([]), checkedAt: z.string().min(1) }).strict(),
  })
  .strict();
export type ScholarshipInput = z.input<typeof ScholarshipInputSchema>;
export type Scholarship = z.infer<typeof ScholarshipInputSchema> & { version: number; updatedAt: string };

export function scholarshipRef(id: string, version?: number): string {
  return version === undefined ? `scholarship:${id}` : `scholarship:${id}@${version}`;
}

// ---------------------------------------------------------------- trust screening

export interface Screening {
  status: TrustStatus;
  signals: Array<{ code: 'guarantee' | 'upfront_fee' | 'fee_to_release' | 'sensitive_request' | 'short_link' | 'link_not_official' | 'no_current_cycle' | 'identity_unconfirmed' | 'not_https'; evidence: string }>;
  /** Checks still to do, in plain words. */
  missing: string[];
  message: string;
}

const GUARANTEE = /\b(guaranteed?|100% (?:sure|certain)|you (?:have been|were|are) (?:selected|chosen)|you(?:'ve| have) won|winner)\b/i;
const FEE = /\b(processing|release|handling|claim|disbursement|registration|activation|verification|redemption) fee\b|\bpay (?:a |the )?(?:small |one-time )?(?:fee|\$\d+|£\d+|€\d+)\b|\bfee (?:of|is) (?:just |only )?[$£€]\d+/i;
const TO_RELEASE = /\b(?:to|before (?:we|you) can) (?:release|receive|claim|unlock|transfer|send) (?:your|the) (?:award|scholarship|funds|money|prize)\b/i;
const SENSITIVE = /\b(bank account|routing number|account number|credit card|debit card|card number|social security|\bssn\b|national insurance number|passport number|password|log ?in details|fsa id|pin\b)/i;
const SHORTENERS = /^(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at)$/i;

function quote(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return '';
  const i = Math.max(0, m.index - 40);
  return text.slice(i, Math.min(text.length, m.index + m[0].length + 60)).replace(/\s+/g, ' ').trim();
}

/**
 * Evidence-based, proportionate screening. The warning patterns are those the
 * FTC describes (guarantees, upfront fees to receive an award, requests for
 * account or identity numbers); they make a listing "suspicious" with the
 * evidence shown. Missing public evidence alone leaves verification
 * unresolved; it is never reported as fraud (16T10).
 */
export function screenListing(input: { url: string | null; text: string; providerName: string; officialDomains?: readonly string[]; currentCycleStated: boolean }): Screening {
  const signals: Screening['signals'] = [];
  const t = input.text;
  if (GUARANTEE.test(t)) signals.push({ code: 'guarantee', evidence: quote(t, GUARANTEE) });
  if (FEE.test(t)) signals.push({ code: 'upfront_fee', evidence: quote(t, FEE) });
  if (TO_RELEASE.test(t) && FEE.test(t)) signals.push({ code: 'fee_to_release', evidence: quote(t, TO_RELEASE) });
  if (SENSITIVE.test(t)) signals.push({ code: 'sensitive_request', evidence: quote(t, SENSITIVE) });
  let host: string | null = null;
  if (input.url) {
    try {
      const u = new URL(input.url);
      host = u.hostname.toLowerCase();
      if (u.protocol !== 'https:') signals.push({ code: 'not_https', evidence: input.url });
      if (SHORTENERS.test(host)) signals.push({ code: 'short_link', evidence: input.url });
    } catch {
      host = null;
    }
  }
  const domains = input.officialDomains ?? [];
  if (host && domains.length > 0 && !domains.some((d) => host === d || host!.endsWith(`.${d}`))) signals.push({ code: 'link_not_official', evidence: `${host} is not one of the provider’s known domains (${domains.join(', ')})` });
  if (!input.currentCycleStated) signals.push({ code: 'no_current_cycle', evidence: 'The page does not describe a current application cycle.' });
  if (domains.length === 0) signals.push({ code: 'identity_unconfirmed', evidence: `No official domain or known contact for ${input.providerName} is on file.` });
  const warning = signals.some((s) => s.code === 'sensitive_request' || s.code === 'fee_to_release' || (s.code === 'upfront_fee' && signals.some((x) => x.code === 'guarantee')));
  const missing: string[] = [];
  if (domains.length === 0) missing.push(`Confirm ${input.providerName} through a contact you already know, such as your school’s counselor or the organization’s published phone number.`);
  if (!input.currentCycleStated) missing.push('Confirm that applications are open for the current cycle.');
  if (signals.some((s) => s.code === 'short_link' || s.code === 'link_not_official')) missing.push('Open the application only from the provider’s own website, not from this link.');
  if (warning) {
    return { status: 'suspicious', signals, missing, message: 'This listing shows warning signs the FTC describes for scholarship offers (for example a guaranteed award, a fee to receive money, or a request for account or identity numbers). Do not pay anything or share those details; check with the provider directly through a contact you already trust.' };
  }
  return { status: 'unresolved', signals, missing, message: 'This opportunity has not been verified yet. That is not a finding of wrongdoing: small local organizations often have limited websites. A direct check through a known contact can confirm it.' };
}

// ---------------------------------------------------------------- the store

export interface ScholarshipChange {
  scholarshipId: string;
  ref: string;
  previousVersion: number;
  version: number;
  material: string[];
}

export interface Lead {
  leadId: string;
  name: string;
  providerName: string;
  url: string | null;
  submittedAt: string;
  screening: Screening;
  status: 'awaiting_review' | 'reported';
}

export class ScholarshipCatalog {
  private readonly items = new Map<string, Scholarship[]>();
  private readonly leads = new Map<string, Lead>();
  private readonly reports: Array<{ scholarshipId: string; reason: string; at: string }> = [];
  private readonly listeners: Array<(c: ScholarshipChange) => void> = [];
  private n = 0;

  constructor(private readonly now: () => string) {}

  onChange(l: (c: ScholarshipChange) => void): void {
    this.listeners.push(l);
  }

  /** Curate a record. A material change (terms, rules, stages, cycle, trust) is a new version and notifies dependents. */
  curate(input: ScholarshipInput): Scholarship {
    const s = ScholarshipInputSchema.parse(input);
    const history = this.items.get(s.scholarshipId) ?? [];
    const latest = history[history.length - 1];
    if (!latest) {
      // A second record for the same provider, award and cycle is a duplicate listing (16 "Data contract").
      for (const h of this.items.values()) {
        const x = h[h.length - 1]!;
        if (x.provider.name.toLowerCase() === s.provider.name.toLowerCase() && x.name.toLowerCase() === s.name.toLowerCase() && x.cycle === s.cycle) throw new Error(`Duplicate listing of ${s.name} (${s.cycle}); already ${x.scholarshipId}`);
      }
    }
    const material = latest ? materialChanges(latest, s) : [];
    if (latest && material.length === 0) return structuredClone(latest);
    const rec: Scholarship = { ...s, version: latest ? latest.version + 1 : 1, updatedAt: this.now() };
    history.push(rec);
    this.items.set(s.scholarshipId, history);
    if (latest) for (const l of this.listeners) l({ scholarshipId: s.scholarshipId, ref: scholarshipRef(s.scholarshipId), previousVersion: latest.version, version: rec.version, material });
    return structuredClone(rec);
  }

  get(id: string): Scholarship | undefined {
    const h = this.items.get(id);
    return h ? structuredClone(h[h.length - 1]!) : undefined;
  }

  list(): Scholarship[] {
    return [...this.items.values()].map((h) => structuredClone(h[h.length - 1]!));
  }

  submitLead(input: { name: string; providerName: string; url: string | null; screening: Screening }): Lead {
    const lead: Lead = { leadId: `lead_${++this.n}`, name: input.name, providerName: input.providerName, url: input.url, submittedAt: this.now(), screening: input.screening, status: 'awaiting_review' };
    this.leads.set(lead.leadId, lead);
    return structuredClone(lead);
  }

  leadsAwaitingReview(): Lead[] {
    return [...this.leads.values()].filter((l) => l.status === 'awaiting_review').map((l) => structuredClone(l));
  }

  /** A student report sends the listing to review; it does not publish an accusation. */
  report(scholarshipId: string, reason: string): { recorded: boolean } {
    if (!this.items.has(scholarshipId)) return { recorded: false };
    this.reports.push({ scholarshipId, reason: reason.slice(0, 500), at: this.now() });
    return { recorded: true };
  }

  reportsFor(id: string): number {
    return this.reports.filter((r) => r.scholarshipId === id).length;
  }
}

function materialChanges(a: Scholarship, b: z.infer<typeof ScholarshipInputSchema>): string[] {
  const out: string[] = [];
  const cmp = (k: string, x: unknown, y: unknown) => {
    if (stableStringify(x) !== stableStringify(y)) out.push(k);
  };
  cmp('award', a.award, b.award);
  cmp('rule', a.rule, b.rule);
  cmp('stages', a.stages, b.stages);
  cmp('cycle', [a.cycle, a.cycleStatus], [b.cycle, b.cycleStatus]);
  cmp('trust', a.trust.status, b.trust.status);
  cmp('exclusive_with', a.exclusiveWith, b.exclusiveWith);
  cmp('application_url', a.applicationUrl, b.applicationUrl);
  cmp('levels', a.applicantLevels, b.applicantLevels);
  return out;
}

export type { Clause, CalendarDate };
