import { isAbsence } from '../../shared/absence.js';
import type { Confirmation, Origin } from '../../shared/facts.js';
import { FIELD_CATALOG } from '../../shared/fields.js';
import { stableStringify } from '../../shared/hash.js';
import { mostRestrictive } from '../../shared/permissions.js';
import type { ClaimSummary, FieldView, StoredClaim } from './types.js';

/**
 * Canonical view computation (04R05 "Assess conflicts by field").
 *
 * "There is no single source ranking that works for every field." The policy
 * comes from the field catalog:
 * - owner_latest: the owner's latest statement is current; lower-authority
 *   statements are kept as alternatives.
 * - planning_latest_statement: a newer student statement is used for planning
 *   while an older documentary assertion is preserved and documentation is
 *   marked pending; a newer document that contradicts a statement is a conflict.
 * - evidence_reconcile: differing values stay in conflict until explicitly
 *   resolved; the system never picks the higher (or lower) value.
 */

const CONFIRMATION_RANK: Record<Confirmation, number> = {
  unreviewed: 1,
  student_confirmed: 2,
  counselor_confirmed: 3,
  issuer_verified: 4,
  human_reviewed: 5,
};

const STATEMENT_TIER: Partial<Record<Origin, number>> = {
  student_statement: 3,
  counselor_statement: 2,
  supporter_statement: 1,
};

const DOCUMENTARY: ReadonlySet<Origin> = new Set(['document_extraction', 'school_feed', 'issuer_report', 'institution_source', 'reviewer_decision']);

export function summarizeClaim(c: StoredClaim): ClaimSummary {
  const s: ClaimSummary = {
    claimId: c.id,
    value: c.value,
    origin: c.origin,
    confirmation: c.confirmation,
    lifecycle: c.lifecycle,
    validity: c.validity,
    dispute: c.dispute,
    recordedAt: c.recordedAt,
    assertedByKind: c.assertedBy.actorKind,
    evidenceKinds: c.evidence.map((e) => e.kind),
    category: c.category,
  };
  if (c.extractionReview) s.extractionReview = c.extractionReview;
  return s;
}

function newest(a: StoredClaim, b: StoredClaim): StoredClaim {
  return b.recordVersion > a.recordVersion ? b : a;
}

function bestSupported(claims: readonly StoredClaim[]): StoredClaim {
  return claims.reduce((best, c) => {
    const rb = CONFIRMATION_RANK[best.confirmation];
    const rc = CONFIRMATION_RANK[c.confirmation];
    if (rc !== rb) return rc > rb ? c : best;
    return newest(best, c);
  });
}

function valueKey(v: unknown): string {
  return stableStringify(v);
}

function candidateMatches(value: unknown, candidates: readonly string[]): boolean {
  const s =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : value && typeof value === 'object' && 'original' in (value as Record<string, unknown>)
        ? String((value as Record<string, unknown>)['original'])
        : stableStringify(value);
  return candidates.some((c) => c.trim() === s.trim());
}

