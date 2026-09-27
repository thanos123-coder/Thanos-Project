import { ActivitiesAssessorAgent, type ActivitiesPayload } from '../../src/agents/a08-activities/agent.js';
import { ConversationStore, IntakeSessionStore, registerIntakeTools, type Turn } from '../../src/agents/a02-intake/sessions.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import { makeKernel, TENANT } from './kernel.js';

export function makeActivitiesHarness(opts: { model?: ModelGateway; now?: string } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const kopts: Parameters<typeof makeKernel>[0] = { model };
  if (opts.now) kopts.now = opts.now;
  const h = makeKernel(kopts);
  const conversations = new ConversationStore(h.clock, h.ids);
  const sessions = new IntakeSessionStore(h.clock, h.ids);
  registerIntakeTools(h.kernel.gateway, conversations, sessions, h.kernel.records.permissions);
  h.kernel.records.registerDerivativeStore(conversations);
  h.kernel.registerSpecialist(new ActivitiesAssessorAgent(model));
  const run = async (scope: Record<string, unknown>) => {
    const req = h.task({ role: '08', purpose: 'experience_review', objective: 'experience_review', completionContract: 'experience_record_v1', scope });
    return (await h.kernel.invoke(req)) as Awaited<ReturnType<typeof h.kernel.invoke>> & { result: ResultEnvelope<ActivitiesPayload> };
  };
  const ok = async (scope: Record<string, unknown>) => {
    const out = await run(scope);
    if (!out.accepted) throw new Error(`activities result rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 600)}`);
    return out.result;
  };
  const say = (text: string): Turn => conversations.append(TENANT, h.studentId, { conversationId: 'conv_activities', role: 'student', actorId: h.student.id, modality: 'text', text });
  /** Submit the activity form (recorded as a student turn) and record it. */
  const submit = (experience: Record<string, unknown>) => {
    const t = say(`[activity form] ${String(experience['title'])}`);
    return ok({ action: 'record', turnId: t.turnId, experience });
  };
  const record = () => h.kernel.records.readScoped(h.ui, { tenantId: TENANT, studentId: h.studentId, role: '04', mode: 'local' });
  return { ...h, model, conversations, run, ok, say, submit, record };
}
