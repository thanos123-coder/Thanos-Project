import { BaseModelGateway, renderUserText, type RawModelResult, type StructuredRequest } from './gateway.js';

/**
 * Deterministic model gateway for tests and evaluation fixtures. Handlers are
 * keyed by request purpose; each returns an object to serialize as the model's
 * JSON output, or a special outcome to simulate refusals, truncation, invalid
 * JSON and provider errors. Every rendered prompt is recorded so tests can
 * assert what was — and was not — disclosed to a model.
 */

export type ScriptedOutcome =
  | { output: unknown }
  | { refusal: string }
  | { maxTokens: true }
  | { rawText: string }
  | { error: string; retryable?: boolean };

export type ScriptedHandler = (req: StructuredRequest<unknown>, callIndex: number) => ScriptedOutcome | Promise<ScriptedOutcome>;

export interface RecordedCall {
  purpose: string;
  system: string;
  userText: string;
  attachmentLabels: string[];
}

export class ScriptedModelGateway extends BaseModelGateway {
  readonly configured = true;
  readonly calls: RecordedCall[] = [];
  private readonly handlers = new Map<string, ScriptedHandler>();
  private readonly counts = new Map<string, number>();

  constructor(handlers: Record<string, ScriptedHandler> = {}) {
    super();
    for (const [k, v] of Object.entries(handlers)) this.handlers.set(k, v);
  }

  on(purpose: string, handler: ScriptedHandler): this {
    this.handlers.set(purpose, handler);
    return this;
  }

  /** Convenience: always return the same output for a purpose. */
  always(purpose: string, output: unknown): this {
    return this.on(purpose, () => ({ output }));
  }

  callsFor(purpose: string): RecordedCall[] {
    return this.calls.filter((c) => c.purpose === purpose);
  }

  /** Every prompt text sent so far, concatenated (for disclosure assertions). */
  allPromptText(): string {
    return this.calls.map((c) => `${c.system}\n${c.userText}`).join('\n');
  }

  protected async rawCall<T>(req: StructuredRequest<T>, userText: string): Promise<RawModelResult> {
    this.calls.push({ purpose: req.purpose, system: req.system, userText, attachmentLabels: (req.attachments ?? []).map((a) => a.label) });
    const handler = this.handlers.get(req.purpose);
    const n = this.counts.get(req.purpose) ?? 0;
    this.counts.set(req.purpose, n + 1);
    const usage = { inputTokens: Math.ceil(userText.length / 4), outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 };
    if (!handler) return { kind: 'error', detail: `No scripted handler for purpose ${req.purpose}`, retryable: false };
    const outcome = await handler(req as StructuredRequest<unknown>, n);
    if ('refusal' in outcome) return { kind: 'refusal', detail: outcome.refusal, modelId: 'scripted', usage };
    if ('maxTokens' in outcome) return { kind: 'max_tokens', modelId: 'scripted', usage };
    if ('rawText' in outcome) return { kind: 'text', text: outcome.rawText, modelId: 'scripted', usage };
    if ('error' in outcome) return { kind: 'error', detail: outcome.error, retryable: outcome.retryable ?? false };
    return { kind: 'text', text: JSON.stringify(outcome.output), modelId: 'scripted', usage };
  }
}

export { renderUserText };
