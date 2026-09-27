import { z } from 'zod';
import { ClaimInputSchema } from './facts.js';
import { ActorSchema, PurposeSchema } from './permissions.js';

/**
 * Common request and result envelopes (spec, Shared operating rules).
 *
 * "Every specialist receives a typed request. A free-form instruction alone is
 * insufficient." and "A result includes status, concise answer, structured
 * payload, input versions, source references, material uncertainties, proposed
 * record changes, requested handoffs, and a completion reason."
 */

export const ROLE_IDS = ['01', '02', '03', '04', '05', '06', '07', '08', '09'] as const;
export type RoleId = (typeof ROLE_IDS)[number];
export const RoleIdSchema = z.enum(ROLE_IDS);

/** Later roles (10-36) that these nine may hand off to; they are interfaces only in this volume. */
export const LATER_ROLE_IDS = [
  '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27',
  '28', '29', '30', '31', '32', '33', '34', '35', '36',
] as const;
export type LaterRoleId = (typeof LATER_ROLE_IDS)[number];
export const AnyRoleIdSchema = z.enum([...ROLE_IDS, ...LATER_ROLE_IDS]);

export const ROLE_NAMES: Readonly<Record<RoleId, string>> = {
  '01': 'Lead counselor and orchestrator',
  '02': 'Intake interviewer',
  '03': 'Document and transcript interpreter',
  '04': 'Student record and evidence steward',
  '05': 'Goals and major exploration advisor',
  '06': 'Curriculum and eligibility contextualizer',
  '07': 'Academic and testing planner',
  '08': 'Activities and experience assessor',
  '09': 'Opportunity research scout',
};

export const BudgetLimitsSchema = z
  .object({
    maxToolCalls: z.number().int().nonnegative(),
    maxModelCalls: z.number().int().nonnegative(),
    /** Bounded repair attempts for an invalid output (01R07: one may be a sensible initial configuration). */
    maxRevisions: z.number().int().nonnegative(),
    /** Optional wall-clock limit for the task in milliseconds. */
    timeoutMs: z.number().int().positive().optional(),
    /** Optional cap on model tokens (input + output) across the task. */
    maxModelTokens: z.number().int().positive().optional(),
  })
  .strict();
export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;

export const RequestEnvelopeSchema = z
  .object({
    taskId: z.string().min(1),
    parentTaskId: z.string().optional(),
    role: RoleIdSchema,
    purpose: PurposeSchema,
    /** Short machine-readable description of the requested work, e.g. 'check_program_requirements'. */
    objective: z.string().min(1),
    tenantId: z.string().min(1),
    studentId: z.string().min(1),
    /** The person on whose behalf the work runs. Agents never act beyond this actor's authority. */
    actor: ActorSchema,
    /** Record version the caller read. */
    recordVersion: z.number().int().nonnegative(),
    /** Role-specific scope (validated by the role's own schema). */
    scope: z.record(z.string(), z.unknown()).default({}),
    /** Specific claim ids the task may use, when the caller wants to restrict inputs. */
    factRefs: z.array(z.string()).default([]),
    /** Opaque permission snapshot id; revalidated at every tool call and before publication. */
    permissionSnapshot: z.string().min(1),
    allowedTools: z.array(z.string()).min(0),
    budget: BudgetLimitsSchema,
    /** Required output contract id, e.g. 'eligibility_finding_v1'. */
    completionContract: z.string().min(1),
    dependsOn: z.array(z.string()).default([]),
    idempotencyKey: z.string().min(1),
  })
  .strict();
export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;
export type RequestEnvelopeInput = z.input<typeof RequestEnvelopeSchema>;

export const RESULT_STATUSES = [
  'completed',
  'partial',
  'needs_student_input',
  'needs_source',
  'needs_human_review',
  'blocked',
  'cancelled',
  'failed',
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
export const ResultStatusSchema = z.enum(RESULT_STATUSES);

/**
 * "Each uncertainty must name the affected conclusion and what would resolve
 * it. 'May be inaccurate' is not an adequate output."
 */
export const UncertaintySchema = z
  .object({
    /** Structured reference to the affected conclusion, e.g. 'rule:math_level_required' or 'field:course:c1.level'. */
    affects: z.string().min(3),
    description: z.string().min(10),
    resolution: z.string().min(5),
    /** How much this uncertainty matters to the decision. */
    consequence: z.enum(['blocks_decision', 'changes_decision', 'minor']),
  })
  .strict();
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const ProposedMutationSchema = z
  .object({
    mutationId: z.string().min(1),
    operation: z.enum(['add_claims', 'confirm_claim', 'retract_claim', 'resolve_conflict']),
    claims: z.array(ClaimInputSchema).default([]),
    targetClaimIds: z.array(z.string()).default([]),
    expectedRecordVersion: z.number().int().nonnegative(),
    reason: z.string().min(1),
  })
  .strict();
export type ProposedMutation = z.infer<typeof ProposedMutationSchema>;
export type ProposedMutationInput = z.input<typeof ProposedMutationSchema>;

export const HandoffSchema = z
  .object({
    toRole: AnyRoleIdSchema,
    reason: z.string().min(1),
    /** Requested outcome for the receiver. */
    requestedOutcome: z.string().min(1),
    /** Typed inputs by reference; never a raw conversation dump. */
    inputRefs: z.array(z.string()).default([]),
    unresolved: z.array(z.string()).default([]),
    completionCondition: z.string().min(1),
  })
  .strict();
export type Handoff = z.infer<typeof HandoffSchema>;

export const ExternalActionProposalSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['send_message', 'submit_application', 'register_for_test', 'enroll_course', 'pay_fee', 'contact_organizer', 'calendar_write', 'other']),
    destination: z.string().min(1),
    exactContent: z.string(),
    consequence: z.string().min(1),
    /** Always 'proposed' when produced by an agent. Only the external-action service changes it after explicit authorization. */
    authorizationState: z.literal('proposed'),
  })
  .strict();
export type ExternalActionProposal = z.infer<typeof ExternalActionProposalSchema>;

export const InputVersionsSchema = z
  .object({
    recordVersion: z.number().int().nonnegative(),
    /** Claim id -> claim version (claims are immutable, so version is 1 unless superseded). */
    claimIds: z.array(z.string()).default([]),
    ruleVersions: z.array(z.string()).default([]),
    sourceVersions: z.array(z.string()).default([]),
    modelVersions: z.array(z.string()).default([]),
    permissionSnapshot: z.string().min(1),
  })
  .strict();
export type InputVersions = z.infer<typeof InputVersionsSchema>;

export const ResultEnvelopeSchema = z
  .object({
    taskId: z.string().min(1),
    role: RoleIdSchema,
    status: ResultStatusSchema,
    /** Concise student-facing or orchestrator-facing answer. Never hidden reasoning. */
    summary: z.string().min(1),
    payload: z.unknown(),
    completionContract: z.string().min(1),
    inputVersions: InputVersionsSchema,
    sourceRefs: z.array(z.string()).default([]),
    uncertainties: z.array(UncertaintySchema).default([]),
    proposedMutations: z.array(ProposedMutationSchema).default([]),
    handoffs: z.array(HandoffSchema).default([]),
    externalActions: z.array(ExternalActionProposalSchema).default([]),
    completionReason: z.string().min(1),
  })
  .strict();
export type ResultEnvelope<TPayload = unknown> = Omit<z.infer<typeof ResultEnvelopeSchema>, 'payload'> & { payload: TPayload };

