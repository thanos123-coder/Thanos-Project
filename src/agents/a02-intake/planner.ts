import { isAbsence, type Absence } from '../../shared/absence.js';
import { FIELD_CATALOG } from '../../shared/fields.js';
import { formatValue } from '../a04-record-steward/explain.js';
import type { FieldView } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';
import { QUESTION_BANK, TEMPLATE_BY_FIELD, TEMPLATE_BY_ID, type Objective, type QuestionTemplate } from './question-bank.js';
import type { IntakeSession } from './sessions.js';

/**
 * Question planning (02R01-02R04). Chooses the next question from what the
 * current task needs, reusing what is already known, confirming imported
 * values instead of asking again, asking about the specific difference when
 * sources conflict, and never re-asking something the student skipped or
 * declined in this session.
 *
 * Ordering uses an explicit heuristic (required dependency, ambiguity
 * reduction, answerability, sensitivity, effort). It is not presented as a
 * mathematically precise information-gain score.
 */

export const OBJECTIVE_QUESTIONS: Readonly<Record<Objective, readonly string[]>> = {
  onboarding: ['goal.current_objective', 'education.stage', 'education.system', 'education.school_country', 'education.graduation_timing', 'application.destinations', 'application.entry_cycle'],
  find_opportunities: ['interests.main', 'constraints.dates', 'constraints.location', 'constraints.travel', 'constraints.budget', 'constraints.weekly_time', 'constraints.timezone'],
  check_eligibility: ['education.system', 'education.school_country', 'application.entry_cycle', 'application.prior_college', 'identity.citizenship', 'identity.residence', 'education.schooling_language'],
  explore_majors: ['goals.decision_horizon', 'interests.main'],
  academic_plan: ['education.graduation_timing', 'constraints.weekly_time', 'constraints.responsibilities'],
  experience_review: ['experiences.overview', 'constraints.responsibilities'],
  fill_gaps: [],
};

export type PlannedQuestionKind = 'ask' | 'confirm_imported' | 'resolve_conflict' | 'confirm_pending' | 'targeted' | 'clarify';
export type ReasonCode = 'required_for_objective' | 'resolves_ambiguity' | 'resolves_conflict' | 'requested_by_specialist' | 'confirms_imported_value';

export interface PlannedQuestion {
  questionId: string;
  kind: PlannedQuestionKind;
  text: string;
  purpose: string;
  /** Target field instance. For new collection items the entity id is 'new'. */
  field: { entity: string; entityId: string; attribute: string };
  reasons: ReasonCode[];
  options: string[];
  allowSkip: boolean;
  allowDontKnow: boolean;
  sensitivity: 'standard' | 'sensitive';
  /** Existing claims this question would confirm or resolve. */
  claimIds: string[];
  templateId: string | null;
}

export interface PlanResult {
  questions: PlannedQuestion[];
  /** True when the current objective has what it needs to proceed. */
  enough: boolean;
  skipped: Array<{ questionId: string; reason: 'already_known' | 'declined_earlier' | 'student_does_not_know' | 'settled_this_session' | 'awaiting_review' }>;
}

function parseCatalog(field: string): { entity: string; attribute: string } {
  const [entity, ...rest] = field.split('.');
  return { entity: entity!, attribute: rest.join('.') };
}

type FieldStatus = 'known' | 'absent' | 'declined' | 'unknown_to_student' | 'needs_confirmation_imported' | 'awaiting_review' | 'conflict';

function statusOf(f: FieldView | undefined): FieldStatus {
  if (!f || f.state === 'absent') return 'absent';
  if (f.state === 'conflict') return 'conflict';
  const cur = f.current!;
  if (isAbsence(cur.value)) {
    const reason = (cur.value as Absence).reason;
    if (reason === 'declined') return 'declined';
    if (reason === 'unknown_to_student') return 'unknown_to_student';
    if (reason === 'confirmed_absent' || reason === 'not_applicable') return 'known';
    return f.needsConfirmation && cur.origin === 'document_extraction' ? 'needs_confirmation_imported' : 'absent';
  }
  if (!f.needsConfirmation) return 'known';
  return cur.origin === 'document_extraction' || cur.origin === 'school_feed' ? 'needs_confirmation_imported' : 'awaiting_review';
}

