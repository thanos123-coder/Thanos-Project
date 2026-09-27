import { describeAbsence, isAbsence, type Absence } from '../../shared/absence.js';
import { formatMoney, type Money } from '../../shared/money.js';
import { parsePartialDate } from '../../shared/time.js';
import type { FieldView } from './types.js';

/**
 * Student-facing change explanations (04R10): a concise before-and-after
 * summary, including what downstream advice changed, without database version
 * numbers or internal ids.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatValue(value: unknown): string {
  if (isAbsence(value)) return describeAbsence((value as Absence).reason);
  if (typeof value === 'string') {
    const d = parsePartialDate(value);
    if (d) {
      if (d.precision === 'year') return String(d.year);
      if (d.precision === 'month') return `${MONTHS[d.month! - 1]} ${d.year}`;
      return `${d.day} ${MONTHS[d.month! - 1]} ${d.year}`;
    }
    return value;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map(formatValue).join(', ') || 'none';
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o['amount'] === 'string' && typeof o['currency'] === 'string') return formatMoney(o as unknown as Money);
    if (o['amount'] && typeof o['amount'] === 'object' && 'kind' in o) {
      const m = formatMoney(o['amount'] as Money);
      return `${m}${o['kind'] === 'hard_cap' ? ' maximum' : ' preferred'}`;
    }
    if ('original' in o && 'status' in o) return `${String(o['original'])} (${String(o['status']).replace(/_/g, ' ')})`;
    if ('original' in o && 'normalized' in o) return String(o['original'] ?? o['normalized'] ?? 'not shown');
    for (const k of ['label', 'text', 'name', 'title', 'titleStudentSupplied']) if (typeof o[k] === 'string') return o[k] as string;
    if ('min' in o && 'max' in o) return o['min'] === o['max'] ? `${String(o['min'])}` : `${String(o['min'])}-${String(o['max'])}`;
  }
  return 'updated';
}

export function explainChanges(changes: ReadonlyArray<{ before: FieldView | undefined; after: FieldView | undefined }>, invalidatedCount: number): string {
  const lines: string[] = [];
  for (const { before, after } of changes) {
    const label = after?.label ?? before?.label ?? 'information';
    const cap = label.charAt(0).toUpperCase() + label.slice(1);
    if (after?.state === 'conflict') {
      lines.push(`${cap}: two sources now disagree, so this stays unresolved until it is clarified.`);
      continue;
    }
    const b = before?.current ? formatValue(before.current.value) : undefined;
    const a = after?.current ? formatValue(after.current.value) : undefined;
    if (a === undefined) lines.push(`${cap} was removed.`);
    else if (b === undefined) lines.push(`${cap}: ${a}.`);
    else if (a !== b) lines.push(`${cap}: ${b} → ${a}.`);
    else if (after?.current && before?.current && after.current.confirmation !== before.current.confirmation) lines.push(`${cap}: ${a} (now confirmed).`);
    else lines.push(`${cap}: ${a} (source updated).`);
    if (after?.documentationPending) lines.push(`Updated school documentation for ${label} is still pending.`);
  }
  if (invalidatedCount > 0) lines.push(invalidatedCount === 1 ? 'One earlier result that used this will be refreshed.' : `${invalidatedCount} earlier results that used this will be refreshed.`);
  return lines.join(' ') || 'No visible change.';
}
