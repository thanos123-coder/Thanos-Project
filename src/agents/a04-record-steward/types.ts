import type { Absence } from '../../shared/absence.js';
import type { EvidenceRef } from '../../shared/evidence.js';
import type { AssertedBy, Confirmation, Dispute, ExtractionReview, FieldRef, Holder, Lifecycle, Origin, Validity } from '../../shared/facts.js';
import type { DataCategory } from '../../shared/permissions.js';

/** A committed claim. Claims are immutable: corrections add a new claim and supersede the old one. */
export interface StoredClaim {
  id: string;
  tenantId: string;
  studentId: string;
  field: FieldRef;
  fieldKey: string;
  catalogKey: string;
  holder?: Holder;
  value: unknown;
  origin: Origin;
  confirmation: Confirmation;
  lifecycle: Lifecycle;
  validity: Validity;
  dispute: Dispute;
  evidence: EvidenceRef[];
  assertedBy: AssertedBy;
  extractionReview?: ExtractionReview;
  /** Effective visibility category (catalog category or a stricter one). */
  category: DataCategory;
  /** Recorded time: when the app learned it (distinct from validity, the real-world time). */
  recordedAt: string;
  recordVersion: number;
  mutationId: string;
  status: 'active' | 'superseded' | 'retracted' | 'deleted';
  supersedes: string[];
  supersededBy?: string;
  statusChangedAt?: string;
  statusReason?: string;
}

export type FieldViewState = 'current' | 'conflict' | 'absent';

export interface ClaimSummary {
  claimId: string;
  value: unknown;
  origin: Origin;
  confirmation: Confirmation;
  lifecycle: Lifecycle;
  validity: Validity;
  dispute: Dispute;
  recordedAt: string;
  assertedByKind: AssertedBy['actorKind'];
  extractionReview?: ExtractionReview;
  evidenceKinds: EvidenceRef['kind'][];
  category: DataCategory;
}

/** The canonical current view of one field instance. Alternatives are preserved, never erased. */
export interface FieldView {
  fieldKey: string;
  field: FieldRef;
  holder?: Holder;
  label: string;
  category: DataCategory;
  consequential: boolean;
  state: FieldViewState;
  current?: ClaimSummary;
  /** Active claims not selected as current (e.g. an earlier document assertion). */
  alternatives: ClaimSummary[];
  /** When state === 'conflict': the competing claims. */
  conflicting: ClaimSummary[];
  /** A student statement is used for planning while updated documentation is pending. */
  documentationPending: boolean;
  /** Current value is an absence or needs confirmation before consequential use. */
  needsConfirmation: boolean;
  /** Increments whenever the field's active claim set changes. */
  fieldVersion: number;
}

export interface MutationRecord {
  mutationId: string;
  payloadHash: string;
  actorId: string;
  permissionSnapshot: string;
  response: MutationResponse;
}

export type MutationOutcome = 'accepted' | 'rejected' | 'conflict' | 'requires_review';

export interface MutationResponse {
  outcome: MutationOutcome;
  mutationId: string;
  /** New record version when committed. */
  recordVersion?: number;
  changedFieldKeys: string[];
  createdClaimIds: string[];
  supersededClaimIds: string[];
  invalidatedArtifactIds: string[];
  /** Reasons for rejection, conflict or review, without private payloads. */
  reasons: string[];
  /** Concise student-facing explanation of what changed. */
  studentSummary: string;
}

export interface DerivedArtifact {
  id: string;
  tenantId: string;
  studentId: string;
  kind: string;
  producedByRole: string;
  /** The task that produced it, so a coordinator can tell which of its results went stale. */
  producedByTask?: string;
  /** Stable scope key, e.g. an eligibility scope key; a newer artifact with the same kind+scopeKey supersedes the older one. */
  scopeKey: string;
  payload: unknown;
  inputs: {
    fieldKeys: string[];
    claimIds: string[];
    ruleVersions: string[];
    sourceIds: string[];
  };
  recordVersion: number;
  category: DataCategory;
  status: 'current' | 'stale' | 'superseded' | 'deleted';
  statusReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeletionLedgerEntry {
  id: string;
  tenantId: string;
  /** Hash of the student id; the ledger never needs the id in clear to re-apply deletions. */
  studentRefHash: string;
  scope: 'claim' | 'document' | 'account' | 'artifact';
  /** Hashes of deleted object ids (no content). */
  targetRefHashes: string[];
  requestedAt: string;
  completedAt: string;
  processorsNotified: string[];
}

/** External stores holding derived content (OCR text, crops, embeddings, summaries, caches, exports). */
export interface DerivativeStore {
  name: string;
  purgeByDocument(tenantId: string, studentId: string, documentId: string): Promise<number> | number;
  purgeByClaims(tenantId: string, studentId: string, claimIds: readonly string[]): Promise<number> | number;
  purgeByStudent(tenantId: string, studentId: string): Promise<number> | number;
}

export interface StudentRecordState {
  tenantId: string;
  studentId: string;
  ownerActorId: string;
  lifecycle: 'active' | 'deleted';
  recordVersion: number;
  claims: Map<string, StoredClaim>;
  /** fieldKey -> claim ids (all statuses). */
  claimsByField: Map<string, string[]>;
  fieldVersions: Map<string, number>;
  /** recordVersion -> changed field keys, for rebase checks. */
  changeLog: Array<{ recordVersion: number; mutationId: string; changedFieldKeys: string[] }>;
  mutations: Map<string, MutationRecord>;
  artifacts: Map<string, DerivedArtifact>;
  createdAt: string;
}

export type ValueOrAbsence = unknown | Absence;
