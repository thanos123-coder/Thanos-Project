import { describeAbsence, isAbsence, type Absence } from '../../shared/absence.js';
import type { Holder, Lifecycle } from '../../shared/facts.js';
import { FIELD_CATALOG } from '../../shared/fields.js';
import type { Budget } from '../../shared/money.js';
import type { DataCategory } from '../../shared/permissions.js';
import { countryName, languageName } from '../../shared/places.js';
import { formatValue } from '../a04-record-steward/explain.js';
import type { FieldView } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { budgetDisplay, displayPartialDate, travelDisplay } from './interpreter.js';
import { TEMPLATE_BY_FIELD } from './question-bank.js';
import type { IntakeSession, ReviewItem } from './sessions.js';

/**
 * Review before consequential use (02R08). Each recorded fact is restated as a
 * plain sentence whose meaning is explicit ("You have NOT taken any college
 * courses"), next to what was heard or typed, so a recognizer that dropped a
 * "not" is exposed rather than hidden (02T12). The review is not a legal
 * waiver and does not make a mistaken fact infallible.
 */

export const REVIEW_NOTE = 'This review helps make sure your record says what you meant. It is not a legal confirmation, and anything here can be corrected later.';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lifecycleSuffix(l: Lifecycle, catalogKey: string): string {
  if (l === 'considering') return ' (tentative)';
  if (catalogKey.startsWith('experience.')) return l === 'planned' ? ' (planned)' : l === 'in_progress' ? ' (current)' : l === 'completed' ? ' (done)' : '';
  if (l === 'completed' && catalogKey === 'student.education.expected_graduation') return ' (already finished)';
  return '';
}

/** A plain-language statement of what a stored value means. */
export function statementFor(catalogKey: string, value: unknown, lifecycle: Lifecycle, holder?: Holder): string {
  const def = FIELD_CATALOG.get(catalogKey);
  const label = def?.label ?? catalogKey;
  if (isAbsence(value)) {
    const a = value as Absence;
    if (catalogKey === 'student.constraints.opportunity_budget' && a.reason === 'not_applicable') return 'Budget for opportunities: no spending limit (costs will still be shown)';
    return `${cap(label)}: ${describeAbsence(a.reason)}`;
  }
  const suffix = lifecycleSuffix(lifecycle, catalogKey);
  switch (catalogKey) {
    case 'student.education.postsecondary_enrollment':
      return value === 'none'
        ? 'You have NOT taken any college or university courses'
        : value === 'dual_enrollment_while_in_secondary'
          ? 'You HAVE taken college courses while still in secondary school'
          : 'You HAVE studied at a college or university after finishing secondary school';
    case 'student.constraints.travel':
      return cap(travelDisplay(value as Parameters<typeof travelDisplay>[0]));
    case 'student.support.family_responsibilities': {
      const v = value as { hasRegularResponsibilities: boolean; broadDescription: string | null; hoursPerWeek: { min: number; max: number } | null };
      if (!v.hasRegularResponsibilities) return 'You have NO regular responsibilities to plan around';
      return `You HAVE regular responsibilities to plan around${v.broadDescription ? ` (${v.broadDescription})` : ''}${v.hoursPerWeek ? `, about ${v.hoursPerWeek.min === v.hoursPerWeek.max ? v.hoursPerWeek.min : `${v.hoursPerWeek.min}-${v.hoursPerWeek.max}`} hours a week` : ''}`;
    }
    case 'student.constraints.opportunity_budget':
    case 'student.constraints.test_budget':
      return `${cap(label)}: ${budgetDisplay(value as Budget)}`;
    case 'student.constraints.weekly_hours_available': {
      const v = value as { min: number; max: number };
      return `Time you can give each week: ${v.min === v.max ? `about ${v.min}` : `about ${v.min} to ${v.max}`} hours`;
    }
    case 'student.education.expected_graduation':
    case 'qualification.expected_completion':
      return `Expected graduation: ${displayPartialDate(String(value))}${suffix}`;
    case 'student.application.entry_cycle':
      return `Intended start: ${String(value)}${suffix}`;
    case 'student.identity.citizenships':
    case 'student.application.destination_countries': {
      const list = (value as string[]).map(countryName).join(', ') || 'none';
      return `${cap(label)}: ${list}${suffix}`;
    }
    case 'student.identity.residence_country':
    case 'student.education.school_country':
      return `${cap(label)}: ${countryName(String(value))}`;
    case 'student.constraints.location_broad': {
      const v = value as { country: string; region: string | null; city: string | null };
      return `Broad location: ${[v.city, v.region && v.region !== v.city ? v.region : null, countryName(v.country)].filter(Boolean).join(', ')}`;
    }
    case 'student.education.schooling_language': {
      const v = value as { language: string; yearsOfInstruction: number | null };
      return `Language of instruction: ${languageName(v.language)}${v.yearsOfInstruction === null ? ' (number of years not known)' : `, for ${v.yearsOfInstruction} year${v.yearsOfInstruction === 1 ? '' : 's'}`}`;
    }
    case 'student.constraints.availability_windows': {
      const list = (value as Array<{ start: string; end?: string }>).map((w) => (w.end && w.end !== w.start ? `${displayPartialDate(w.start)} to ${displayPartialDate(w.end)}` : displayPartialDate(w.start))).join('; ');
      return `Available: ${list}`;
    }
    case 'student.education.current_year_label': {
      const v = value as { label: string };
      return `Current year: ${v.label} (as your school calls it)`;
    }
    case 'student.education.qualification_system': {
      const v = value as { id: string; label: string };
      return v.id === 'UNRECOGNIZED' ? `Qualification: ${v.label} (as you described it; not yet in the app's coverage)` : `Qualification: ${v.label}`;
    }

    case 'student.constraints.remote_preference':
      return `Online or in person: ${String(value).replace(/_/g, ' ')}`;
    case 'preference.statement': {
      const v = value as { text: string };
      if (holder?.kind === 'reported_other') return `Your ${holder.label}'s view, as you described it: “${v.text}”`;
      if (holder?.kind === 'supporter') return `A supporter's view: “${v.text}”`;
      return `Your preference: “${v.text}”`;
    }
    case 'interest.description':
      return `Interest: “${(value as { text: string }).text}”${suffix}`;
    case 'experience.identity':
      return `Activity: “${(value as { titleStudentSupplied: string }).titleStudentSupplied}”${suffix}`;
    case 'course.level': {
      const v = value as { original: string | null };
      return `Course level: ${v.original ?? 'no level shown'}`;
    }
    default: {
      // Enumerated answers are restated with the wording the student chose from.
      const option = typeof value === 'string' ? TEMPLATE_BY_FIELD.get(catalogKey)?.options?.find((o) => o.value === value) : undefined;
      return `${cap(label)}: ${option ? option.label : formatValue(value)}${suffix}`;
    }
  }
}

