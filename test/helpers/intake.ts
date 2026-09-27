import { IntakeInterviewerAgent, type IntakePayload } from '../../src/agents/a02-intake/agent.js';
import { ConversationStore, IntakeSessionStore, registerIntakeTools, type AsrSegment, type Turn } from '../../src/agents/a02-intake/sessions.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { Actor } from '../../src/shared/permissions.js';
import { makeKernel, TENANT } from './kernel.js';

export function makeIntakeHarness(opts: { model?: ModelGateway; now?: string } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const kernelOpts: Parameters<typeof makeKernel>[0] = { model };
  if (opts.now) kernelOpts.now = opts.now;
  const h = makeKernel(kernelOpts);
  const conversations = new ConversationStore(h.clock, h.ids);
  const sessions = new IntakeSessionStore(h.clock, h.ids);
  registerIntakeTools(h.kernel.gateway, conversations, sessions, h.kernel.records.permissions);
  h.kernel.records.registerDerivativeStore(conversations);
  h.kernel.records.registerDerivativeStore(sessions);
  h.kernel.registerSpecialist(new IntakeInterviewerAgent(model));

  const run = async (scope: Record<string, unknown>, actor: Actor = h.student) => {
    const req = h.task({ role: '02', purpose: 'intake', objective: 'intake', completionContract: 'intake_turn_v1', scope, actor });
    const out = await h.kernel.invoke(req);
    return out as typeof out & { result: ResultEnvelope<IntakePayload> };
  };
  const ok = async (scope: Record<string, unknown>, actor: Actor = h.student) => {
    const out = await run(scope, actor);
    if (!out.accepted) throw new Error(`intake result rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 600)}`);
    return out.result;
  };
  const start = (scope: Record<string, unknown> = {}, actor: Actor = h.student) => ok({ action: 'start', objective: 'onboarding', ...scope }, actor);

  /** Append a student turn to the session's conversation. */
  const say = (conversationId: string, text: string, extra: { modality?: 'text' | 'voice'; segments?: AsrSegment[]; speakerLabel?: Turn['speakerLabel']; actor?: Actor } = {}): Turn => {
    const turn: Parameters<ConversationStore['append']>[2] = { conversationId, role: 'student', actorId: (extra.actor ?? h.student).id, modality: extra.modality ?? 'text', text };
    if (extra.segments) turn.segments = extra.segments;
    if (extra.speakerLabel) turn.speakerLabel = extra.speakerLabel;
    return conversations.append(TENANT, h.studentId, turn);
  };

  /** Answer the current question of a session in one step. */
  const answer = async (p: IntakePayload, text: string, extra: Parameters<typeof say>[2] = {}, actor: Actor = h.student) => {
    const t = say(p.conversationId, text, { ...extra, actor: extra.actor ?? actor });
    return ok({ action: 'answer', sessionId: p.sessionId, turnId: t.turnId }, actor);
  };

  const record = () => h.kernel.records.readScoped(h.ui, { tenantId: TENANT, studentId: h.studentId, role: '04', mode: 'local' });

  return { ...h, model, conversations, sessions, run, ok, start, say, answer, record };
}
