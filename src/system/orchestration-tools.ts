import { z } from 'zod';
import type { ObjectiveStore } from '../agents/a01-orchestrator/objectives.js';
import { ROLE_PURPOSE } from '../agents/a01-orchestrator/roles.js';
import { ReviewPacketSchema, type ReviewRequestOutcome } from '../runtime/human-review.js';
import { BudgetLimitsSchema, RoleIdSchema, type ResultEnvelope, type RoleId } from '../shared/envelopes.js';
import { AccessDeniedError } from '../shared/errors.js';
import type { SystemKernel } from './kernel.js';

/**
 * Orchestration tools for the lead counselor (01 "Data and tool contract":
 * specialist.invoke and review.request).
 *
 * specialist.invoke starts a bounded child task for the same person: the
 * child's actor, tenant and student come from the calling task, never from
 * arguments; its budget and cancellation are children of the caller's; its
 * purpose is fixed by the role; and its result is validated against the
 * role's own contract before the coordinator sees it as accepted. The
 * coordinator can therefore never reach data or tools its person could not.
 */

export const ROLE_PURPOSES = ROLE_PURPOSE;

export interface InvokeOutcome {
  taskId: string;
  accepted: boolean;
  issues: string[];
  result: ResultEnvelope;
}

const SpecialistRoleSchema = RoleIdSchema.exclude(['01']);

export function registerOrchestrationTools(kernel: SystemKernel, objectives: ObjectiveStore): void {
  kernel.gateway.register({
    name: 'specialist.invoke',
    description: 'Run one bounded specialist task for the same person, with a question, scoped inputs, output contract and budget.',
    kind: 'orchestration',
    args: z
      .object({
        role: SpecialistRoleSchema,
        objective: z.string().min(1).max(80),
        completionContract: z.string().min(1),
        scope: z.record(z.string(), z.unknown()),
        idempotencyKey: z.string().min(1).max(200),
        objectiveRef: z.object({ objectiveId: z.string().min(1), nodeId: z.string().min(1) }).strict().nullable(),
        budget: BudgetLimitsSchema.partial().optional(),
      })
      .strict(),
    handler: async (inv, args): Promise<InvokeOutcome> => {
      const role = args.role as Exclude<RoleId, '01'>;
      const contract = kernel.contracts.get(args.completionContract);
      if (!contract || contract.role !== role) throw new AccessDeniedError('invalid_arguments', `Contract ${args.completionContract} does not belong to role ${role}`);
      const spec: Parameters<SystemKernel['buildRequest']>[0] = {
        role,
        purpose: ROLE_PURPOSES[role],
        objective: args.objective,
        actor: inv.actor,
        tenantId: inv.tenantId,
        studentId: inv.studentId,
        scope: args.scope,
        completionContract: args.completionContract,
        parentTaskId: inv.taskId,
        idempotencyKey: args.idempotencyKey,
      };
      if (args.budget) spec.budget = args.budget as NonNullable<typeof spec.budget>;
      const request = kernel.buildRequest(spec);
      if (args.objectiveRef) objectives.attach(args.objectiveRef.objectiveId, request.taskId, { nodeId: args.objectiveRef.nodeId, role });
      try {
        const out = await kernel.invoke(request, inv.context);
        if (out.accepted) {
          // Evidence the child relied on becomes citable by the coordinator.
          for (const id of out.result.inputVersions.claimIds) inv.context.servedClaimIds.add(id);
          for (const id of out.result.sourceRefs) inv.context.servedSourceIds.add(id);
        }
        return { taskId: request.taskId, accepted: out.accepted, issues: out.issues, result: out.result };
      } finally {
        if (args.objectiveRef) objectives.detach(args.objectiveRef.objectiveId, request.taskId);
      }
    },
  });

  kernel.gateway.register({
    name: 'review.request',
    description: 'Request qualified human review with a minimum-necessary packet, or receive an honest referral when review is not staffed.',
    kind: 'orchestration',
    args: z.object({ tenantId: z.string(), studentId: z.string(), packet: ReviewPacketSchema, referralTarget: z.string().min(3).max(120).optional() }).strict(),
    handler: async (_inv, args): Promise<ReviewRequestOutcome> => kernel.review.request(args.tenantId, args.studentId, args.packet, args.referralTarget),
  });
}
