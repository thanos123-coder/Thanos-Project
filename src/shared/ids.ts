import { randomUUID } from 'node:crypto';

/**
 * Opaque identifier generation.
 *
 * Identifiers are opaque strings with a readable prefix. Names, emails and
 * transcript spellings are never used as keys (spec 04: "Avoids using a name
 * as a database key"). Tests inject a {@link SequentialIdGenerator} so that
 * every run is reproducible.
 */
export interface IdGenerator {
  next(prefix: string): string;
}

export class RandomIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID().replace(/-/g, '')}`;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** True when the value looks like an opaque id produced by this system. */
export function isOpaqueId(value: string): boolean {
  return ID_PATTERN.test(value) && value.length <= 128;
}
