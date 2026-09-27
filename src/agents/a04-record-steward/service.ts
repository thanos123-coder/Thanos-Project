import type { AuditLog } from '../../runtime/audit.js';
import { absent, isAbsence } from '../../shared/absence.js';
import type { Clock } from '../../shared/clock.js';
import { ProposedMutationSchema, type ProposedMutationInput } from '../../shared/envelopes.js';
import { AccessDeniedError, SecurityIncidentError } from '../../shared/errors.js';
import type { DomainEvent } from '../../shared/events.js';
import type { EvidenceRef } from '../../shared/evidence.js';
import { catalogKey, fieldKey, type ClaimInputParsed, type Holder } from '../../shared/facts.js';
import { FIELD_CATALOG } from '../../shared/fields.js';
import { sha256Hex, stableStringify } from '../../shared/hash.js';
import type { IdGenerator } from '../../shared/ids.js';
import {
  ROLE_LOCAL_CATEGORIES,
  ROLE_MODEL_CONTEXT_CATEGORIES,
  mostRestrictive,
  type Actor,
  type DataCategory,
  type Purpose,
} from '../../shared/permissions.js';
import { explainChanges } from './explain.js';
import { PermissionService } from './permissions.js';
import type {
  DeletionLedgerEntry,
  DerivativeStore,
  DerivedArtifact,
  FieldView,
  MutationRecord,
  MutationResponse,
  StoredClaim,
  StudentRecordState,
} from './types.js';
import { validateClaim } from './validation.js';
import { computeFieldView, viewSignature } from './views.js';

/**
 * Agent 04 — Student record and evidence steward.
 *
 * The authoritative representation of what is known about the student, where
 * it came from, who may use it and how it changes. "Most of the role should be a
 * conventional data and policy service." Language models never control access,
 * merges or deletion here.
 */

export interface ActingContext {
  /** The person on whose behalf the operation runs. */
  actor: Actor;
  /** Role that processed the input ('02', '03', ...) or 'ui' for direct edits. */
  viaRole: string;
  purpose: Purpose;
  taskId?: string;
}

export interface ReadOptions {
  tenantId: string;
  studentId: string;
  /** The role whose allow-list applies. */
  role: string;
  /** 'model_context' for data that may enter a prompt; 'local' for deterministic evaluation only. */
  mode: 'model_context' | 'local';
  /** Optional narrowing by entity type. */
  entityTypes?: readonly string[];
  /** Optional narrowing by catalog key (entity.attribute). */
  catalogKeys?: readonly string[];
}

export interface ScopedView {
  tenantId: string;
  studentId: string;
  role: string;
  mode: 'model_context' | 'local';
  purpose: Purpose;
  recordVersion: number;
  permissionSnapshot: string;
  fields: FieldView[];
  /** Category names withheld from this view (names only, never content). */
  withheldCategories: DataCategory[];
}

export interface PutDerivedInput {
  tenantId: string;
  studentId: string;
  kind: string;
  scopeKey: string;
  payload: unknown;
  /** Claim ids the artifact was computed from (field keys are derived from them). */
  inputClaimIds: readonly string[];
  /** Additional field keys the artifact depends on even if no claim existed (e.g. an absent course level). */
  inputFieldKeys?: readonly string[];
  ruleVersions?: readonly string[];
  sourceIds?: readonly string[];
  /** Record version the producer read. */
  recordVersion: number;
  /** Minimum category for the artifact (derived data never gets less restrictive than its inputs). */
  categoryFloor?: DataCategory;
}

const studentKey = (tenantId: string, studentId: string): string => `${tenantId}::${studentId}`;

const STATEMENT_ORIGINS = new Set(['student_statement', 'supporter_statement', 'counselor_statement']);

export class RecordService {
  readonly permissions: PermissionService;
  private readonly students = new Map<string, StudentRecordState>();
  private outbox: DomainEvent[] = [];
  private readonly ledger: DeletionLedgerEntry[] = [];
  private readonly derivativeStores: DerivativeStore[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLog,
  ) {
    this.permissions = new PermissionService({ ownerOf: (t, s) => this.ownerOf(t, s) }, clock, ids, audit);
  }

  // ---------------------------------------------------------------- lifecycle

  createStudent(input: { tenantId: string; ownerActorId: string }): string {
    const id = this.ids.next('student');
    this.students.set(studentKey(input.tenantId, id), {
      tenantId: input.tenantId,
      studentId: id,
      ownerActorId: input.ownerActorId,
      lifecycle: 'active',
      recordVersion: 0,
      claims: new Map(),
      claimsByField: new Map(),
      fieldVersions: new Map(),
      changeLog: [],
      mutations: new Map(),
      artifacts: new Map(),
      createdAt: this.clock.nowIso(),
    });
    return id;
  }

  ownerOf(tenantId: string, studentId: string): string | undefined {
    const s = this.students.get(studentKey(tenantId, studentId));
    return s && s.lifecycle === 'active' ? s.ownerActorId : undefined;
  }

  recordVersion(tenantId: string, studentId: string): number | undefined {
    return this.students.get(studentKey(tenantId, studentId))?.recordVersion;
  }

  registerDerivativeStore(store: DerivativeStore): void {
    this.derivativeStores.push(store);
  }

  private state(tenantId: string, studentId: string): StudentRecordState | undefined {
    const s = this.students.get(studentKey(tenantId, studentId));
    return s && s.lifecycle === 'active' ? s : undefined;
  }

  // ---------------------------------------------------------------- reads

