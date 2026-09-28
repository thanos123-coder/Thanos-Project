import { LeadCounselorAgent } from '../agents/a01-orchestrator/agent.js';
import type { LeadPayload } from '../agents/a01-orchestrator/compose.js';
import { ObjectiveStore, registerTaskTools } from '../agents/a01-orchestrator/objectives.js';
import type { RequestContextInput } from '../agents/a01-orchestrator/planner.js';
import { IntakeInterviewerAgent } from '../agents/a02-intake/agent.js';
import { ConversationStore, IntakeSessionStore, registerIntakeTools } from '../agents/a02-intake/sessions.js';
import { DocumentInterpreterAgent } from '../agents/a03-document-interpreter/agent.js';
import { DocumentStore } from '../agents/a03-document-interpreter/documents.js';
import type { MalwareScanner, QuarantineLimits } from '../agents/a03-document-interpreter/quarantine.js';
import { registerDocumentTools } from '../agents/a03-document-interpreter/tools.js';
import { RecordStewardAgent } from '../agents/a04-record-steward/agent.js';
import { GoalsExplorationAgent } from '../agents/a05-goals/agent.js';
import { BUILTIN_EXPERIMENTS, BUILTIN_PROFILES } from '../agents/a05-goals/content.js';
import { registerKnowledgeTools, SubjectKnowledgeRegistry } from '../agents/a05-goals/knowledge.js';
import { EligibilityAgent } from '../agents/a06-eligibility/agent.js';
import { AcademicPlannerAgent } from '../agents/a07-planner/agent.js';
import { registerCalendarTools, TestCalendarRegistry } from '../agents/a07-planner/calendars.js';
import { ActivitiesAssessorAgent } from '../agents/a08-activities/agent.js';
import { OpportunityScoutAgent } from '../agents/a09-opportunities/agent.js';
import { OpportunityCatalog } from '../agents/a09-opportunities/catalog.js';
import type { ResearchProviders } from '../agents/a09-opportunities/research.js';
import { registerOpportunityTools } from '../agents/a09-opportunities/tools.js';
import type { ModelGateway } from '../model/gateway.js';
import type { ExternalActionRecord } from '../runtime/external-actions.js';
import type { ReviewStaffing } from '../runtime/human-review.js';
import type { Clock } from '../shared/clock.js';
import type { ResultEnvelope, RoleId } from '../shared/envelopes.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Actor } from '../shared/permissions.js';
import { SystemKernel } from './kernel.js';
import { connectOpportunityCatalog } from './opportunity-wiring.js';
import { registerOrchestrationTools } from './orchestration-tools.js';

/**
 * The counselor as one system (spec "Deployment structure"): one
 * orchestration service, one record service, a document worker, a public
 * source service and bounded specialists, all behind a single interface that
 * an app and a website can call. The nine roles are modules with separate
 * contracts and permissions; shared services own records, rules, files and
 * task state, so no specialist keeps its own copy of the student's profile.
 */

export interface CounselorSystemOptions {
  clock?: Clock;
  ids?: IdGenerator;
  model?: ModelGateway;
  reviewStaffing?: ReviewStaffing;
  research?: ResearchProviders;
  documents?: { scanner?: MalwareScanner | null; limits?: QuarantineLimits; fingerprintSecret?: string };
}

export interface CounselorMessage {
  text: string;
  conversationId?: string;
  modality?: 'text' | 'voice';
  /** A client message id; delivering the same message twice has no second effect (01T10). */
  deliveryKey?: string;
  /** The objective the interface shows as active, if any. */
  objectiveId?: string;
  context?: Partial<RequestContextInput>;
  /** An explicit effort budget for this request (the default is the coordinator's aggregate budget). */
  budget?: { maxToolCalls?: number; maxModelCalls?: number };
}

export interface CounselorResponse {
  /** True when the answer passed validation and may be shown. */
  accepted: boolean;
  status: ResultEnvelope['status'];
  objectiveId: string | null;
  summary: string;
  answer: LeadPayload | null;
  issues: string[];
  taskId: string;
  turnId: string | null;
}

export class CounselorSystem {
  readonly kernel: SystemKernel;
  readonly conversations: ConversationStore;
  readonly intakeSessions: IntakeSessionStore;
  readonly documents: DocumentStore;
  readonly knowledge: SubjectKnowledgeRegistry;
  readonly calendars: TestCalendarRegistry;
  readonly opportunities: OpportunityCatalog;
  readonly objectives: ObjectiveStore;
  private readonly deliveries = new Map<string, string>();

