import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { AccessDeniedError } from '../../shared/errors.js';
import type { PermissionService } from '../a04-record-steward/permissions.js';
import type { DocumentMeta, DocumentStore } from './documents.js';
import { reconstructBlocks, plainTextOf, type LayoutPage } from './layout.js';
import { PARSER_VERSION } from './interpret.js';
import { layoutFromCsv, layoutFromJson } from './structured.js';

/**
 * File tools for Agent 03. Parsing runs inside the service boundary with no
 * network access and never executes document content. The document's access
 * policy is re-checked on every call.
 */

export interface ParsedLayout {
  pages: LayoutPage[];
  /** Pages with no reliable text layer (scans, images) that need OCR or vision transcription. */
  pagesNeedingTranscription: number[];
  parserVersion: string;
}

const LAYOUT_VERSION = `layout_v1+${PARSER_VERSION}`;

export function registerDocumentTools(gateway: ToolGateway, store: DocumentStore, permissions: PermissionService): void {
  const check = (inv: { actor: Parameters<PermissionService['authorize']>[0]['actor']; tenantId: string; studentId: string; purpose: Parameters<PermissionService['authorize']>[0]['purpose'] }) => {
    const d = permissions.authorize({ actor: inv.actor, tenantId: inv.tenantId, studentId: inv.studentId, category: 'documents_raw', access: 'read', purpose: inv.purpose });
    if (!d.allowed) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
  };

  gateway.register({
    name: 'files.read_quarantined',
    description: 'Read the quarantine decision and metadata of an uploaded document; optionally its bytes for sandboxed transcription.',
    kind: 'read',
    args: z.object({ tenantId: z.string(), studentId: z.string(), documentId: z.string(), version: z.number().int().positive().optional(), includeBytes: z.boolean().default(false) }).strict(),
    handler: async (inv, args): Promise<{ meta: DocumentMeta; base64: string | null }> => {
      check(inv);
      const meta = store.meta(args.tenantId, args.studentId, args.documentId, args.version);
      if (!meta) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
      const bytes = args.includeBytes && meta.status === 'accepted' ? store.bytes(args.tenantId, args.studentId, meta.id, meta.version) : undefined;
      return { meta, base64: bytes ? Buffer.from(bytes).toString('base64') : null };
    },
  });

  gateway.register({
    name: 'files.parse_sandboxed',
    description: 'Produce page layouts from the text layer or structured content of an accepted document (cached per version and parser).',
    kind: 'compute',
    args: z.object({ tenantId: z.string(), studentId: z.string(), documentId: z.string(), version: z.number().int().positive() }).strict(),
    handler: async (inv, args): Promise<ParsedLayout> => {
      check(inv);
      const meta = store.meta(args.tenantId, args.studentId, args.documentId, args.version);
      if (!meta || meta.status !== 'accepted') throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
      const cached = store.cachedLayout(args.tenantId, args.studentId, meta.id, meta.version, LAYOUT_VERSION);
      const needing = (pages: LayoutPage[]) => pages.filter((p) => !p.readable).map((p) => p.page);
      if (cached) return { pages: cached, pagesNeedingTranscription: needing(cached), parserVersion: LAYOUT_VERSION };
      let pages: LayoutPage[];
      if (meta.sniffed === 'pdf') {
        const pdf = store.pdfText(args.tenantId, args.studentId, meta.id, meta.version);
        pages = (pdf?.pages ?? []).map((p) => {
          const letters = p.runs.map((r) => r.str).join('').replace(/\s/g, '');
          const reliable = letters.length >= 20 && !letters.includes('�');
          return {
            page: p.page,
            rotation: p.rotation,
            readable: reliable,
            issues: reliable ? (p.rotation !== 0 ? [`page rotated ${p.rotation} degrees`] : []) : ['no reliable text layer; the page needs OCR or visual transcription'],
            source: 'text_layer' as const,
            blocks: reliable ? reconstructBlocks(p.runs) : [],
            plainText: plainTextOf(p.runs),
          };
        });
      } else if (meta.sniffed === 'csv') {
        const bytes = store.bytes(args.tenantId, args.studentId, meta.id, meta.version)!;
        pages = layoutFromCsv(new TextDecoder().decode(bytes));
      } else if (meta.sniffed === 'json') {
        const bytes = store.bytes(args.tenantId, args.studentId, meta.id, meta.version)!;
        pages = layoutFromJson(new TextDecoder().decode(bytes));
      } else if (meta.sniffed === 'text') {
        const bytes = store.bytes(args.tenantId, args.studentId, meta.id, meta.version)!;
        const text = new TextDecoder().decode(bytes);
        pages = [{ page: 1, rotation: 0, readable: true, issues: [], source: 'structured_import', blocks: text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
          const kv = /^([A-Za-z][A-Za-z0-9 .'/()–-]{1,40}):\s+(.+)$/.exec(l.trim());
          return kv ? { kind: 'key_value' as const, key: kv[1]!, value: kv[2]! } : { kind: 'paragraph' as const, text: l.trim() };
        }), plainText: text }];
      } else {
        // Images: no text layer.
        pages = Array.from({ length: meta.pages ?? 1 }, (_, i) => ({ page: i + 1, rotation: 0 as const, readable: false, issues: ['image page; needs OCR or visual transcription'], source: 'ocr' as const, blocks: [] }));
      }
      store.cacheLayout(args.tenantId, args.studentId, meta.id, meta.version, LAYOUT_VERSION, pages);
      return { pages, pagesNeedingTranscription: needing(pages), parserVersion: LAYOUT_VERSION };
    },
  });
}
