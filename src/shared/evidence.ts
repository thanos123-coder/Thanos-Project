import { z } from 'zod';

/**
 * Evidence pointers. "Every material factual claim needs an evidence pointer.
 * For a document, store the document version, page, region or text span,
 * original string, and extraction method. For a policy, store publisher,
 * canonical URL, title, relevant section, retrieval time ..." (spec, Evidence
 * and time are first class data). A citation that points only to an entire file
 * is inadequate for a disputed field (03R11).
 */

export const DocumentRegionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('table_cell'),
      tableIndex: z.number().int().nonnegative(),
      row: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
      /** Header text of the column as printed, for human review. */
      columnHeader: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('text_span'),
      blockIndex: z.number().int().nonnegative(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('bbox'),
      /** Normalized coordinates 0..1 relative to the page. */
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('structured_path'),
      /** Path inside a machine-readable record, e.g. "courses[3].grade". */
      path: z.string().min(1),
    })
    .strict(),
]);
export type DocumentRegion = z.infer<typeof DocumentRegionSchema>;

export const EXTRACTION_METHODS = ['text_layer', 'ocr', 'vision_model', 'structured_import', 'manual_entry'] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const EvidenceRefSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('document_anchor'),
      documentId: z.string().min(1),
      documentVersion: z.number().int().positive(),
      page: z.number().int().positive(),
      region: DocumentRegionSchema,
      /** The exact string at the anchor, as extracted. */
      originalText: z.string(),
      method: z.enum(EXTRACTION_METHODS),
    })
    .strict(),
  z
    .object({
      kind: z.literal('conversation_span'),
      conversationId: z.string().min(1),
      turnId: z.string().min(1),
      /** Short quote of what the speaker said (not a full transcript copy). */
      quote: z.string().optional(),
      modality: z.enum(['text', 'voice']),
      /** True when speech recognition flagged uncertainty over this span. */
      recognitionUncertain: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('source_passage'),
      sourceId: z.string().min(1),
      sourceVersion: z.string().min(1),
      section: z.string().optional(),
      quote: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('derivation'),
      method: z.string().min(1),
      softwareVersion: z.string().min(1),
      inputClaimIds: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('human_review'),
      reviewId: z.string().min(1),
      reviewerRole: z.enum(['school_counselor', 'admissions_reviewer', 'registrar', 'student', 'internal_support']),
      decidedAt: z.string().min(1),
    })
    .strict(),
]);
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export function describeEvidence(e: EvidenceRef): string {
  switch (e.kind) {
    case 'document_anchor': {
      const where =
        e.region.kind === 'table_cell'
          ? `table ${e.region.tableIndex + 1}, row ${e.region.row + 1}${e.region.columnHeader ? `, column "${e.region.columnHeader}"` : ''}`
          : e.region.kind === 'text_span'
            ? `text block ${e.region.blockIndex + 1}`
            : e.region.kind === 'bbox'
              ? 'marked region'
              : e.region.path;
      return `document ${e.documentId} v${e.documentVersion}, page ${e.page}, ${where}: "${e.originalText}"`;
    }
    case 'conversation_span':
      return `${e.modality === 'voice' ? 'spoken' : 'written'} answer${e.quote ? `: "${e.quote}"` : ''}`;
    case 'source_passage':
      return `source ${e.sourceId}${e.section ? ` (${e.section})` : ''}: "${e.quote}"`;
    case 'derivation':
      return `calculated by ${e.method} (${e.softwareVersion})`;
    case 'human_review':
      return `reviewed by ${e.reviewerRole.replace(/_/g, ' ')} on ${e.decidedAt}`;
  }
}
