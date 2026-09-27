import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { BaseModelGateway, type ModelTier, type ModelUsage, type RawModelResult, type StructuredRequest } from './gateway.js';

/**
 * Claude adapter for the model gateway.
 *
 * - Structured outputs: `output_config.format` built from the zod schema; the
 *   base gateway re-validates client-side, including refinements JSON Schema
 *   cannot express.
 * - Adaptive thinking with per-tier effort (low for routine extraction and
 *   classification, higher for synthesis). Effort is the cost lever; model
 *   choice is configuration, and every tier defaults to the same model.
 * - Server-side refusal fallbacks (`fallbacks: "default"`), and an explicit
 *   check of `stop_reason` before any content is read.
 * - A byte-stable system prompt with a cache breakpoint so repeated role calls
 *   can reuse the cached prefix.
 * - Typed SDK errors mapped to retryable / non-retryable failures (the SDK
 *   already retries 408/409/429/5xx with backoff).
 *
 * Data handling: callers pass only scoped views; this adapter adds nothing from
 * the student record. Check the provider's data-use terms before stating that
 * student data is not used for training (blueprint, Security).
 */

export const DEFAULT_MODEL = 'claude-opus-5';

export interface AnthropicGatewayOptions {
  client?: Anthropic;
  models?: Partial<Record<ModelTier, string>>;
  effort?: Partial<Record<ModelTier, 'low' | 'medium' | 'high' | 'xhigh' | 'max'>>;
  /** Default maximum output tokens (thinking + response). */
  maxOutputTokens?: number;
  /** Opt into server-side refusal fallbacks (recommended; on by default). */
  refusalFallbacks?: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_EFFORT: Record<ModelTier, 'low' | 'medium' | 'high'> = { fast: 'low', standard: 'medium', deep: 'high' };

export class AnthropicModelGateway extends BaseModelGateway {
  readonly configured = true;
  private readonly client: Anthropic;
  private readonly models: Record<ModelTier, string>;
  private readonly effort: Record<ModelTier, 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  private readonly maxOutputTokens: number;
  private readonly refusalFallbacks: boolean;
  private readonly timeoutMs: number | undefined;

  constructor(options: AnthropicGatewayOptions = {}) {
    super();
    this.client = options.client ?? new Anthropic();
    this.models = {
      fast: options.models?.fast ?? DEFAULT_MODEL,
      standard: options.models?.standard ?? DEFAULT_MODEL,
      deep: options.models?.deep ?? DEFAULT_MODEL,
    };
    this.effort = { ...DEFAULT_EFFORT, ...options.effort };
    this.maxOutputTokens = options.maxOutputTokens ?? 16_000;
    this.refusalFallbacks = options.refusalFallbacks ?? true;
    this.timeoutMs = options.timeoutMs;
  }

  /** Exposed for tests: the exact request body sent to the API. */
  buildParams<T>(req: StructuredRequest<T>, userText: string): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
    const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
    for (const a of req.attachments ?? []) {
      if (a.kind === 'pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 }, title: a.label });
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: a.base64 } });
      }
    }
    content.push({ type: 'text', text: userText });
    const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model: this.models[req.tier],
      max_tokens: req.maxOutputTokens ?? this.maxOutputTokens,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      thinking: { type: 'adaptive' },
      output_config: { effort: this.effort[req.tier], format: betaZodOutputFormat(req.schema as never) },
    };
    if (this.refusalFallbacks) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    return params;
  }

  protected async rawCall<T>(req: StructuredRequest<T>, userText: string): Promise<RawModelResult> {
    const params = this.buildParams(req, userText);
    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await this.client.beta.messages.create(params, this.timeoutMs !== undefined ? { timeout: this.timeoutMs } : undefined);
    } catch (e) {
      return mapError(e);
    }
    const usage: ModelUsage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    // Always check stop_reason before reading content.
    if (message.stop_reason === 'refusal') {
      const details = (message as { stop_details?: { category?: string | null; explanation?: string | null } | null }).stop_details;
      return { kind: 'refusal', detail: details?.category ?? 'declined', modelId: message.model, usage };
    }
    if (message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded') {
      return { kind: 'max_tokens', modelId: message.model, usage };
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (text.trim().length === 0) return { kind: 'error', detail: `Empty response (stop_reason=${message.stop_reason ?? 'null'})`, retryable: false };
    return { kind: 'text', text, modelId: message.model, usage };
  }
}

function mapError(e: unknown): RawModelResult {
  // Most specific first.
  if (e instanceof Anthropic.AuthenticationError) return { kind: 'error', detail: 'Model provider authentication failed', retryable: false };
  if (e instanceof Anthropic.PermissionDeniedError) return { kind: 'error', detail: 'Model provider denied access', retryable: false };
  if (e instanceof Anthropic.NotFoundError) return { kind: 'error', detail: 'Configured model was not found', retryable: false };
  if (e instanceof Anthropic.BadRequestError) return { kind: 'error', detail: `Invalid model request: ${e.message}`, retryable: false };
  if (e instanceof Anthropic.RateLimitError) return { kind: 'error', detail: 'Model provider rate limit reached', retryable: true };
  if (e instanceof Anthropic.InternalServerError) return { kind: 'error', detail: 'Model provider unavailable', retryable: true };
  if (e instanceof Anthropic.APIConnectionError) return { kind: 'error', detail: 'Could not reach the model provider', retryable: true };
  if (e instanceof Anthropic.APIError) return { kind: 'error', detail: `Model provider error ${e.status ?? ''}`.trim(), retryable: (e.status ?? 0) >= 500 };
  return { kind: 'error', detail: e instanceof Error ? e.message : String(e), retryable: false };
}
