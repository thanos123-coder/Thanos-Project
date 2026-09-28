import type { TestFamily, TestScoreRecord } from '../../shared/assessments.js';
import { findDateInText, parseHumanDate } from '../../shared/date-parse.js';
import type { CourseLevel, SubjectMapping } from '../../shared/fields.js';
import { REFERENCE_SCALES, parseGrade, parseLocalizedNumber, type GradeResultStatus } from '../../shared/grades.js';
import type { AcademicPeriod, CalendarDate, PartialDate } from '../../shared/time.js';
import { isStrictlyBefore } from '../../shared/time.js';
import { detectInjectionSignals } from '../../runtime/untrusted.js';
import type { Cell, LayoutPage } from './layout.js';

/**
 * Semantic interpretation of page layouts (03R06-03R12). Deterministic and
 * conservative: values are preserved exactly, statuses come only from explicit
 * document evidence (headings, legends, columns) or from a period that has
 * clearly ended, and anything uncertain becomes an ambiguity for review.
 */

export const PARSER_VERSION = 'interpret_v1';

export type DocumentClass =
  | 'transcript'
  | 'report_card'
  | 'predicted_grades'
  | 'qualification_certificate'
  | 'test_report'
  | 'school_profile'
  | 'course_catalog'
  | 'activity_evidence'
  | 'unknown';

export interface Anchor {
  page: number;
  /** Index of the table on its page, when the value is a table cell. */
  tableIndex?: number;
  row?: number;
  column?: number;
  columnHeader?: string;
  /** Index of the block on its page, for non-table values. */
  blockIndex?: number;
  text: string;
  method: 'text_layer' | 'ocr' | 'vision_model' | 'structured_import';
}

export type StatusBasis = 'heading' | 'legend' | 'column' | 'period_ended' | 'period_current' | 'document_class' | 'none';

export interface CourseObservation {
  localId: string;
  name: { original: string; anchor: Anchor };
  code?: { original: string; anchor: Anchor };
  level: { value: CourseLevel; anchor: Anchor | null; basis: 'column' | 'name_suffix' | 'not_shown' };
  period?: { value: AcademicPeriod; anchor: Anchor | null };
  grade?: {
    original: string;
    status: GradeResultStatus;
    statusBasis: StatusBasis;
    scaleRef: string | null;
    anchor: Anchor;
    /** Alternative readings; when present the value is ambiguous and must be confirmed. */
    candidates: string[];
    /** Reason the value needs review, if any. */
    reviewNote?: string;
  };
  credit?: { original: string; unit: string | null; anchor: Anchor };
  subject?: SubjectMapping;
  attempt?: { number: number; kind: 'first' | 'resit' | 'retake' | 'remark' };
  courseKey?: string;
  enrollmentStatus?: 'completed' | 'in_progress' | 'withdrawn' | 'planned';
}

export interface OfferingObservation {
  name: string;
  subjectKey: string | null;
  level: CourseLevel['normalized'];
  termsOffered: string[];
  prerequisites: string[];
  anchor: Anchor;
}

export interface TestObservation {
  /** Null when a required element (such as the test date) is missing; nothing is invented to fill it. */
  record: TestScoreRecord | null;
  family: TestFamily;
  anchor: Anchor;
  ambiguities: string[];
}

export interface Ambiguity {
  field: string;
  /** Local course id or 'document' / 'test:<n>' */
  subject: string;
  candidates: string[];
  consequence: 'critical' | 'moderate' | 'minor';
  question: string;
  anchor: Anchor | null;
}

export interface Concern {
  kind: 'injection_signal' | 'printed_total_differs' | 'identity_mismatch' | 'multiple_subjects' | 'unrecognized_table' | 'declared_type_mismatch' | 'active_content_isolated' | 'authenticity_limit' | 'unreadable_page' | 'scale_unknown' | 'value_out_of_range';
  detail: string;
  pages: number[];
}

export interface InterpretContext {
  documentId: string;
  documentVersion: number;
  now: CalendarDate;
  accountLegalName: string | null;
  confirmedQualificationSystem: string | null;
  declaredDocumentType: string | null;
  /** Alternative readings of the same pages from another method (e.g. vision vs text layer), for cross-checks. */
  alternateReadings?: readonly LayoutPage[];
}

export interface InterpretationResult {
  parserVersion: string;
  documentClass: DocumentClass;
  classBasis: string[];
  identity: { namesFound: Array<{ name: string; pages: number[] }>; decision: 'matches_account' | 'mismatch' | 'unknown' | 'multiple_subjects'; importPages: number[]; quarantinedPages: number[] };
  scale: { scaleRef: string | null; basis: string };
  legend: Record<string, GradeResultStatus | 'pass' | 'unknown_meaning'>;
  courses: CourseObservation[];
  offerings: OfferingObservation[];
  tests: TestObservation[];
  qualification: { credentialId: string; label: string; status: 'in_progress' | 'awarded' | 'completed' | null; total: { original: string; status: GradeResultStatus; anchor: Anchor } | null; anchor: Anchor } | null;
  expectedGraduation: { value: PartialDate; anchor: Anchor } | null;
  schoolContext: Array<{ topic: string; text: string; anchor: Anchor }>;
  ambiguities: Ambiguity[];
  concerns: Concern[];
  unreadablePages: number[];
}

// ------------------------------------------------------------------ vocabulary