export function computeFieldView(fieldKey: string, claims: readonly StoredClaim[], fieldVersion: number): FieldView | undefined {
  const active = claims.filter((c) => c.status === 'active');
  const any = claims[0];
  if (!any) return undefined;
  const def = FIELD_CATALOG.get(any.catalogKey);
  if (!def) return undefined;
  const view: FieldView = {
    fieldKey,
    field: any.field,
    label: def.label,
    category: active.length > 0 ? mostRestrictive(active.map((c) => c.category)) : def.category,
    consequential: def.consequential,
    state: 'absent',
    alternatives: [],
    conflicting: [],
    documentationPending: false,
    needsConfirmation: false,
    fieldVersion,
  };
  if (any.holder) view.holder = any.holder;
  if (active.length === 0) return view;

  let current: StoredClaim | undefined;
  let conflict: StoredClaim[] = [];
  let documentationPending = false;

  const valueClaims = active.filter((c) => !isAbsence(c.value));
  const absenceClaims = active.filter((c) => isAbsence(c.value));

  if (def.conflictPolicy === 'owner_latest') {
    const pool = valueClaims.length > 0 ? valueClaims : absenceClaims;
    const topTier = Math.max(...pool.map((c) => STATEMENT_TIER[c.origin] ?? 0));
    current = pool.filter((c) => (STATEMENT_TIER[c.origin] ?? 0) === topTier).reduce(newest);
  } else if (def.conflictPolicy === 'planning_latest_statement') {
    const statements = valueClaims.filter((c) => STATEMENT_TIER[c.origin] !== undefined);
    const documents = valueClaims.filter((c) => DOCUMENTARY.has(c.origin) || STATEMENT_TIER[c.origin] === undefined);
    const topTier = statements.length > 0 ? Math.max(...statements.map((c) => STATEMENT_TIER[c.origin]!)) : -1;
    const s = statements.length > 0 ? statements.filter((c) => STATEMENT_TIER[c.origin] === topTier).reduce(newest) : undefined;
    const d = documents.length > 0 ? documents.reduce(newest) : undefined;
    if (s && d) {
      if (valueKey(s.value) === valueKey(d.value)) current = bestSupported([s, d]);
      else if (s.recordVersion > d.recordVersion) {
        current = s;
        documentationPending = true;
      } else conflict = [s, d];
    } else current = s ?? d ?? (absenceClaims.length > 0 ? absenceClaims.reduce(newest) : undefined);
  } else {
    // evidence_reconcile
    if (valueClaims.length === 0) {
      current = absenceClaims.reduce(newest);
    } else {
      const groups = new Map<string, StoredClaim[]>();
      for (const c of valueClaims) {
        const k = valueKey(c.value);
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      if (groups.size === 1) {
        current = bestSupported(valueClaims);
        // An ambiguous extraction whose candidates do not include the value is a real disagreement.
        const contradicted = absenceClaims.some(
          (a) => a.extractionReview?.state === 'ambiguous' && a.extractionReview.candidates.length > 0 && !candidateMatches(current!.value, a.extractionReview.candidates),
        );
        if (contradicted) {
          conflict = [current, ...absenceClaims.filter((a) => a.extractionReview?.state === 'ambiguous')];
          current = undefined;
        }
      } else {
        conflict = [...groups.values()].map((g) => bestSupported(g));
      }
    }
  }

  if (conflict.length > 0) {
    view.state = 'conflict';
    view.conflicting = conflict.map(summarizeClaim);
    view.alternatives = active.filter((c) => !conflict.includes(c)).map(summarizeClaim);
    view.category = mostRestrictive(active.map((c) => c.category));
    view.needsConfirmation = true;
    return view;
  }
  if (!current) return view;
  view.state = 'current';
  view.current = summarizeClaim(current);
  view.category = mostRestrictive([current.category, ...active.map((c) => c.category)]);
  view.alternatives = active.filter((c) => c !== current).map(summarizeClaim);
  view.documentationPending = documentationPending;
  const review = current.extractionReview?.state;
  view.needsConfirmation =
    isAbsence(current.value)
      ? current.extractionReview !== undefined || (current.value as { reason: string }).reason === 'pending_evidence'
      : review === 'ambiguous' || review === 'needs_confirmation' || review === 'unreadable' || (def.consequential && current.confirmation === 'unreviewed' && !DOCUMENTARY.has(current.origin));
  return view;
}

/** Signature used to detect whether a field's canonical view changed. */
export function viewSignature(v: FieldView | undefined): string {
  if (!v) return 'none';
  return stableStringify({
    s: v.state,
    c: v.current?.claimId ?? null,
    x: v.conflicting.map((c) => c.claimId).sort(),
    a: v.alternatives.map((c) => c.claimId).sort(),
    d: v.documentationPending,
  });
}
