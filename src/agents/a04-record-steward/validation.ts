import { AbsenceSchema, isAbsence } from '../../shared/absence.js';
import { validateTestScore, type TestScoreRecord } from '../../shared/assessments.js';
import { CATEGORY_SENSITIVITY, DATA_CATEGORIES, type Actor, type DataCategory } from '../../shared/permissions.js';
import { ClaimInputSchema, FUTURE_LIFECYCLES, catalogKey, type ClaimInputParsed } from '../../shared/facts.js';
import { FIELD_CATALOG, type FieldDefinition } from '../../shared/fields.js';
import { ACHIEVED_STATUSES, type GradeValue } from '../../shared/grades.js';

/**
 * Structural and semantic claim validation (04R02, 04R06).
 *
 * "Do not silently coerce an unknown string into the closest allowed category
 * when that changes meaning." "A model's interpretation must be labeled as an
 * interpretation. A recommendation must not be inserted into a factual field."
 */

/** Which entity types / student attributes each writer may propose (04: "An essay specialist cannot overwrite the academic record"). */
export const ROLE_WRITE_SCOPE: Readonly<Record<string, { entities: readonly string[]; studentAttributePrefixes: readonly string[] }>> = {
  '02': {
    entities: ['student', 'preference', 'interest', 'commitment', 'test_attempt', 'course', 'qualification', 'age_attestation', 'accommodation', 'waiver', 'experience', 'episode'],
    studentAttributePrefixes: ['education.', 'application.', 'identity.citizenships', 'identity.residence_country', 'identity.birth_date', 'identity.preferred_name', 'identity.legal_name', 'constraints.', 'finance.', 'support.', 'preferences.', 'accessibility.', 'goals.'],
  },
  '03': {
    entities: ['student', 'course', 'qualification', 'test_attempt', 'school_offering', 'school_context', 'award', 'gpa_calculation'],
    studentAttributePrefixes: ['education.expected_graduation', 'education.school_name', 'education.qualification_system', 'education.school_country', 'education.schooling_language'],
  },
  '04': { entities: ['*'], studentAttributePrefixes: [''] },
  '05': { entities: ['student', 'interest', 'preference', 'reflection', 'hypothesis', 'assessment'], studentAttributePrefixes: ['goals.'] },
  '08': { entities: ['student', 'experience', 'episode', 'award', 'research_output', 'commitment'], studentAttributePrefixes: ['support.family_responsibilities'] },
  // Volume two. The researcher (11) and uncertainty advisor (13) propose no student facts.
  '10': { entities: ['project'], studentAttributePrefixes: [] },
  '12': { entities: ['fit_priority', 'option_decision'], studentAttributePrefixes: [] },
  '14': { entities: ['application', 'application_item'], studentAttributePrefixes: [] },
  '15': { entities: ['attendance_budget', 'funding_award', 'aid_eligibility', 'fee_status'], studentAttributePrefixes: [] },
  '16': { entities: ['funding_award', 'scholarship_application'], studentAttributePrefixes: [] },
  // Approved factual corrections found while exploring or reviewing writing go through Agent 04 (17 "Story bank", 18 "Factual consistency").
  '17': { entities: ['story_use', 'project', 'experience', 'episode'], studentAttributePrefixes: [] },
  '18': { entities: ['project', 'experience', 'episode', 'award'], studentAttributePrefixes: [] },
  // Direct edits by the person through the product interface.
  ui: { entities: ['*'], studentAttributePrefixes: [''] },
};

export function roleMayWrite(role: string, entity: string, attribute: string): boolean {
  const scope = ROLE_WRITE_SCOPE[role];
  if (!scope) return false;
  if (!scope.entities.includes('*') && !scope.entities.includes(entity)) return false;
  if (entity !== 'student') return true;
  return scope.studentAttributePrefixes.some((p) => attribute === p || attribute.startsWith(p));
}