  private fieldViewsOf(s: StudentRecordState): FieldView[] {
    const out: FieldView[] = [];
    for (const [key, ids] of s.claimsByField) {
      const claims = ids.map((id) => s.claims.get(id)!).filter((c) => c.status !== 'deleted');
      if (claims.length === 0) continue;
      const v = computeFieldView(key, claims, s.fieldVersions.get(key) ?? 0);
      if (v && (v.state !== 'absent' || v.alternatives.length > 0)) out.push(v);
    }
    return out;
  }

  /**
   * Role-specific view (spec 04 "Retrieval and memory design"). Applies the
   * role allow-list for the mode, then the acting person's current permissions
   * for the purpose, then drops any claim whose category is not permitted.
   */
  readScoped(ctx: ActingContext, opts: ReadOptions): ScopedView {
    const s = this.state(opts.tenantId, opts.studentId);
    if (!s || ctx.actor.tenantId !== opts.tenantId) throw denied();
    const roleCats = new Set<DataCategory>((opts.mode === 'model_context' ? ROLE_MODEL_CONTEXT_CATEGORIES : ROLE_LOCAL_CATEGORIES)[opts.role] ?? []);
    const actorCats = this.permissions.permittedCategories(ctx.actor, opts.tenantId, opts.studentId, ctx.purpose, 'read');
    if (actorCats.size === 0) throw denied();
    const allowed = new Set([...roleCats].filter((c) => actorCats.has(c)));
    const withheld = new Set<DataCategory>();
    const fields: FieldView[] = [];
    for (const v of this.fieldViewsOf(s)) {
      if (opts.entityTypes && !opts.entityTypes.includes(v.field.entity)) continue;
      if (opts.catalogKeys && !opts.catalogKeys.includes(catalogKey(v.field))) continue;
      // A field is shown only when every claim that determines its state is permitted;
      // otherwise even the existence of a conflict could leak restricted content.
      const shown = [...(v.current ? [v.current] : []), ...v.conflicting];
      const blocked = shown.find((c) => !allowed.has(c.category));
      if (blocked) {
        withheld.add(blocked.category);
        continue;
      }
      fields.push({ ...v, alternatives: v.alternatives.filter((a) => allowed.has(a.category)) });
    }
    return {
      tenantId: opts.tenantId,
      studentId: opts.studentId,
      role: opts.role,
      mode: opts.mode,
      purpose: ctx.purpose,
      recordVersion: s.recordVersion,
      permissionSnapshot: this.permissions.snapshot(ctx.actor, opts.tenantId, opts.studentId),
      fields,
      withheldCategories: [...withheld],
    };
  }

  /** Every claim id present in a view (current, conflicting and alternatives). */
  static claimIdsOf(view: ScopedView): string[] {
    const ids = new Set<string>();
    for (const f of view.fields) {
      if (f.current) ids.add(f.current.claimId);
      for (const c of f.conflicting) ids.add(c.claimId);
      for (const c of f.alternatives) ids.add(c.claimId);
    }
    return [...ids];
  }

  /** Full claim, for the owner's inspection interface ("Why do you think that about me?"). */
  getClaim(ctx: ActingContext, tenantId: string, studentId: string, claimId: string): StoredClaim | undefined {
    const s = this.state(tenantId, studentId);
    if (!s) return undefined;
    const c = s.claims.get(claimId);
    if (!c || c.status === 'deleted') return undefined;
    const d = this.permissions.authorize({ actor: ctx.actor, tenantId, studentId, category: c.category, access: 'read', purpose: ctx.purpose });
    return d.allowed ? structuredClone(c) : undefined;
  }

  /** Claim history for a field instance, oldest first (superseded claims included, deleted ones excluded). */
  history(ctx: ActingContext, tenantId: string, studentId: string, key: string): StoredClaim[] {
    const s = this.state(tenantId, studentId);
    if (!s) return [];
    return (s.claimsByField.get(key) ?? [])
      .map((id) => s.claims.get(id)!)
      .filter((c) => c.status !== 'deleted' && this.permissions.authorize({ actor: ctx.actor, tenantId, studentId, category: c.category, access: 'read', purpose: ctx.purpose }).allowed)
      .map((c) => structuredClone(c));
  }

  // ---------------------------------------------------------------- mutations

