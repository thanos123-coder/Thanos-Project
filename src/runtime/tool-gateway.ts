import { z } from 'zod';
import type { Clock } from '../shared/clock.js';
import type { RequestEnvelope, RoleId } from '../shared/envelopes.js';
import { AccessDeniedError, BudgetExhaustedError, TaskCancelledError, errorMessage } from '../shared/errors.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Actor, Purpose } from '../shared/permissions.js';
import type { AuditLog } from './audit.js';
import type { BudgetTracker } from './budget.js';
import type { CancellationToken } from './cancellation.js';

/**
 * Tool gateway (spec, Implementation contracts → Tool permission matrix).
 *
 * "The tool gateway should validate every call independently of the model. It
 * checks actor, task purpose, allowed tool, argument schema, object scope,
 * destination, budget, and current authorization. An agent may request a tool
 * that it cannot use; the gateway must deny it without exposing additional
 * private information."
 */

export type ToolKind = 'read' | 'propose' | 'write' | 'compute' | 'public_research' | 'orchestration';

export interface ToolInvocation {
  taskId: string;
  role: RoleId;
  actor: Actor;
  tenantId: string;
  studentId: string;
  purpose: Purpose;
  permissionSnapshot: string;
  /** The live task context, for orchestration tools that spawn child work. */
  context: TaskContext;
}

export interface ToolDefinition<A = any, R = any> {
  name: string;
  description: string;
  kind: ToolKind;
  args: z.ZodType<A>;
  handler: (call: ToolInvocation, args: A) => Promise<R>;
  /** Claim ids contained in the result, so result validation can check evidence came from served inputs. */
  servedClaimIds?: (result: R) => readonly string[];
}

/**
 * Role → permitted tools. Mirrors the spec's permission matrix. No role holds a
 * tool that sends messages, pays, registers, enrolls or submits: agents can
 * only *propose* external actions (actions.propose); execution requires the
 * separate, explicitly authorized external-action service.
 */
export const ROLE_TOOL_MATRIX: Readonly<Record<RoleId, readonly string[]>> = {
  '01': ['record.read_scoped', 'record.read_status', 'tasks.create', 'tasks.cancel', 'tasks.checkpoint', 'specialist.invoke', 'review.request', 'actions.propose', 'artifacts.read'],
  '02': ['record.read_scoped', 'record.propose_change'],
  '03': ['files.read_quarantined', 'files.parse_sandboxed', 'record.read_scoped', 'record.propose_change'],
  '04': ['record.read_scoped', 'record.propose_change', 'record.commit_validated', 'record.resolve_conflict', 'record.delete_scoped', 'permissions.manage', 'artifacts.put_derived', 'artifacts.read'],
  '05': ['record.read_scoped', 'record.propose_change', 'sources.read_verified', 'artifacts.put_derived', 'actions.propose'],
  '06': ['record.read_scoped', 'rules.read_verified', 'artifacts.put_derived'],
  '07': ['record.read_scoped', 'rules.read_verified', 'calendars.read_verified', 'artifacts.put_derived', 'actions.propose'],
  '08': ['record.read_scoped', 'record.propose_change', 'artifacts.put_derived'],
  '09': ['record.read_scoped', 'research.search_public', 'research.fetch_public', 'opportunities.read_catalog', 'opportunities.upsert_catalog', 'rules.read_verified', 'artifacts.put_derived', 'actions.propose'],
};

/** Hook used to re-check that the acting person is still authorized (revocation takes effect immediately). */
export interface AuthorizationChecker {
  isStillAuthorized(actor: Actor, tenantId: string, studentId: string, purpose: Purpose): boolean;
}

