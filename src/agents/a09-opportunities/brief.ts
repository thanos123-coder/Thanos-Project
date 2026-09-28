import { z } from 'zod';
import { isAbsence, type Absence } from '../../shared/absence.js';
import type { WeeklySlot } from '../../shared/fields.js';
import { MoneySchema, type Budget, type Money } from '../../shared/money.js';
import { DateIntervalSchema, type DateInterval } from '../../shared/time.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { OpportunityCategorySchema, type OpportunityCategory } from './catalog.js';
import { isTopic, topicLabel, topicsFromText } from './topics.js';

/**
 * The search brief (09R01, "Search brief and minimum personal data").
 *
 * Hard constraints and preferences are kept apart: "Cannot travel" is a hard
 * logistical constraint, "would prefer online" is a preference; "up to €200
 * including transport" differs from "up to €200 tuition"; "needs financial
 * aid" is not "aid has been awarded". The brief lives only inside the agent;
 * public queries are generalized from it separately.
 */

export const WeightsSchema = z
  .object({
    goalFit: z.number().int().min(0).max(5),
    feasibility: z.number().int().min(0).max(5),
    learning: z.number().int().min(0).max(5),
    cost: z.number().int().min(0).max(5),
    evidence: z.number().int().min(0).max(5),
    format: z.number().int().min(0).max(5),
  })
  .strict();
export type Weights = z.infer<typeof WeightsSchema>;
export const DEFAULT_WEIGHTS: Weights = { goalFit: 3, feasibility: 3, learning: 2, cost: 2, evidence: 1, format: 1 };

export const BriefRequestSchema = z
  .object({
    /** The student's words for this request. Used locally to find topics; never sent to a search provider. */
    purpose: z.string().max(400).optional(),
    topics: z.array(z.string().refine(isTopic, { message: 'Unknown topic key' })).max(6).default([]),
    categories: z.array(OpportunityCategorySchema).max(6).default([]),
    /** Dates for this request; defaults to the recorded availability. */
    window: DateIntervalSchema.nullable().default(null),
    format: z.enum(['online_only', 'in_person_only', 'prefer_online', 'prefer_in_person', 'any']).nullable().default(null),
    maxResults: z.number().int().min(1).max(10).default(5),
    weights: WeightsSchema.partial().optional(),
    /** The student's own answers to opportunity-specific questions, keyed "<opportunityId>.<conditionId>". */
    declarations: z.record(z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/), z.boolean()).default({}),
    /** Travel costs the student estimated for a specific opportunity. */
    travelEstimates: z.array(z.object({ opportunityId: z.string().min(1), amount: MoneySchema }).strict()).max(20).default([]),
    /** Search public sources for new leads when the catalog has few verified options. */
    discover: z.boolean().default(true),
  })
  .strict();
export type BriefRequest = z.infer<typeof BriefRequestSchema>;

export interface MissingField {
  field: string;
  question: string;
  why: string;
  blocking: boolean;
}

export interface Brief {
  topics: string[];
  topicsFrom: 'request' | 'request_text' | 'record' | 'none';
  /** "Find something impressive": ask what they want to learn before searching (09R01). */
  prestigeFraming: boolean;
  categories: OpportunityCategory[];
  windows: DateInterval[];
  windowsFrom: 'request' | 'record' | 'none';
  format: { required: 'online' | 'in_person' | null; preferred: 'online' | 'in_person' | null };
  location: { country: string; region: string | null; city: string | null } | null;
  /** Used locally only (routes and residence conditions). */
  residenceCountry: string | null;
  schoolCountry: string | null;
  timezone: string | null;
  dailyHours: { start: string; end: string } | null;
  weeklyHours: { min: number; max: number } | null;
  travel: { overnightTravelPossible: boolean | null; maxTravelMinutes: number | null; travelDuringTermPossible: boolean | null } | null;
  budget: Budget | null;
  budgetAbsence: Absence | null;
  aidNeeded: 'yes' | 'no' | 'unsure' | null;
  deviceAccess: 'reliable_own_device' | 'shared_device' | 'limited' | 'none' | null;
  /** The student voluntarily recorded accessibility needs; their content stays local. */
  hasAccessibilityNeeds: boolean;
  commitments: Array<{ label: string; weekly: WeeklySlot[]; period: DateInterval | null }>;
  hardConstraints: string[];
  preferences: string[];
  missing: MissingField[];
  claimIds: string[];
  /** Field keys the brief depends on (for invalidation of saved matches). */
  fieldKeys: string[];
  declarations: Record<string, boolean>;
  travelEstimates: Map<string, Money>;
  weights: Weights;
  maxResults: number;
}

const PRESTIGE = /\b(impressive|prestigious|prestige|look(s)? good|stand out|elite|top[- ]tier|boost (my )?(application|chances)|for (my )?(college|university) applications?)\b/i;