  /**
   * Apply a proposed mutation (04R01-04R10). Returns accepted, rejected,
   * conflict (stale version) or requires_review, without ever returning the
   * complete private record to the caller.
   */
  applyMutation(ctx: ActingContext, tenantId: string, studentId: string, input: ProposedMutationInput): MutationResponse {
    const empty = (outcome: MutationResponse['outcome'], mutationId: string, reasons: string[]): MutationResponse => ({
      outcome,
      mutationId,
      changedFieldKeys: [],
      createdClaimIds: [],
      supersededClaimIds: [],
      invalidatedArtifactIds: [],
      reasons,
      studentSummary: outcome === 'rejected' ? 'Nothing was changed.' : outcome === 'conflict' ? 'The record changed while this was being prepared; please review the latest version.' : 'This change needs review before it can be applied.',
    });

    // 04R01 Authenticate the request.
    const s = this.state(tenantId, studentId);
    if (!s || ctx.actor.tenantId !== tenantId) {
      this.audit.record({ kind: 'mutation_rejected', actorId: ctx.actor.id, tenantId, name: 'mutation', outcome: 'not_found_or_denied' });
      return empty('rejected', String((input as { mutationId?: unknown }).mutationId ?? 'unknown'), ['not_found_or_denied']);
    }
    if (ctx.actor.kind === 'agent') return empty('rejected', String((input as { mutationId?: unknown }).mutationId ?? 'unknown'), ['agents act on behalf of a person; no personal actor was supplied']);
    const parsedMutation = ProposedMutationSchema.safeParse(input);
    if (!parsedMutation.success) return empty('rejected', String((input as { mutationId?: unknown }).mutationId ?? 'unknown'), parsedMutation.error.issues.map((i) => `mutation.${i.path.join('.')}: ${i.message}`));
    const m = parsedMutation.data;
    const snapshot = this.permissions.snapshot(ctx.actor, tenantId, studentId);

    // 04R03 Idempotency.
    const payloadHash = sha256Hex(stableStringify({ op: m.operation, claims: m.claims, targets: m.targetClaimIds, expected: m.expectedRecordVersion }));
    const prior = s.mutations.get(m.mutationId);
    if (prior) {
      if (prior.payloadHash === payloadHash && (prior.response.outcome !== 'rejected' || prior.permissionSnapshot === snapshot)) return structuredClone(prior.response);
      if (prior.response.outcome === 'accepted' || prior.response.outcome === 'requires_review') {
        return empty('rejected', m.mutationId, ['idempotency_key_reused: this mutation id was already used for different content']);
      }
      // A previously rejected mutation may be re-evaluated when its input or authorization changed.
    }

    const finish = (response: MutationResponse): MutationResponse => {
      s.mutations.set(m.mutationId, { mutationId: m.mutationId, payloadHash, actorId: ctx.actor.id, permissionSnapshot: snapshot, response: structuredClone(response) });
      this.audit.record({ kind: response.outcome === 'accepted' ? 'mutation' : 'mutation_rejected', taskId: ctx.taskId, role: ctx.viaRole, actorId: ctx.actor.id, tenantId, studentId, name: m.operation, outcome: response.outcome });
      return response;
    };

    // 04R02 / 04R06 Validate structure and semantics of every claim.
    const validated: Array<{ claim: ClaimInputParsed; category: DataCategory; key: string }> = [];
    const issues: string[] = [];
    for (const [i, raw] of m.claims.entries()) {
      const v = validateClaim(raw, ctx.actor, ctx.viaRole);
      if (!v.ok) {
        issues.push(...v.issues.map((x) => `claims[${i}]: ${x}`));
        continue;
      }
      const def = v.definition!;
      const key = fieldKey(v.claim!.field, def.holderScoped ? (v.claim!.holder ?? { kind: 'student' }) : undefined);
      // Write permission for the category.
      const d = this.permissions.authorize({ actor: ctx.actor, tenantId, studentId, category: v.category!, access: 'write', purpose: ctx.purpose });
      if (!d.allowed) {
        issues.push(`claims[${i}]: not permitted to write this information`);
        continue;
      }
      validated.push({ claim: v.claim!, category: v.category!, key });
    }
    if (m.operation === 'confirm_claim' || m.operation === 'resolve_conflict') {
      for (const [i, v] of validated.entries()) if (v.claim.supersedes.length === 0) issues.push(`claims[${i}]: ${m.operation} must name the claim(s) it confirms or resolves`);
    }
    if ((m.operation === 'add_claims' || m.operation === 'confirm_claim' || m.operation === 'resolve_conflict') && m.claims.length === 0) issues.push('no claims supplied');
    if (m.operation === 'retract_claim' && m.targetClaimIds.length === 0) issues.push('no claims to retract');
    if (issues.length > 0) return finish(empty('rejected', m.mutationId, issues));

    // Targets for supersession/retraction must exist, be active and belong to this student.
    const targetIds = new Set<string>([...m.targetClaimIds, ...validated.flatMap((v) => v.claim.supersedes)]);
    for (const id of targetIds) {
      const t = s.claims.get(id);
      if (!t || t.status !== 'active') return finish(empty('rejected', m.mutationId, [`claim ${id} is not an active claim in this record`]));
      const dd = this.permissions.authorize({ actor: ctx.actor, tenantId, studentId, category: t.category, access: 'write', purpose: ctx.purpose });
      if (!dd.allowed) return finish(empty('rejected', m.mutationId, ['not permitted to change this information']));
    }
    for (const v of validated) {
      for (const id of v.claim.supersedes) {
        if (s.claims.get(id)!.fieldKey !== v.key) return finish(empty('rejected', m.mutationId, [`claim ${id} belongs to a different field than the claim superseding it`]));
      }
    }
    if (m.operation === 'retract_claim') {
      for (const id of m.targetClaimIds) {
        const t = s.claims.get(id)!;
        const ownStatement = t.assertedBy.actorId === ctx.actor.id || ctx.actor.id === s.ownerActorId;
        if (!ownStatement) return finish(empty('rejected', m.mutationId, ['only the person who made a statement, or the student, can retract it']));
      }
    }

    // 04R04 Compare versions; rebase only independent changes.
    if (m.expectedRecordVersion > s.recordVersion) return finish(empty('rejected', m.mutationId, ['expected version is newer than the record']));
    if (m.expectedRecordVersion < s.recordVersion) {
      const touched = new Set([...validated.map((v) => v.key), ...[...targetIds].map((id) => s.claims.get(id)!.fieldKey)]);
      const groupsTouched = new Set([...touched].map((k) => jointGroupOf(k, s)).filter((g): g is string => g !== undefined));
      const conflicting = s.changeLog
        .filter((e) => e.recordVersion > m.expectedRecordVersion)
        .flatMap((e) => e.changedFieldKeys)
        .filter((k) => touched.has(k) || (jointGroupOf(k, s) !== undefined && groupsTouched.has(jointGroupOf(k, s)!)));
      if (conflicting.length > 0) {
        return finish({ ...empty('conflict', m.mutationId, [`fields changed since version ${m.expectedRecordVersion}; revalidate against version ${s.recordVersion}`]), changedFieldKeys: [...new Set(conflicting)] });
      }
    }

    // 04R05 Consequential overrides of stronger evidence require review.
    for (const v of validated) {
      for (const id of v.claim.supersedes) {
        const t = s.claims.get(id)!;
        const strongerTarget = ['issuer_verified', 'human_reviewed', 'counselor_confirmed'].includes(t.confirmation);
        const weakerNew = STATEMENT_ORIGINS.has(v.claim.origin) && !['human_reviewed', 'counselor_confirmed'].includes(v.claim.confirmation);
        const def = FIELD_CATALOG.get(t.catalogKey)!;
        if (def.consequential && strongerTarget && weakerNew) {
          return finish(empty('requires_review', m.mutationId, [`replacing a ${t.confirmation.replace('_', ' ')} value needs updated documentation or a qualified reviewer`]));
        }
      }
      if (m.operation === 'resolve_conflict') {
        const def = FIELD_CATALOG.get(catalogKey(v.claim.field))!;
        const hasStrongEvidence = v.claim.evidence.some((e) => e.kind === 'document_anchor' || e.kind === 'human_review') || ['issuer_report', 'school_feed', 'reviewer_decision'].includes(v.claim.origin);
        if (def.conflictPolicy === 'evidence_reconcile' && !hasStrongEvidence) {
          return finish(empty('requires_review', m.mutationId, ['this conflict can only be resolved with corrected documentation or a qualified reviewer']));
        }
      }
    }

    // 04R08 Commit atomically (no awaits below this line).
    const before = new Map<string, string>();
    const affectedKeys = new Set<string>([...validated.map((v) => v.key), ...[...targetIds].map((id) => s.claims.get(id)!.fieldKey)]);
    for (const k of affectedKeys) before.set(k, viewSignature(this.viewOfKey(s, k)));
    const beforeViews = new Map<string, FieldView | undefined>([...affectedKeys].map((k) => [k, this.viewOfKey(s, k)]));

    const newVersion = s.recordVersion + 1;
    const now = this.clock.nowIso();
    const created: string[] = [];
    const superseded: string[] = [];

    if (m.operation === 'retract_claim') {
      for (const id of m.targetClaimIds) {
        const t = s.claims.get(id)!;
        t.status = 'retracted';
        t.statusChangedAt = now;
        t.statusReason = m.reason;
        superseded.push(id);
      }
    }
    for (const v of validated) {
      const def = FIELD_CATALOG.get(catalogKey(v.claim.field))!;
      const holder: Holder | undefined = def.holderScoped ? (v.claim.holder ?? { kind: 'student' }) : undefined;
      const claim: StoredClaim = {
        id: this.ids.next('claim'),
        tenantId,
        studentId,
        field: v.claim.field,
        fieldKey: v.key,
        catalogKey: catalogKey(v.claim.field),
        value: v.claim.value,
        origin: v.claim.origin,
        confirmation: v.claim.confirmation,
        lifecycle: v.claim.lifecycle,
        validity: v.claim.validity,
        dispute: v.claim.dispute,
        evidence: v.claim.evidence,
        assertedBy: v.claim.assertedBy,
        category: v.category,
        recordedAt: now,
        recordVersion: newVersion,
        mutationId: m.mutationId,
        status: 'active',
        supersedes: [...v.claim.supersedes],
      };
      if (holder) claim.holder = holder;
      if (v.claim.extractionReview) claim.extractionReview = v.claim.extractionReview;
      // Explicit supersession.
      for (const id of v.claim.supersedes) {
        const t = s.claims.get(id)!;
        if (t.status === 'active') {
          t.status = 'superseded';
          t.supersededBy = claim.id;
          t.statusChangedAt = now;
          t.statusReason = m.reason;
          superseded.push(id);
        }
      }
      // Automatic supersession of the same source's earlier assertion (same speaker, or a newer version of the same document).
      for (const id of s.claimsByField.get(v.key) ?? []) {
        const t = s.claims.get(id)!;
        if (t.status === 'active' && sameSourceClass(t, claim)) {
          t.status = 'superseded';
          t.supersededBy = claim.id;
          t.statusChangedAt = now;
          t.statusReason = 'replaced by a newer statement from the same source';
          superseded.push(id);
        }
      }
      s.claims.set(claim.id, claim);
      s.claimsByField.set(v.key, [...(s.claimsByField.get(v.key) ?? []), claim.id]);
      created.push(claim.id);
    }

    const changedKeys: string[] = [];
    for (const k of affectedKeys) {
      const after = viewSignature(this.viewOfKey(s, k));
      if (after !== before.get(k)) {
        changedKeys.push(k);
        s.fieldVersions.set(k, (s.fieldVersions.get(k) ?? 0) + 1);
      }
    }
    s.recordVersion = newVersion;
    s.changeLog.push({ recordVersion: newVersion, mutationId: m.mutationId, changedFieldKeys: changedKeys });

    // 04R09 Invalidate dependencies (field-level; unrelated artifacts untouched).
    const invalidated = this.invalidateArtifacts(s, changedKeys, `input changed by ${m.mutationId}`);

    // Outbox: events carry references only.
    for (const k of changedKeys) {
      const v = this.viewOfKey(s, k);
      const prev = beforeViews.get(k);
      this.outbox.push({
        eventId: this.ids.next('event'),
        type: 'student_fact.changed',
        tenantId,
        studentId,
        entityRef: k,
        oldVersion: prev?.fieldVersion ?? 0,
        newVersion: s.fieldVersions.get(k) ?? 0,
        changedFields: [k],
        recordVersion: newVersion,
        causeRef: m.mutationId,
        occurredAt: now,
        sensitivePayloadIncluded: false,
      });
      if (v?.state === 'conflict' && prev?.state !== 'conflict') {
        this.outbox.push({ eventId: this.ids.next('event'), type: 'conflict.opened', tenantId, studentId, entityRef: k, changedFields: [k], recordVersion: newVersion, causeRef: m.mutationId, occurredAt: now, sensitivePayloadIncluded: false });
      }
      if (prev?.state === 'conflict' && v?.state !== 'conflict') {
        this.outbox.push({ eventId: this.ids.next('event'), type: 'conflict.resolved', tenantId, studentId, entityRef: k, changedFields: [k], recordVersion: newVersion, causeRef: m.mutationId, occurredAt: now, sensitivePayloadIncluded: false });
      }
    }

    // 04R10 Explain the change.
    const afterViews = new Map(changedKeys.map((k) => [k, this.viewOfKey(s, k)]));
    const response: MutationResponse = {
      outcome: 'accepted',
      mutationId: m.mutationId,
      recordVersion: newVersion,
      changedFieldKeys: changedKeys,
      createdClaimIds: created,
      supersededClaimIds: superseded,
      invalidatedArtifactIds: invalidated,
      reasons: [],
      studentSummary: explainChanges(changedKeys.map((k) => ({ before: beforeViews.get(k), after: afterViews.get(k) })), invalidated.length),
    };
    return finish(response);
  }

