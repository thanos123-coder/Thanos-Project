import { inflateSync } from 'node:zlib';
import { inspectPdf, type PdfInspection } from './pdf-text.js';

/**
 * File quarantine (03R01): validate actual file type, size, page count,
 * encryption state and basic integrity before parsing. "A filename alone is not
 * a trustworthy content-type check." Unsupported embedded objects, macros,
 * external references and excessively expensive files are rejected or isolated.
 */

export type SniffedType = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'tiff' | 'office_zip' | 'zip' | 'csv' | 'json' | 'text' | 'unknown';

export interface QuarantineLimits {
  maxBytes: number;
  maxPages: number;
  maxImagePixels: number;
}

export const DEFAULT_LIMITS: QuarantineLimits = { maxBytes: 20 * 1024 * 1024, maxPages: 40, maxImagePixels: 60_000_000 };

export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<'clean' | 'infected' | 'error'>;
}

export interface QuarantineReport {
  sniffed: SniffedType;
  declaredMediaType: string | null;
  declaredMismatch: boolean;
  sizeBytes: number;
  pages: number | null;
  activeContent: string[];
  malware: 'clean' | 'infected' | 'scan_error' | 'not_configured';
  decision: 'accepted' | 'rejected' | 'needs_unlock';
  reasons: string[];
  /** Student-facing explanation of the decision. */
  studentMessage: string;
}

export function sniffType(bytes: Uint8Array): SniffedType {
  const b = (i: number) => bytes[i] ?? -1;
  const ascii = (start: number, len: number) => String.fromCharCode(...bytes.slice(start, start + len));
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  // Some PDFs have leading bytes before the header; the spec allows up to 1024.
  const head = String.fromCharCode(...bytes.slice(0, Math.min(1024, bytes.length)));
  if (head.includes('%PDF-')) return 'pdf';
  if (b(0) === 0x89 && ascii(1, 3) === 'PNG') return 'png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if ((b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2a && b(3) === 0x00) || (b(0) === 0x4d && b(1) === 0x4d && b(2) === 0x00 && b(3) === 0x2a)) return 'tiff';
  if (b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) {
    const latin = latin1(bytes);
    return /(word|xl|ppt)\/|\[Content_Types\]\.xml/.test(latin) ? 'office_zip' : 'zip';
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, Math.min(bytes.length, 64 * 1024)));
  } catch {
    return 'unknown';
  }
  if (text.includes('\u0000')) return 'unknown';
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && isJson(new TextDecoder().decode(bytes))) return 'json';
  const lines = trimmed.split(/\r?\n/).slice(0, 20).filter((l) => l.length > 0);
  if (lines.length >= 2) {
    for (const sep of [',', ';', '\t']) {
      const counts = lines.map((l) => l.split(sep).length);
      if (counts[0]! >= 2 && counts.every((c) => c === counts[0])) return 'csv';
    }
  }
  return 'text';
}

function isJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** Upper bound on decompressed bytes inspected per file, so a compression bomb cannot exhaust memory. */
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;

/**
 * Text of the file's Flate-compressed object streams (/Type /ObjStm). Most PDF
 * writers store dictionaries, including actions, inside them, where a scan of
 * the raw bytes cannot see them. Page content streams are not included, so
 * text printed on a page cannot trigger a finding. Streams that fail to
 * inflate are skipped; the parser decides whether the file is malformed.
 */
function inflatedObjectStreams(bytes: Uint8Array): string {
  const text = latin1(bytes);
  const out: string[] = [];
  let budget = MAX_INFLATED_BYTES;
  for (const m of text.matchAll(/\bobj\b((?:(?!\bendobj\b)[\s\S]){0,1000}?)\bstream\r?\n/g)) {
    const dict = m[1]!;
    if (!/\/Type\s*\/ObjStm\b/.test(dict) || !/\/FlateDecode\b/.test(dict)) continue;
    const start = m.index! + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0 || budget <= 0) continue;
    try {
      const inflated = inflateSync(bytes.subarray(start, end), { maxOutputLength: Math.min(budget, 4 * 1024 * 1024) });
      budget -= inflated.length;
      out.push(latin1(inflated));
    } catch {
      // Not inflatable within the limits: skipped.
    }
  }
  return out.join('\n');
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return s;
}

const MEDIA_FOR: Record<SniffedType, string | null> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  tiff: 'image/tiff',
  office_zip: null,
  zip: null,
  csv: 'text/csv',
  json: 'application/json',
  text: 'text/plain',
  unknown: null,
};

export function mediaTypeOf(t: SniffedType): string | null {
  return MEDIA_FOR[t];
}

function imagePixels(bytes: Uint8Array, t: SniffedType): number | null {
  const u32 = (i: number) => ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
  if (t === 'png' && bytes.length > 24) return u32(16) * u32(20);
  if (t === 'jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        const w = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        return h * w;
      }
      i += 2 + len;
    }
  }
  return null;
}

export interface QuarantineOutcome {
  report: QuarantineReport;
  pdf?: PdfInspection;
}

