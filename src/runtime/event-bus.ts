import type { Clock } from '../shared/clock.js';
import { DomainEventSchema, type DomainEvent, type EventType } from '../shared/events.js';
import { errorMessage } from '../shared/errors.js';

/**
 * In-process event bus with at-least-once delivery semantics.
 *
 * "Consumers must be idempotent, tolerate duplicate delivery, and reject
 * obsolete work. Out-of-order events require comparing versions, not assuming
 * arrival order equals real-world order. ... The task service should expose a
 * dead-letter or failed-work queue with an accountable operator and a recovery
 * procedure." A production deployment would replace this with a durable queue
 * behind the same interface.
 */

export interface EventConsumer {
  /** Stable consumer name; processed-event bookkeeping is per consumer. */
  name: string;
  types: readonly EventType[] | 'all';
  handle(event: DomainEvent): Promise<void>;
}

export interface DeadLetter {
  consumer: string;
  event: DomainEvent;
  error: string;
  attempts: number;
  failedAt: string;
}

export class EventBus {
  private readonly consumers: EventConsumer[] = [];
  private readonly log: DomainEvent[] = [];
  private readonly processed = new Map<string, Set<string>>();
  private readonly deadLetters: DeadLetter[] = [];
  private readonly queue: DomainEvent[] = [];
  private draining: Promise<void> | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly maxAttempts = 3,
    /** Accountable operator for failed work, recorded on dead letters. */
    readonly deadLetterOwner = 'operations_on_call',
  ) {}

  subscribe(consumer: EventConsumer): void {
    if (this.consumers.some((c) => c.name === consumer.name)) throw new Error(`Consumer already subscribed: ${consumer.name}`);
    this.consumers.push(consumer);
    this.processed.set(consumer.name, new Set());
  }

  /** Enqueue an event for delivery. Validated so that no sensitive payload can travel on the bus. */
  publish(event: DomainEvent): void {
    const parsed = DomainEventSchema.parse(event);
    this.log.push(parsed);
    this.queue.push(parsed);
  }

  /** Re-deliver an already published event (simulates at-least-once redelivery). */
  redeliver(eventId: string): void {
    const e = this.log.find((x) => x.eventId === eventId);
    if (!e) throw new Error(`Unknown event ${eventId}`);
    this.queue.push(e);
  }

  /** Deliver everything queued, including events published by consumers while draining. */
  async drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      try {
        while (this.queue.length > 0) {
          const event = this.queue.shift()!;
          for (const consumer of this.consumers) {
            if (consumer.types !== 'all' && !consumer.types.includes(event.type)) continue;
            const done = this.processed.get(consumer.name)!;
            if (done.has(event.eventId)) continue; // duplicate delivery: no effect
            let attempts = 0;
            let lastError = '';
            let ok = false;
            while (attempts < this.maxAttempts && !ok) {
              attempts += 1;
              try {
                await consumer.handle(event);
                ok = true;
              } catch (e) {
                lastError = errorMessage(e);
              }
            }
            if (ok) done.add(event.eventId);
            else this.deadLetters.push({ consumer: consumer.name, event, error: lastError, attempts, failedAt: this.clock.nowIso() });
          }
        }
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  events(type?: EventType): readonly DomainEvent[] {
    return type ? this.log.filter((e) => e.type === type) : [...this.log];
  }

  deadLetterQueue(): readonly DeadLetter[] {
    return [...this.deadLetters];
  }

  /** Recovery procedure: retry dead letters for a consumer after the cause is fixed. */
  async retryDeadLetters(consumerName: string): Promise<number> {
    const pending = this.deadLetters.filter((d) => d.consumer === consumerName);
    for (const d of pending) this.deadLetters.splice(this.deadLetters.indexOf(d), 1);
    for (const d of pending) this.queue.push(d.event);
    await this.drain();
    return pending.length;
  }
}