const NAME_KEYS = /^(student(\s+name)?|name|candidate(\s+name)?|pupil(\s+name)?|learner)$/i;
const COLUMN_ROLES: Array<{ role: ColumnRole; re: RegExp }> = [
  { role: 'period', re: /^(grade level|year level|year|term|semester|session|period|school year|academic year)$/i },
  { role: 'credits', re: /\b(credits?|units?|hours|ects|weight(ing)?|coefficient)\b/i },
  { role: 'code', re: /^(code|course (no\.?|number|code|#)|subject code)$/i },
  { role: 'level', re: /^(level|track|course level|type)$/i },
  { role: 'status', re: /^(status|remark|remarks|note|notes)$/i },
  { role: 'attempt', re: /^(attempt|sitting)$/i },
  { role: 'course', re: /\b(course|subject|module|class|title|examination)\b/i },
  { role: 'grade', re: /\b(grade|mark|marks|result|score|points)\b/i },
];

type ColumnRole = 'course' | 'code' | 'level' | 'period' | 'grade' | 'credits' | 'status' | 'attempt';

const STATUS_WORDS: Array<{ status: GradeResultStatus; re: RegExp }> = [
  { status: 'predicted', re: /\b(predicted|forecast|anticipated|expected grades?)\b/i },
  { status: 'provisional', re: /\bprovisional\b/i },
  { status: 'in_progress', re: /\b(in progress|current courses?|currently enrolled|ongoing)\b/i },
  { status: 'remarked', re: /\b(re-?marked|remark)\b/i },
  { status: 'resit', re: /\b(re-?sit|retake|re-?take|repeat(ed)?)\b/i },
  { status: 'transfer_credit', re: /\btransfer(red)? credit\b/i },
  { status: 'final', re: /\b(final (results?|grades?|marks?)|results? awarded|achieved|final)\b/i },
];

// 03R09: predicted, provisional, final, remarked, resit and transfer results stay distinct; repeated attempts stay separate records.
function statusFrom(text: string): GradeResultStatus | null {
  for (const { status, re } of STATUS_WORDS) if (re.test(text)) return status;
  return null;
}

const LEGEND_MEANINGS: Array<{ meaning: GradeResultStatus | 'pass'; re: RegExp }> = [
  { meaning: 'predicted', re: /predicted|forecast/i },
  { meaning: 'exempt', re: /exempt/i },
  { meaning: 'withdrawn', re: /withdr/i },
  { meaning: 'incomplete', re: /incomplete/i },
  { meaning: 'in_progress', re: /in progress|current/i },
  { meaning: 'transfer_credit', re: /transfer/i },
  { meaning: 'resit', re: /re-?sit|retake|repeat/i },
  { meaning: 'provisional', re: /provisional/i },
  { meaning: 'remarked', re: /re-?mark/i },
  { meaning: 'pass', re: /\bpass(ed)?\b/i },
];

const LEVEL_SUFFIXES: Array<{ level: NonNullable<CourseLevel['normalized']>; re: RegExp }> = [
  { level: 'IB_HL', re: /\b(HL|Higher Level)\b/ },
  { level: 'IB_SL', re: /\b(SL|Standard Level)\b/ },
  { level: 'AS_LEVEL', re: /\bAS[- ]?Level\b/i },
  { level: 'A_LEVEL', re: /\bA[- ]?Level\b/i },
  { level: 'AP', re: /(^|\s)AP\b/ },
  { level: 'honors', re: /\bHonou?rs\b|\(H\)/i },
  { level: 'dual_enrollment', re: /\bdual enrollment\b/i },
];

const IB_TITLES: Array<{ key: string; re: RegExp }> = [
  { key: 'ib.math_aa', re: /^math(ematics)?\s*(:|-)?\s*(analysis and approaches|aa)\b/i },
  { key: 'ib.math_ai', re: /^math(ematics)?\s*(:|-)?\s*(applications and interpretation|ai)\b/i },
  { key: 'ib.physics', re: /^physics\b/i },
  { key: 'ib.chemistry', re: /^chemistry\b/i },
  { key: 'ib.biology', re: /^biology\b/i },
  { key: 'ib.computer_science', re: /^computer science\b/i },
  { key: 'ib.economics', re: /^economics\b/i },
  { key: 'ib.history', re: /^history\b/i },
  { key: 'ib.visual_arts', re: /^visual arts\b/i },
  { key: 'ib.music', re: /^music\b/i },
  { key: 'ib.english_a_lang_lit', re: /^english a:?\s*language and literature\b/i },
  { key: 'ib.english_a_literature', re: /^english a:?\s*literature\b/i },
  { key: 'ib.english_b', re: /^english b\b/i },
];

const BROAD_KEYWORDS: Array<{ key: string; re: RegExp }> = [
  { key: 'mathematics', re: /\b(math|mathematics|maths|algebra|calculus|geometry|statistics)\b/i },
  { key: 'physics', re: /\bphysics\b/i },
  { key: 'chemistry', re: /\bchemistry\b/i },
  { key: 'biology', re: /\bbiology\b/i },
  { key: 'computer_science', re: /\b(computer science|computing|informatics|programming)\b/i },
  { key: 'economics', re: /\beconomics\b/i },
  { key: 'english', re: /\benglish\b/i },
  { key: 'history', re: /\bhistory\b/i },
  { key: 'visual_arts', re: /\b(art|visual arts|design)\b/i },
  { key: 'music', re: /\bmusic\b/i },
];

// ------------------------------------------------------------------ helpers

export function normalizePersonName(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .split(/[\s'-]+/)
    .filter((t) => t.length > 1)
    .sort();
}

/** Names match when every token of the shorter name (at least two tokens) appears in the longer one. Order does not matter. */
export function namesMatch(a: string, b: string): boolean {
  const ta = normalizePersonName(a);
  const tb = normalizePersonName(b);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2) return short.length > 0 && short.join() === long.join();
  return short.every((t) => long.includes(t));
}

function cellText(c: Cell | undefined): string {
  return (c?.text ?? '').trim();
}

function periodFromLabel(label: string): AcademicPeriod {
  const t = label.trim();
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{4})\s*[-/–]\s*(\d{2,4})\b/.exec(t))) {
    const y1 = Number(m[1]);
    const y2 = m[2]!.length === 2 ? Number(`${String(y1).slice(0, 2)}${m[2]}`) : Number(m[2]);
    if (y2 === y1 + 1) return { label: t, kind: 'school_year', start: `${y1}-08`, end: `${y2}-07` };
  }
  if ((m = /\b(fall|autumn)\s+(\d{4})\b/i.exec(t))) return { label: t, kind: 'semester', start: `${m[2]}-08`, end: `${m[2]}-12` };
  if ((m = /\bspring\s+(\d{4})\b/i.exec(t))) return { label: t, kind: 'semester', start: `${m[1]}-01`, end: `${m[1]}-06` };
  if ((m = /\bsummer\s+(\d{4})\b/i.exec(t))) return { label: t, kind: 'summer', start: `${m[1]}-06`, end: `${m[1]}-08` };
  if ((m = /\b(semester|term)\s*\d\b/i.exec(t))) return { label: t, kind: m[1]!.toLowerCase() === 'term' ? 'term' : 'semester' };
  return { label: t, kind: 'unknown' };
}

function scaleFromText(text: string): { scaleRef: string; basis: string } | null {
  if (/\b(1\s*(-|–|to)\s*7)\b|scale of 1\s*(-|–|to)\s*7/i.test(text)) return { scaleRef: 'ib_subject_1_7', basis: 'The document states a 1-7 grade scale.' };
  if (/\b(out of 20|\/\s*20\b|0\s*(-|–|to)\s*20\b|scale of 0\s*(-|–|to)\s*20)/i.test(text)) return { scaleRef: 'twenty_point_0_20', basis: 'The document states a 20-point scale.' };
  if (/\b(0\s*(-|–|to)\s*100\b|percentage marks?|out of 100)\b/i.test(text)) return { scaleRef: 'percentage_0_100', basis: 'The document states marks out of 100.' };
  if (/\bA\*\s*(-|–|to)\s*E\b|A\*\s*[-–]\s*U\b/i.test(text)) return { scaleRef: 'a_level_letter', basis: 'The document states an A*-E scale.' };
  return null;
}

// ------------------------------------------------------------------ main

// 03R07: source fields are captured exactly as printed (name, code, level, period, grade string, scale, credit, status).
export function interpretDocument(pages: readonly LayoutPage[], ctx: InterpretContext): InterpretationResult {
  const concerns: Concern[] = [];
  const ambiguities: Ambiguity[] = [];
  const unreadablePages = pages.filter((p) => !p.readable).map((p) => p.page);
  if (unreadablePages.length > 0) concerns.push({ kind: 'unreadable_page', detail: 'Some pages could not be read; a clearer scan of these pages would help.', pages: unreadablePages });

  // All text, for classification, scale and injection checks.
  const pageText = new Map<number, string>();
  for (const p of pages) {
    const parts = p.blocks.map((b) => (b.kind === 'table' ? [b.headers.join(' '), ...b.rows.map((r) => r.map(cellText).join(' '))].join('\n') : b.kind === 'key_value' ? `${b.key}: ${b.value}` : b.text));
    pageText.set(p.page, [p.plainText ?? '', ...parts].join('\n'));
  }
  const allText = [...pageText.values()].join('\n');

  for (const [page, text] of pageText) {
    const signals = detectInjectionSignals(text);
    if (signals.length > 0) concerns.push({ kind: 'injection_signal', detail: `Text on this page looks like instructions to software (${signals.map((s) => s.pattern).join(', ')}). It is treated only as document content.`, pages: [page] });
  }

  // Identity (03R03): names per page, carried forward to continuation pages.
  const namesByPage = new Map<number, string>();
  let lastName: string | null = null;
  for (const p of pages) {
    for (const b of p.blocks) if (b.kind === 'key_value' && NAME_KEYS.test(b.key.trim())) lastName = b.value.trim();
    if (lastName) namesByPage.set(p.page, lastName);
  }
  const distinct: Array<{ name: string; pages: number[] }> = [];
  for (const [page, name] of namesByPage) {
    const found = distinct.find((d) => namesMatch(d.name, name));
    if (found) found.pages.push(page);
    else distinct.push({ name, pages: [page] });
  }
  let decision: InterpretationResult['identity']['decision'] = 'unknown';
  let importPages = pages.map((p) => p.page);
  let quarantinedPages: number[] = [];
  if (distinct.length > 1) {
    decision = 'multiple_subjects';
    if (ctx.accountLegalName) {
      const mine = distinct.find((d) => namesMatch(d.name, ctx.accountLegalName!));
      importPages = mine ? mine.pages : [];
    } else importPages = [];
    quarantinedPages = pages.map((p) => p.page).filter((pg) => !importPages.includes(pg));
    concerns.push({ kind: 'multiple_subjects', detail: 'This file appears to contain records for more than one person. Only pages that match your account are used; the rest are set aside and not imported.', pages: quarantinedPages });
  } else if (distinct.length === 1 && ctx.accountLegalName) {
    decision = namesMatch(distinct[0]!.name, ctx.accountLegalName) ? 'matches_account' : 'mismatch';
    if (decision === 'mismatch') {
      importPages = [];
      quarantinedPages = pages.map((p) => p.page);
      concerns.push({ kind: 'identity_mismatch', detail: 'The name on the document is written differently from the name on your account. This can be a transliteration or spelling difference; please confirm the document is yours before anything is imported.', pages: quarantinedPages });
    }
  }
  const usablePages = pages.filter((p) => importPages.includes(p.page) && p.readable);

  // Classification from content, independent of what the uploader said (03T13).
  const classBasis: string[] = [];
  const has = (re: RegExp, label: string) => {
    if (re.test(allText)) {
      classBasis.push(label);
      return true;
    }
    return false;
  };
  let documentClass: DocumentClass = 'unknown';
  if (has(/course catalog(ue)?|program(me)? of studies|courses? offered|course offerings|curriculum guide/i, 'catalog wording')) documentClass = 'course_catalog';
  else if (has(/school profile/i, 'school profile wording')) documentClass = 'school_profile';
  else if (has(/score report|test report|\btoefl\b|\bielts\b|\bduolingo english test\b|\bsat\b.*\bscore|\bact\b.*composite/i, 'test report wording')) documentClass = 'test_report';
  else if (has(/transcript|academic record|record of achievement/i, 'transcript wording')) documentClass = 'transcript';
  else if (has(/predicted grades?|forecast grades?/i, 'predicted grades wording')) documentClass = 'predicted_grades';
  else if (has(/report card|term report|progress report|school report/i, 'report card wording')) documentClass = 'report_card';
  else if (has(/certificate of participation|volunteer(ing)? hours|letter of (recognition|completion)/i, 'activity evidence wording')) documentClass = 'activity_evidence';
  else if (has(/certificate|diploma (is )?awarded|has been awarded/i, 'certificate wording')) documentClass = 'qualification_certificate';
  if (ctx.declaredDocumentType && documentClass !== 'unknown' && !ctx.declaredDocumentType.toLowerCase().includes(documentClass.split('_')[0]!)) {
    concerns.push({ kind: 'declared_type_mismatch', detail: `This was uploaded as "${ctx.declaredDocumentType}", but its content reads as a ${documentClass.replace(/_/g, ' ')}.`, pages: [] });
  }

  // Legend (03R08): symbol meanings only from the document itself.
  const legend: Record<string, GradeResultStatus | 'pass' | 'unknown_meaning'> = {};
  for (const p of pages) {
    for (const b of p.blocks) {
      if (b.kind !== 'legend' && b.kind !== 'paragraph' && b.kind !== 'key_value') continue;
      const text = b.kind === 'key_value' ? `${b.key}: ${b.value}` : b.text;
      if (b.kind !== 'legend' && !/legend|key|symbol|denotes|indicates|=/i.test(text)) continue;
      for (const m of text.matchAll(/(^|[\s;,(])([*†‡#^~+]|[A-Z]{1,2}|-{1,2}|–|—)\s*(?:=|:|–|—|\bdenotes\b|\bindicates\b|\bmeans\b)\s*([A-Za-z][A-Za-z -]{2,40})/g)) {
        const symbol = m[2]!;
        const meaningText = m[3]!;
        const meaning = LEGEND_MEANINGS.find((x) => x.re.test(meaningText))?.meaning ?? 'unknown_meaning';
        if (!/^(legend|key|note)$/i.test(symbol)) legend[symbol] = meaning;
      }
    }
  }

  // Scale (only when stated, or implied by a confirmed credential and consistent values).
  let scale = scaleFromText(allText);
  const ibContext = ctx.confirmedQualificationSystem === 'IB_DP' || /international baccalaureate|\bIB diploma\b|diploma programme/i.test(allText);
  if (!scale && ibContext) scale = { scaleRef: 'ib_subject_1_7', basis: 'IB Diploma Programme context; IB subject grades use a 1-7 scale.' };
  if (!scale && (ctx.confirmedQualificationSystem === 'A_LEVEL' || /\bA[- ]levels?\b/i.test(allText))) scale = { scaleRef: 'a_level_letter', basis: 'A level context.' };

  const courses: CourseObservation[] = [];
  const offerings: OfferingObservation[] = [];
  const schoolContext: InterpretationResult['schoolContext'] = [];
  let qualification: InterpretationResult['qualification'] = null;
  let expectedGraduation: InterpretationResult['expectedGraduation'] = null;
  const testKv: Array<{ key: string; value: string; anchor: Anchor }> = [];

  let statusHint: { status: GradeResultStatus; basis: StatusBasis } | null = null;
  let periodHint: string | null = null;
  let courseCounter = 0;

  for (const p of usablePages) {
    let tableIndex = -1;
    p.blocks.forEach((b, blockIndex) => {
      const anchorBase = { page: p.page, blockIndex, method: p.source } as const;
      if (b.kind === 'heading' || b.kind === 'paragraph') {
        const s = statusFrom(b.text);
        if (b.kind === 'heading' && s) statusHint = { status: s, basis: 'heading' };
        if (b.kind === 'heading') {
          const range = /\b\d{4}\s*[-/–]\s*\d{2,4}\b|\b(fall|spring|summer|autumn) \d{4}\b/i.exec(b.text)?.[0];
          const named = /\b(year|grade|form) \d{1,2}\b/i.exec(b.text)?.[0];
          if (range || named) periodHint = named && range ? `${named} (${range})` : (range ?? named)!;
        }
        if (documentClass === 'school_profile' || /does not offer|not offered|no (advanced|AP|IB|honou?rs) courses|only offers/i.test(b.text)) {
          if (/offer|available|curriculum|courses/i.test(b.text)) schoolContext.push({ topic: 'course_availability', text: b.text, anchor: { ...anchorBase, text: b.text } });
        }
        if (/diploma programme|ib diploma|international baccalaureate diploma/i.test(b.text) && !qualification) {
          qualification = { credentialId: 'IB_DIPLOMA', label: 'IB Diploma', status: /awarded/i.test(b.text) ? 'awarded' : /candidate|predicted|in progress|expected/i.test(allText) ? 'in_progress' : null, total: null, anchor: { ...anchorBase, text: b.text } };
        }
        return;
      }
      if (b.kind === 'legend') return;
      if (b.kind === 'key_value') {
        const k = b.key.trim();
        const anchor: Anchor = { ...anchorBase, text: `${b.key}: ${b.value}` };
        if (/expected (graduation|completion)|graduation date|anticipated graduation|expected date of completion/i.test(k)) {
          const d = parseHumanDate(b.value);
          const inText = d.kind === 'none' ? findDateInText(b.value) : d;
          if (inText.kind === 'date') expectedGraduation = { value: inText.value, anchor };
          else if (inText.kind === 'ambiguous') ambiguities.push({ field: 'expected_graduation', subject: 'document', candidates: inText.candidates, consequence: 'critical', question: `The document lists "${b.value}" as the expected completion date. Which date is it?`, anchor });
        }
        if (/total (points|diploma points)|diploma points|points total/i.test(k) && qualification) {
          const q = qualification as NonNullable<InterpretationResult['qualification']>;
          q.total = { original: b.value.trim(), status: statusHint?.status ?? 'unknown', anchor };
        }
        if (/^(qualification|programme|program|diploma)$/i.test(k) && /ib|international baccalaureate/i.test(b.value) && !qualification) {
          qualification = { credentialId: 'IB_DIPLOMA', label: 'IB Diploma', status: null, total: null, anchor };
        }
        testKv.push({ key: k, value: b.value.trim(), anchor });
        return;
      }
      // Tables.
      tableIndex += 1;
      // Continuation tables (the same headers repeated on a later page) keep the running heading context,
      // and their repeated header rows are skipped below.
      const roles = b.headers.map((h) => COLUMN_ROLES.find((r) => r.re.test(h.trim()))?.role ?? null);
      const colOf = (role: ColumnRole) => roles.indexOf(role);
      const courseCol = colOf('course');
      const gradeCols = roles.map((r, i) => (r === 'grade' ? i : -1)).filter((i) => i >= 0);
      if (courseCol < 0) {
        // Score tables in test reports: rows of section / score.
        if (documentClass === 'test_report') {
          for (const [ri, row] of b.rows.entries()) {
            const label = cellText(row[0]);
            const val = cellText(row[row.length - 1]);
            if (label && val) testKv.push({ key: label, value: val, anchor: { page: p.page, tableIndex, row: ri, column: row.length - 1, columnHeader: b.headers[row.length - 1] ?? '', text: val, method: p.source } });
          }
        } else concerns.push({ kind: 'unrecognized_table', detail: `A table with columns "${b.headers.join(', ')}" was not recognized and was not imported.`, pages: [p.page] });
        return;
      }
      const headerSet = new Set(b.headers.map((h) => h.trim().toLowerCase()));
      for (const [ri, row] of b.rows.entries()) {
        const name = cellText(row[courseCol]);
        const otherCells = row.filter((c, i) => i !== courseCol && cellText(c));
        // Prose lines captured inside a table region are not courses.
        if (otherCells.length === 0 && (/[.!?]$/.test(name) || name.split(/\s+/).length >= 7)) continue;
        // Repeated header rows (continuation pages) are not courses (03T04).
        if (!name || (row.every((c, i) => !cellText(c) || headerSet.has(cellText(c).toLowerCase()) || i === courseCol) && headerSet.has(name.toLowerCase()))) continue;
        if (/^(total|sum|overall|gpa|cumulative)\b/i.test(name)) {
          const creditCol = colOf('credits');
          if (creditCol >= 0) {
            const printed = parseLocalizedNumber(cellText(row[creditCol]));
            const sum = courses.filter((c) => c.credit && c.name.anchor.page <= p.page).reduce((acc, c) => acc + (Number(parseLocalizedNumber(c.credit!.original)) || 0), 0);
            if (typeof printed === 'number' && Math.abs(printed - sum) > 1e-6) concerns.push({ kind: 'printed_total_differs', detail: `The printed total (${cellText(row[creditCol])}) differs from the sum of the listed credits (${sum}); the printed value is kept and the difference is flagged. Weighting or exemptions can explain this.`, pages: [p.page] });
          }
          continue;
        }
        if (documentClass === 'course_catalog') {
          const levelCol = colOf('level');
          const levelText = levelCol >= 0 ? cellText(row[levelCol]) : '';
          offerings.push({
            name,
            subjectKey: subjectFor(name, ibContext)?.key ?? null,
            level: levelFrom(levelText, name).value.normalized,
            termsOffered: colOf('period') >= 0 && cellText(row[colOf('period')]) ? [cellText(row[colOf('period')])] : [],
            prerequisites: [],
            anchor: { page: p.page, tableIndex, row: ri, column: courseCol, columnHeader: b.headers[courseCol] ?? '', text: name, method: p.source },
          });
          continue;
        }
        const cellAnchor = (col: number, text: string): Anchor => ({ page: p.page, tableIndex, row: ri, column: col, columnHeader: b.headers[col] ?? '', text, method: p.source });
        const obs: CourseObservation = {
          localId: `course_${++courseCounter}`,
          name: { original: name, anchor: cellAnchor(courseCol, name) },
          level: { value: { original: null, normalized: null }, anchor: null, basis: 'not_shown' },
        };
        const codeCol = colOf('code');
        if (codeCol >= 0 && cellText(row[codeCol])) obs.code = { original: cellText(row[codeCol]), anchor: cellAnchor(codeCol, cellText(row[codeCol])) };
        const levelCol = colOf('level');
        const lv = levelFrom(levelCol >= 0 ? cellText(row[levelCol]) : '', name);
        obs.level = { value: lv.value, anchor: lv.basis === 'column' ? cellAnchor(levelCol, cellText(row[levelCol])) : lv.basis === 'name_suffix' ? cellAnchor(courseCol, name) : null, basis: lv.basis };
        const periodCol = colOf('period');
        const periodText = periodCol >= 0 ? cellText(row[periodCol]) : '';
        if (periodText) obs.period = { value: periodFromLabel(periodText), anchor: cellAnchor(periodCol, periodText) };
        else if (periodHint) obs.period = { value: periodFromLabel(periodHint), anchor: null };
        const subject = subjectFor(name, ibContext);
        if (subject) obs.subject = subject;
        const creditCol = colOf('credits');
        if (creditCol >= 0 && cellText(row[creditCol])) obs.credit = { original: cellText(row[creditCol]), unit: unitFrom(b.headers[creditCol] ?? ''), anchor: cellAnchor(creditCol, cellText(row[creditCol])) };

        // Grade: choose the grade column; if both a predicted and a final column exist, prefer the final value when present.
        const statusCol = colOf('status');
        const statusText = statusCol >= 0 ? cellText(row[statusCol]) : '';
        const chosen = pickGradeColumn(gradeCols, row, b.headers);
        // An empty grade cell means no result is shown: nothing is recorded for it.
        if (chosen !== null && cellText(row[chosen])) {
          const raw = cellText(row[chosen]);
          const cell = row[chosen]!;
          const headerStatus = statusFrom(b.headers[chosen] ?? '');
          let status: GradeResultStatus = 'unknown';
          let statusBasis: StatusBasis = 'none';
          let original = raw;
          let reviewNote: string | undefined;
          // Legend suffix/prefix symbols (e.g. "6*").
          const sym = /^(.*?)([*†‡#^~+])$/.exec(raw);
          if (sym && sym[1]!.trim()) {
            original = sym[1]!.trim();
            const meaning = legend[sym[2]!];
            if (meaning && meaning !== 'pass' && meaning !== 'unknown_meaning') {
              status = meaning;
              statusBasis = 'legend';
            } else if (!meaning) reviewNote = `The symbol "${sym[2]}" next to this grade is not explained on the document.`;
          }
          const whole = legend[raw];
          if (whole && whole !== 'pass' && whole !== 'unknown_meaning' && statusBasis === 'none') {
            status = whole;
            statusBasis = 'legend';
          }
          if (statusBasis === 'none' && statusText && statusFrom(statusText)) {
            status = statusFrom(statusText)!;
            statusBasis = 'column';
          }
          if (statusBasis === 'none' && headerStatus) {
            status = headerStatus;
            statusBasis = 'column';
          }
          if (statusBasis === 'none' && statusHint) {
            status = (statusHint as { status: GradeResultStatus }).status;
            statusBasis = 'heading';
          }
          if (statusBasis === 'none' && obs.period?.value.end) {
            const ended = isStrictlyBefore(obs.period.value.end, ctx.now);
            if (ended === true) {
              status = 'final';
              statusBasis = 'period_ended';
            } else if (obs.period.value.start && isStrictlyBefore(obs.period.value.start, ctx.now) === true) {
              status = 'in_progress';
              statusBasis = 'period_current';
            }
          }
          if (statusBasis === 'none' && documentClass === 'predicted_grades') {
            status = 'predicted';
            statusBasis = 'document_class';
          }
          // Symbols without a legend: preserved, never zero or fail (03T06).
          const symbolOnly = /^([-–—*/?xX]|n\/?a)$/i.test(original);
          if (symbolOnly && !legend[original]) reviewNote = `The symbol "${original}" has no legend on this document, so its meaning (missing, exempt, withdrawn, ...) is not assumed.`;
          const candidates = cell.alternatives.filter((a) => a !== raw);
          obs.grade = { original, status, statusBasis, scaleRef: scale?.scaleRef ?? null, anchor: cellAnchor(chosen, raw), candidates: candidates.length > 0 ? [original, ...candidates] : [] };
          if (reviewNote) obs.grade.reviewNote = reviewNote;
          if (!symbolOnly && scale) {
            const parsed = parseGrade({ original, scaleRef: scale.scaleRef, status, weighting: null }, REFERENCE_SCALES);
            // 03R10: a grade is validated against its scale only when the scale is known; a printed value is never overwritten.
            if (!parsed.ok && parsed.reason === 'out_of_range') {
              obs.grade.reviewNote = `The value "${original}" does not fit the ${REFERENCE_SCALES[scale.scaleRef]!.name}.`;
              concerns.push({ kind: 'value_out_of_range', detail: `A grade (${original}) does not fit the stated scale.`, pages: [p.page] });
            }
            if (!parsed.ok && parsed.reason === 'ambiguous_decimal_separator') obs.grade.reviewNote = `The value "${original}" could be read with a decimal comma or a thousands separator.`;
          }
          if (status === 'final' || status === 'remarked' || status === 'transfer_credit' || status === 'resit') obs.enrollmentStatus = 'completed';
          else if (status === 'predicted' || status === 'in_progress' || status === 'provisional') obs.enrollmentStatus = 'in_progress';
          else if (status === 'withdrawn') obs.enrollmentStatus = 'withdrawn';
        }
        // Explicit resit/retake markers create attempts (03T07).
        const rowText = row.map(cellText).join(' ');
        if (/\b(re-?sit|retake|re-?take|repeat(ed)?)\b/i.test(rowText) || obs.grade?.status === 'resit') obs.attempt = { number: 2, kind: /retake|re-?take|repeat/i.test(rowText) ? 'retake' : 'resit' };
        courses.push(obs);
      }
    });
  }

  // Link attempts of the same course: a resit row and the earlier row with the same name and level.
  const byName = new Map<string, CourseObservation[]>();
  for (const c of courses) {
    const k = `${c.name.original.replace(/\b(re-?sit|retake|re-?take|repeat(ed)?)\b/gi, '').replace(/[()]/g, '').trim().toLowerCase()}|${c.level.value.normalized ?? ''}`;
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  for (const [k, group] of byName) {
    if (group.length < 2 || !group.some((c) => c.attempt)) continue;
    const key = `ck_${k.replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
    let n = 0;
    for (const c of group) {
      n += 1;
      c.courseKey = key;
      c.attempt = c.attempt ? { ...c.attempt, number: n } : { number: n, kind: 'first' };
    }
  }

  // Ambiguities for review, ranked by consequence (03R12).
  for (const c of courses) {
    if (c.grade && c.grade.candidates.length > 1) {
      ambiguities.push({ field: 'grade', subject: c.localId, candidates: c.grade.candidates, consequence: 'critical', question: `The grade for ${c.name.original} could be read as ${c.grade.candidates.join(' or ')}. Which is it? A clearer image would also settle it.`, anchor: c.grade.anchor });
    } else if (c.grade?.reviewNote) {
      ambiguities.push({ field: 'grade', subject: c.localId, candidates: [c.grade.original], consequence: 'critical', question: `${c.grade.reviewNote} What does it mean for ${c.name.original}?`, anchor: c.grade.anchor });
    }
    if (c.grade && c.grade.status === 'unknown' && !c.grade.reviewNote && c.grade.candidates.length === 0) {
      ambiguities.push({ field: 'grade_status', subject: c.localId, candidates: ['final', 'predicted', 'in progress'], consequence: 'critical', question: `Is the result for ${c.name.original} (${c.grade.original}) a final result, a predicted grade, or still in progress?`, anchor: c.grade.anchor });
    }
  }
  // Cross-check against another reading of the same pages (03T09).
  if (ctx.alternateReadings && ctx.alternateReadings.length > 0) {
    const alt = interpretDocument(ctx.alternateReadings, { ...ctx, alternateReadings: [] });
    for (const c of courses) {
      const other = alt.courses.find((o) => o.name.original.toLowerCase() === c.name.original.toLowerCase() && o.name.anchor.page === c.name.anchor.page && (o.period?.value.label ?? '') === (c.period?.value.label ?? ''));
      if (!other || !c.grade || !other.grade) continue;
      if (other.grade.original !== c.grade.original) {
        c.grade.candidates = [...new Set([c.grade.original, other.grade.original])];
        ambiguities.push({ field: 'grade', subject: c.localId, candidates: c.grade.candidates, consequence: 'critical', question: `The page's text layer and its visible image disagree on the grade for ${c.name.original} (${c.grade.candidates.join(' vs ')}). Which is correct?`, anchor: c.grade.anchor });
      }
      const la = c.level.value.normalized;
      const lb = other.level.value.normalized;
      if (la !== lb && (la !== null || lb !== null)) ambiguities.push({ field: 'level', subject: c.localId, candidates: [String(c.level.value.original), String(other.level.value.original)], consequence: 'critical', question: `The text layer and the visible page disagree on the level of ${c.name.original}.`, anchor: c.level.anchor });
    }
  }

  const tests = documentClass === 'test_report' ? parseTestReport(testKv, allText, pages[0]?.source ?? 'text_layer') : [];
  for (const [i, t] of tests.entries()) for (const a of t.ambiguities) ambiguities.push({ field: 'test_score', subject: `test:${i}`, candidates: [], consequence: 'critical', question: a, anchor: t.anchor });
  if (!scale && courses.some((c) => c.grade)) concerns.push({ kind: 'scale_unknown', detail: 'The grading scale is not stated on the document, so grades are kept exactly as printed and are not compared with requirements until the scale is confirmed.', pages: [] });
  concerns.push({ kind: 'authenticity_limit', detail: 'An uploaded copy is not verified by the issuing school. Some institutions require records sent directly by the school.', pages: [] });

  return {
    parserVersion: PARSER_VERSION,
    documentClass,
    classBasis,
    identity: { namesFound: distinct, decision, importPages, quarantinedPages },
    scale: scale ?? { scaleRef: null, basis: 'not stated' },
    legend,
    courses,
    offerings,
    tests,
    qualification,
    expectedGraduation,
    schoolContext,
    ambiguities,
    concerns,
    unreadablePages,
  };
}

function pickGradeColumn(gradeCols: number[], row: Cell[], headers: string[]): number | null {
  if (gradeCols.length === 0) return null;
  if (gradeCols.length === 1) return gradeCols[0]!;
  const final = gradeCols.find((i) => /final|achieved|awarded/i.test(headers[i] ?? '') && cellText(row[i]));
  if (final !== undefined) return final;
  return gradeCols.find((i) => cellText(row[i])) ?? gradeCols[0]!;
}

function levelFrom(levelText: string, name: string): { value: CourseLevel; basis: 'column' | 'name_suffix' | 'not_shown' } {
  const t = levelText.trim();
  if (t) {
    const hit = LEVEL_SUFFIXES.find((l) => l.re.test(t)) ?? (/^(standard|regular|general|college prep)$/i.test(t) ? { level: 'standard' as const } : undefined);
    return { value: { original: t, normalized: hit?.level ?? null }, basis: 'column' };
  }
  const hit = LEVEL_SUFFIXES.find((l) => l.re.test(name));
  if (hit) {
    const m = hit.re.exec(name)!;
    return { value: { original: m[0].trim(), normalized: hit.level }, basis: 'name_suffix' };
  }
  return { value: { original: null, normalized: null }, basis: 'not_shown' };
}

function subjectFor(name: string, ibContext: boolean): SubjectMapping | undefined {
  const bare = name.replace(/\b(HL|SL|Higher Level|Standard Level)\b/g, '').trim();
  if (ibContext) {
    const ib = IB_TITLES.find((t) => t.re.test(bare));
    if (ib) return { key: ib.key, basis: 'verified_mapping', label: bare };
  }
  const broad = BROAD_KEYWORDS.find((b) => b.re.test(bare));
  return broad ? { key: broad.key, basis: 'broad_taxonomy', label: bare } : undefined;
}

function unitFrom(header: string): string | null {
  const m = /\b(credits?|units?|hours|ects|coefficient|weight)\b/i.exec(header);
  return m ? m[1]!.toLowerCase() : null;
}

// ------------------------------------------------------------------ test reports

const SECTION_ALIASES: Record<TestFamily, Record<string, string>> = {
  TOEFL_IBT: { reading: 'reading', listening: 'listening', speaking: 'speaking', writing: 'writing' },
  IELTS_ACADEMIC: { listening: 'listening', reading: 'reading', writing: 'writing', speaking: 'speaking' },
  IELTS_GENERAL: { listening: 'listening', reading: 'reading', writing: 'writing', speaking: 'speaking' },
  SAT: { 'evidence-based reading and writing': 'evidence_based_reading_writing', 'reading and writing': 'evidence_based_reading_writing', math: 'math', mathematics: 'math' },
  ACT: { english: 'english', math: 'math', mathematics: 'math', reading: 'reading', science: 'science', stem: 'stem', writing: 'writing' },
  DUOLINGO_ENGLISH_TEST: {},
  AP: {},
  OTHER: {},
};

function parseTestReport(kv: Array<{ key: string; value: string; anchor: Anchor }>, allText: string, method: Anchor['method']): TestObservation[] {
  const family: TestFamily | null = /\btoefl\b/i.test(allText)
    ? 'TOEFL_IBT'
    : /\bielts\b/i.test(allText)
      ? /general training/i.test(allText)
        ? 'IELTS_GENERAL'
        : /academic/i.test(allText)
          ? 'IELTS_ACADEMIC'
          : null
      : /\bduolingo english test\b/i.test(allText)
        ? 'DUOLINGO_ENGLISH_TEST'
        : /\bSAT\b/.test(allText)
          ? 'SAT'
          : /\bACT\b/.test(allText)
            ? 'ACT'
            : null;
  const ambiguities: string[] = [];
  const anchor: Anchor = kv[0]?.anchor ?? { page: 1, blockIndex: 0, text: '', method };
  if (!family) return [];
  const aliases = SECTION_ALIASES[family];
  const sections: Record<string, number> = {};
  let total: number | null = null;
  let legacy: number | null = null;
  let date: PartialDate | null = null;
  for (const { key, value } of kv) {
    const k = key.toLowerCase().trim();
    const n = parseLocalizedNumber(value.replace(/\s*\/\s*\d+$/, ''));
    if (/test date|date of test|administration date|exam date/.test(k)) {
      const d = parseHumanDate(value);
      if (d.kind === 'date') date = d.value;
      else if (d.kind === 'ambiguous') ambiguities.push(`The test date "${value}" could be read as ${d.candidates.join(' or ')}. Which is it?`);
      continue;
    }
    if (/comparable|0\s*-\s*120|legacy/.test(k) && typeof n === 'number') {
      legacy = n;
      continue;
    }
    if (/^(total|overall|composite|total score|overall band( score)?|overall score)$/.test(k) && typeof n === 'number') {
      total = n;
      continue;
    }
    const alias = aliases[k];
    if (alias && typeof n === 'number') sections[alias] = n;
  }
  let versionRef: string | null = null;
  const values = Object.values(sections);
  if (family === 'TOEFL_IBT') {
    const bandLike = values.length > 0 && values.every((v) => v >= 1 && v <= 6 && Number.isInteger(v * 2)) && (total === null || total <= 6);
    const legacyLike = values.length > 0 && values.every((v) => Number.isInteger(v) && v <= 30) && (total === null || (total > 6 && total <= 120));
    versionRef = bandLike ? 'toefl_ibt_band_1_6' : legacyLike ? 'toefl_ibt_0_120' : null;
  } else if (family === 'SAT') versionRef = 'sat_400_1600';
  else if (family === 'IELTS_ACADEMIC') versionRef = 'ielts_academic_0_9';
  else if (family === 'IELTS_GENERAL') versionRef = 'ielts_general_0_9';
  else if (family === 'DUOLINGO_ENGLISH_TEST') versionRef = 'duolingo_10_160';
  else if (family === 'ACT') versionRef = 'stem' in sections || /enhanced/i.test(allText) ? 'act_enhanced' : null;
  if (versionRef === null) ambiguities.push(`The score scale or test format on this ${family.replace(/_/g, ' ')} report could not be established from the document; please confirm the format shown on the report.`);
  if (date === null) ambiguities.push('The test date was not found on the report.');
  if (date === null) return [{ record: null, family, anchor, ambiguities }];
  const record: TestScoreRecord = {
    family,
    versionRef,
    subjectLabel: null,
    administrationDate: date,
    deliveryFormat: 'unknown',
    sections,
    reportedTotal: total,
    comparableLegacyTotal: legacy,
    combination: /superscore/i.test(allText) ? 'issuer_superscore' : /mybest|best scores/i.test(allText) ? 'issuer_best_of' : 'single_administration',
    reportStatus: /official score report/i.test(allText) ? 'official' : /unofficial|practice/i.test(allText) ? 'unofficial_practice' : 'unknown',
  };
  return [{ record, family, anchor, ambiguities }];
}
