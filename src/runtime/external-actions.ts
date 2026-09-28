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
  /** Claims served to the proposing task. Deleting any of them withdraws the proposal, which may repeat their content. */
  inputClaimIds: string[];
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

/** Who is deciding, and for which student; a decision never reaches another student's proposal. */
export interface DecisionScope {
  tenantId: string;
  studentId: string;
  /** Whether the person may manage this student's plans (checked by the caller against live permissions). */
  authorized: boolean;
}

export class ExternalActionService {
  /** Name under which deletion reaches this store (it is registered as a derivative store). */
  readonly name = 'external_action_proposals';
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
  propose(input: Omit<ExternalActionProposal, 'id' | 'authorizationState'>, meta: { tenantId: string; studentId: string; taskId: string; role: string; inputClaimIds?: readonly string[] }): ExternalActionProposal {
    const proposal: ExternalActionProposal = { ...input, id: this.ids.next('action'), authorizationState: 'proposed' };
    this.records.set(proposal.id, { proposal, tenantId: meta.tenantId, studentId: meta.studentId, proposedByTask: meta.taskId, proposedByRole: meta.role, inputClaimIds: [...(meta.inputClaimIds ?? [])], state: 'proposed' });
    this.audit.record({ kind: 'external_action', taskId: meta.taskId, role: meta.role, tenantId: meta.tenantId, studentId: meta.studentId, name: proposal.kind, outcome: 'proposed' });
    return proposal;
  }

  /**
   * Explicit approval by a person. Only the student themself (or another human
   * actor the caller has authorized for this student) may approve; agents never can.
   */
  approve(proposalId: string, approver: Actor, scope: DecisionScope): ExternalActionRecord {
    const r = this.scoped(proposalId, scope);
    if (approver.kind === 'agent') throw new Error('Agents cannot approve external actions');
    if (approver.tenantId !== r.tenantId || !scope.authorized) throw new Error('Approver is not authorized for this student');
    if (r.state !== 'proposed') return r;
    r.state = 'approved';
    r.approvedBy = approver.id;
    r.approvedAt = this.clock.nowIso();
    this.audit.record({ kind: 'external_action', actorId: approver.id, tenantId: r.tenantId, studentId: r.studentId, name: r.proposal.kind, outcome: 'approved' });
    return r;
  }

  reject(proposalId: string, by: Actor, scope: DecisionScope): ExternalActionRecord {
    const r = this.scoped(proposalId, scope);
    if (by.kind === 'agent' || by.tenantId !== r.tenantId || !scope.authorized) throw new Error('Not authorized for this student');
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

  list(tenantId: string, studentId: string): readonly ExternalActionRecord[] {
    return [...this.records.values()].filter((r) => r.tenantId === tenantId && r.studentId === studentId);
  }

  // Deletion (the record service calls these as for any derivative store).

  purgeByStudent(tenantId: string, studentId: string): number {
    const mine = this.list(tenantId, studentId);
    for (const r of mine) this.records.delete(r.proposal.id);
    return mine.length;
  }

  /**
   * A proposal may repeat content from the claims its task was served, so
   * deleting one of them withdraws every proposal that has not been carried
   * out. An executed action is history: its record stays, without the content.
   */
  purgeByClaims(tenantId: string, studentId: string, claimIds: readonly string[]): number {
    const deleted = new Set(claimIds);
    let n = 0;
    for (const r of this.list(tenantId, studentId)) {
      if (!r.inputClaimIds.some((id) => deleted.has(id))) continue;
      if (r.state === 'executed') r.proposal = { ...r.proposal, exactContent: '' };
      else this.records.delete(r.proposal.id);
      n += 1;
    }
    return n;
  }

  /** Document deletion reaches proposals through the claims extracted from the document. */
  purgeByDocument(): number {
    return 0;
  }

  /** Not found and not this student's are the same answer, so a proposal id reveals nothing. */
  private scoped(proposalId: string, scope: DecisionScope): ExternalActionRecord {
    const r = this.records.get(proposalId);
    if (!r || r.tenantId !== scope.tenantId || r.studentId !== scope.studentId) throw new Error('Unknown proposal');
    return r;
  }

  countByState(state: ExternalActionState): number {
    return [...this.records.values()].filter((r) => r.state === state).length;
  }
}
