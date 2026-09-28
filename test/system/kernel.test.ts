import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ObjectiveStore } from '../../src/agents/a01-orchestrator/objectives.js';
import { RecordService } from '../../src/agents/a04-record-steward/service.js';
import { makeResult, type SpecialistAgent } from '../../src/agents/common/specialist.js';
import type { TaskContext } from '../../src/runtime/tool-gateway.js';
import type { RoleId } from '../../src/shared/envelopes.js';
import type { Actor } from '../../src/shared/permissions.js';
import { registerOrchestrationTools, type InvokeOutcome } from '../../src/system/orchestration-tools.js';
import { makeKernel, stated, TENANT } from '../helpers/kernel.js';

/**
 * The kernel's own safeguards, each checked on its own with small stand-in
 * specialists, so that no other layer can hide a missing check.
 */

type Behaviour = (ctx: TaskContext) => Promise<unknown>;

function fake(role: RoleId, contractId: string, behave: Behaviour, payload: z.ZodType = z.object({ note: z.string() }).strict()): SpecialistAgent {
  return {
    role,
    contracts: [{ id: contractId, role, payload, groundSummary: false }],
    handle: async (ctx) => {
      const claimIds = (await behave(ctx)) as string[] | undefined;
      return makeResult(ctx, { status: 'completed', summary: 'Done.', payload: { note: 'ok' }, claimIds: claimIds ?? [], completionReason: 'done' });
    },
  } as SpecialistAgent;
}

function setup(behave: Behaviour = async () => undefined) {
  const h = makeKernel();
  h.kernel.registerSpecialist(fake('09', 'fake_v1', behave));
  const run = (actor?: Actor) => h.kernel.invoke(h.task({ role: '09', purpose: 'opportunity_research', objective: 'test', completionContract: 'fake_v1', scope: {}, ...(actor ? { actor } : {}) }));
  return { ...h, run };
}

describe('kernel safeguards', () => {
  it('a task can act only for a person, never for an agent', async () => {
    const h = setup();
    const out = await h.run({ id: 'agent_x', kind: 'agent', tenantId: TENANT, role: '01' } as Actor);
    expect(out.accepted).toBe(false);
    expect(out.result.completionReason).toBe('agents_act_for_people');
  });

  it('a request built under permissions that have since changed does not run', async () => {
    const h = setup();
    const parent: Actor = { id: 'acct_parent', kind: 'supporter', tenantId: TENANT };
    const grant = { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter' as const, purposes: ['opportunity_research' as const], categories: ['goals_preferences' as const], access: ['read' as const], policyBasis: 'student_invitation' };
    h.kernel.records.permissions.grant(h.student, grant);
    const request = h.task({ role: '09', purpose: 'opportunity_research', objective: 'test', completionContract: 'fake_v1', scope: {}, actor: parent });
    h.kernel.records.permissions.grant(h.student, { ...grant, categories: ['practical_constraints'] });
    const out = await h.kernel.invoke(request);
    expect(out.accepted).toBe(false);
    expect(out.result.completionReason).toBe('permission_snapshot_stale');
  });

  it('a result that arrives after its task was cancelled is never published', async () => {
    const h = setup(async (ctx) => ctx.token.cancel('stopped by the student'));
    const out = await h.run();
    expect(out.accepted).toBe(false);
    expect(out.result.status).toBe('cancelled');
    expect(out.result.completionReason).toBe('cancelled_before_publication');
  });
});

describe('specialist.invoke', () => {
  function orchestration(childPayload?: z.ZodType) {
    const h = makeKernel();
    registerOrchestrationTools(h.kernel, new ObjectiveStore(h.clock, h.ids, () => false));
    // The child reads the record (so claims are served to it) and cites them.
    const readAndCite: Behaviour = async (ctx) => {
      return RecordService.claimIdsOf(await ctx.call('record.read_scoped', { tenantId: TENANT, studentId: h.studentId, mode: 'local' }));
    };
    h.kernel.registerSpecialist(fake('06', 'child_v1', readAndCite, childPayload));
    h.kernel.registerSpecialist(fake('09', 'other_v1', async () => undefined));
    h.seed([stated(h.student, 'education.qualification_system', { id: 'IB_DP', label: 'IB Diploma' })]);
    const lead = h.kernel.createContext(h.task({ role: '01', purpose: 'counseling', objective: 'counsel', completionContract: 'other_v1', scope: {} }));
    const invoke = (role: RoleId, completionContract: string) => lead.call<InvokeOutcome>('specialist.invoke', { role, objective: 'check', completionContract, scope: {}, idempotencyKey: `k_${role}_${completionContract}`, objectiveRef: null });
    return { ...h, lead, invoke };
  }

  it('refuses a contract that belongs to a different role', async () => {
    const h = orchestration();
    await expect(h.invoke('06', 'other_v1')).rejects.toMatchObject({ code: 'invalid_arguments' });
  });

  it('makes a child’s evidence citable by the coordinator only when the child’s result was accepted', async () => {
    const accepted = orchestration();
    const ok = await accepted.invoke('06', 'child_v1');
    expect(ok.accepted).toBe(true);
    expect(ok.result.inputVersions.claimIds.length).toBeGreaterThan(0);
    expect([...accepted.lead.servedClaimIds]).toEqual(ok.result.inputVersions.claimIds);

    // Same child, but its payload fails its contract: nothing it cited reaches the coordinator.
    const rejected = orchestration(z.object({ note: z.number() }).strict());
    const bad = await rejected.invoke('06', 'child_v1');
    expect(bad.accepted).toBe(false);
    expect(rejected.lead.servedClaimIds.size).toBe(0);
  });
});