  constructor(options: CounselorSystemOptions = {}) {
    const kernelOptions: ConstructorParameters<typeof SystemKernel>[0] = {};
    if (options.clock) kernelOptions.clock = options.clock;
    if (options.ids) kernelOptions.ids = options.ids;
    if (options.model) kernelOptions.model = options.model;
    if (options.reviewStaffing) kernelOptions.reviewStaffing = options.reviewStaffing;
    const k = new SystemKernel(kernelOptions);
    this.kernel = k;

    this.conversations = new ConversationStore(k.clock, k.ids);
    this.intakeSessions = new IntakeSessionStore(k.clock, k.ids);
    registerIntakeTools(k.gateway, this.conversations, this.intakeSessions, k.records.permissions);
    k.records.registerDerivativeStore(this.conversations);
    k.records.registerDerivativeStore(this.intakeSessions);

    const d = options.documents ?? {};
    this.documents = new DocumentStore(k.clock, k.ids, k.records.permissions, d.scanner ?? null, d.limits, d.fingerprintSecret);
    registerDocumentTools(k.gateway, this.documents, k.records.permissions);
    k.records.registerDerivativeStore(this.documents);

    this.knowledge = new SubjectKnowledgeRegistry();
    for (const p of BUILTIN_PROFILES) this.knowledge.addProfile(p);
    for (const e of BUILTIN_EXPERIMENTS) this.knowledge.addExperiment(e);
    registerKnowledgeTools(k.gateway, this.knowledge);

    this.calendars = new TestCalendarRegistry();
    registerCalendarTools(k.gateway, this.calendars);

    this.opportunities = new OpportunityCatalog(() => k.clock.nowIso());
    registerOpportunityTools(k.gateway, this.opportunities, options.research ?? {});
    connectOpportunityCatalog(k, this.opportunities);

    this.objectives = new ObjectiveStore(k.clock, k.ids, (taskId, reason) => k.cancel(taskId, reason));
    registerTaskTools(k.gateway, this.objectives);
    registerOrchestrationTools(k, this.objectives);

    const model = k.model;
    k.registerSpecialist(new LeadCounselorAgent(model));
    k.registerSpecialist(new IntakeInterviewerAgent(model));
    k.registerSpecialist(new DocumentInterpreterAgent(model));
    k.registerSpecialist(new RecordStewardAgent());
    k.registerSpecialist(new GoalsExplorationAgent(model));
    k.registerSpecialist(new EligibilityAgent());
    k.registerSpecialist(new AcademicPlannerAgent());
    k.registerSpecialist(new ActivitiesAssessorAgent(model));
    k.registerSpecialist(new OpportunityScoutAgent(model));
  }

  /** Create a student record owned by the student's own account. */
  createStudent(input: { tenantId: string; ownerActorId: string }): string {
    return this.kernel.records.createStudent(input);
  }

  // ---------------------------------------------------------------- conversation

  /** Send a message to the counselor. The message is stored as a conversation turn, then handled by Agent 01. */
  async ask(actor: Actor, tenantId: string, studentId: string, message: CounselorMessage): Promise<CounselorResponse> {
    const conversationId = message.conversationId ?? `conv_${studentId}`;
    const turnId = this.turnFor(actor, tenantId, studentId, conversationId, message.text, message.modality ?? 'text', message.deliveryKey);
    const scope: Record<string, unknown> = {
      action: 'request',
      text: message.text,
      conversationId,
      turnId,
      modality: message.modality ?? 'text',
      deliveryKey: message.deliveryKey ?? null,
      objectiveId: message.objectiveId ?? null,
      context: message.context ?? {},
    };
    return { ...(await this.lead(actor, tenantId, studentId, scope, message.deliveryKey, message.budget)), turnId };
  }

  /** Answer the counselor's pending question for an objective; the answer is recorded through intake, then dependent work continues. */
  async reply(actor: Actor, tenantId: string, studentId: string, objectiveId: string, text: string, opts: { conversationId?: string; modality?: 'text' | 'voice'; deliveryKey?: string } = {}): Promise<CounselorResponse> {
    const objective = this.objectives.get(tenantId, studentId, actor.id, objectiveId);
    const session = objective.intakeSessionId ? this.intakeSessions.get(tenantId, studentId, objective.intakeSessionId) : undefined;
    const conversationId = session?.conversationId ?? opts.conversationId ?? `conv_${studentId}`;
    const turnId = this.turnFor(actor, tenantId, studentId, conversationId, text, opts.modality ?? 'text', opts.deliveryKey);
    return { ...(await this.lead(actor, tenantId, studentId, { action: 'answer', objectiveId, turnId })), turnId };
  }