/** Inspect an upload. Never executes content; returns a decision with reasons. */
export async function quarantine(bytes: Uint8Array, declaredMediaType: string | null, scanner: MalwareScanner | null, limits: QuarantineLimits = DEFAULT_LIMITS): Promise<QuarantineOutcome> {
  const reasons: string[] = [];
  const activeContent: string[] = [];
  const sniffed = sniffType(bytes);
  const expected = mediaTypeOf(sniffed);
  const declaredMismatch = declaredMediaType !== null && expected !== null && declaredMediaType.toLowerCase() !== expected;
  const report: QuarantineReport = { sniffed, declaredMediaType, declaredMismatch, sizeBytes: bytes.length, pages: null, activeContent, malware: 'not_configured', decision: 'accepted', reasons, studentMessage: '' };
  const reject = (reason: string, message: string): QuarantineOutcome => {
    reasons.push(reason);
    report.decision = 'rejected';
    report.studentMessage = message;
    return { report };
  };

  if (bytes.length === 0) return reject('empty_file', 'The file is empty.');
  if (bytes.length > limits.maxBytes) return reject('file_too_large', `The file is larger than the supported ${Math.round(limits.maxBytes / 1024 / 1024)} MB. A smaller export or fewer pages would work.`);
  if (declaredMismatch) reasons.push(`declared type ${declaredMediaType} does not match the file content (${sniffed})`);

  if (scanner) {
    try {
      const r = await scanner.scan(bytes);
      report.malware = r === 'error' ? 'scan_error' : r;
    } catch {
      report.malware = 'scan_error';
    }
    if (report.malware === 'infected') return reject('malware_detected', 'This file could not be accepted because the security scan flagged it.');
    if (report.malware === 'scan_error') return reject('malware_scan_failed', 'The security scan could not complete, so the file was not opened. Please try again later.');
  }

  switch (sniffed) {
    case 'unknown':
      return reject('unsupported_type', 'This file type is not supported. PDF, PNG, JPEG, or a CSV export works.');
    case 'zip':
      return reject('archive_not_supported', 'Archives are not opened. Please upload the individual documents.');
    case 'office_zip': {
      const latin = latin1(bytes);
      if (/vbaProject\.bin|macros\//i.test(latin)) activeContent.push('macros');
      if (/externalLink|oleObject/i.test(latin)) activeContent.push('external_or_embedded_objects');
      return reject(activeContent.length ? 'office_active_content' : 'office_requires_conversion', 'Office documents are not opened directly. Please save it as a PDF and upload that instead.');
    }
    case 'pdf': {
      // Plain objects plus the decompressed object streams, where writers usually put actions.
      const raw = latin1(bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024))) + inflatedObjectStreams(bytes);
      if (/\/Launch\b/.test(raw)) activeContent.push('launch_action');
      if (/\/GoToR\b|\/GoToE\b/.test(raw)) activeContent.push('remote_reference');
      if (/\/RichMedia\b/.test(raw)) activeContent.push('rich_media');
      if (/\/JavaScript\b|\/JS\s*[(<]/.test(raw)) activeContent.push('javascript');
      const pdf = await inspectPdf(bytes, { maxPages: limits.maxPages });
      if (!pdf.ok) {
        if (pdf.reason === 'password_required') {
          reasons.push('password_protected');
          report.decision = 'needs_unlock';
          report.studentMessage = 'This PDF is password protected. Please export an unprotected copy from the original source. We will never ask for your school or exam account passwords.';
          return { report };
        }
        if (pdf.reason === 'too_many_pages') {
          report.pages = pdf.numPages ?? null;
          return reject('too_many_pages', `The PDF has more pages than the supported ${limits.maxPages}. Uploading only the relevant pages would work.`);
        }
        return reject('malformed_pdf', 'The PDF appears to be damaged and could not be read safely.');
      }
      report.pages = pdf.numPages;
      if (pdf.hasJavaScript && !activeContent.includes('javascript')) activeContent.push('javascript');
      if (pdf.hasAttachments) activeContent.push('embedded_files');
      if (pdf.hasLocalFileAction && !activeContent.includes('launch_action')) activeContent.push('launch_action');
      if (activeContent.includes('launch_action') || activeContent.includes('embedded_files')) {
        return reject('pdf_active_content', 'This PDF contains embedded files or launch actions, which are not opened. Printing it to a new PDF usually removes them.');
      }
      if (activeContent.length > 0) reasons.push(`isolated active content: ${activeContent.join(', ')} (never executed)`);
      report.studentMessage = 'The document was accepted for reading.';
      return { report, pdf };
    }
    case 'png':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'tiff': {
      const px = imagePixels(bytes, sniffed);
      if (px !== null && px > limits.maxImagePixels) return reject('image_too_large', 'The image resolution is too large to process safely. A smaller scan would work.');
      report.pages = 1;
      report.studentMessage = 'The image was accepted for reading.';
      return { report };
    }
    case 'csv':
    case 'json':
    case 'text':
      report.pages = 1;
      report.studentMessage = 'The file was accepted for reading.';
      return { report };
  }
}
