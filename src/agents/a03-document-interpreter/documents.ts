import { randomBytes } from 'node:crypto';
import type { DerivativeStore } from '../a04-record-steward/types.js';
import type { PermissionService } from '../a04-record-steward/permissions.js';
import type { Clock } from '../../shared/clock.js';
import { scopedFingerprint } from '../../shared/hash.js';
import type { IdGenerator } from '../../shared/ids.js';
import type { Actor } from '../../shared/permissions.js';
import type { LayoutPage } from './layout.js';
import type { PdfInspection } from './pdf-text.js';
import { DEFAULT_LIMITS, quarantine, type MalwareScanner, type QuarantineLimits, type QuarantineReport, type SniffedType } from './quarantine.js';

/**
 * Document storage for student uploads. Originals are preserved; derived page
 * text, layouts and crops are separate artifacts that inherit the document's
 * access policy and are purged when the document is deleted (03T16). Duplicate
 * detection is scoped to one student so it cannot reveal whether another
 * student uploaded the same file (03R02).
 */

export interface DocumentMeta {
  id: string;
  version: number;
  tenantId: string;
  studentId: string;
  uploaderActorId: string;
  /** What the uploader said the document is, kept separate from what it contains. */
  declaredDocumentType: string | null;
  uploaderDescription: string | null;
  sniffed: SniffedType;
  mediaType: string | null;
  sizeBytes: number;
  pages: number | null;
  fingerprint: string;
  status: 'accepted' | 'rejected' | 'needs_unlock' | 'deleted';
  quarantine: QuarantineReport;
  /** Uploaded copies are never issuer-verified by this app. */
  authenticity: 'not_verified_by_issuer';
  uploadedAt: string;
}

export type UploadResult =
  | { status: 'accepted'; document: DocumentMeta }
  | { status: 'duplicate'; document: DocumentMeta }
  | { status: 'rejected' | 'needs_unlock'; report: QuarantineReport };

interface StoredVersion {
  meta: DocumentMeta;
  bytes: Uint8Array | null;
  pdf: PdfInspection | null;
  layouts: Map<string, LayoutPage[]>;
}

const key = (tenantId: string, studentId: string) => `${tenantId}::${studentId}`;

