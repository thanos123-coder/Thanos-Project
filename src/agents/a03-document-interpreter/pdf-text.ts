import { createRequire } from 'node:module';
import path from 'node:path';
import type { TextRun } from './layout.js';

/**
 * PDF text-layer reader built on Mozilla pdf.js, configured so that nothing in
 * a document can execute: no eval, no XFA, no font face injection, no network,
 * no scripting sandbox. The reader only reports text positions and structural
 * facts (page count, password protection, attachments, JavaScript presence)
 * that quarantine decisions depend on (03R01, 03R04).
 */

export interface PdfPageText {
  page: number;
  rotation: 0 | 90 | 180 | 270;
  width: number;
  height: number;
  runs: TextRun[];
}

export interface PdfInspection {
  ok: true;
  numPages: number;
  hasJavaScript: boolean;
  hasAttachments: boolean;
  pages: PdfPageText[];
}

export type PdfInspectionResult = PdfInspection | { ok: false; reason: 'password_required' | 'malformed' | 'too_many_pages'; detail: string; numPages?: number };

let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

function standardFontsDir(): string {
  const require = createRequire(import.meta.url);
  return `${path.dirname(require.resolve('pdfjs-dist/package.json'))}/standard_fonts/`;
}

export async function inspectPdf(bytes: Uint8Array, opts: { maxPages: number }): Promise<PdfInspectionResult> {
  const pdfjs = await loadPdfjs();
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  // pdf.js 6 no longer evaluates code at all; XFA, font faces, system fonts and worker fetches stay disabled.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
    verbosity: 0,
    standardFontDataUrl: standardFontsDir(),
  });
  try {
    doc = await loadingTask.promise;
  } catch (e) {
    await loadingTask.destroy().catch(() => undefined);
    const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
    if (name === 'PasswordException') return { ok: false, reason: 'password_required', detail: 'The PDF is password protected.' };
    return { ok: false, reason: 'malformed', detail: e instanceof Error ? e.message.slice(0, 200) : 'unreadable PDF' };
  }
  try {
    if (doc.numPages > opts.maxPages) return { ok: false, reason: 'too_many_pages', detail: `${doc.numPages} pages exceeds the limit of ${opts.maxPages}`, numPages: doc.numPages };
    const [attachments, js] = await Promise.all([doc.getAttachments().catch(() => null), doc.getJSActions().catch(() => null)]);
    const hasJavaScript = !!js && Object.keys(js).length > 0;
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const [vx, vy] = viewport.convertToViewportPoint(item.transform[4] as number, item.transform[5] as number) as [number, number];
        runs.push({ str: item.str, x: vx, y: viewport.height - vy, width: item.width, height: item.height });
      }
      const rot = ((page.rotate % 360) + 360) % 360;
      pages.push({ page: n, rotation: (rot === 90 || rot === 180 || rot === 270 ? rot : 0) as PdfPageText['rotation'], width: viewport.width, height: viewport.height, runs });
      page.cleanup();
    }
    return { ok: true, numPages: doc.numPages, hasJavaScript, hasAttachments: !!attachments && Object.keys(attachments).length > 0, pages };
  } finally {
    await loadingTask.destroy();
  }
}
