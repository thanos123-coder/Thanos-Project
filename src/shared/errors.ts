/**
 * Typed, recoverable errors. Denials never reveal whether a record exists
 * (04T15), and messages never contain private payloads.
 */

export type DenialCode =
  | 'not_found_or_denied'
  | 'tool_not_permitted'
  | 'tool_not_in_task'
  | 'invalid_arguments'
  | 'budget_exhausted'
  | 'task_cancelled'
  | 'scope_violation'
  | 'purpose_mismatch'
  | 'destination_not_allowed'
  | 'authorization_revoked';

export class AccessDeniedError extends Error {
  readonly code: DenialCode;
  readonly recoverable: boolean;

  constructor(code: DenialCode, message: string, recoverable = true) {
    super(message);
    this.name = 'AccessDeniedError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

export class ValidationError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length > 0 ? `${message}: ${issues.join('; ')}` : message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class BudgetExhaustedError extends Error {
  readonly dimension: 'tool_calls' | 'model_calls' | 'revisions' | 'time' | 'model_tokens';

  constructor(dimension: BudgetExhaustedError['dimension']) {
    super(`Task budget exhausted: ${dimension}`);
    this.name = 'BudgetExhaustedError';
    this.dimension = dimension;
  }
}

export class TaskCancelledError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} was cancelled`);
    this.name = 'TaskCancelledError';
  }
}

/** A security incident: data belonging to another student or tenant appeared in a flow (01 failure handling). */
export class SecurityIncidentError extends Error {
  readonly incidentKind: 'cross_student' | 'cross_tenant' | 'unauthorized_action';

  constructor(kind: SecurityIncidentError['incidentKind'], message: string) {
    super(message);
    this.name = 'SecurityIncidentError';
    this.incidentKind = kind;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
