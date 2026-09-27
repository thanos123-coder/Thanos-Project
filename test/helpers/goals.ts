import { GoalsExplorationAgent, type ExplorationPayload } from '../../src/agents/a05-goals/agent.js';
import { BUILTIN_EXPERIMENTS, BUILTIN_PROFILES } from '../../src/agents/a05-goals/content.js';
import { registerKnowledgeTools, SubjectKnowledgeRegistry } from '../../src/agents/a05-goals/knowledge.js';
import { ConversationStore, IntakeSessionStore, registerIntakeTools, type Turn } from '../../src/agents/a02-intake/sessions.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { SourceRecord } from '../../src/shared/sources.js';
import { makeKernel, TENANT } from './kernel.js';

export const LABOR_SOURCE: SourceRecord = {
  id: 'src_labor_fixture',
  version: 'v1',
  publisher: 'Synthetic Labor Statistics Office',
  canonicalUrl: 'https://example.org/labor/software',
  title: 'Occupational data (synthetic fixture)',
  sourceType: 'government',
  scope: { geography: 'US' },
  retrievedAt: '2026-09-01T00:00:00Z',
  contentHash: 'a'.repeat(64),
  permittedUse: 'quote_only',
  reviewStatus: 'verified',
};

export function makeGoalsHarness(opts: { model?: ModelGateway; registry?: (r: SubjectKnowledgeRegistry) => void } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const conversations = new ConversationStore(h.clock, h.ids);
  registerIntakeTools(h.kernel.gateway, conversations, new IntakeSessionStore(h.clock, h.ids), h.kernel.records.permissions);
  const registry = new SubjectKnowledgeRegistry();
  for (const p of BUILTIN_PROFILES) registry.addProfile(p);
  for (const e of BUILTIN_EXPERIMENTS) registry.addExperiment(e);
  opts.registry?.(registry);
  registerKnowledgeTools(h.kernel.gateway, registry);
  h.kernel.registerSpecialist(new GoalsExplorationAgent(model));
  const run = async (scope: Record<string, unknown>) => {
    const req = h.task({ role: '05', purpose: 'exploration', objective: 'explore_majors', completionContract: 'exploration_v1', scope });
    return (await h.kernel.invoke(req)) as Awaited<ReturnType<typeof h.kernel.invoke>> & { result: ResultEnvelope<ExplorationPayload> };
  };
  const ok = async (scope: Record<string, unknown>) => {
    const out = await run(scope);
    if (!out.accepted) throw new Error(`exploration result rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 600)}`);
    return out.result;
  };
  const say = (text: string): Turn => conversations.append(TENANT, h.studentId, { conversationId: 'conv_goals', role: 'student', actorId: h.student.id, modality: 'text', text });
  const record = () => h.kernel.records.readScoped(h.ui, { tenantId: TENANT, studentId: h.studentId, role: '04', mode: 'local' });
  return { ...h, model, registry, conversations, run, ok, say, record };
}
