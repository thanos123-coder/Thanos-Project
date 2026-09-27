import type { Cell, LayoutPage } from './layout.js';

/**
 * Machine-readable inputs (CSV exports, JSON arrays). Parsed into the same
 * layout representation so the same interpreter and validation apply.
 */

/** RFC 4180-style CSV parsing with quoted fields; the delimiter is detected from the header line. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function layoutFromCsv(text: string): LayoutPage[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [{ page: 1, rotation: 0, readable: false, issues: ['empty file'], source: 'structured_import', blocks: [] }];
  const [headers, ...body] = rows;
  const cells = (r: string[]): Cell[] => headers!.map((_, i) => ({ text: (r[i] ?? '').trim(), alternatives: [] }));
  return [{ page: 1, rotation: 0, readable: true, issues: [], source: 'structured_import', blocks: [{ kind: 'heading', text: 'Structured import' }, { kind: 'table', headers: headers!.map((h) => h.trim()), rows: body.map(cells) }], plainText: text }];
}

export function layoutFromJson(text: string): LayoutPage[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [{ page: 1, rotation: 0, readable: false, issues: ['invalid JSON'], source: 'structured_import', blocks: [] }];
  }
  const records = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)['courses']) ? ((data as Record<string, unknown>)['courses'] as unknown[]) : null;
  if (!records || records.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
    return [{ page: 1, rotation: 0, readable: false, issues: ['unsupported JSON structure: expected an array of records'], source: 'structured_import', blocks: [] }];
  }
  const headers = [...new Set(records.flatMap((r) => Object.keys(r as Record<string, unknown>)))];
  const rows = (records as Array<Record<string, unknown>>).map((r) => headers.map((h) => ({ text: r[h] === undefined || r[h] === null ? '' : String(r[h]), alternatives: [] })));
  return [{ page: 1, rotation: 0, readable: true, issues: [], source: 'structured_import', blocks: [{ kind: 'table', headers, rows }], plainText: text }];
}
