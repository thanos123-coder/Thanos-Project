import { StoryInterviewerAgent, type StoryPayload } from '../../src/agents/a17-stories/agent.js';
import { registerStoryTools, StoryBank } from '../../src/agents/a17-stories/bank.js';
import { ConversationStore, IntakeSessionStore, registerIntakeTools, type AsrSegment } from '../../src/agents/a02-intake/sessions.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { Actor } from '../../src/shared/permissions.js';
import { connectStoryBank } from '../../src/system/story-wiring.js';
import { makeKernel, TENANT } from './kernel.js';

/**
 * Agent 17 harness. Brookfield College and Ashgrove Institute are fictional
 * destinations with reviewed assistance policies: Brookfield allows
 * brainstorming questions but not outlines or translation; Ashgrove allows
 * only general exploration, so reusing tailored material there needs review.
 */

export const BROOKFIELD = { kind: 'institution', ref: 'brookfield_college', cycle: '2027' } as const;
export const ASHGROVE = { kind: 'institution', ref: 'ashgrove_institute', cycle: '2027' } as const;

export function makeStoryHarness(opts: { model?: ModelGateway } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const conversations = new ConversationStore(h.clock, h.ids);
  registerIntakeTools(h.kernel.gateway, conversations, new IntakeSessionStore(h.clock, h.ids), h.kernel.records.permissions);
  h.kernel.records.registerDerivativeStore(conversations);
  const bank = new StoryBank(() => h.clock.nowIso());
  registerStoryTools(h.kernel.gateway, bank, h.kernel.records.permissions);
  connectStoryBank(h.kernel, bank);
  h.kernel.registerSpecialist(new StoryInterviewerAgent(model));

  const policies = () => {
    h.kernel.policies.add({ id: 'brookfield_ai', version: '2027.1', destination: BROOKFIELD, decisions: { tailored_brainstorming: 'allowed', exploration_questions: 'allowed', story_prompt_mapping: 'allowed', outline: 'prohibited', translation: 'prohibited', prose_generation: 'prohibited', editing: 'prohibited' }, source: { sourceId: 'src_brookfield_ai', url: 'https://admissions.brookfield.example.edu/ai-guidance', quote: 'You may use tools to brainstorm questions; outlines, drafts and translations of your essay must be your own.' }, reviewStatus: 'reviewed', reviewedBy: 'policy_reviewer', reviewedAt: '2026-09-01T00:00:00Z' });
    h.kernel.policies.add({ id: 'ashgrove_ai', version: '2027.1', destination: ASHGROVE, decisions: { tailored_brainstorming: 'prohibited', story_prompt_mapping: 'prohibited', outline: 'prohibited', prose_generation: 'prohibited' }, source: { sourceId: 'src_ashgrove_ai', url: 'https://apply.ashgrove.example.edu/integrity', quote: 'Applicants must not use AI tools to develop or tailor application essay content.' }, reviewStatus: 'reviewed', reviewedBy: 'policy_reviewer', reviewedAt: '2026-09-01T00:00:00Z' });
  };

  const say = (text: string, extra: { modality?: 'text' | 'voice'; segments?: AsrSegment[]; conversationId?: string } = {}) => {
    const t: Parameters<ConversationStore['append']>[2] = { conversationId: extra.conversationId ?? 'conv_story', role: 'student', actorId: h.student.id, modality: extra.modality ?? 'text', text };
    if (extra.segments) t.segments = extra.segments;
    return conversations.append(TENANT, h.studentId, t);
  };
  const run = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const spec: Parameters<typeof h.task>[0] = { role: '17', purpose: 'essay_exploration', objective: 'essay_exploration', completionContract: 'story_session_v1', scope };
    if (extra.actor) spec.actor = extra.actor;
    const out = await h.kernel.invoke(h.task(spec));
    return out as typeof out & { result: ResultEnvelope<StoryPayload> };
  };
  const ok = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const out = await run(scope, extra);
    if (!out.accepted) throw new Error(`story task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 900)}`);
    return out.result;
  };
  const start = (over: Record<string, unknown> = {}) => ok({ action: 'start', ...over });
  const answer = async (sessionId: string, text: string, extra: Parameters<typeof say>[1] & { extractorNotes?: Array<{ kind: string; text: string }> } = {}) => {
    const t = say(text, extra);
    return ok({ action: 'answer', sessionId, turnId: t.turnId, ...(extra.extractorNotes ? { extractorNotes: extra.extractorNotes } : {}) });
  };
  const parent: Actor = { id: 'acct_parent_story', kind: 'supporter', tenantId: TENANT };
  const grantParent = (categories: string[]) => h.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['essay_exploration'], categories: categories as never, access: ['read'], policyBasis: 'student_invitation' });
  return { ...h, model, conversations, bank, policies, say, run, ok, start, answer, parent, grantParent };
}
