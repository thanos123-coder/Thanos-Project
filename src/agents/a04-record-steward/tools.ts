import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { ProposedMutationSchema } from '../../shared/envelopes.js';
import { DataCategorySchema } from '../../shared/permissions.js';
import { RecordService, type ActingContext, type ScopedView } from './service.js';
import type { DerivedArtifact, MutationResponse } from './types.js';

/**
 * Tool bindings for the record service. The gateway has already checked the
 * role matrix, task allow-list, argument schema, object scope, budget and live
 * authorization before any handler runs; the record service checks permissions
 * again (defense in depth).
 */
export function registerRecordTools(gateway: ToolGateway, records: RecordService): void {
  const acting = (inv: { actor: ActingContext['actor']; role: string; purpose: ActingContext['purpose']; taskId: string }): ActingContext => ({
    actor: inv.actor,
    viaRole: inv.role,
    purpose: inv.purpose,
    taskId: inv.taskId,
  });

  gateway.register({
    name: 'record.read_scoped',
    description: 'Read the role-scoped, permission-filtered view of the student record.',
    kind: 'read',
    args: z
      .object({
        tenantId: z.string(),
        studentId: z.string(),
        mode: z.enum(['model_context', 'local']),
        entityTypes: z.array(z.string()).optional(),
        catalogKeys: z.array(z.string()).optional(),
      })
      .strict(),
    handler: async (inv, args): Promise<ScopedView> => {
      const opts: Parameters<RecordService['readScoped']>[1] = { tenantId: args.tenantId, studentId: args.studentId, role: inv.role, mode: args.mode };
      if (args.entityTypes) opts.entityTypes = args.entityTypes;
      if (args.catalogKeys) opts.catalogKeys = args.catalogKeys;
      return records.readScoped(acting(inv), opts);
    },
    servedClaimIds: (view: ScopedView) => RecordService.claimIdsOf(view),
  });

  gateway.register({
    name: 'record.read_status',
    description: 'Minimal record status for coordination: version, open conflicts and stale results visible to the actor.',
    kind: 'read',
    args: z.object({ tenantId: z.string(), studentId: z.string() }).strict(),
    handler: async (inv, args) => {
      const ctx = acting(inv);
      const view = records.readScoped(ctx, { tenantId: args.tenantId, studentId: args.studentId, role: '01', mode: 'local' });
      const stale = records.listArtifacts(ctx, args.tenantId, args.studentId, { status: 'stale' });
      return {
        recordVersion: view.recordVersion,
        openConflicts: view.fields.filter((f) => f.state === 'conflict').map((f) => ({ fieldKey: f.fieldKey, label: f.label })),
        needsConfirmation: view.fields.filter((f) => f.needsConfirmation && f.consequential).map((f) => ({ fieldKey: f.fieldKey, label: f.label })),
        staleArtifacts: stale.map((a) => ({ id: a.id, kind: a.kind, scopeKey: a.scopeKey, producedByTask: a.producedByTask ?? null, reason: a.statusReason ?? null })),
      };
    },
  });

  gateway.register({
    name: 'record.propose_change',
    description: 'Propose typed claims to the record steward, which validates and commits or rejects them.',
    kind: 'propose',
    args: z.object({ tenantId: z.string(), studentId: z.string(), mutation: ProposedMutationSchema }).strict(),
    handler: async (inv, args): Promise<MutationResponse> => records.applyMutation(acting(inv), args.tenantId, args.studentId, args.mutation),
  });

  gateway.register({
    name: 'record.resolve_conflict',
    description: 'Resolve a field conflict with corrected documentation or a qualified review decision.',
    kind: 'write',
    args: z.object({ tenantId: z.string(), studentId: z.string(), mutation: ProposedMutationSchema }).strict(),
    handler: async (inv, args): Promise<MutationResponse> => records.applyMutation(acting(inv), args.tenantId, args.studentId, { ...args.mutation, operation: 'resolve_conflict' }),
  });

  gateway.register({
    name: 'record.delete_scoped',
    description: 'Delete a fact or a document and everything derived from it under the service’s control.',
    kind: 'write',
    args: z.object({ tenantId: z.string(), studentId: z.string(), target: z.discriminatedUnion('kind', [z.object({ kind: z.literal('claim'), claimId: z.string() }).strict(), z.object({ kind: z.literal('document'), documentId: z.string() }).strict()]) }).strict(),
    handler: async (inv, args) => {
      const ctx = { ...acting(inv), purpose: 'deletion' as const };
      return args.target.kind === 'claim' ? records.deleteClaim(ctx, args.tenantId, args.studentId, args.target.claimId) : records.deleteDocument(ctx, args.tenantId, args.studentId, args.target.documentId);
    },
  });

  gateway.register({
    name: 'artifacts.put_derived',
    description: 'Store a derived result (finding, plan, match) with its input references for invalidation.',
    kind: 'write',
    args: z
      .object({
        tenantId: z.string(),
        studentId: z.string(),
        kind: z.string().min(1),
        scopeKey: z.string().min(1),
        payload: z.unknown(),
        inputClaimIds: z.array(z.string()),
        inputFieldKeys: z.array(z.string()).optional(),
        ruleVersions: z.array(z.string()).optional(),
        sourceIds: z.array(z.string()).optional(),
        recordVersion: z.number().int().nonnegative(),
        categoryFloor: DataCategorySchema.optional(),
      })
      .strict(),
    handler: async (inv, args): Promise<Pick<DerivedArtifact, 'id' | 'status' | 'category' | 'statusReason'>> => {
      const input: Parameters<RecordService['putDerived']>[1] = {
        tenantId: args.tenantId,
        studentId: args.studentId,
        kind: args.kind,
        scopeKey: args.scopeKey,
        payload: args.payload,
        inputClaimIds: args.inputClaimIds,
        recordVersion: args.recordVersion,
      };
      if (args.inputFieldKeys) input.inputFieldKeys = args.inputFieldKeys;
      if (args.ruleVersions) input.ruleVersions = args.ruleVersions;
      if (args.sourceIds) input.sourceIds = args.sourceIds;
      if (args.categoryFloor) input.categoryFloor = args.categoryFloor;
      const a = records.putDerived(acting(inv), input);
      const out: Pick<DerivedArtifact, 'id' | 'status' | 'category' | 'statusReason'> = { id: a.id, status: a.status, category: a.category };
      if (a.statusReason) out.statusReason = a.statusReason;
      return out;
    },
  });

  gateway.register({
    name: 'artifacts.read',
    description: 'Read derived results visible to the actor, with their current/stale status.',
    kind: 'read',
    args: z.object({ tenantId: z.string(), studentId: z.string(), artifactId: z.string().optional(), kind: z.string().optional() }).strict(),
    handler: async (inv, args): Promise<DerivedArtifact[]> => {
      const ctx = acting(inv);
      if (args.artifactId) {
        const a = records.getArtifact(ctx, args.tenantId, args.studentId, args.artifactId);
        return a ? [a] : [];
      }
      const filter: { kind?: string } = {};
      if (args.kind) filter.kind = args.kind;
      return records.listArtifacts(ctx, args.tenantId, args.studentId, filter);
    },
  });
}
