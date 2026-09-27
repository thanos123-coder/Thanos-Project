import type { z } from 'zod';
import type { TaskContext } from '../runtime/tool-gateway.js';
import { fenceUntrusted, type UntrustedContent } from '../runtime/untrusted.js';
import { BudgetExhaustedError, errorMessage } from '../shared/errors.js';

/**
 * Model gateway (blueprint service "Model gateway: approved model access,
 * minimal data disclosure, structured outputs, cost limits and provider
 * settings").
 *
 * Every model call returns a validated, typed object or an explicit failure.
 * Agents never receive raw model text they could mistake for a fact, and they
 * must handle every failure kind (the product keeps working, narrowed, when no
 * model is configured, a request is refused, or the output is invalid).
 */

export type ModelTier = 'fast' | 'standard' | 'deep';

export interface Attachment {
  kind: 'pdf' | 'image';
  mediaType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  base64: string;
  /** Reference used in prompts and audit, e.g. "doc_5 v2". */
  label: string;
}

export interface StructuredRequest<T> {
  /** Stable purpose id, e.g. 'intake.interpret_answer'. Used for routing in tests and for audit. */
  purpose: string;
  /** Stable role instruction. Kept byte-identical across calls so it can be cached. */
  system: string;
  /** Task-specific instruction for this call. */
  instructions: string;
  /** Trusted, already-scoped structured context. Must contain only data this role may see. */
  context?: ReadonlyArray<{ label: string; data: unknown }>;
  /** Untrusted content (documents, web pages, student free text). Always fenced as data. */
  untrusted?: readonly UntrustedContent[];
  attachments?: readonly Attachment[];
  schema: z.ZodType<T>;
  schemaName: string;
  tier: ModelTier;
  maxOutputTokens?: number;
}

export type ModelFailureReason = 'no_model_configured' | 'refusal' | 'max_tokens' | 'schema_invalid' | 'api_error' | 'budget_exhausted' | 'cancelled';

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type StructuredResponse<T> =
  | { ok: true; output: T; modelId: string; usage: ModelUsage; repaired: boolean }
  | { ok: false; reason: ModelFailureReason; detail: string; modelId?: string; usage?: ModelUsage; retryable: boolean };

export interface ModelGateway {
  readonly configured: boolean;
  generate<T>(ctx: TaskContext | null, req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

/** Raw provider result before validation. */
export type RawModelResult =
  | { kind: 'text'; text: string; modelId: string; usage: ModelUsage }
  | { kind: 'refusal'; detail: string; modelId: string; usage: ModelUsage }
  | { kind: 'max_tokens'; modelId: string; usage: ModelUsage }
  | { kind: 'error'; detail: string; retryable: boolean };

const ZERO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * Shared behavior for all gateways: budget reservation before the call, token
 * accounting after it, client-side schema validation (refinements that JSON
 * Schema cannot express are enforced here), and at most one bounded repair.
 */
export abstract class BaseModelGateway implements ModelGateway {
  abstract readonly configured: boolean;

  protected abstract rawCall<T>(req: StructuredRequest<T>, userText: string): Promise<RawModelResult>;

  async generate<T>(ctx: TaskContext | null, req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    if (!this.configured) return { ok: false, reason: 'no_model_configured', detail: 'No language model is configured', retryable: false };
    let repairNote: string | null = null;
    let totalUsage = { ...ZERO_USAGE };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (ctx?.token.isCancelled) return { ok: false, reason: 'cancelled', detail: 'Task cancelled', retryable: false };
      if (attempt > 0 && ctx && (!ctx.budget.canConsume('revisions') || !ctx.budget.canConsume('model_calls'))) {
        // No repair budget left: report the invalid output rather than a budget failure.
        return { ok: false, reason: 'schema_invalid', detail: repairNote ?? 'invalid output', retryable: false, usage: totalUsage };
      }
      try {
        ctx?.budget.consume('model_calls');
        if (attempt > 0) ctx?.budget.consume('revisions');
        if (ctx?.budget.tokensExhausted()) throw new BudgetExhaustedError('model_tokens');
      } catch (e) {
        if (e instanceof BudgetExhaustedError) return { ok: false, reason: 'budget_exhausted', detail: e.message, retryable: false, usage: totalUsage };
        throw e;
      }
      const userText = renderUserText(req, repairNote);
      let raw: RawModelResult;
      try {
        raw = await this.rawCall(req, userText);
      } catch (e) {
        raw = { kind: 'error', detail: errorMessage(e), retryable: false };
      }
      if (raw.kind === 'error') return { ok: false, reason: 'api_error', detail: raw.detail, retryable: raw.retryable, usage: totalUsage };
      totalUsage = addUsage(totalUsage, raw.usage);
      ctx?.budget.recordTokens(raw.usage.inputTokens + raw.usage.outputTokens);
      if (ctx?.token.isCancelled) return { ok: false, reason: 'cancelled', detail: 'Task cancelled during the model call', retryable: false, usage: totalUsage };
      if (raw.kind === 'refusal') return { ok: false, reason: 'refusal', detail: raw.detail, modelId: raw.modelId, usage: totalUsage, retryable: false };
      if (raw.kind === 'max_tokens') return { ok: false, reason: 'max_tokens', detail: 'The response was cut off before completion', modelId: raw.modelId, usage: totalUsage, retryable: false };

      let json: unknown;
      try {
        json = JSON.parse(raw.text);
      } catch (e) {
        repairNote = `Your previous output was not valid JSON (${errorMessage(e)}). Return only JSON matching the schema.`;
        continue;
      }
      const parsed = req.schema.safeParse(json);
      if (parsed.success) return { ok: true, output: parsed.data, modelId: raw.modelId, usage: totalUsage, repaired: attempt > 0 };
      repairNote = `Your previous output failed validation: ${parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}. Correct these problems and return JSON matching the schema.`;
    }
    return { ok: false, reason: 'schema_invalid', detail: repairNote ?? 'invalid output', retryable: false, usage: totalUsage };
  }
}

function addUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/**
 * Build the user turn: task instructions, trusted context as JSON, then each
 * untrusted item fenced as data. Deterministic ordering keeps prompts
 * reproducible for evaluation.
 */
export function renderUserText<T>(req: StructuredRequest<T>, repairNote: string | null): string {
  const parts: string[] = [`<task purpose="${req.purpose}">\n${req.instructions.trim()}\n</task>`];
  for (const c of req.context ?? []) parts.push(`<context name="${c.label}">\n${JSON.stringify(c.data, null, 2)}\n</context>`);
  for (const u of req.untrusted ?? []) parts.push(fenceUntrusted(u));
  if (repairNote) parts.push(`<repair>\n${repairNote}\n</repair>`);
  parts.push(`Respond with a single JSON object that conforms to the ${req.schemaName} schema.`);
  return parts.join('\n\n');
}

/** A gateway for deployments without a model: every call fails gracefully and agents narrow their help. */
export class NullModelGateway implements ModelGateway {
  readonly configured = false;

  async generate<T>(): Promise<StructuredResponse<T>> {
    return { ok: false, reason: 'no_model_configured', detail: 'No language model is configured', retryable: false };
  }
}