  private viewOfKey(s: StudentRecordState, key: string): FieldView | undefined {
    const claims = (s.claimsByField.get(key) ?? []).map((id) => s.claims.get(id)!).filter((c) => c.status !== 'deleted');
    if (claims.length === 0) return undefined;
    return computeFieldView(key, claims, s.fieldVersions.get(key) ?? 0);
  }

  /** Field view for one key, permission-checked. */
  fieldView(ctx: ActingContext, tenantId: string, studentId: string, key: string): FieldView | undefined {
    const s = this.state(tenantId, studentId);
    if (!s) return undefined;
    const v = this.viewOfKey(s, key);
    if (!v) return undefined;
    const d = this.permissions.authorize({ actor: ctx.actor, tenantId, studentId, category: v.category, access: 'read', purpose: ctx.purpose });
    return d.allowed ? v : undefined;
  }

  // ---------------------------------------------------------------- derived artifacts

  putDerived(ctx: ActingContext, input: PutDerivedInput): DerivedArtifact {
    const s = this.state(input.tenantId, input.studentId);
    if (!s || ctx.actor.tenantId !== input.tenantId) throw denied();
    const inputClaims = input.inputClaimIds.map((id) => s.claims.get(id));
    if (inputClaims.some((c) => c === undefined)) {
      // An input claim that does not belong to this student is a security incident, not a normal error.
      throw new SecurityIncidentError('cross_student', 'A derived artifact referenced a claim outside this student record');
    }
    const claims = inputClaims as StoredClaim[];
    if (claims.some((c) => c.status === 'deleted')) {
      // Deleted evidence must never be reconstructed into a new recommendation (scenario six).
      throw new AccessDeniedError('not_found_or_denied', 'An input of this result was deleted; the result must be regenerated from remaining facts');
    }
    const fieldKeys = [...new Set([...claims.map((c) => c.fieldKey), ...(input.inputFieldKeys ?? [])])];
    const category = mostRestrictive([...claims.map((c) => c.category), input.categoryFloor ?? 'findings']);
    const now = this.clock.nowIso();
    // Stale on arrival if inputs changed after the producer read them (01T06) or were deleted/superseded.
    const changedSince = s.changeLog.filter((e) => e.recordVersion > input.recordVersion).flatMap((e) => e.changedFieldKeys);
    const stale = claims.some((c) => c.status !== 'active') || changedSince.some((k) => fieldKeys.some((pattern) => fieldKeyMatches(pattern, k)));
    const artifact: DerivedArtifact = {
      id: this.ids.next('artifact'),
      tenantId: input.tenantId,
      studentId: input.studentId,
      kind: input.kind,
      producedByRole: ctx.viaRole,
      scopeKey: input.scopeKey,
      payload: structuredClone(input.payload),
      inputs: { fieldKeys, claimIds: [...input.inputClaimIds], ruleVersions: [...(input.ruleVersions ?? [])], sourceIds: [...(input.sourceIds ?? [])] },
      recordVersion: input.recordVersion,
      category,
      status: stale ? 'stale' : 'current',
      createdAt: now,
      updatedAt: now,
    };
    if (stale) artifact.statusReason = 'inputs changed while this was being prepared';
    if (!stale) {
      for (const a of s.artifacts.values()) {
        if (a.kind === input.kind && a.scopeKey === input.scopeKey && (a.status === 'current' || a.status === 'stale')) {
          a.status = 'superseded';
          a.statusReason = `superseded by ${artifact.id}`;
          a.updatedAt = now;
        }
      }
    }
    s.artifacts.set(artifact.id, artifact);
    return structuredClone(artifact);
  }