function render(t: QuestionTemplate, mode: 'text' | 'voice'): string {
  return mode === 'voice' && t.voice ? t.voice : t.text;
}

export function planQuestions(input: { objective: Objective; mode: 'text' | 'voice'; view: RecordView; session: IntakeSession }): PlanResult {
  const { view, session } = input;
  const out: Array<PlannedQuestion & { score: number }> = [];
  const skipped: PlanResult['skipped'] = [];

  // 1. Pending confirmations always come first (a consequential value is waiting).
  for (const p of session.pending) {
    out.push({
      questionId: `confirm:${p.id}`,
      kind: 'confirm_pending',
      text: p.question,
      purpose: 'To make sure the value is recorded exactly as you meant it.',
      field: p.field,
      reasons: ['resolves_ambiguity'],
      options: p.candidateLabels.length > 1 ? p.candidateLabels : ['Yes', 'No, let me correct it'],
      allowSkip: true,
      allowDontKnow: true,
      sensitivity: 'standard',
      claimIds: p.existingClaimIds,
      templateId: null,
      score: 100,
    });
  }

  const templateIds = [...OBJECTIVE_QUESTIONS[input.objective]];
  const targeted: Array<{ fieldKey: string; question: string | null }> = session.targetFields.map((k) => ({ fieldKey: k, question: session.handoffQuestions[k] ?? null }));

  const considerTemplate = (t: QuestionTemplate, reason: ReasonCode, entityId = 'self') => {
    const { entity, attribute } = parseCatalog(t.field);
    if (session.settledQuestionIds.includes(t.id)) {
      skipped.push({ questionId: t.id, reason: 'settled_this_session' });
      return;
    }
    let status: FieldStatus;
    let fv: FieldView | undefined;
    if (entity === 'student') {
      fv = view.student(attribute);
      status = statusOf(fv);
    } else {
      // Collection fields (e.g. interests): known when at least one active item exists.
      const ids = view.entityIds(entity);
      const views = ids.map((id) => view.field(entity, id, attribute)).filter((x): x is FieldView => !!x);
      status = views.some((v) => statusOf(v) === 'known' || statusOf(v) === 'awaiting_review') ? 'known' : views.length > 0 ? statusOf(views[0]) : 'absent';
    }
    const base = { field: { entity, entityId: entity === 'student' ? 'self' : entityId === 'self' ? 'new' : entityId, attribute }, allowSkip: t.skippable, allowDontKnow: true, sensitivity: t.sensitivity, templateId: t.id, options: (t.options ?? []).map((o) => o.label) };
    // The current goal comes first: it decides which of the other questions matter (first intake layer).
    const scoreBase = (reason === 'required_for_objective' || reason === 'requested_by_specialist' ? 30 : 10) + (t.consequential ? 5 : 0) - (t.sensitivity === 'sensitive' ? 4 : 0) - t.effort + (t.id === 'goal.current_objective' ? 20 : 0);
    switch (status) {
      case 'known':
        skipped.push({ questionId: t.id, reason: 'already_known' });
        return;
      case 'declined':
        skipped.push({ questionId: t.id, reason: 'declined_earlier' });
        return;
      case 'unknown_to_student':
        skipped.push({ questionId: t.id, reason: 'student_does_not_know' });
        return;
      case 'awaiting_review':
        skipped.push({ questionId: t.id, reason: 'awaiting_review' });
        return;
      case 'needs_confirmation_imported': {
        const cur = fv!.current!;
        const shown = isAbsence(cur.value) ? null : formatValue(cur.value);
        out.push({
          ...base,
          questionId: `confirm_imported:${t.id}`,
          kind: 'confirm_imported',
          text: shown ? `Your document lists ${shown} as your ${fv!.label}. Is that still right?` : `Your document does not clearly show your ${fv!.label}. ${render(t, input.mode)}`,
          purpose: t.purpose,
          reasons: ['confirms_imported_value', reason],
          options: shown ? ['Yes', 'No, let me correct it'] : base.options,
          claimIds: [cur.claimId],
          score: scoreBase + 8,
        });
        return;
      }
      case 'conflict': {
        const [a, b] = fv!.conflicting;
        out.push({
          ...base,
          questionId: `conflict:${fv!.fieldKey}`,
          kind: 'resolve_conflict',
          text: `Earlier I had ${formatValue(a!.value)} for your ${fv!.label}, and another source says ${formatValue(b!.value)}. Which should I use?`,
          purpose: 'Two sources disagree, so I would rather ask than pick one.',
          reasons: ['resolves_conflict', reason],
          options: [formatValue(a!.value), formatValue(b!.value), 'Neither / not sure'],
          claimIds: fv!.conflicting.map((c) => c.claimId),
          score: scoreBase + 10,
        });
        return;
      }
      case 'absent':
        out.push({ ...base, questionId: t.id, kind: 'ask', text: render(t, input.mode), purpose: t.purpose, reasons: [reason], claimIds: [], score: scoreBase });
    }
  };

  for (const id of templateIds) considerTemplate(TEMPLATE_BY_ID.get(id)!, 'required_for_objective');

  // 2. Specialist-requested fields (fill_gaps). Uses the template for the field when one exists.
  for (const tf of targeted) {
    const m = /^([^:]+):([^.]+)\.(.+)$/.exec(tf.fieldKey);
    if (!m) continue;
    const [, entity, entityId, attribute] = m as unknown as [string, string, string, string];
    const template = TEMPLATE_BY_FIELD.get(`${entity}.${attribute}`);
    if (template && entity === 'student') {
      considerTemplate(template, 'requested_by_specialist');
      continue;
    }
    const def = FIELD_CATALOG.get(`${entity}.${attribute}`);
    if (!def) continue;
    const fv = view.field(entity, entityId, attribute);
    const status = statusOf(fv);
    if (status === 'known' || session.settledQuestionIds.includes(`targeted:${tf.fieldKey}`)) {
      skipped.push({ questionId: `targeted:${tf.fieldKey}`, reason: status === 'known' ? 'already_known' : 'settled_this_session' });
      continue;
    }
    const name = entity === 'course' ? view.value<string>('course', entityId, 'name_original') : undefined;
    const current = fv?.current && !isAbsence(fv.current.value) ? formatValue(fv.current.value) : null;
    const text = tf.question ?? (name ? `Your record lists ${name}${current ? ` with ${def.label} "${current}"` : ` without a ${def.label}`}. What does your school record show for the ${def.label}?` : `Could you confirm your ${def.label}?`);
    out.push({
      questionId: `targeted:${tf.fieldKey}`,
      kind: 'targeted',
      text,
      purpose: 'Another part of your plan depends on this detail.',
      field: { entity, entityId, attribute },
      reasons: ['requested_by_specialist'],
      options: attribute === 'level' ? ['Higher Level (HL)', 'Standard Level (SL)', 'AP', 'Honors', 'No level / standard', 'Not sure'] : [],
      allowSkip: true,
      allowDontKnow: true,
      sensitivity: def.category === 'citizenship_residency' || def.category === 'financial' ? 'sensitive' : 'standard',
      claimIds: fv?.current ? [fv.current.claimId] : [],
      templateId: null,
      score: 40,
    });
  }

  out.sort((a, b) => b.score - a.score);
  // Voice: one main question at a time. Text: a compact group of related questions.
  let chosen: Array<PlannedQuestion & { score: number }>;
  if (input.mode === 'voice' || out.length === 0) chosen = out.slice(0, 1);
  else {
    const first = out[0]!;
    const group = first.templateId ? TEMPLATE_BY_ID.get(first.templateId)?.group : undefined;
    chosen = [first, ...out.slice(1).filter((q) => q.kind === 'ask' && group && q.templateId && TEMPLATE_BY_ID.get(q.templateId)?.group === group && first.kind === 'ask').slice(0, 2)];
  }
  const requiredOpen = out.some((q) => q.reasons.includes('required_for_objective') || q.reasons.includes('requested_by_specialist') || q.kind === 'confirm_pending');
  return { questions: chosen.map(({ score: _s, ...q }) => q), enough: !requiredOpen, skipped };
}

export { QUESTION_BANK };
