import { absent } from '../../shared/absence.js';
import type { EvidenceRef } from '../../shared/evidence.js';
import type { ClaimInput, Lifecycle } from '../../shared/facts.js';
import type { IdGenerator } from '../../shared/ids.js';
import type { Actor } from '../../shared/permissions.js';
import { buildClaim } from '../a04-record-steward/claims.js';
import type { Anchor, CourseObservation, InterpretationResult } from './interpret.js';

/**
 * Map interpreted observations to typed claims for Agent 04 (03R11, 03R13).
 * Every value carries a document-version anchor and the original string. The
 * student-supplied document is never called issuer-verified.
 */

export function anchorEvidence(documentId: string, documentVersion: number, a: Anchor): EvidenceRef {
  const region =
    a.tableIndex !== undefined && a.row !== undefined && a.column !== undefined
      ? { kind: 'table_cell' as const, tableIndex: a.tableIndex, row: a.row, column: a.column, ...(a.columnHeader ? { columnHeader: a.columnHeader } : {}) }
      : { kind: 'text_span' as const, blockIndex: a.blockIndex ?? 0, start: 0, end: a.text.length };
  return { kind: 'document_anchor', documentId, documentVersion, page: a.page, region, originalText: a.text, method: a.method };
}

export interface ImportPreviewRow {
  entityId: string;
  course: string;
  level: string | null;
  period: string | null;
  grade: string | null;
  status: string;
  needsReview: string | null;
}

export interface BuiltImport {
  claims: ClaimInput[];
  preview: ImportPreviewRow[];
  /** Map from interpreter local ids to record entity ids. */
  entityIds: Record<string, string>;
}

function lifecycleFor(c: CourseObservation): Lifecycle {
  switch (c.enrollmentStatus) {
    case 'completed':
      return 'completed';
    case 'in_progress':
      return 'in_progress';
    case 'withdrawn':
      return 'cancelled';
    case 'planned':
      return 'planned';
    default:
      return 'current';
  }
}