  getArtifact(ctx: ActingContext, tenantId: string, studentId: string, artifactId: string): DerivedArtifact | undefined {
    const s = this.state(tenantId, studentId);
    const a = s?.artifacts.get(artifactId);
    if (!a || a.status === 'deleted') return undefined;
    const d = this.permissions.authorize({ actor: ctx.actor, tenantId, studentId, category: a.category, access: 'read', purpose: ctx.purpose });
    return d.allowed ? structuredClone(a) : undefined;
  }

  listArtifacts(ctx: ActingContext, tenantId: string, studentId: string, filter: { kind?: string; status?: DerivedArtifact['status'] } = {}): DerivedArtifact[] {
    const s = this.state(tenantId, studentId);
    if (!s) return [];
    return [...s.artifacts.values()]
      .filter((a) => a.status !== 'deleted' && (filter.kind === undefined || a.kind === filter.kind) && (filter.status === undefined || a.status === filter.status))
      .filter((a) => this.permissions.authorize({ actor: ctx.actor, tenantId, studentId, category: a.category, access: 'read', purpose: ctx.purpose }).allowed)
      .map((a) => structuredClone(a));
  }

  /** Mark artifacts depending on a rule or source version stale (source-change events). */
  invalidateByRuleOrSource(tenantId: string, studentId: string, ref: { ruleVersion?: string; sourceId?: string }, reason: string): string[] {
    const s = this.state(tenantId, studentId);
    if (!s) return [];
    const out: string[] = [];
    for (const a of s.artifacts.values()) {
      if (a.status !== 'current') continue;
      if ((ref.ruleVersion && a.inputs.ruleVersions.includes(ref.ruleVersion)) || (ref.sourceId && a.inputs.sourceIds.includes(ref.sourceId))) {
        a.status = 'stale';
        a.statusReason = reason;
        a.updatedAt = this.clock.nowIso();
        out.push(a.id);
      }
    }
    this.emitInvalidations(s, out, reason);
    return out;
  }

