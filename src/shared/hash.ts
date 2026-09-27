import { createHash, createHmac } from 'node:crypto';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Keyed fingerprint scoped to one student. Used for duplicate detection inside
 * a student's own storage boundary so that global cross-student deduplication
 * cannot reveal whether another student uploaded the same file (03R02).
 */
export function scopedFingerprint(scopeSecret: string, scopeId: string, data: Uint8Array): string {
  return createHmac('sha256', `${scopeSecret}:${scopeId}`).update(data).digest('hex');
}

/**
 * Deterministic JSON serialization with sorted keys, used for idempotency
 * payload comparison and cache keys.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}
