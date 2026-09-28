import { z } from 'zod';
import { sha256Hex, stableStringify } from '../shared/hash.js';

/**
 * Operation-specific assistance policy: the interface agents 10, 16, 17 and 18
 * need from Agent 22 (the authorship policy guardian, specified in a later
 * volume). This module is the deterministic part of that interface: reviewed
 * policy records per destination and cycle, the product's own no-ghostwriting
 * default, and the intersection rule for a shared artifact.
 *
 * "A policy decision needs scope, operation, source, effective cycle, and
 * status. 'Allowed,' 'prohibited,' and 'unclear' should remain distinct"
 * (17 "Policy before personalization"). "A general 'AI allowed' flag is too
 * coarse" (16 "Authorship essays and interviews"). "When one shared essay will
 * serve several destinations, evaluate the policy intersection for the planned
 * operation" (17). "If a sponsor's policy is silent or unclear, do not assume
 * that every form of assistance is allowed" (16).
 */

export const ASSISTANCE_OPERATIONS = [
  /** How an application or award process works: logistics, formats, who to ask. */
  'process_explanation',
  /** General exploration questions not aimed at a particular prompt or destination. */
  'exploration_questions',
  /** Questions aimed at one prompt or destination. */
  'tailored_brainstorming',
  /** Lengths, required fields and formats. */
  'mechanical_check',
  /** Findings about the student's own drafts: repeated facts, inconsistencies, unanswered asks. */
  'review_student_text',
  /** Suggesting which of the student's chosen material answers which prompt. */
  'story_prompt_mapping',
  /** Ordering scenes, arguments or paragraphs: structure for a response. */
  'outline',
  /** Translating text that will be submitted. */
  'translation',
  /** Rewriting the student's own sentences. */
  'editing',
  /** Writing content for the student. */
  'prose_generation',
  /** Preparing for an interview (never answering an assessed one). */
  'interview_preparation',
  /** Producing a competition research plan, abstract, poster text or citations. */
  'research_plan_generation',
] as const;
export type AssistanceOperation = (typeof ASSISTANCE_OPERATIONS)[number];
export const AssistanceOperationSchema = z.enum(ASSISTANCE_OPERATIONS);

export const ASSISTANCE_DECISIONS = ['allowed', 'prohibited', 'unclear'] as const;
export type AssistanceDecision = (typeof ASSISTANCE_DECISIONS)[number];

/**
 * The product's own boundary, which applies everywhere and before any
 * destination rule: the student remains the author. No essay text, no
 * rewritten sentences, no outlines, no translation of submission text and no
 * generated research plans, even where a destination would allow more.
 */
export const APP_DEFAULT_POLICY: Readonly<Record<AssistanceOperation, AssistanceDecision>> = {
  process_explanation: 'allowed',
  exploration_questions: 'allowed',
  tailored_brainstorming: 'allowed',
  mechanical_check: 'allowed',
  review_student_text: 'allowed',
  story_prompt_mapping: 'allowed',
  outline: 'prohibited',
  translation: 'prohibited',
  editing: 'prohibited',
  prose_generation: 'prohibited',
  interview_preparation: 'allowed',
  research_plan_generation: 'prohibited',
};

/**
 * Operations whose permission depends on the destination: once a destination
 * is named, each of these needs that destination's reviewed decision. The
 * others (process explanation, general exploration, mechanical checks) do not
 * shape submitted content and follow the product default.
 */
export const DESTINATION_SENSITIVE: ReadonlySet<AssistanceOperation> = new Set([
  'tailored_brainstorming',
  'review_student_text',
  'story_prompt_mapping',
  'outline',
  'translation',
  'editing',
  'prose_generation',
  'interview_preparation',
  'research_plan_generation',
]);

export const DESTINATION_KINDS = ['institution', 'platform', 'scholarship', 'competition', 'school_course'] as const;

export const DestinationRefSchema = z
  .object({
    kind: z.enum(DESTINATION_KINDS),
    ref: z.string().min(1).max(160),
    cycle: z.string().min(4).max(20),
  })
  .strict();
export type DestinationRef = z.infer<typeof DestinationRefSchema>;

export const AssistancePolicySchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    destination: DestinationRefSchema,
    /** Decisions the source actually states; an operation it does not address stays unclear. */
    decisions: z.partialRecord(AssistanceOperationSchema, z.enum(ASSISTANCE_DECISIONS)),
    source: z.object({ sourceId: z.string().min(1), url: z.string().url(), quote: z.string().min(1) }).strict(),
    reviewStatus: z.enum(['draft', 'reviewed', 'retired']),
    reviewedBy: z.string().nullable(),
    reviewedAt: z.string().nullable(),
  })
  .strict();