  private invalidateArtifacts(s: StudentRecordState, changedKeys: readonly string[], reason: string): string[] {
    if (changedKeys.length === 0) return [];
    const out: string[] = [];
    for (const a of s.artifacts.values()) {
      if (a.status !== 'current') continue;
      if (a.inputs.fieldKeys.some((pattern) => changedKeys.some((k) => fieldKeyMatches(pattern, k)))) {
        a.status = 'stale';
        a.statusReason = reason;
        a.updatedAt = this.clock.nowIso();
        out.push(a.id);
      }
    }
    this.emitInvalidations(s, out, reason);
    return out;
  }

  private emitInvalidations(s: StudentRecordState, ids: readonly string[], reason: string): void {
    for (const id of ids) {
      this.outbox.push({ eventId: this.ids.next('event'), type: 'derived_artifact.invalidated', tenantId: s.tenantId, studentId: s.studentId, entityRef: id, changedFields: [], recordVersion: s.recordVersion, causeRef: reason.slice(0, 120), occurredAt: this.clock.nowIso(), sensitivePayloadIncluded: false });
    }
  }

  // ---------------------------------------------------------------- deletion

  /** Delete one fact (and everything derived from it under this service's control). */
  async deleteClaim(ctx: ActingContext, tenantId: string, studentId: string, claimId: string): Promise<{ deletedClaims: number; deletedArtifacts: number }> {
    const s = this.state(tenantId, studentId);
    const c = s?.claims.get(claimId);
    if (!s || !c || c.status === 'deleted') throw denied();
    this.requireDelete(ctx, tenantId, studentId, c.category);
    const result = this.purgeClaims(s, [claimId]);
    const notified: string[] = [];
    for (const store of this.derivativeStores) {
      await store.purgeByClaims(tenantId, studentId, [claimId]);
      notified.push(store.name);
    }
    this.recordLedger(tenantId, studentId, 'claim', [claimId, ...result.artifactIds], notified);
    return { deletedClaims: 1, deletedArtifacts: result.artifactIds.length };
  }

  /**
   * Delete a document and every claim supported only by it; claims with other
   * evidence keep only that other evidence. Derived artifacts, OCR output,
   * crops, embeddings and caches registered as derivative stores are purged.
   */
  async deleteDocument(ctx: ActingContext, tenantId: string, studentId: string, documentId: string): Promise<{ deletedClaims: number; deletedArtifacts: number; processorsNotified: string[] }> {
    const s = this.state(tenantId, studentId);
    if (!s) throw denied();
    this.requireDelete(ctx, tenantId, studentId, 'documents_raw');
    const toDelete: string[] = [];
    for (const c of s.claims.values()) {
      if (c.status === 'deleted') continue;
      const fromDoc = c.evidence.filter((e) => e.kind === 'document_anchor' && e.documentId === documentId);
      if (fromDoc.length === 0) continue;
      const other = c.evidence.filter((e) => !(e.kind === 'document_anchor' && e.documentId === documentId));
      if (other.length === 0 || c.origin === 'document_extraction') toDelete.push(c.id);
      else c.evidence = other;
    }
    const result = this.purgeClaims(s, toDelete);
    const notified: string[] = [];
    for (const store of this.derivativeStores) {
      await store.purgeByDocument(tenantId, studentId, documentId);
      await store.purgeByClaims(tenantId, studentId, toDelete);
      notified.push(store.name);
    }
    this.outbox.push({ eventId: this.ids.next('event'), type: 'document.deleted', tenantId, studentId, entityRef: documentId, changedFields: result.changedKeys, recordVersion: s.recordVersion, causeRef: `deletion:${documentId}`, occurredAt: this.clock.nowIso(), sensitivePayloadIncluded: false });
    this.recordLedger(tenantId, studentId, 'document', [documentId, ...toDelete, ...result.artifactIds], notified);
    return { deletedClaims: toDelete.length, deletedArtifacts: result.artifactIds.length, processorsNotified: notified };
  }

  async deleteAccount(ctx: ActingContext, tenantId: string, studentId: string): Promise<{ processorsNotified: string[] }> {
    const s = this.state(tenantId, studentId);
    if (!s) throw denied();
    if (ctx.actor.kind !== 'student' || ctx.actor.id !== s.ownerActorId) throw denied();
    const notified: string[] = [];
    for (const store of this.derivativeStores) {
      await store.purgeByStudent(tenantId, studentId);
      notified.push(store.name);
    }
    for (const g of this.permissions.listGrants(tenantId, studentId)) if (!g.revokedAt) this.permissions.revoke(ctx.actor, g.id);
    s.claims.clear();
    s.claimsByField.clear();
    s.artifacts.clear();
    s.mutations.clear();
    s.changeLog = [];
    s.lifecycle = 'deleted';
    this.outbox.push({ eventId: this.ids.next('event'), type: 'deletion.completed', tenantId, studentId, changedFields: [], causeRef: 'account_deletion', occurredAt: this.clock.nowIso(), sensitivePayloadIncluded: false });
    this.recordLedger(tenantId, studentId, 'account', [studentId], notified);
    return { processorsNotified: notified };
  }

