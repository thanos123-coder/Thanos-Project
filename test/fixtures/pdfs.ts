import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Synthetic PDF builders. All names, schools and results are fictional.
 * Documents are laid out like simple school records so that the real text-layer
 * pipeline (pdf.js) is exercised end to end.
 */

export type PdfLine =
  | { kind: 'heading'; text: string; size?: number }
  | { kind: 'text'; text: string }
  | { kind: 'kv'; key: string; value: string }
  | { kind: 'table'; headers: string[]; rows: string[][]; columns?: number[] }
  | { kind: 'gap' };

const DEFAULT_COLUMNS = [50, 280, 360, 440, 510];

function draw(page: PDFPage, font: PDFFont, bold: PDFFont, lines: PdfLine[]): void {
  let y = 800;
  const text = (s: string, x: number, size = 10, f = font) => page.drawText(s, { x, y, size, font: f });
  for (const l of lines) {
    switch (l.kind) {
      case 'heading':
        y -= 8;
        text(l.text, 50, l.size ?? 14, bold);
        y -= 22;
        break;
      case 'text':
        text(l.text, 50);
        y -= 16;
        break;
      case 'kv':
        text(`${l.key}: ${l.value}`, 50);
        y -= 16;
        break;
      case 'gap':
        y -= 20;
        break;
      case 'table': {
        const cols = l.columns ?? DEFAULT_COLUMNS;
        l.headers.forEach((h, i) => text(h, cols[i]!, 10, bold));
        y -= 15;
        for (const row of l.rows) {
          row.forEach((c, i) => {
            if (c) text(c, cols[i]!);
          });
          y -= 14;
        }
        y -= 10;
        break;
      }
    }
  }
}

export async function buildPdf(pages: PdfLine[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const lines of pages) draw(doc.addPage([595, 842]), font, bold, lines);
  return doc.save();
}

/**
 * A one-page PDF carrying active content in an annotation. Saved with object
 * streams (pdf-lib's default, like most writers), so the annotation's
 * dictionary is compressed and invisible to a scan of the raw bytes.
 */
export async function pdfWithActiveAnnotation(kind: 'javascript_link' | 'launch_link' | 'file_attachment' | 'escaped_javascript_link' | 'escaped_launch_link'): Promise<Uint8Array> {
  if (kind === 'escaped_javascript_link' || kind === 'escaped_launch_link') {
    // The action name written with a #xx escape (/L#61unch is the name Launch), uncompressed.
    const plain = await activeAnnotationPdf(kind === 'escaped_launch_link' ? 'launch_link' : 'javascript_link', false);
    const text = Buffer.from(plain).toString('latin1');
    return Uint8Array.from(Buffer.from(kind === 'escaped_launch_link' ? text.replace('/Launch', '/L#61unch') : text.replace('/JavaScript', '/J#61vaScript'), 'latin1'));
  }
  return activeAnnotationPdf(kind, true);
}

async function activeAnnotationPdf(kind: 'javascript_link' | 'launch_link' | 'file_attachment', objectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText('Example International School - Academic Transcript', { x: 50, y: 800, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  const c = doc.context;
  const annot =
    kind === 'file_attachment'
      ? c.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [0, 0, 20, 20], FS: c.register(c.obj({ Type: 'Filespec', F: PDFString.of('run.exe'), EF: { F: c.register(c.flateStream('not a real program', { Type: 'EmbeddedFile' })) } })) })
      : c.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 100, 100], Border: [0, 0, 0], A: kind === 'javascript_link' ? c.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }) : c.obj({ S: 'Launch', F: PDFString.of('calc.exe') }) });
  page.node.set(PDFName.of('Annots'), c.obj([c.register(annot)]));
  return doc.save({ useObjectStreams: objectStreams });
}

/** An IB transcript with final Year 11 marks and predicted Year 12 results (03T01). */
export function ibTranscriptWithPredicted(name = 'Maria Papadopoulou'): PdfLine[][] {
  return [
    [
      { kind: 'heading', text: 'Example International School - Academic Transcript', size: 16 },
      { kind: 'kv', key: 'Student name', value: name },
      { kind: 'kv', key: 'Programme', value: 'International Baccalaureate Diploma Programme' },
      { kind: 'kv', key: 'Expected graduation', value: 'June 2027' },
      { kind: 'heading', text: 'Year 11 Final Results (2025-2026)' },
      { kind: 'table', headers: ['Subject', 'Level', 'Grade'], rows: [['Mathematics: Analysis and Approaches', 'HL', '6'], ['Physics', 'HL', '5'], ['English A: Language and Literature', 'SL', '6']] },
      { kind: 'heading', text: 'Year 12 Predicted Grades (2026-2027)' },
      { kind: 'table', headers: ['Subject', 'Level', 'Grade'], rows: [['Mathematics: Analysis and Approaches', 'HL', '7'], ['Physics', 'HL', '6'], ['English A: Language and Literature', 'SL', '6']] },
      { kind: 'text', text: 'Grades are reported on the IB scale of 1-7.' },
    ],
  ];
}