/** Identity key used to match an extracted course to an existing course entity (same printed name and period). */
export function courseMatchKey(name: string, periodLabel: string | null | undefined): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, ' ')}|${(periodLabel ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export function buildImportClaims(
  r: InterpretationResult,
  doc: { id: string; version: number },
  actor: Actor,
  ids: IdGenerator,
  /** Existing course entities by match key, so a new document version supersedes rather than duplicates. */
  existingCourses: ReadonlyMap<string, string> = new Map(),
): BuiltImport {
  const claims: ClaimInput[] = [];
  const preview: ImportPreviewRow[] = [];
  const entityIds: Record<string, string> = {};
  const ev = (a: Anchor) => [anchorEvidence(doc.id, doc.version, a)];
  const base = { origin: 'document_extraction' as const, actor, viaRole: '03' };

  const used = new Set<string>();
  for (const c of r.courses) {
    const match = existingCourses.get(courseMatchKey(c.name.original, c.period?.value.label));
    const id = match && !used.has(match) ? match : ids.next('course');
    used.add(id);
    entityIds[c.localId] = id;
    const lifecycle = lifecycleFor(c);
    const add = (attribute: string, value: unknown, anchor: Anchor, extra: Partial<Parameters<typeof buildClaim>[0]> = {}) =>
      claims.push(buildClaim({ ...base, entity: 'course', entityId: id, attribute, value, evidence: ev(anchor), lifecycle, ...extra }));
    add('name_original', c.name.original, c.name.anchor);
    if (c.code) add('code_local', c.code.original, c.code.anchor);
    if (c.subject) add('subject_mapping', c.subject, c.name.anchor);
    add('level', c.level.value, c.level.anchor ?? c.name.anchor);
    if (c.period) add('period', c.period.value, c.period.anchor ?? c.name.anchor);
    if (c.credit) add('credit', { original: c.credit.original, unit: c.credit.unit }, c.credit.anchor);
    if (c.enrollmentStatus) add('enrollment_status', c.enrollmentStatus, c.grade?.anchor ?? c.name.anchor);
    if (c.attempt) add('attempt', c.attempt, c.name.anchor);
    if (c.courseKey) add('course_key', c.courseKey, c.name.anchor);
    let needsReview: string | null = null;
    if (c.grade) {
      const g = c.grade;
      if (g.candidates.length > 1) {
        needsReview = `could be ${g.candidates.join(' or ')}`;
        add('grade', absent('pending_evidence', `Confirm whether the grade is ${g.candidates.join(' or ')}`), g.anchor, { extractionReview: { state: 'ambiguous', candidates: g.candidates } });
      } else {
        const value = { original: g.original, scaleRef: g.scaleRef, status: g.status, weighting: null };
        if (g.reviewNote) needsReview = g.reviewNote;
        else if (g.status === 'unknown') needsReview = 'result status (final, predicted or in progress) not shown';
        const review = g.reviewNote || g.status === 'unknown' ? { extractionReview: { state: 'needs_confirmation' as const, candidates: [], note: g.reviewNote ?? 'The document does not show whether this result is final, predicted or in progress.' } } : {};
        add('grade', value, g.anchor, review);
      }
    }
    preview.push({
      entityId: id,
      course: c.name.original,
      level: c.level.value.original,
      period: c.period?.value.label ?? null,
      grade: c.grade ? (c.grade.candidates.length > 1 ? c.grade.candidates.join(' / ') : c.grade.original) : null,
      status: c.grade?.status ?? 'no result shown',
      needsReview,
    });
  }

  if (r.qualification) {
    const q = r.qualification;
    const id = ids.next('qualification');
    claims.push(buildClaim({ ...base, entity: 'qualification', entityId: id, attribute: 'credential', value: { id: q.credentialId, label: q.label }, evidence: ev(q.anchor) }));
    if (q.status) claims.push(buildClaim({ ...base, entity: 'qualification', entityId: id, attribute: 'status', value: q.status, evidence: ev(q.anchor), lifecycle: q.status === 'in_progress' ? 'in_progress' : 'completed' }));
    if (q.total) claims.push(buildClaim({ ...base, entity: 'qualification', entityId: id, attribute: 'total', value: { original: q.total.original, scaleRef: 'ib_diploma_points_0_45', status: q.total.status, weighting: null }, evidence: ev(q.total.anchor), ...(q.total.status === 'unknown' ? { extractionReview: { state: 'needs_confirmation' as const, candidates: [], note: 'Confirm whether the total is final or predicted.' } } : {}) }));
  }
  if (r.expectedGraduation) {
    claims.push(buildClaim({ ...base, attribute: 'education.expected_graduation', value: r.expectedGraduation.value, evidence: ev(r.expectedGraduation.anchor), lifecycle: 'planned' }));
  }
  for (const t of r.tests) {
    if (!t.record) continue;
    const critical = t.ambiguities.length > 0;
    claims.push(buildClaim({ ...base, entity: 'test_attempt', entityId: ids.next('test'), attribute: 'record', value: t.record, evidence: ev(t.anchor), lifecycle: 'completed', ...(critical ? { extractionReview: { state: 'needs_confirmation' as const, candidates: [], note: t.ambiguities.join(' ') } } : {}) }));
  }
  for (const o of r.offerings) {
    claims.push(buildClaim({ ...base, entity: 'school_offering', entityId: ids.next('offering'), attribute: 'course', value: { name: o.name, subjectKey: o.subjectKey, level: o.level, termsOffered: o.termsOffered, prerequisites: o.prerequisites, availability: 'catalog_listed' }, evidence: ev(o.anchor) }));
  }
  for (const s of r.schoolContext) {
    claims.push(buildClaim({ ...base, entity: 'school_context', entityId: ids.next('context'), attribute: 'note', value: { topic: s.topic, text: s.text }, evidence: ev(s.anchor) }));
  }
  return { claims, preview, entityIds };
}