  private requireDelete(ctx: ActingContext, tenantId: string, studentId: string, category: DataCategory): void {
    const d = this.permissions.authorize({ actor: ctx.actor, tenantId, studentId, category, access: 'delete', purpose: 'deletion' });
    if (!d.allowed) throw denied();
  }

  private purgeClaims(s: StudentRecordState, claimIds: readonly string[]): { changedKeys: string[]; artifactIds: string[] } {
    const now = this.clock.nowIso();
    const keys = new Set<string>();
    const beforeSig = new Map<string, string>();
    for (const id of claimIds) {
      const c = s.claims.get(id);
      if (c) beforeSig.set(c.fieldKey, viewSignature(this.viewOfKey(s, c.fieldKey)));
    }
    for (const id of claimIds) {
      const c = s.claims.get(id);
      if (!c) continue;
      keys.add(c.fieldKey);
      c.status = 'deleted';
      c.value = absent('unknown');
      c.evidence = [];
      c.validity = {};
      delete c.extractionReview;
      c.statusChangedAt = now;
      c.statusReason = 'deleted';
      // A claim that superseded nothing leaves no trace of the value; a superseded predecessor stays superseded.
    }
    const artifactIds: string[] = [];
    for (const a of s.artifacts.values()) {
      if (a.status === 'deleted') continue;
      if (a.inputs.claimIds.some((id) => claimIds.includes(id))) {
        a.status = 'deleted';
        a.payload = null;
        a.statusReason = 'an input was deleted';
        a.updatedAt = now;
        artifactIds.push(a.id);
      }
    }
    const changedKeys: string[] = [];
    for (const k of keys) {
      if (viewSignature(this.viewOfKey(s, k)) !== beforeSig.get(k)) {
        changedKeys.push(k);
        s.fieldVersions.set(k, (s.fieldVersions.get(k) ?? 0) + 1);
      }
    }
    s.recordVersion += 1;
    s.changeLog.push({ recordVersion: s.recordVersion, mutationId: `deletion_${s.recordVersion}`, changedFieldKeys: changedKeys });
    // Other artifacts depending on changed fields become stale.
    this.invalidateArtifacts(s, changedKeys, 'an input was deleted');
    for (const k of changedKeys) {
      this.outbox.push({ eventId: this.ids.next('event'), type: 'student_fact.deleted', tenantId: s.tenantId, studentId: s.studentId, entityRef: k, changedFields: [k], recordVersion: s.recordVersion, causeRef: 'deletion', occurredAt: now, sensitivePayloadIncluded: false });
    }
    for (const id of artifactIds) {
      this.outbox.push({ eventId: this.ids.next('event'), type: 'derived_artifact.deleted', tenantId: s.tenantId, studentId: s.studentId, entityRef: id, changedFields: [], recordVersion: s.recordVersion, causeRef: 'deletion', occurredAt: now, sensitivePayloadIncluded: false });
    }
    return { changedKeys, artifactIds };
  }

  private recordLedger(tenantId: string, studentId: string, scope: DeletionLedgerEntry['scope'], targets: readonly string[], processors: readonly string[]): void {
    const now = this.clock.nowIso();
    this.ledger.push({
      id: this.ids.next('deletion'),
      tenantId,
      studentRefHash: refHash(tenantId, studentId, studentId),
      scope,
      targetRefHashes: targets.map((t) => refHash(tenantId, studentId, t)),
      requestedAt: now,
      completedAt: now,
      processorsNotified: [...processors],
    });
    this.audit.record({ kind: 'deletion', tenantId, name: scope, outcome: `completed:${targets.length}` });
  }

  deletionLedger(): readonly DeletionLedgerEntry[] {
    return structuredClone(this.ledger);
  }

  // ---------------------------------------------------------------- backup / restore

  /** Backup snapshot of record state (ledger is kept separately so it survives restores). */
  exportBackup(): string {
    const students = [...this.students.values()].map((s) => ({
      ...s,
      claims: [...s.claims.entries()],
      claimsByField: [...s.claimsByField.entries()],
      fieldVersions: [...s.fieldVersions.entries()],
      mutations: [...s.mutations.entries()],
      artifacts: [...s.artifacts.entries()],
    }));
    return JSON.stringify(students);
  }

