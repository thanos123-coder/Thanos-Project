import type { Clock } from '../shared/clock.js';
import type { BudgetLimits } from '../shared/envelopes.js';
import { BudgetExhaustedError } from '../shared/errors.js';

export type BudgetDimension = 'tool_calls' | 'model_calls' | 'revisions' | 'model_tokens';

export interface BudgetUsage {
  toolCalls: number;
  modelCalls: number;
  revisions: number;
  modelTokens: number;
  elapsedMs: number;
}

/**
 * Enforced task budget (spec: "A budget is enforced by the runtime, and a child
 * task cannot grant itself additional tools." "All child usage also consumes the
 * parent task's aggregate budget."). Consumption is checked before the work is
 * done, so an exhausted budget stops the call rather than reporting after it.
 */
export class BudgetTracker {
  private readonly usage = { toolCalls: 0, modelCalls: 0, revisions: 0, modelTokens: 0 };
  private readonly startedAt: number;

  constructor(
    readonly limits: BudgetLimits,
    private readonly clock: Clock,
    private readonly parent?: BudgetTracker,
  ) {
    this.startedAt = clock.nowMs();
  }

  /** Create a child tracker whose limits can never exceed this tracker's remaining budget. */
  child(requested: BudgetLimits): BudgetTracker {
    const remaining = this.remaining();
    const limits: BudgetLimits = {
      maxToolCalls: Math.min(requested.maxToolCalls, remaining.maxToolCalls),
      maxModelCalls: Math.min(requested.maxModelCalls, remaining.maxModelCalls),
      maxRevisions: Math.min(requested.maxRevisions, remaining.maxRevisions),
    };
    const timeout = minDefined(requested.timeoutMs, remaining.timeoutMs);
    if (timeout !== undefined) limits.timeoutMs = timeout;
    const tokens = minDefined(requested.maxModelTokens, remaining.maxModelTokens);
    if (tokens !== undefined) limits.maxModelTokens = tokens;
    return new BudgetTracker(limits, this.clock, this);
  }

  remaining(): BudgetLimits {
    const r: BudgetLimits = {
      maxToolCalls: Math.max(0, this.limits.maxToolCalls - this.usage.toolCalls),
      maxModelCalls: Math.max(0, this.limits.maxModelCalls - this.usage.modelCalls),
      maxRevisions: Math.max(0, this.limits.maxRevisions - this.usage.revisions),
    };
    if (this.limits.timeoutMs !== undefined) r.timeoutMs = Math.max(1, this.limits.timeoutMs - this.elapsedMs());
    if (this.limits.maxModelTokens !== undefined) r.maxModelTokens = Math.max(1, this.limits.maxModelTokens - this.usage.modelTokens);
    return r;
  }

  elapsedMs(): number {
    return this.clock.nowMs() - this.startedAt;
  }

  /** Throws if the wall-clock limit has passed. */
  checkTime(): void {
    if (this.limits.timeoutMs !== undefined && this.elapsedMs() > this.limits.timeoutMs) throw new BudgetExhaustedError('time');
    this.parent?.checkTime();
  }

  canConsume(dimension: BudgetDimension, amount = 1): boolean {
    const [used, limit] = this.pair(dimension);
    if (limit !== undefined && used + amount > limit) return false;
    return this.parent ? this.parent.canConsume(dimension, amount) : true;
  }

  /** Reserve budget before doing the work. Throws BudgetExhaustedError without consuming anything if unavailable. */
  consume(dimension: BudgetDimension, amount = 1): void {
    this.checkTime();
    if (!this.canConsume(dimension, amount)) throw new BudgetExhaustedError(dimension);
    this.apply(dimension, amount);
  }

  /** Record token usage after a model call; tokens cannot be known in advance. */
  recordTokens(tokens: number): void {
    this.apply('model_tokens', tokens);
  }

  tokensExhausted(): boolean {
    const [used, limit] = this.pair('model_tokens');
    return limit !== undefined && used >= limit;
  }

  snapshot(): BudgetUsage {
    return { ...this.usage, elapsedMs: this.elapsedMs() };
  }

  private apply(dimension: BudgetDimension, amount: number): void {
    switch (dimension) {
      case 'tool_calls':
        this.usage.toolCalls += amount;
        break;
      case 'model_calls':
        this.usage.modelCalls += amount;
        break;
      case 'revisions':
        this.usage.revisions += amount;
        break;
      case 'model_tokens':
        this.usage.modelTokens += amount;
        break;
    }
    this.parent?.apply(dimension, amount);
  }

  private pair(dimension: BudgetDimension): [number, number | undefined] {
    switch (dimension) {
      case 'tool_calls':
        return [this.usage.toolCalls, this.limits.maxToolCalls];
      case 'model_calls':
        return [this.usage.modelCalls, this.limits.maxModelCalls];
      case 'revisions':
        return [this.usage.revisions, this.limits.maxRevisions];
      case 'model_tokens':
        return [this.usage.modelTokens, this.limits.maxModelTokens];
    }
  }
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Illustrative initial caps from the spec's "Initial effort budgets" table.
 * These are prototype starting configurations to tune after measurement, not
 * measured guarantees.
 */
export const DEFAULT_ROLE_BUDGETS: Readonly<Record<string, BudgetLimits>> = {
  // The lead counselor's budget is the aggregate for the whole request, because every
  // specialist it starts consumes the parent budget too. Its own planning and
  // synthesis calls are capped separately in the agent (three model calls, one repair).
  '01': { maxToolCalls: 150, maxModelCalls: 30, maxRevisions: 6 },
  '02': { maxToolCalls: 12, maxModelCalls: 2, maxRevisions: 1 },
  '03': { maxToolCalls: 20, maxModelCalls: 4, maxRevisions: 1 },
  '04': { maxToolCalls: 10, maxModelCalls: 0, maxRevisions: 1 },
  '05': { maxToolCalls: 10, maxModelCalls: 2, maxRevisions: 1 },
  '06': { maxToolCalls: 6, maxModelCalls: 1, maxRevisions: 1 },
  '07': { maxToolCalls: 12, maxModelCalls: 2, maxRevisions: 1 },
  '08': { maxToolCalls: 10, maxModelCalls: 2, maxRevisions: 1 },
  '09': { maxToolCalls: 40, maxModelCalls: 12, maxRevisions: 1 },
  // Volume two ("Proposed operating budgets"): a cost recalculation needs no model call, a shortlist
  // explanation one bounded call, a new institution research task several fetches; one structured repair.
  '10': { maxToolCalls: 12, maxModelCalls: 2, maxRevisions: 1 },
  '11': { maxToolCalls: 40, maxModelCalls: 6, maxRevisions: 1 },
  '12': { maxToolCalls: 16, maxModelCalls: 1, maxRevisions: 1 },
  // Up to 8 options: resolve, claims and one stored assessment each, plus shared reads.
  '13': { maxToolCalls: 32, maxModelCalls: 1, maxRevisions: 1 },
  '14': { maxToolCalls: 24, maxModelCalls: 1, maxRevisions: 1 },
  '15': { maxToolCalls: 14, maxModelCalls: 1, maxRevisions: 1 },
  '16': { maxToolCalls: 30, maxModelCalls: 3, maxRevisions: 1 },
  '17': { maxToolCalls: 14, maxModelCalls: 3, maxRevisions: 1 },
  '18': { maxToolCalls: 14, maxModelCalls: 2, maxRevisions: 1 },
};