const BRIEF_FIELDS = [
  'constraints.availability_windows',
  'constraints.remote_preference',
  'constraints.location_broad',
  'constraints.timezone',
  'constraints.daily_available_hours',
  'constraints.weekly_hours_available',
  'constraints.travel',
  'constraints.opportunity_budget',
  'constraints.device_access',
  'finance.aid_needed',
  'accessibility.preferences',
  'identity.residence_country',
  'education.school_country',
  'goals.current_objective',
];

export function readBrief(view: RecordView, req: BriefRequest): Brief {
  const claimIds = new Set<string>();
  const use = (attribute: string) => {
    const c = view.current('student', 'self', attribute);
    if (c) claimIds.add(c.claimId);
    return c && !isAbsence(c.value) ? c.value : undefined;
  };

  // Topics: explicit keys, then the request's own words, then the student's recorded interests (never a supporter's).
  let topics = [...new Set(req.topics)];
  let topicsFrom: Brief['topicsFrom'] = topics.length > 0 ? 'request' : 'none';
  if (topics.length === 0 && req.purpose) {
    topics = topicsFromText(req.purpose);
    if (topics.length > 0) topicsFrom = 'request_text';
  }
  const prestigeFraming = !!req.purpose && PRESTIGE.test(req.purpose) && topicsFrom !== 'request' && topicsFrom !== 'request_text';
  // Recorded interests are still read under prestige framing, but only as a hint for the question below.
  let recordTopics: string[] = [];
  if (topics.length === 0) {
    const texts: string[] = [];
    for (const id of view.entityIds('interest')) {
      const c = view.current('interest', id, 'description');
      const status = view.value<string>('interest', id, 'status');
      if (c && !isAbsence(c.value) && status !== 'retired') {
        texts.push((c.value as { text: string }).text);
        claimIds.add(c.claimId);
      }
    }
    for (const id of view.entityIds('preference')) {
      for (const f of view.holderVariants('preference', id, 'statement')) {
        if (f.holder && f.holder.kind !== 'student') continue;
        const c = f.current;
        if (c && !isAbsence(c.value)) {
          texts.push((c.value as { text: string }).text);
          claimIds.add(c.claimId);
        }
      }
    }
    for (const id of view.entityIds('hypothesis')) {
      const response = view.value<string>('hypothesis', id, 'student_response');
      const h = view.current('hypothesis', id, 'statement');
      if (h && response === 'accepted_as_tentative' && !isAbsence(h.value)) {
        topics.push(...(h.value as { subjectKeys: string[] }).subjectKeys.filter(isTopic));
        claimIds.add(h.claimId);
      }
    }
    const objective = use('goals.current_objective');
    if (typeof objective === 'string') texts.push(objective);
    recordTopics = [...new Set([...topics, ...texts.flatMap(topicsFromText)])].sort();
    topics = recordTopics;
    if (topics.length > 0) topicsFrom = 'record';
  }

  const recordedWindows = (use('constraints.availability_windows') as DateInterval[] | undefined) ?? [];
  const windows = req.window ? [req.window] : recordedWindows;
  const windowsFrom: Brief['windowsFrom'] = req.window ? 'request' : recordedWindows.length > 0 ? 'record' : 'none';

  const pref = (use('constraints.remote_preference') as string | undefined) ?? null;
  const fmt = req.format ?? (pref === 'remote_only' ? 'online_only' : pref === 'in_person_only' ? 'in_person_only' : pref === 'prefer_remote' ? 'prefer_online' : pref === 'prefer_in_person' ? 'prefer_in_person' : 'any');
  const format: Brief['format'] = {
    required: fmt === 'online_only' ? 'online' : fmt === 'in_person_only' ? 'in_person' : null,
    preferred: fmt === 'prefer_online' ? 'online' : fmt === 'prefer_in_person' ? 'in_person' : null,
  };

  const location = (use('constraints.location_broad') as Brief['location'] | undefined) ?? null;
  const residenceCountry = (use('identity.residence_country') as string | undefined) ?? null;
  const schoolCountry = (use('education.school_country') as string | undefined) ?? null;
  const timezone = (use('constraints.timezone') as string | undefined) ?? null;
  const dailyHours = (use('constraints.daily_available_hours') as Brief['dailyHours'] | undefined) ?? null;
  const weeklyHours = (use('constraints.weekly_hours_available') as Brief['weeklyHours'] | undefined) ?? null;
  const travel = (use('constraints.travel') as Brief['travel'] | undefined) ?? null;
  const budgetClaim = view.current('student', 'self', 'constraints.opportunity_budget');
  if (budgetClaim) claimIds.add(budgetClaim.claimId);
  const budgetField = view.student('constraints.opportunity_budget');
  // A budget that still needs confirmation (e.g. a possible speech-recognition error) is not used as a cap.
  const budgetUsable = !!budgetClaim && !isAbsence(budgetClaim.value) && !budgetField?.needsConfirmation && budgetField?.state === 'current';
  const budget = budgetUsable ? (budgetClaim!.value as Budget) : null;
  const budgetAbsence = budgetClaim && isAbsence(budgetClaim.value) ? (budgetClaim.value as Absence) : null;
  const aidNeeded = (use('finance.aid_needed') as Brief['aidNeeded'] | undefined) ?? null;
  const deviceAccess = (use('constraints.device_access') as Brief['deviceAccess'] | undefined) ?? null;
  const access = use('accessibility.preferences') as string[] | undefined;

  const commitments: Brief['commitments'] = [];
  for (const id of view.entityIds('commitment')) {
    const c = view.current('commitment', id, 'definition');
    if (!c || isAbsence(c.value)) continue;
    const v = c.value as { label: string; weekly: WeeklySlot[]; period: DateInterval | null };
    commitments.push({ label: v.label, weekly: v.weekly, period: v.period });
    claimIds.add(c.claimId);
  }

  const hardConstraints: string[] = [];
  const preferences: string[] = [];
  if (format.required) hardConstraints.push(format.required === 'online' ? 'Online only' : 'In person only');
  if (format.preferred) preferences.push(format.preferred === 'online' ? 'Prefers online' : 'Prefers in person');
  if (travel?.overnightTravelPossible === false) hardConstraints.push('Cannot travel overnight');
  if (travel?.maxTravelMinutes) hardConstraints.push(`Travel up to about ${travel.maxTravelMinutes} minutes`);
  if (windows.length > 0) hardConstraints.push(`Available: ${windows.map((w) => `${w.start}${w.end ? ` to ${w.end}` : w.ongoing ? ' onward' : ''}`).join('; ')}`);
  if (budget) (budget.kind === 'hard_cap' ? hardConstraints : preferences).push(`${budget.kind === 'hard_cap' ? 'Budget limit' : 'Preferred budget'} ${budget.amount.amount} ${budget.amount.currency} ${budget.covers === 'all' ? 'including travel and all other costs' : `for ${budget.covers.join(', ').replace(/_/g, ' ')}`}`);
  if (dailyHours) hardConstraints.push(`Available between ${dailyHours.start} and ${dailyHours.end}`);
  if (weeklyHours) preferences.push(`About ${weeklyHours.min === weeklyHours.max ? weeklyHours.max : `${weeklyHours.min}–${weeklyHours.max}`} hours a week`);

  const missing: MissingField[] = [];
  if (topics.length === 0 || prestigeFraming) {
    const hint = prestigeFraming && recordTopics.length > 0 ? ` Earlier you mentioned ${recordTopics.map(topicLabel).join(', ').toLowerCase()}; is that what you would like to explore?` : '';
    missing.push({ field: 'topics', question: `What would you like to learn, make or contribute? A subject, a problem you care about, or a skill is enough.${hint}`, why: 'Without a learning goal the search would default to whatever is most visible, which is often expensive rather than useful.', blocking: true });
  }
  if (windows.length === 0) missing.push({ field: 'constraints.availability_windows', question: 'Which dates or weeks are you available?', why: 'Dates decide which sessions are possible.', blocking: false });
  if (!budget && budgetClaim && !isAbsence(budgetClaim.value)) missing.push({ field: 'constraints.opportunity_budget', question: 'Could you confirm your budget for opportunities, and whether it includes travel? The recorded amount still needs your confirmation.', why: 'An unconfirmed amount is not used, so no paid option is called affordable yet.', blocking: false });
  else if (!budget && !budgetAbsence) missing.push({ field: 'constraints.opportunity_budget', question: 'Is there a spending limit, and does it need to include travel?', why: 'Without it, no paid option can be called affordable.', blocking: false });
  if (!location && format.required !== 'online') missing.push({ field: 'constraints.location_broad', question: 'Which city or region are you in? A street address is not needed.', why: 'Location decides which in-person options are reachable.', blocking: false });

  return {
    topics,
    topicsFrom,
    prestigeFraming,
    categories: [...new Set(req.categories)],
    windows,
    windowsFrom,
    format,
    location,
    residenceCountry,
    schoolCountry,
    timezone,
    dailyHours,
    weeklyHours,
    travel,
    budget,
    budgetAbsence,
    aidNeeded,
    deviceAccess,
    hasAccessibilityNeeds: !!access && access.length > 0,
    commitments,
    hardConstraints,
    preferences,
    missing,
    claimIds: [...claimIds],
    fieldKeys: [...BRIEF_FIELDS.map((f) => `student:self.${f}`), 'interest:*.description', 'preference:*.statement', 'hypothesis:*.student_response', 'commitment:*.definition'],
    declarations: req.declarations,
    travelEstimates: new Map(req.travelEstimates.map((t) => [t.opportunityId, t.amount])),
    weights: { ...DEFAULT_WEIGHTS, ...(req.weights ?? {}) } as Weights,
    maxResults: req.maxResults,
  };
}
