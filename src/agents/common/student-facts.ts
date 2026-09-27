import { interpretAbsence, isAbsence, type Absence } from '../../shared/absence.js';
import type { TestScoreRecord } from '../../shared/assessments.js';
import type { CourseLevel, SubjectMapping } from '../../shared/fields.js';
import type { GradeValue } from '../../shared/grades.js';
import type { AcademicPeriod, PartialDate } from '../../shared/time.js';
import type { FieldView } from '../a04-record-steward/types.js';
import type { RecordView } from '../a04-record-steward/view-reader.js';

/**
 * Decision-ready student facts. Every accessor reports *why* a value can or
 * cannot be used, so rule evaluation never treats a disputed, ambiguous or
 * unconfirmed consequential fact as settled (06R04: "A grade with unresolved OCR
 * ambiguity cannot satisfy a threshold merely because one candidate reading is
 * high enough").
 */

export type FactStatus = 'usable' | 'absent' | 'known_negative' | 'not_applicable' | 'conflict' | 'needs_confirmation' | 'not_visible';

export interface Fact<T> {
  status: FactStatus;
  value?: T;
  fieldKey: string;
  claimIds: string[];
  /** Origin of the current claim, for stage evidence checks. */
  origin?: string;
  confirmation?: string;
  absence?: Absence;
  /** Plain-language reason when not usable. */
  reason?: string;
}

export function factFrom<T>(fieldKey: string, fv: FieldView | undefined): Fact<T> {
  if (!fv) return { status: 'not_visible', fieldKey, claimIds: [], reason: 'not recorded' };
  const claimIds = [...(fv.current ? [fv.current.claimId] : []), ...fv.conflicting.map((c) => c.claimId)];
  if (fv.state === 'conflict') return { status: 'conflict', fieldKey, claimIds, reason: `${fv.label}: sources disagree` };
  if (fv.state !== 'current' || !fv.current) return { status: 'absent', fieldKey, claimIds, reason: `${fv.label} is not recorded` };
  const base = { fieldKey, claimIds, origin: fv.current.origin, confirmation: fv.current.confirmation };
  if (isAbsence(fv.current.value)) {
    const a = fv.current.value as Absence;
    const interp = interpretAbsence(a.reason);
    if (interp === 'known_negative') return { ...base, status: 'known_negative', absence: a, reason: `${fv.label}: confirmed none` };
    if (interp === 'excluded') return { ...base, status: 'not_applicable', absence: a, reason: `${fv.label}: not applicable` };
    return { ...base, status: 'absent', absence: a, reason: `${fv.label}: ${a.reason.replace(/_/g, ' ')}` };
  }
  if (fv.needsConfirmation || fv.current.dispute !== 'none') {
    return { ...base, status: 'needs_confirmation', value: fv.current.value as T, reason: `${fv.label} needs confirmation before it is used for a decision` };
  }
  return { ...base, status: 'usable', value: fv.current.value as T };
}

export interface CourseFacts {
  entityId: string;
  name: Fact<string>;
  subject: Fact<SubjectMapping>;
  level: Fact<CourseLevel>;
  grade: Fact<GradeValue>;
  period: Fact<AcademicPeriod>;
  enrollmentStatus: Fact<'planned' | 'enrolled' | 'in_progress' | 'completed' | 'withdrawn' | 'cancelled'>;
  attempt: Fact<{ number: number; kind: 'first' | 'resit' | 'retake' | 'remark' }>;
  courseKey: Fact<string>;
  lifecycle?: string;
}

export interface QualificationFacts {
  entityId: string;
  credential: Fact<{ id: string; label: string }>;
  status: Fact<'planned' | 'in_progress' | 'completed' | 'awarded' | 'withdrawn'>;
  total: Fact<GradeValue>;
  expectedCompletion: Fact<PartialDate>;
}

export interface TestFacts {
  entityId: string;
  record: Fact<TestScoreRecord>;
}

export class StudentFacts {
  constructor(readonly view: RecordView) {}

  private f<T>(entity: string, id: string, attribute: string): Fact<T> {
    const fv = this.view.field(entity, id, attribute);
    return factFrom<T>(`${entity}:${id}.${attribute}`, fv);
  }

  student<T>(attribute: string): Fact<T> {
    return this.f<T>('student', 'self', attribute);
  }

  courses(): CourseFacts[] {
    return this.view.entityIds('course').map((id) => {
      const c: CourseFacts = {
        entityId: id,
        name: this.f('course', id, 'name_original'),
        subject: this.f('course', id, 'subject_mapping'),
        level: this.f('course', id, 'level'),
        grade: this.f('course', id, 'grade'),
        period: this.f('course', id, 'period'),
        enrollmentStatus: this.f('course', id, 'enrollment_status'),
        attempt: this.f('course', id, 'attempt'),
        courseKey: this.f('course', id, 'course_key'),
      };
      const lc = this.view.field('course', id, 'name_original')?.current?.lifecycle ?? this.view.field('course', id, 'grade')?.current?.lifecycle;
      if (lc) c.lifecycle = lc;
      return c;
    });
  }

  qualifications(): QualificationFacts[] {
    return this.view.entityIds('qualification').map((id) => ({
      entityId: id,
      credential: this.f('qualification', id, 'credential'),
      status: this.f('qualification', id, 'status'),
      total: this.f('qualification', id, 'total'),
      expectedCompletion: this.f('qualification', id, 'expected_completion'),
    }));
  }

  tests(): TestFacts[] {
    return this.view.entityIds('test_attempt').map((id) => ({ entityId: id, record: this.f<TestScoreRecord>('test_attempt', id, 'record') })).filter((t) => t.record.status !== 'not_visible');
  }

  waivers(): Array<Fact<{ waiverRef: string; institutionRef: string; state: 'not_requested' | 'pending' | 'approved' | 'denied' }>> {
    return this.view.entityIds('waiver').map((id) => this.f('waiver', id, 'state'));
  }

  gpaCalculations(): Array<Fact<{ calculationRef: string; value: number; scaleNote: string | null }>> {
    return this.view.entityIds('gpa_calculation').map((id) => this.f('gpa_calculation', id, 'result'));
  }

  contextualCriteria(): Array<Fact<{ criteriaRef: string; meets: boolean }>> {
    return this.view.entityIds('contextual_criterion').map((id) => this.f('contextual_criterion', id, 'result'));
  }

  ageAttestations(): Array<{ minimumAge: Fact<number>; referenceDate: Fact<string>; meets: Fact<boolean> }> {
    return this.view.entityIds('age_attestation').map((id) => ({
      minimumAge: this.f('age_attestation', id, 'minimum_age'),
      referenceDate: this.f('age_attestation', id, 'reference_date'),
      meets: this.f('age_attestation', id, 'meets'),
    }));
  }
}

/** Merge claim ids from several facts. */
export function claimIdsOf(...facts: ReadonlyArray<Fact<unknown> | undefined>): string[] {
  const out = new Set<string>();
  for (const f of facts) for (const id of f?.claimIds ?? []) out.add(id);
  return [...out];
}