export type AssistancePolicy = z.infer<typeof AssistancePolicySchema>;

export interface DestinationDecision {
  destination: DestinationRef;
  decision: AssistanceDecision;
  policyRef: string | null;
  sourceId: string | null;
  quote: string | null;
  reason: string;
}

export interface OperationDecision {
  /** Stable id of this decision (inputs and policy versions), so an artifact can record which decision governed it. */
  id: string;
  operation: AssistanceOperation;
  destinations: DestinationRef[];
  decision: AssistanceDecision;
  appDefault: AssistanceDecision;
  perDestination: DestinationDecision[];
  /** True when no destination was named: the result is the product default and clears the material for none. */
  generalOnly: boolean;
  explanation: string;
}

const key = (d: DestinationRef) => `${d.kind}:${d.ref}:${d.cycle}`;

export interface PolicyChange {
  destination: DestinationRef;
  policyRef: string;
  previousRef: string | null;
}

/** The reference an artifact records for the policy version that governed it (used for invalidation). */
export function policyVersionRef(p: Pick<AssistancePolicy, 'id' | 'version'>): string {
  return `policy:${p.id}@${p.version}`;
}

export class AssistancePolicyRegistry {
  private readonly policies = new Map<string, AssistancePolicy[]>();
  private readonly listeners: Array<(c: PolicyChange) => void> = [];

  onChange(listener: (c: PolicyChange) => void): void {
    this.listeners.push(listener);
  }

  /** Add a reviewed (or draft) policy version. A newer reviewed version for the same destination supersedes the older one. */
  add(input: z.input<typeof AssistancePolicySchema>): AssistancePolicy {
    const p = AssistancePolicySchema.parse(input);
    if (p.reviewStatus === 'reviewed' && (!p.reviewedBy || !p.reviewedAt)) throw new Error('A reviewed policy must record its reviewer and review time');
    const k = key(p.destination);
    const list = this.policies.get(k) ?? [];
    if (list.some((x) => x.id === p.id && x.version === p.version)) throw new Error(`Policy ${p.id} version ${p.version} already exists`);
    const previous = this.current(p.destination);
    this.policies.set(k, [...list, p]);
    if (p.reviewStatus === 'reviewed') for (const l of this.listeners) l({ destination: p.destination, policyRef: policyVersionRef(p), previousRef: previous ? policyVersionRef(previous) : null });
    return structuredClone(p);
  }

  /** The current reviewed policy for a destination and cycle, if any. Drafts and retired versions never decide. */
  current(d: DestinationRef): AssistancePolicy | undefined {
    const list = (this.policies.get(key(d)) ?? []).filter((p) => p.reviewStatus === 'reviewed');
    return list.length > 0 ? structuredClone(list[list.length - 1]!) : undefined;
  }

  evaluate(operation: AssistanceOperation, destinations: readonly DestinationRef[]): OperationDecision {
    const appDefault = APP_DEFAULT_POLICY[operation];
    const unique = [...new Map(destinations.map((d) => [key(d), d])).values()];
    const perDestination: DestinationDecision[] = unique.map((d) => {
      if (!DESTINATION_SENSITIVE.has(operation)) {
        return { destination: d, decision: 'allowed', policyRef: null, sourceId: null, quote: null, reason: 'This kind of help does not shape submitted content.' };
      }
      const p = this.current(d);
      if (!p) return { destination: d, decision: 'unclear', policyRef: null, sourceId: null, quote: null, reason: `No reviewed assistance policy is on file for ${d.ref} (${d.cycle}).` };
      const stated = p.decisions[operation];
      if (!stated) return { destination: d, decision: 'unclear', policyRef: policyVersionRef(p), sourceId: p.source.sourceId, quote: p.source.quote, reason: `The ${d.ref} policy does not address this kind of help.` };
      return { destination: d, decision: stated, policyRef: policyVersionRef(p), sourceId: p.source.sourceId, quote: p.source.quote, reason: `The ${d.ref} policy ${stated === 'allowed' ? 'permits' : stated === 'prohibited' ? 'prohibits' : 'does not settle'} this.` };
    });
    // The strictest applicable rule wins: the product default first, then every destination.
    let decision: AssistanceDecision = appDefault;
    if (decision !== 'prohibited') {
      if (perDestination.some((p) => p.decision === 'prohibited')) decision = 'prohibited';
      else if (perDestination.some((p) => p.decision === 'unclear')) decision = 'unclear';
    }
    const generalOnly = unique.length === 0;
    const explanation =
      appDefault === 'prohibited'
        ? 'This app does not do that: you stay the author of everything you submit.'
        : decision === 'prohibited'
          ? `Not permitted for ${perDestination.filter((p) => p.decision === 'prohibited').map((p) => p.destination.ref).join(', ')}.`
          : decision === 'unclear'
            ? `Not yet confirmed for ${perDestination.filter((p) => p.decision === 'unclear').map((p) => p.destination.ref).join(', ')}; the policy needs review first.`
            : generalOnly
              ? 'Allowed for general exploration; not yet cleared for any particular application.'
              : 'Allowed for every destination this material is for.';
    const id = `policy_decision_${sha256Hex(stableStringify({ operation, d: unique.map(key).sort(), v: perDestination.map((p) => p.policyRef) })).slice(0, 16)}`;
    return { id, operation, destinations: unique, decision, appDefault, perDestination, generalOnly, explanation };
  }
}

