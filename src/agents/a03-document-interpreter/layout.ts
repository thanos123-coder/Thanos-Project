import { z } from 'zod';

/**
 * Page layout: the intermediate representation between physical extraction
 * (text layer, OCR, vision model, structured import) and semantic
 * interpretation. Every string is kept exactly as read; nothing is normalized
 * here ("Preserve the original").
 */

export const CellSchema = z
  .object({
    text: z.string(),
    /** Alternative readings when a character is uncertain (e.g. "6" vs "8"). Never averaged. */
    alternatives: z.array(z.string()).default([]),
  })
  .strict();
export type Cell = z.infer<typeof CellSchema>;

export const LayoutBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), text: z.string() }).strict(),
  z.object({ kind: z.literal('paragraph'), text: z.string() }).strict(),
  z.object({ kind: z.literal('legend'), text: z.string() }).strict(),
  z.object({ kind: z.literal('key_value'), key: z.string(), value: z.string() }).strict(),
  z
    .object({
      kind: z.literal('table'),
      headers: z.array(z.string()),
      rows: z.array(z.array(CellSchema)),
    })
    .strict(),
]);
export type LayoutBlock = z.infer<typeof LayoutBlockSchema>;

export const LayoutPageSchema = z
  .object({
    page: z.number().int().positive(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    readable: z.boolean(),
    issues: z.array(z.string()).default([]),
    source: z.enum(['text_layer', 'ocr', 'vision_model', 'structured_import']),
    blocks: z.array(LayoutBlockSchema),
    /** Full plain text of the page when a text layer exists, for cross-checks. */
    plainText: z.string().optional(),
  })
  .strict();
export type LayoutPage = z.infer<typeof LayoutPageSchema>;

/** A positioned text run as produced by a PDF text layer (PDF coordinates: y grows upward). */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Segment {
  text: string;
  x0: number;
  x1: number;
  height: number;
}

interface Line {
  y: number;
  height: number;
  segments: Segment[];
}

const HEADER_WORDS = /\b(course|subject|module|class|title|grade|mark|marks|result|score|level|track|credits?|units?|hours|period|term|semester|year|session|code|status|attempt|points|examination|exam)\b/i;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Group text runs into lines and, within a line, into segments separated by visible gaps. */
export function groupLines(runs: readonly TextRun[]): Line[] {
  const items = runs.filter((r) => r.str.trim().length > 0 && r.height > 0);
  if (items.length === 0) return [];
  const medH = median(items.map((r) => r.height)) || 10;
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const r of sorted) {
    const line = lines.find((l) => Math.abs(l.y - r.y) <= medH * 0.35);
    const seg: Segment = { text: r.str, x0: r.x, x1: r.x + r.width, height: r.height };
    if (line) {
      line.segments.push(seg);
      line.height = Math.max(line.height, r.height);
    } else lines.push({ y: r.y, height: r.height, segments: [seg] });
  }
  for (const l of lines) {
    l.segments.sort((a, b) => a.x0 - b.x0);
    const merged: Segment[] = [];
    for (const s of l.segments) {
      const prev = merged[merged.length - 1];
      const gap = prev ? s.x0 - prev.x1 : Infinity;
      if (prev && gap < Math.max(prev.height, s.height) * 0.6) {
        prev.text = `${prev.text}${gap > Math.max(prev.height, s.height) * 0.15 ? ' ' : ''}${s.text}`;
        prev.x1 = Math.max(prev.x1, s.x1);
      } else merged.push({ ...s });
    }
    l.segments = merged.map((m) => ({ ...m, text: m.text.replace(/\s+/g, ' ').trim() })).filter((m) => m.text.length > 0);
  }
  return lines.filter((l) => l.segments.length > 0).sort((a, b) => b.y - a.y);
}

function isHeaderLine(l: Line): boolean {
  if (l.segments.length < 2) return false;
  const hits = l.segments.filter((s) => HEADER_WORDS.test(s.text) && s.text.length <= 40).length;
  return hits >= 2 && hits >= Math.ceil(l.segments.length / 2);
}

const LEGEND_LINE = /^(legend|key|notes?)\b[:\s]|^\S{1,3}\s*(=|:|–|—|-)\s*[A-Za-z]/i;
const KV_LINE = /^([A-Za-z][A-Za-z0-9 .'/()–-]{1,40}):\s+(.+)$/;

/**
 * Reconstruct headings, key-value lines, legends and tables from a text layer.
 * Columns are defined by the header row; each following aligned line becomes a
 * table row until a non-aligned line ends the table. Repeated header rows (on
 * continuation pages) are recognized by the interpreter, not dropped here.
 */
export function reconstructBlocks(runs: readonly TextRun[]): LayoutBlock[] {
  const lines = groupLines(runs);
  if (lines.length === 0) return [];
  const medH = median(lines.map((l) => l.height)) || 10;
  const blocks: LayoutBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isHeaderLine(line)) {
      const cols = line.segments.map((s) => ({ header: s.text, x0: s.x0, x1: s.x1 }));
      // Column boundaries: midpoint between adjacent header starts, with the first column open to the left.
      const bounds = cols.map((c, k) => ({ start: k === 0 ? -Infinity : (cols[k - 1]!.x1 + c.x0) / 2, header: c.header }));
      const rows: Cell[][] = [];
      let j = i + 1;
      let lastY = line.y;
      while (j < lines.length) {
        const l = lines[j]!;
        const gap = lastY - l.y;
        if (gap > medH * 3.2) break;
        if (isHeaderLine(l) && l.segments.map((s) => s.text.toLowerCase()).join('|') !== line.segments.map((s) => s.text.toLowerCase()).join('|')) break;
        if (l.segments.length === 1) {
          const only = l.segments[0]!;
          const spansColumns = only.x0 < cols[0]!.x0 + 2 && only.x1 > (cols[1]?.x0 ?? Infinity);
          const prose = /[.!?]$/.test(only.text) || only.text.split(/\s+/).length >= 7;
          if (spansColumns || prose || LEGEND_LINE.test(only.text) || l.height > medH * 1.25) break;
        }
        const cells: Cell[] = cols.map(() => ({ text: '', alternatives: [] }));
        for (const s of l.segments) {
          let idx = 0;
          for (let k = 0; k < bounds.length; k += 1) if (s.x0 >= bounds[k]!.start) idx = k;
          const cell = cells[idx]!;
          cell.text = cell.text ? `${cell.text} ${s.text}` : s.text;
        }
        rows.push(cells);
        lastY = l.y;
        j += 1;
      }
      blocks.push({ kind: 'table', headers: cols.map((c) => c.header), rows });
      i = j;
      continue;
    }
    const text = line.segments.map((s) => s.text).join(' ');
    const kv = line.segments.length <= 2 ? KV_LINE.exec(text) : null;
    if (LEGEND_LINE.test(text) && !kv) blocks.push({ kind: 'legend', text });
    else if (kv) blocks.push({ kind: 'key_value', key: kv[1]!.trim(), value: kv[2]!.trim() });
    else if (line.height > medH * 1.2 || (text.length <= 80 && !/[.;]$/.test(text))) blocks.push({ kind: 'heading', text });
    else blocks.push({ kind: 'paragraph', text });
    i += 1;
  }
  return blocks;
}

/** Plain text of a page from its runs, line by line, for cross-checks against other readings. */
export function plainTextOf(runs: readonly TextRun[]): string {
  return groupLines(runs)
    .map((l) => l.segments.map((s) => s.text).join(' '))
    .join('\n');
}
