import { isAbsence, type Absence } from '../../shared/absence.js';
import { fieldKey, holderKey, type Holder } from '../../shared/facts.js';
import type { ScopedView } from './service.js';
import type { ClaimSummary, FieldView } from './types.js';

/**
 * Convenience reader over a scoped view. Agents only ever see the fields their
 * role and the acting person are permitted to see; this class adds typed
 * lookups and explicit handling of absence, conflict and confirmation.
 */
export class RecordView {
  private readonly byKey = new Map<string, FieldView>();

  constructor(readonly view: ScopedView) {
    for (const f of view.fields) this.byKey.set(f.fieldKey, f);
  }

  get recordVersion(): number {
    return this.view.recordVersion;
  }

  field(entity: string, entityId: string, attribute: string, holder?: Holder): FieldView | undefined {
    const h = holder && holderKey(holder) !== 'student' ? holder : undefined;
    return this.byKey.get(fieldKey({ entity, entityId, attribute }, h));
  }

  /** Field view by its full field key (entity:id.attribute[@holder]). */
  fieldByKey(key: string): FieldView | undefined {
    return this.byKey.get(key);
  }

  student(attribute: string): FieldView | undefined {
    return this.field('student', 'self', attribute);
  }

  /** Current non-absent value, or undefined when absent, conflicting or not visible. */
  value<T = unknown>(entity: string, entityId: string, attribute: string, holder?: Holder): T | undefined {
    const f = this.field(entity, entityId, attribute, holder);
    if (!f || f.state !== 'current' || !f.current || isAbsence(f.current.value)) return undefined;
    return f.current.value as T;
  }

  studentValue<T = unknown>(attribute: string): T | undefined {
    return this.value<T>('student', 'self', attribute);
  }

  /** The explicit absence recorded for a field, if any. */
  absence(entity: string, entityId: string, attribute: string): Absence | undefined {
    const f = this.field(entity, entityId, attribute);
    if (!f?.current || !isAbsence(f.current.value)) return undefined;
    return f.current.value as Absence;
  }

  /** Distinct entity ids of a type visible in this view. */
  entityIds(entity: string): string[] {
    const ids = new Set<string>();
    for (const f of this.view.fields) if (f.field.entity === entity) ids.add(f.field.entityId);
    return [...ids].sort();
  }

  /** All visible field views for one entity, keyed by attribute (and holder key for holder-scoped fields). */
  entity(entity: string, entityId: string): Map<string, FieldView> {
    const out = new Map<string, FieldView>();
    for (const f of this.view.fields) {
      if (f.field.entity === entity && f.field.entityId === entityId) {
        const h = f.holder ? holderKey(f.holder) : 'student';
        out.set(h === 'student' ? f.field.attribute : `${f.field.attribute}@${h}`, f);
      }
    }
    return out;
  }

  /** All holder variants of a holder-scoped field (e.g. the student's and a parent's stated preference). */
  holderVariants(entity: string, entityId: string, attribute: string): FieldView[] {
    return this.view.fields.filter((f) => f.field.entity === entity && f.field.entityId === entityId && f.field.attribute === attribute);
  }

  /** Current claim summary for a field, if one is selected. */
  current(entity: string, entityId: string, attribute: string): ClaimSummary | undefined {
    const f = this.field(entity, entityId, attribute);
    return f?.state === 'current' ? f.current : undefined;
  }

  /** Claim ids that support the current state of the given fields. */
  supportingClaimIds(fields: ReadonlyArray<FieldView | undefined>): string[] {
    const ids = new Set<string>();
    for (const f of fields) {
      if (!f) continue;
      if (f.current) ids.add(f.current.claimId);
      for (const c of f.conflicting) ids.add(c.claimId);
    }
    return [...ids];
  }

  fields(): readonly FieldView[] {
    return this.view.fields;
  }
}

/** Is the field's current value usable for a consequential decision without further confirmation? */
export function isDecisionReady(f: FieldView | undefined): boolean {
  return !!f && f.state === 'current' && !!f.current && !isAbsence(f.current.value) && !f.needsConfirmation && f.current.dispute === 'none';
}