/** Phrases meaning the answer is unknown or withheld. A value must never be stored on the strength of such a quote (04T12). */
export const UNKNOWN_PHRASES = /\b(i\s+)?(don'?t|do not)\s+know\b|\bnot\s+sure\b|\bno\s+idea\b|\bprefer\s+not\b|\brather\s+not\b|\bskip\b|\bunsure\b/i;

export interface ClaimValidation {
  ok: boolean;
  claim?: ClaimInputParsed;
  definition?: FieldDefinition;
  category?: DataCategory;
  issues: string[];
}

function actorOriginAllowed(actor: Actor, origin: ClaimInputParsed['origin']): boolean {
  switch (actor.kind) {
    case 'student':
      // Issuer reports and school feeds arrive through verified integrations, never from a student account.
      return ['student_statement', 'document_extraction', 'model_interpretation', 'derived_calculation'].includes(origin);
    case 'supporter':
      return ['supporter_statement', 'document_extraction'].includes(origin);
    case 'school_counselor':
      return ['counselor_statement', 'document_extraction', 'school_feed', 'reviewer_decision', 'derived_calculation'].includes(origin);
    case 'institution_admin':
      return ['school_feed', 'institution_source'].includes(origin);
    case 'internal_support':
      return false;
    case 'agent':
      return false;
  }
}

export function validateClaim(raw: unknown, actor: Actor, viaRole: string): ClaimValidation {
  const parsed = ClaimInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => `claim.${i.path.join('.')}: ${i.message}`) };
  const claim = parsed.data;
  const issues: string[] = [];
  const key = catalogKey(claim.field);
  const def = FIELD_CATALOG.get(key);
  if (!def) return { ok: false, claim, issues: [`unknown_field: ${key} is not a recognized record field`] };
  if (claim.field.entity === 'student' && claim.field.entityId !== 'self') issues.push('student-level fields must use entityId "self"');
  if (claim.field.entity !== 'student' && claim.field.entityId === 'self') issues.push('collection fields need an opaque entity id');

  if (!roleMayWrite(viaRole, claim.field.entity, claim.field.attribute)) issues.push(`role ${viaRole} may not write ${key}`);

  // Value: typed value or explicit absence. Never an empty string standing in for unknown.
  if (isAbsence(claim.value)) {
    if (!AbsenceSchema.safeParse(claim.value).success) issues.push('malformed absence');
    if ((claim.value as { reason: string }).reason === 'confirmed_absent' && claim.origin === 'model_interpretation') issues.push('a model cannot confirm that something does not exist');
  } else {
    const v = def.schema.safeParse(claim.value);
    if (!v.success) issues.push(...v.error.issues.map((i) => `value.${i.path.join('.')}: ${i.message}`));
    if (claim.value === '' || claim.value === null) issues.push('empty value: use an explicit absence with a reason instead');
  }

  // Origin rules.
  if (def.allowedOrigins && !def.allowedOrigins.includes(claim.origin)) issues.push(`origin ${claim.origin} may not assert ${key}`);
  if (claim.origin === 'model_interpretation' && !(def.allowedOrigins ?? []).includes('model_interpretation')) {
    issues.push(`a model interpretation cannot be stored in the factual field ${key}`);
  }
  if (!actorOriginAllowed(actor, claim.origin)) issues.push(`a ${actor.kind} cannot assert a claim with origin ${claim.origin}`);
  if (claim.assertedBy.actorId !== actor.id) issues.push('assertedBy must be the acting person');
  if (claim.assertedBy.actorKind === 'agent') issues.push('claims are asserted on behalf of a person, not by an agent');

  // Holder rules.
  if (def.holderScoped) {
    const h = claim.holder ?? { kind: 'student' as const };
    if (h.kind === 'student' && actor.kind !== 'student') issues.push("only the student can state the student's own preference");
    if (h.kind === 'supporter' && h.actorId !== actor.id) issues.push("a supporter-held preference must be stated by that supporter");
  } else if (claim.holder && claim.holder.kind !== 'student') {
    issues.push(`${key} is not holder-scoped`);
  }

  // Evidence rules.
  const kinds = new Set(claim.evidence.map((e) => e.kind));
  if (claim.origin === 'document_extraction' && !kinds.has('document_anchor')) issues.push('document extractions need a document anchor');
  if (claim.origin === 'document_extraction' && !isAbsence(claim.value)) {
    const anchors = claim.evidence.filter((e) => e.kind === 'document_anchor');
    if (anchors.some((a) => a.kind === 'document_anchor' && a.originalText.trim() === '')) issues.push('document anchors must include the original text');
  }
  if (claim.origin === 'derived_calculation' && !kinds.has('derivation')) issues.push('calculated values need a derivation record (inputs, method, software version)');
  if (claim.confirmation === 'human_reviewed' && !kinds.has('human_review')) issues.push('human_reviewed requires a human review record');
  if (claim.confirmation === 'issuer_verified' && !['issuer_report', 'school_feed'].includes(claim.origin)) issues.push('issuer_verified requires an issuer report or school feed');
  if (claim.confirmation === 'student_confirmed' && actor.kind !== 'student') issues.push('only the student can student-confirm a claim');
  if (claim.confirmation === 'counselor_confirmed' && actor.kind !== 'school_counselor') issues.push('only a counselor can counselor-confirm a claim');

  // Unknown submitted as a value (04T12).
  if (!isAbsence(claim.value)) {
    const saidUnknown = claim.evidence.some((e) => e.kind === 'conversation_span' && e.quote !== undefined && UNKNOWN_PHRASES.test(e.quote));
    if (saidUnknown) issues.push('the cited answer says the information is unknown or declined; store an explicit absence, not a value');
  }

  // Lifecycle and semantic consistency by field.
  issues.push(...semanticIssues(key, claim));

  // Visibility: a claim may be made stricter than its catalog category, never looser (04R07).
  let category: DataCategory = def.category;
  if (claim.restrictToCategory !== undefined) {
    if (!(DATA_CATEGORIES as readonly string[]).includes(claim.restrictToCategory)) issues.push('unknown visibility category');
    else if (CATEGORY_SENSITIVITY[claim.restrictToCategory as DataCategory] < CATEGORY_SENSITIVITY[def.category]) issues.push('visibility can only be made stricter');
    else category = claim.restrictToCategory as DataCategory;
  }

  return issues.length === 0 ? { ok: true, claim, definition: def, category, issues } : { ok: false, claim, definition: def, issues };
}

