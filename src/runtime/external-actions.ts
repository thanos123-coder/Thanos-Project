import type { Clock } from '../shared/clock.js';
import type { ExternalActionProposal } from '../shared/envelopes.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Actor } from '../shared/permissions.js';
import type { AuditLog } from './audit.js';

/**
 * External actions: sending messages, submitting, paying, registering,
 * enrolling, calendar writes. Agents can only create *proposals*. A proposal is
 * never inferred from an internal plan and is never executed by an agent.
 *
 * States: proposed → approved (by the student or an authorized adult through
 * the interface) → executed | failed. Execution requires an adapter for the
 * destination; this volume ships none, so approved actions remain approved and
 * the interface guides the person to complete the step themselves. Execution is
 * idempotent per proposal id.
 */

export type ExternalActionState = 'proposed' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface ExternalActionRecord {
  proposal: ExternalActionProposal;
  tenantId: string;
  studentId: string;
  proposedByTask: string;
  proposedByRole: string;
  state: ExternalActionState;
  approvedBy?: string;
  approvedAt?: string;
  executedAt?: string;
  failure?: string;
}

export interface ExternalActionAdapter {
  kind: ExternalActionProposal['kind'];
  execute(record: ExternalActionRecord): Promise<{ ok: true; receipt: string } | { ok: false; error: string }>;
}

export class ExternalActionService {
  private readonly records = new Map<string, ExternalActionRecord>();
  private readonly adapters = new Map<string, ExternalActionAdapter>();

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLog,
  ) {}

  registerAdapter(adapter: ExternalActionAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  /** Called by the `actions.propose` tool. Returns the stored proposal (always state 'proposed'). */
  propose(input: Omit<ExternalActionProposal, 'id' | 'authorizationState'>, meta: { tenantId: string; studentId: string; taskId: string; role: string }): ExternalActionProposal {
    const proposal: ExternalActionProposal = { ...input, id: this.ids.next('action'), authorizationState: 'proposed' };
    this.records.set(proposal.id, { proposal, tenantId: meta.tenantId, studentId: meta.studentId, proposedByTask: meta.taskId, proposedByRole: meta.role, state: 'proposed' });
    this.audit.record({ kind: 'external_action', taskId: meta.taskId, role: meta.role, tenantId: meta.tenantId, studentId: meta.studentId, name: proposal.kind, outcome: 'proposed' });
    return proposal;
  }

  /**
   * Explicit approval by a person. Only the student themself (or another human
   * actor the caller has authorized for this student) may approve; agents never can.
   */
  approve(proposalId: string, approver: Actor, approverAuthorizedForStudent: boolean): ExternalActionRecord {
    const r = this.records.get(proposalId);
    if (!r) throw new Error('Unknown proposal');
    if (approver.kind === 'agent') throw new Error('Agents cannot approve external actions');
    if (approver.tenantId !== r.tenantId || !approverAuthorizedForStudent) throw new Error('Approver is not authorized for this student');
    if (r.state !== 'proposed') return r;
    r.state = 'approved';
    r.approvedBy = approver.id;
    r.approvedAt = this.clock.nowIso();
    this.audit.record({ kind: 'external_action', actorId: approver.id, tenantId: r.tenantId, studentId: r.studentId, name: r.proposal.kind, outcome: 'approved' });
    return r;
  }

  reject(proposalId: string, by: Actor): ExternalActionRecord {
    const r = this.records.get(proposalId);
    if (!r) throw new Error('Unknown proposal');
    if (r.state === 'proposed') r.state = 'rejected';
    this.audit.record({ kind: 'external_action', actorId: by.id, tenantId: r.tenantId, studentId: r.studentId, name: r.proposal.kind, outcome: 'rejected' });
    return r;
  }

  /** Execute an approved action through its adapter. Idempotent: an executed action is never re-sent. */
  async execute(proposalId: string): Promise<ExternalActionRecord> {
    const r = this.records.get(proposalId);
    if (!r) throw new Error('Unknown proposal');
    if (r.state === 'executed') return r;
    if (r.state !== 'approved') throw new Error(`Action ${proposalId} is ${r.state}; explicit approval is required before execution`);
    const adapter = this.adapters.get(r.proposal.kind);
    if (!adapter) throw new Error(`No supported integration exists for ${r.proposal.kind}; the person must complete this step directly`);
    const outcome = await adapter.execute(r);
    if (outcome.ok) {
      r.state = 'executed';
      r.executedAt = this.clock.nowIso();
    } else {
      r.state = 'failed';
      r.failure = outcome.error;
    }
    this.audit.record({ kind: 'external_action', tenantId: r.tenantId, studentId: r.studentId, name: r.proposal.kind, outcome: r.state });
    return r;
  }

  list(studentId: string): readonly ExternalActionRecord[] {
    return [...this.records.values()].filter((r) => r.studentId === studentId);
  }

  countByState(state: ExternalActionState): number {
    return [...this.records.values()].filter((r) => r.state === state).length;
  }
}