export class DocumentStore implements DerivativeStore {
  readonly name = 'document_store';
  private readonly docs = new Map<string, Map<string, StoredVersion[]>>();
  private readonly fingerprints = new Map<string, Map<string, { id: string; version: number }>>();
  private readonly scopeSecret: string;

  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly permissions: PermissionService,
    private readonly scanner: MalwareScanner | null = null,
    private readonly limits: QuarantineLimits = DEFAULT_LIMITS,
    scopeSecret?: string,
  ) {
    this.scopeSecret = scopeSecret ?? randomBytes(32).toString('hex');
  }

  async upload(input: {
    tenantId: string;
    studentId: string;
    uploader: Actor;
    bytes: Uint8Array;
    declaredMediaType?: string | null;
    declaredDocumentType?: string | null;
    uploaderDescription?: string | null;
    /** When the student says this replaces an earlier upload, it becomes a new version of that document. */
    replacesDocumentId?: string;
  }): Promise<UploadResult> {
    const allowed = this.permissions.authorize({ actor: input.uploader, tenantId: input.tenantId, studentId: input.studentId, category: 'documents_raw', access: 'write', purpose: 'document_import' });
    if (!allowed.allowed) throw Object.assign(new Error('Not found or not permitted'), { code: 'not_found_or_denied' });
    const { report, pdf } = await quarantine(input.bytes, input.declaredMediaType ?? null, this.scanner, this.limits);
    if (report.decision !== 'accepted') return { status: report.decision, report };
    const k = key(input.tenantId, input.studentId);
    const fp = scopedFingerprint(this.scopeSecret, k, input.bytes);
    const seen = this.fingerprints.get(k)?.get(fp);
    if (seen) {
      const existing = this.version(input.tenantId, input.studentId, seen.id, seen.version);
      if (existing && existing.meta.status === 'accepted') return { status: 'duplicate', document: structuredClone(existing.meta) };
    }
    const studentDocs = this.docs.get(k) ?? new Map<string, StoredVersion[]>();
    this.docs.set(k, studentDocs);
    let id: string;
    let version: number;
    if (input.replacesDocumentId && studentDocs.has(input.replacesDocumentId)) {
      id = input.replacesDocumentId;
      version = studentDocs.get(id)!.length + 1;
    } else {
      id = this.ids.next('doc');
      version = 1;
    }
    const meta: DocumentMeta = {
      id,
      version,
      tenantId: input.tenantId,
      studentId: input.studentId,
      uploaderActorId: input.uploader.id,
      declaredDocumentType: input.declaredDocumentType ?? null,
      uploaderDescription: input.uploaderDescription ?? null,
      sniffed: report.sniffed,
      mediaType: report.sniffed === 'pdf' ? 'application/pdf' : report.declaredMediaType,
      sizeBytes: input.bytes.length,
      pages: report.pages,
      fingerprint: fp,
      status: 'accepted',
      quarantine: report,
      authenticity: 'not_verified_by_issuer',
      uploadedAt: this.clock.nowIso(),
    };
    const versions = studentDocs.get(id) ?? [];
    versions.push({ meta, bytes: new Uint8Array(input.bytes), pdf: pdf ?? null, layouts: new Map() });
    studentDocs.set(id, versions);
    const fps = this.fingerprints.get(k) ?? new Map();
    fps.set(fp, { id, version });
    this.fingerprints.set(k, fps);
    return { status: 'accepted', document: structuredClone(meta) };
  }

  private version(tenantId: string, studentId: string, id: string, version?: number): StoredVersion | undefined {
    const versions = this.docs.get(key(tenantId, studentId))?.get(id);
    if (!versions || versions.length === 0) return undefined;
    return version === undefined ? versions[versions.length - 1] : versions[version - 1];
  }

  meta(tenantId: string, studentId: string, id: string, version?: number): DocumentMeta | undefined {
    const v = this.version(tenantId, studentId, id, version);
    return v && v.meta.status !== 'deleted' ? structuredClone(v.meta) : undefined;
  }

  bytes(tenantId: string, studentId: string, id: string, version: number): Uint8Array | undefined {
    const v = this.version(tenantId, studentId, id, version);
    return v?.bytes && v.meta.status === 'accepted' ? new Uint8Array(v.bytes) : undefined;
  }

  pdfText(tenantId: string, studentId: string, id: string, version: number): PdfInspection | undefined {
    const v = this.version(tenantId, studentId, id, version);
    return v?.pdf && v.meta.status === 'accepted' ? v.pdf : undefined;
  }

  cachedLayout(tenantId: string, studentId: string, id: string, version: number, parserVersion: string): LayoutPage[] | undefined {
    return this.version(tenantId, studentId, id, version)?.layouts.get(parserVersion);
  }

  cacheLayout(tenantId: string, studentId: string, id: string, version: number, parserVersion: string, pages: LayoutPage[]): void {
    const v = this.version(tenantId, studentId, id, version);
    if (v && v.meta.status === 'accepted') v.layouts.set(parserVersion, pages);
  }

  // DerivativeStore: deletion propagates here from Agent 04.
  purgeByDocument(tenantId: string, studentId: string, documentId: string): number {
    const versions = this.docs.get(key(tenantId, studentId))?.get(documentId);
    if (!versions) return 0;
    for (const v of versions) {
      v.bytes = null;
      v.pdf = null;
      v.layouts.clear();
      v.meta.status = 'deleted';
      v.meta.uploaderDescription = null;
      const fps = this.fingerprints.get(key(tenantId, studentId));
      fps?.delete(v.meta.fingerprint);
    }
    return versions.length;
  }

  purgeByClaims(): number {
    return 0;
  }

  purgeByStudent(tenantId: string, studentId: string): number {
    const docs = this.docs.get(key(tenantId, studentId));
    if (!docs) return 0;
    let n = 0;
    for (const id of docs.keys()) n += this.purgeByDocument(tenantId, studentId, id);
    this.docs.delete(key(tenantId, studentId));
    this.fingerprints.delete(key(tenantId, studentId));
    return n;
  }
}