function hasReceipt(claim: ClaimInputParsed): boolean {
  return claim.evidence.some((e) => e.kind === 'document_anchor') || ['issuer_report', 'school_feed', 'institution_source'].includes(claim.origin);
}

function semanticIssues(key: string, claim: ClaimInputParsed): string[] {
  const issues: string[] = [];
  if (isAbsence(claim.value)) return issues;
  const v = claim.value as Record<string, unknown>;
  switch (key) {
    case 'award.definition': {
      const stage = v['stage'] as string;
      if (FUTURE_LIFECYCLES.has(claim.lifecycle) && !['nominee', 'applicant'].includes(stage)) {
        issues.push('a planned or considered entry cannot be recorded as an award result');
      }
      break;
    }
    case 'course.grade': {
      const g = claim.value as GradeValue;
      if (ACHIEVED_STATUSES.has(g.status) && FUTURE_LIFECYCLES.has(claim.lifecycle)) issues.push('a planned course cannot have an achieved grade');
      break;
    }
    case 'episode.definition': {
      const period = v['period'] as { ongoing?: boolean } | undefined;
      if (claim.lifecycle === 'completed' && period?.ongoing) issues.push('a completed activity period cannot be ongoing');
      break;
    }
    case 'research_output.definition': {
      if (FUTURE_LIFECYCLES.has(claim.lifecycle) && ['accepted_paper', 'published_article', 'poster', 'preprint'].includes(v['status'] as string)) {
        issues.push('planned research cannot have a publication status');
      }
      break;
    }
    case 'test_attempt.record': {
      const errors = validateTestScore(claim.value as TestScoreRecord).filter((i) => i.severity === 'error');
      for (const e of errors) issues.push(`test score: ${e.message}`);
      break;
    }
    // A receipt or completeness state needs a receipt, not a ticked task (14 "Data contract and states").
    case 'application.status':
    case 'application_item.definition': {
      const status = key === 'application.status' ? (claim.value as string) : (v['status'] as string);
      if (['received', 'complete'].includes(status) && !hasReceipt(claim)) issues.push(`a ${status} state needs a receipt (a document or an issuer report), not only a statement`);
      break;
    }
    // Funds are confirmed only by the provider's documents (15 "Aid record and conditions").
    case 'funding_award.definition': {
      if (['confirmed_for_disbursement', 'disbursed'].includes(v['stage'] as string) && !hasReceipt(claim)) issues.push('confirmed or disbursed funding needs the provider’s document or report');
      break;
    }
    // A student estimate is not a supporter's commitment (15 "Intake with minimum necessary data").
    case 'attendance_budget.definition': {
      if (v['basis'] === 'supporter_confirmed' && claim.holder?.kind !== 'supporter') issues.push('a supporter-confirmed amount must be stated by that supporter');
      break;
    }
    default:
      break;
  }
  return issues;
}
