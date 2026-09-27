/**
 * Injectable clock. All timestamps are ISO-8601 instants in UTC.
 * Business code must never call `Date.now()` directly so that deadline and
 * freshness logic can be tested deterministically.
 */
export interface Clock {
  /** Current instant as an ISO-8601 UTC string, e.g. 2026-09-27T10:00:00.000Z */
  nowIso(): string;
  /** Current instant in epoch milliseconds. */
  nowMs(): number;
}

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now(),
};

export class FixedClock implements Clock {
  private current: number;

  constructor(isoInstant: string) {
    const ms = Date.parse(isoInstant);
    if (Number.isNaN(ms)) throw new Error(`FixedClock: invalid instant ${isoInstant}`);
    this.current = ms;
  }

  nowIso(): string {
    return new Date(this.current).toISOString();
  }

  nowMs(): number {
    return this.current;
  }

  advanceMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('FixedClock: can only advance forward');
    this.current += ms;
  }

  set(isoInstant: string): void {
    const ms = Date.parse(isoInstant);
    if (Number.isNaN(ms)) throw new Error(`FixedClock: invalid instant ${isoInstant}`);
    this.current = ms;
  }
}
