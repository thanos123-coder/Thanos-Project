import { z } from 'zod';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/ids.js';
import type { AuditLog } from './audit.js';

/**
 * Human review (spec 01 failure handling, "Human review packet").
 *
 * "If human review is not actually staffed, it should provide a concise
 * question the student can take to a school counselor or admissions office.
 * 'Escalated' must not mean placed into an unattended queue with no owner."
 * A case is only `accepted` when a named person accepts it; the system never
 * implies acceptance on their behalf (01T14, XT19).
 */

export const ReviewPacketSchema = z
  .object({
    question: z.string().min(10),
    scope: z.string().min(3),
    facts: z.array(z.object({ description: z.string(), provenance: z.string(), status: z.enum(['confirmed', 'disputed', 'unconfirmed']) }).strict()),
    sourceSections: z.array(z.object({ sourceRef: z.string(), excerpt: z.string() }).strict()),
    competingInterpretations: z.array(z.string()),
    consequenceOfDelay: z.string(),
    deadline: z.string().nullable(),
    requestedDecision: z.string().min(5),
  })
  .strict();
export type ReviewPacket = z.infer<typeof ReviewPacketSchema>;

export type ReviewCaseState = 'queued' | 'accepted' | 'resolved' | 'withdrawn';

export interface ReviewCase {
  id: string;
  tenantId: string;
  studentId: string;
  packet: ReviewPacket;
  state: ReviewCaseState;
  queueOwner: string;
  acceptedBy?: string;
  resolution?: { decision: string; decidedBy: string; decidedAt: string; scopeNote: string };
  createdAt: string;
}

export type ReviewRequestOutcome =
  | { kind: 'queued'; caseId: string; queueOwner: string; responseExpectation: string }
  | { kind: 'referral'; referral: { takeTo: string; question: string; bringAlong: string[] } };

export interface ReviewStaffing {
  staffed: boolean;
  queueOwner?: string;
  /** Published response expectation, only when actually staffed, e.g. "within 2 school days". */
  responseExpectation?: string;
}

export class HumanReviewService {
  private readonly cases = new Map<string, ReviewCase>();

  constructor(
    private staffing: ReviewStaffing,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLog,
  ) {}

  setStaffing(staffing: ReviewStaffing): void {
    this.staffing = staffing;
  }

  isStaffed(): boolean {
    return this.staffing.staffed && !!this.staffing.queueOwner;
  }

  request(tenantId: string, studentId: string, packet: ReviewPacket, referralTarget = 'your school counselor or the admissions office'): ReviewRequestOutcome {
    const p = ReviewPacketSchema.parse(packet);
    if (!this.isStaffed()) {
      this.audit.record({ kind: 'review_request', tenantId, studentId, name: 'human_review', outcome: 'referral_unstaffed' });
      return {
        kind: 'referral',
        referral: {
          takeTo: referralTarget,
          question: p.question,
          bringAlong: [...p.sourceSections.map((s) => s.sourceRef), ...p.facts.filter((f) => f.status !== 'confirmed').map((f) => f.description)],
        },
      };
    }
    const c: ReviewCase = { id: this.ids.next('review'), tenantId, studentId, packet: p, state: 'queued', queueOwner: this.staffing.queueOwner!, createdAt: this.clock.nowIso() };
    this.cases.set(c.id, c);
    this.audit.record({ kind: 'review_request', tenantId, studentId, name: 'human_review', outcome: 'queued' });
    return { kind: 'queued', caseId: c.id, queueOwner: c.queueOwner, responseExpectation: this.staffing.responseExpectation ?? 'no response time is guaranteed' };
  }

  accept(caseId: string, reviewerId: string): ReviewCase {
    const c = this.mustGet(caseId);
    if (c.state === 'queued') {
      c.state = 'accepted';
      c.acceptedBy = reviewerId;
    }
    return c;
  }

  resolve(caseId: string, reviewerId: string, decision: string, scopeNote: string): ReviewCase {
    const c = this.mustGet(caseId);
    c.state = 'resolved';
    c.resolution = { decision, decidedBy: reviewerId, decidedAt: this.clock.nowIso(), scopeNote };
    return c;
  }

  get(caseId: string): ReviewCase | undefined {
    return this.cases.get(caseId);
  }

  private mustGet(caseId: string): ReviewCase {
    const c = this.cases.get(caseId);
    if (!c) throw new Error('Unknown review case');
    return c;
  }
}