  /**
   * Restore from a backup, then re-apply the deletion ledger before the data
   * becomes active, so deleted content never resurrects (04T09).
   */
  restoreBackup(serialized: string): { reapplied: number } {
    const parsed = JSON.parse(serialized) as Array<Record<string, unknown>>;
    this.students.clear();
    for (const raw of parsed) {
      const s: StudentRecordState = {
        ...(raw as unknown as StudentRecordState),
        claims: new Map(raw['claims'] as Array<[string, StoredClaim]>),
        claimsByField: new Map(raw['claimsByField'] as Array<[string, string[]]>),
        fieldVersions: new Map(raw['fieldVersions'] as Array<[string, number]>),
        mutations: new Map(raw['mutations'] as Array<[string, MutationRecord]>),
        artifacts: new Map(raw['artifacts'] as Array<[string, DerivedArtifact]>),
      };
      this.students.set(studentKey(s.tenantId, s.studentId), s);
    }
    let reapplied = 0;
    for (const entry of this.ledger) {
      for (const s of this.students.values()) {
        if (s.tenantId !== entry.tenantId || refHash(s.tenantId, s.studentId, s.studentId) !== entry.studentRefHash) continue;
        if (entry.scope === 'account') {
          s.claims.clear();
          s.claimsByField.clear();
          s.artifacts.clear();
          s.mutations.clear();
          s.lifecycle = 'deleted';
          reapplied += 1;
          continue;
        }
        const targets = new Set(entry.targetRefHashes);
        const claimIds = [...s.claims.values()].filter((c) => c.status !== 'deleted' && targets.has(refHash(s.tenantId, s.studentId, c.id))).map((c) => c.id);
        const docTargets = [...s.claims.values()].filter((c) => c.status !== 'deleted' && c.evidence.some((e) => e.kind === 'document_anchor' && targets.has(refHash(s.tenantId, s.studentId, e.documentId)))).map((c) => c.id);
        const all = [...new Set([...claimIds, ...docTargets])];
        if (all.length > 0) {
          this.purgeClaims(s, all);
          reapplied += all.length;
        }
        for (const a of s.artifacts.values()) {
          if (a.status !== 'deleted' && targets.has(refHash(s.tenantId, s.studentId, a.id))) {
            a.status = 'deleted';
            a.payload = null;
            reapplied += 1;
          }
        }
      }
    }
    // Events from a restore are internal; downstream caches are rebuilt from the restored state.
    this.outbox = [];
    return { reapplied };
  }

  // ---------------------------------------------------------------- events

  /** Take pending outbox events for dispatch. Commit and event creation happen together. */
  takeOutbox(): DomainEvent[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  // ---------------------------------------------------------------- export (student rights)

  /** Export everything the student can see about themselves, with provenance. */
  exportForStudent(ctx: ActingContext, tenantId: string, studentId: string): { recordVersion: number; claims: Array<Omit<StoredClaim, 'tenantId'>> } {
    const s = this.state(tenantId, studentId);
    if (!s || ctx.actor.kind !== 'student' || ctx.actor.id !== s.ownerActorId) throw denied();
    const claims = [...s.claims.values()].filter((c) => c.status !== 'deleted').map(({ tenantId: _t, ...rest }) => structuredClone(rest));
    return { recordVersion: s.recordVersion, claims };
  }

  /** Evidence descriptions supporting a field's current value ("Why do you think that about me?"). */
  whyDoYouThink(ctx: ActingContext, tenantId: string, studentId: string, key: string): EvidenceRef[] {
    const v = this.fieldView(ctx, tenantId, studentId, key);
    if (!v?.current) return [];
    const c = this.getClaim(ctx, tenantId, studentId, v.current.claimId);
    return c ? c.evidence : [];
  }
}

/**
 * Match a dependency pattern against a concrete field key. A pattern may use
 * `*` as the entity id (e.g. `test_attempt:*.record`) so that a result which
 * depended on the *absence* of any such entity is invalidated when one appears.
 */
export function fieldKeyMatches(pattern: string, key: string): boolean {
  if (pattern === key) return true;
  if (!pattern.includes(':*.')) return false;
  const [pEntity, pRest] = pattern.split(':*.') as [string, string];
  const m = /^([^:]+):([^.]+)\.(.+)$/.exec(key);
  if (!m) return false;
  const rest = m[3]!;
  return m[1] === pEntity && (rest === pRest || rest.startsWith(`${pRest}@`));
}

function refHash(tenantId: string, studentId: string, objectId: string): string {
  return sha256Hex(`${tenantId}:${studentId}:${objectId}`);
}

function jointGroupOf(key: string, s: StudentRecordState): string | undefined {
  const ids = s.claimsByField.get(key);
  const c = ids && ids.length > 0 ? s.claims.get(ids[0]!) : undefined;
  if (!c) {
    // Parse "entity:id.attribute" to find the catalog group for keys with no claims yet.
    const m = /^([^:]+):([^.]+)\.([^@]+)/.exec(key);
    if (!m) return undefined;
    const def = FIELD_CATALOG.get(`${m[1]}.${m[3]}`);
    return def?.jointReviewGroup ? `${m[1]}:${m[2]}#${def.jointReviewGroup}` : undefined;
  }
  const def = FIELD_CATALOG.get(c.catalogKey);
  return def?.jointReviewGroup ? `${c.field.entity}:${c.field.entityId}#${def.jointReviewGroup}` : undefined;
}

/** Same speaker, or a newer version of the same document: the earlier assertion is replaced, not contradicted. */
function sameSourceClass(prev: StoredClaim, next: StoredClaim): boolean {
  if (STATEMENT_ORIGINS.has(prev.origin) && prev.origin === next.origin) {
    return prev.assertedBy.actorId === next.assertedBy.actorId;
  }
  if (prev.origin === 'model_interpretation' && next.origin === 'model_interpretation') return true;
  if (prev.origin === 'document_extraction' && next.origin === 'document_extraction') {
    const pd = prev.evidence.find((e) => e.kind === 'document_anchor');
    const nd = next.evidence.find((e) => e.kind === 'document_anchor');
    return !!pd && !!nd && pd.kind === 'document_anchor' && nd.kind === 'document_anchor' && pd.documentId === nd.documentId && nd.documentVersion >= pd.documentVersion;
  }
  if ((prev.origin === 'issuer_report' || prev.origin === 'school_feed') && prev.origin === next.origin) return true;
  return false;
}

/** Uniform denial that never reveals whether a record exists (04T15). */
function denied(): AccessDeniedError {
  return new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
}

/** Convenience: is a value an explicit absence? Re-exported for consumers of views. */
export const valueIsAbsent = isAbsence;