export interface ReviewEntry {
  claimId: string;
  fieldKey: string;
  label: string;
  statement: string;
  /** What was heard (voice) or typed, for comparison with the statement. */
  heard: string | null;
  modality: 'text' | 'voice';
  consequential: boolean;
  confirmation: string;
  tentative: boolean;
  /** The value was replaced since it was recorded in this session. */
  changedSince: boolean;
  /** The entry records that something is unknown, declined or not decided (no value to confirm). */
  absent: boolean;
}

/** Build the review list from facts recorded in this session, using the canonical record (never a separate copy). */
export function buildReview(session: IntakeSession, view: RecordView): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  const seen = new Set<string>();
  for (const item of [...session.reviewItems].reverse()) {
    if (seen.has(item.fieldKey)) continue;
    seen.add(item.fieldKey);
    const fv = view.fieldByKey(item.fieldKey);
    if (!fv) continue;
    const cur = fv.current;
    const changed = !cur || cur.claimId !== item.claimId;
    const shown = cur ?? fv.conflicting[0];
    if (!shown) continue;
    out.push({
      claimId: shown.claimId,
      fieldKey: item.fieldKey,
      label: fv.label,
      statement: statementFor(catalogKeyOf(fv), shown.value, shown.lifecycle, fv.holder),
      heard: item.heard || null,
      modality: item.modality,
      consequential: fv.consequential,
      confirmation: shown.confirmation,
      tentative: item.tentative || shown.lifecycle === 'considering',
      changedSince: changed,
      absent: isAbsence(shown.value),
    });
  }
  return out.sort((a, b) => Number(b.consequential) - Number(a.consequential) || Number(a.confirmation !== 'unreviewed') - Number(b.confirmation !== 'unreviewed'));
}

export function catalogKeyOf(fv: FieldView): string {
  return `${fv.field.entity}.${fv.field.attribute}`;
}

/** Items still waiting for the student's review. */
export function unreviewedItems(entries: readonly ReviewEntry[]): ReviewEntry[] {
  return entries.filter((e) => e.confirmation === 'unreviewed' && !e.absent);
}

export type { ReviewItem };

/**
 * Plain-language visibility note shown when a question is asked. It does not
 * promise absolute secrecy: a school-managed account can have its own access
 * rules, and the account's sharing settings decide who else can see a field.
 */
export function visibilityNote(category: DataCategory | null, sensitive: boolean): string {
  const who = 'Who else can see it depends on your account’s sharing settings, which you can review at any time (a school account may also have its own access rules).';
  switch (category) {
    case 'citizenship_residency':
      return `This is sensitive. It is used only to check published eligibility rules. ${who}`;
    case 'financial':
      return `This is sensitive. It is used only to compare costs against your limit. ${who}`;
    case 'family_context':
      return `Only a broad note is kept, with no details about other people. ${who}`;
    case 'health_accessibility':
      return `This is sensitive and used only for the support you ask for. ${who}`;
    default:
      return sensitive ? `This is sensitive. ${who}` : `It is kept in your record so you do not have to repeat it. ${who}`;
  }
}