export class ToolGateway {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly audit: AuditLog,
    private readonly authorization: AuthorizationChecker,
  ) {}

  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) throw new Error(`Tool already registered: ${def.name}`);
    this.tools.set(def.name, def);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async call<R = unknown>(ctx: TaskContext, name: string, rawArgs: unknown): Promise<R> {
    const req = ctx.request;
    const deny = (code: AccessDeniedError['code'], message: string): never => {
      this.audit.record({ kind: 'tool_denied', taskId: req.taskId, role: req.role, actorId: req.actor.id, tenantId: req.tenantId, studentId: req.studentId, name, outcome: 'denied', code });
      throw new AccessDeniedError(code, message);
    };

    if (ctx.token.isCancelled) deny('task_cancelled', `Task ${req.taskId} is cancelled`);
    const def = this.tools.get(name);
    if (!def) deny('tool_not_permitted', `Tool ${name} is not available`);
    if (!ROLE_TOOL_MATRIX[req.role].includes(name)) deny('tool_not_permitted', `Role ${req.role} may not use ${name}`);
    if (!req.allowedTools.includes(name)) deny('tool_not_in_task', `Tool ${name} was not granted to task ${req.taskId}`);

    const parsed = def!.args.safeParse(rawArgs);
    if (!parsed.success) deny('invalid_arguments', `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    const args = parsed.data as Record<string, unknown>;

    // Object scope: a task may only touch its own tenant and student.
    if (args && typeof args === 'object') {
      if ('tenantId' in args && args['tenantId'] !== req.tenantId) deny('scope_violation', 'Requested object is outside the task scope');
      if ('studentId' in args && args['studentId'] !== req.studentId) deny('scope_violation', 'Requested object is outside the task scope');
    }

    try {
      ctx.budget.consume('tool_calls');
    } catch (e) {
      if (e instanceof BudgetExhaustedError) deny('budget_exhausted', e.message);
      throw e;
    }

    if (!this.authorization.isStillAuthorized(req.actor, req.tenantId, req.studentId, req.purpose)) {
      deny('authorization_revoked', 'The acting person is no longer authorized for this work');
    }

    const invocation: ToolInvocation = {
      taskId: req.taskId,
      role: req.role,
      actor: req.actor,
      tenantId: req.tenantId,
      studentId: req.studentId,
      purpose: req.purpose,
      permissionSnapshot: req.permissionSnapshot,
      context: ctx,
    };
    try {
      const result = (await def!.handler(invocation, parsed.data)) as R;
      if (ctx.token.isCancelled) throw new TaskCancelledError(req.taskId);
      if (def!.servedClaimIds) for (const id of def!.servedClaimIds(result)) ctx.servedClaimIds.add(id);
      this.audit.record({ kind: 'tool_call', taskId: req.taskId, role: req.role, actorId: req.actor.id, tenantId: req.tenantId, studentId: req.studentId, name, outcome: 'ok' });
      return result;
    } catch (e) {
      const code = e instanceof AccessDeniedError ? e.code : undefined;
      const entry: Parameters<AuditLog['record']>[0] = { kind: 'tool_call', taskId: req.taskId, role: req.role, actorId: req.actor.id, tenantId: req.tenantId, studentId: req.studentId, name, outcome: `error:${e instanceof Error ? e.name : 'unknown'}` };
      if (code !== undefined) entry.code = code;
      this.audit.record(entry);
      throw e;
    }
  }
}

/**
 * Everything an agent needs to do bounded work for one task. Agents receive
 * this context, never raw service references, so their capabilities are exactly
 * the tools their role and task permit.
 */
export class TaskContext {
  /** Claim ids served to this task through tools; results may only cite these. */
  readonly servedClaimIds = new Set<string>();
  /** Source ids served to this task through tools. */
  readonly servedSourceIds = new Set<string>();

  constructor(
    readonly request: RequestEnvelope,
    readonly budget: BudgetTracker,
    readonly token: CancellationToken,
    private readonly gateway: ToolGateway,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}

  call<R = unknown>(tool: string, args: unknown): Promise<R> {
    return this.gateway.call<R>(this, tool, args);
  }

  /** Try a tool; on a recoverable denial return the error instead of throwing. */
  async tryCall<R = unknown>(tool: string, args: unknown): Promise<{ ok: true; value: R } | { ok: false; error: AccessDeniedError }> {
    try {
      return { ok: true, value: await this.call<R>(tool, args) };
    } catch (e) {
      if (e instanceof AccessDeniedError) return { ok: false, error: e };
      throw e;
    }
  }

  describe(): string {
    return `${this.request.role}:${this.request.taskId}`;
  }
}

export function describeDenial(e: unknown): string {
  return e instanceof AccessDeniedError ? `${e.code}: ${e.message}` : errorMessage(e);
}