// ---------------------------------------------------------------- output checks

/**
 * Structure that functions as an outline, whatever it is called (18 "A policy
 * gate that can change the workflow"): "A table with 'opening,' 'turning
 * point,' and 'final lesson' columns can be prohibited structure generation. A
 * series of questions that dictates every paragraph can also exceed a
 * permitted brainstorming exercise." The check looks at function, not labels.
 */
const STRUCTURE_ROLES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'opening', re: /\b(opening|hook|intro(duction)?|first paragraph|opening (scene|line|sentence))\b/i },
  { name: 'turning_point', re: /\b(turning point|climax|pivotal moment|moment of change)\b/i },
  { name: 'lesson', re: /\b(final lesson|lesson learned|moral|takeaway|what (it|this) taught)\b/i },
  { name: 'conclusion', re: /\b(conclusion|closing (paragraph|scene|line)|final paragraph|ending|resolution)\b/i },
  { name: 'body', re: /\b(body paragraph|paragraph [1-9]|section [1-9]|second paragraph|third paragraph)\b/i },
  { name: 'thesis', re: /\b(thesis|main argument|central claim)\b/i },
];

const ORDERING_DIRECTIVES: ReadonlyArray<RegExp> = [
  /\b(start|begin|open) (with|by)\b/i,
  /\bthen (describe|explain|write|show|move to|talk about)\b/i,
  /\b(end|finish|close|conclude) (with|by|on)\b/i,
  /\bfinally,? (reflect|write|explain|describe|show)\b/i,
  /\bin (your|the) (first|second|third|next|last|final) paragraph\b/i,
  /\bnext,? (describe|explain|write|show)\b/i,
];

export interface StructureFinding {
  outline: boolean;
  signals: string[];
}

/** Does this output tell the student how to structure their response? Headers of a table count like any other text. */
export function detectOutlineStructure(output: string | { headers: readonly string[]; rows: ReadonlyArray<readonly string[]> }): StructureFinding {
  const text = typeof output === 'string' ? output : [...output.headers, ...output.rows.flat()].join('\n');
  const roles = STRUCTURE_ROLES.filter((r) => r.re.test(text)).map((r) => r.name);
  const directives = ORDERING_DIRECTIVES.filter((re) => re.test(text)).map((re) => re.source);
  const headerRoles = typeof output === 'string' ? [] : STRUCTURE_ROLES.filter((r) => output.headers.some((h) => r.re.test(h))).map((r) => r.name);
  const signals = [...new Set([...roles.map((r) => `structure:${r}`), ...directives.map(() => 'ordering_directive')])];
  // Two structural roles, two ordering directives, or any structural column in a table: it prescribes structure.
  const outline = roles.length >= 2 || directives.length >= 2 || (roles.length >= 1 && directives.length >= 1) || headerRoles.length >= 1;
  return { outline, signals };
}

/**
 * Text that reads as submission prose rather than a question or a factual
 * note: first-person narrative of more than a sentence or two, or an opening
 * line offered for use. Used by the writing roles' contracts, which must never
 * return essay text, and by output validation generally.
 */
export function looksLikeSubmissionProse(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  const sentences = t.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
  const firstPerson = sentences.filter((s) => /\b(I|my|me|I'm|I've)\b/.test(s) && !/\?\s*$/.test(s)).length;
  const offered = /\b(you could (write|say|start with)|here(?:'s| is) (an?|your) (opening|paragraph|draft|sentence|essay)|try (this|writing) (opening|sentence|line))\b/i.test(t);
  return offered || firstPerson >= 3;
}