  /** Approve, edit or leave unresolved the answers the counselor asked you to check. */
  confirm(actor: Actor, tenantId: string, studentId: string, objectiveId: string, decisions: Array<{ claimId: string; decision: 'approve' | 'edit' | 'leave_unresolved'; turnId?: string }>): Promise<CounselorResponse> {
    return this.lead(actor, tenantId, studentId, { action: 'confirm_review', objectiveId, decisions });
  }

  status(actor: Actor, tenantId: string, studentId: string, objectiveId: string): Promise<CounselorResponse> {
    return this.lead(actor, tenantId, studentId, { action: 'status', objectiveId });
  }

  /** Stop an objective, or one branch of it (e.g. the opportunity search). Late results are discarded. */
  cancel(actor: Actor, tenantId: string, studentId: string, objectiveId: string, branch: RoleId | 'all' = 'all', reason = 'Stopped at your request.'): Promise<CounselorResponse> {
    return this.lead(actor, tenantId, studentId, { action: 'cancel', objectiveId, branch, reason });
  }

  resume(actor: Actor, tenantId: string, studentId: string, objectiveId: string, budget?: { maxToolCalls?: number }): Promise<CounselorResponse> {
    return this.lead(actor, tenantId, studentId, { action: 'resume', objectiveId }, undefined, budget);
  }

  /** Changes that happened in the background, as a reviewable list. */
  updates(actor: Actor, tenantId: string, studentId: string): Promise<CounselorResponse> {
    return this.lead(actor, tenantId, studentId, { action: 'review_updates' });
  }

  /** Run a lead-counselor task with an optional budget (e.g. a narrower plan). */
  async lead(actor: Actor, tenantId: string, studentId: string, scope: Record<string, unknown>, idempotencyKey?: string, budget?: { maxToolCalls?: number; maxModelCalls?: number }): Promise<CounselorResponse> {
    const spec: Parameters<SystemKernel['buildRequest']>[0] = { role: '01', purpose: 'counseling', objective: 'counsel', actor, tenantId, studentId, scope, completionContract: 'counselor_turn_v1' };
    if (idempotencyKey) spec.idempotencyKey = `lead:${idempotencyKey}`;
    if (budget) spec.budget = budget;
    const request = this.kernel.buildRequest(spec);
    const out = await this.kernel.invoke(request);
    const payload = out.accepted ? (out.result.payload as LeadPayload) : null;
    return { accepted: out.accepted, status: out.result.status, objectiveId: payload?.objectiveId ?? null, summary: out.result.summary, answer: payload, issues: out.issues, taskId: request.taskId, turnId: null };
  }

  // ---------------------------------------------------------------- documents and actions

  uploadDocument(actor: Actor, tenantId: string, studentId: string, bytes: Uint8Array, declared: { mediaType?: string | null; documentType?: string | null } = {}) {
    return this.documents.upload({ tenantId, studentId, uploader: actor, bytes, declaredMediaType: declared.mediaType ?? null, declaredDocumentType: declared.documentType ?? null });
  }

  /** Proposed external actions waiting for this person's decision. */
  pendingActions(tenantId: string, studentId: string): ExternalActionRecord[] {
    return this.kernel.actions.list(studentId).filter((r) => r.tenantId === tenantId && r.state === 'proposed');
  }

  /**
   * Explicit approval of a proposed external action by the student (or an adult
   * the student authorized to manage their plans). Approval does not send
   * anything by itself; execution needs a configured integration.
   */
  approveAction(actor: Actor, tenantId: string, studentId: string, proposalId: string): ExternalActionRecord {
    const authorized = this.kernel.records.permissions.authorize({ actor, tenantId, studentId, category: 'plans_tasks', access: 'write', purpose: 'counseling' }).allowed;
    return this.kernel.actions.approve(proposalId, actor, authorized);
  }

  rejectAction(actor: Actor, proposalId: string): ExternalActionRecord {
    return this.kernel.actions.reject(proposalId, actor);
  }

  private turnFor(actor: Actor, tenantId: string, studentId: string, conversationId: string, text: string, modality: 'text' | 'voice', deliveryKey?: string): string {
    const key = deliveryKey ? `${tenantId}:${studentId}:${actor.id}:${deliveryKey}` : null;
    if (key && this.deliveries.has(key)) return this.deliveries.get(key)!;
    const turn = this.conversations.append(tenantId, studentId, { conversationId, role: 'student', actorId: actor.id, modality, text });
    if (key) this.deliveries.set(key, turn.turnId);
    return turn.turnId;
  }
}
