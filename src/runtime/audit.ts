import type { Clock } from '../shared/clock.js';

/**
 * Privacy-conscious audit log. Entries record who did what and the outcome;
 * they never contain field values, document text or conversation content
 * ("avoid spreading sensitive details in debugging logs").
 */
export interface AuditEntry {
  at: string;
  kind: 'tool_call' | 'tool_denied' | 'mutation' | 'mutation_rejected' | 'access_denied' | 'deletion' | 'permission_change' | 'incident' | 'external_action' | 'model_call' | 'review_request';
  taskId?: string;
  role?: string;
  actorId?: string;
  tenantId?: string;
  studentId?: string;
  name: string;
  outcome: string;
  code?: string;
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  constructor(private readonly clock: Clock) {}

  record(entry: Omit<AuditEntry, 'at'>): void {
    this.entries.push({ at: this.clock.nowIso(), ...entry });
  }

  list(filter?: Partial<Pick<AuditEntry, 'kind' | 'taskId' | 'studentId' | 'name'>>): readonly AuditEntry[] {
    if (!filter) return [...this.entries];
    return this.entries.filter((e) =>
      (filter.kind === undefined || e.kind === filter.kind) &&
      (filter.taskId === undefined || e.taskId === filter.taskId) &&
      (filter.studentId === undefined || e.studentId === filter.studentId) &&
      (filter.name === undefined || e.name === filter.name),
    );
  }
}
