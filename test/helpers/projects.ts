import { ProjectMentorAgent, type ProjectPayload } from '../../src/agents/a10-projects/agent.js';
import { ProjectNotebook, registerProjectTools } from '../../src/agents/a10-projects/notebook.js';
import type { MilestoneInput } from '../../src/agents/a10-projects/schedule.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { Actor } from '../../src/shared/permissions.js';
import { makeKernel, said, stated } from './kernel.js';

/**
 * Agent 10 harness. The club, school, competition and people here are
 * fictional. The worked example is a resource page for a school club with
 * three hours a week for six weeks, starting on Monday 2026-09-28.
 */

export const START = '2026-09-28';

/** The worked example's milestones: understand, structure, build, optional search, review, corrections. */
export const RESOURCE_PAGE: MilestoneInput[] = [
  { id: 'm1', purpose: 'Know what already exists before building anything', action: 'List the club’s existing resources and where they live', effort: { low: 1, high: 2 }, evidence: 'student_resource_list' },
  { id: 'm2', purpose: 'Choose a structure small enough to finish', action: 'Choose a simple structure for the page', effort: { low: 1, high: 2 }, dependsOn: ['m1'], evidence: 'student_structure_sketch' },
  { id: 'm3', purpose: 'The smallest useful result', action: 'Build the page with five checked links', effort: { low: 3, high: 4 }, dependsOn: ['m2'], evidence: 'student_checked_link_list' },
  { id: 'search', purpose: 'Optional extension', action: 'Add a search box', effort: { low: 2, high: 3 }, dependsOn: ['m3'], evidence: 'working_search_demo', optional: true },
  { id: 'm4', purpose: 'Someone who knows the club checks accuracy', action: 'Share the page with the club adviser for review', effort: { low: 0.5, high: 1 }, dependsOn: ['m3'], evidence: 'adviser_comment', waitWeeks: 1 },
  { id: 'm5', purpose: 'Finish well and notice what was learned', action: 'Make corrections and write a short reflection', effort: { low: 1, high: 2 }, dependsOn: ['m4'], evidence: 'student_reflection' },
];

export const BRIEF = {
  title: 'Club resource page',
  goal: 'Learn to organize accurate club resources',
  description: 'A simple page that collects the robotics club’s useful links in one place.',
  audience: 'Club members',
  context: 'personal_learning',
  learningQuestion: 'How do I organize information so people can find it?',
  smallestResult: 'A page with five checked links',
  extension: 'A search box',
  publicRelease: { wanted: true, approvalId: 'adviser_posting' },
} as const;

export const APPROVALS = [{ id: 'adviser_posting', authority: 'the club adviser', status: 'pending', permittedScope: null }] as const;

/** A fictional regional science fair whose reviewed policy prohibits generated research plans. */
export const FAIR = { kind: 'competition', ref: 'northgate_regional_fair', cycle: '2027' } as const;

export function makeProjectHarness(opts: { model?: ModelGateway; now?: string } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model, ...(opts.now ? { now: opts.now } : {}) });
  const notebook = new ProjectNotebook(() => h.clock.nowIso());
  registerProjectTools(h.kernel.gateway, notebook);
  h.kernel.records.registerDerivativeStore(notebook.asDerivativeStore());
  h.kernel.registerSpecialist(new ProjectMentorAgent(model));

  const fairPolicy = () =>
    h.kernel.policies.add({
      id: 'northgate_fair_rules',
      version: '2027.1',
      destination: FAIR,
      decisions: { research_plan_generation: 'prohibited', review_student_text: 'allowed', process_explanation: 'allowed' },
      source: { sourceId: 'src_northgate_rules', url: 'https://northgatefair.example.org/rules/ai', quote: 'Research plans, abstracts and posters must be written by the student; generative AI may not produce them.' },
      reviewStatus: 'reviewed',
      reviewedBy: 'policy_reviewer',
      reviewedAt: '2026-09-01T00:00:00Z',
    });
  const weekly = (min: number, max: number) => h.seed([stated(h.student, 'constraints.weekly_hours_available', { min, max })]);
  const commitment = (id: string, label: string) => h.seed([buildClaim({ entity: 'commitment', entityId: id, attribute: 'definition', value: { label, kind: 'paid_work', weekly: [], period: null }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(label)], actor: h.student, viaRole: 'ui' })]);
  const storyUse = (projectId: string, state: 'private' | 'discuss_only' | 'possible_writing_material' | 'do_not_use') => h.seed([buildClaim({ entity: 'story_use', entityId: projectId, attribute: 'permission', value: { sourceRef: `project:${projectId}`, state }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`use ${state}`)], actor: h.student, viaRole: 'ui' })]);

  const run = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const spec: Parameters<typeof h.task>[0] = { role: '10', purpose: 'project_mentoring', objective: 'project_mentoring', completionContract: 'project_plan_v1', scope };
    if (extra.actor) spec.actor = extra.actor;
    const out = await h.kernel.invoke(h.task(spec));
    return out as typeof out & { result: ResultEnvelope<ProjectPayload> };
  };
  const ok = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const out = await run(scope, extra);
    if (!out.accepted) throw new Error(`project task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 900)}`);
    return out.result;
  };
  const plan = (over: Record<string, unknown> = {}) => ok({ action: 'plan', projectId: 'club_page', brief: BRIEF, weeks: 6, startDate: START, weeklyHours: { low: 3, high: 3 }, milestones: RESOURCE_PAGE, approvals: APPROVALS, ...over });
  const ms = (r: ResultEnvelope<ProjectPayload>, id: string) => r.payload.milestones.find((m) => m.id === id)!;
  const history = (key: string) => h.kernel.records.history(h.ui, 'tenant_a', h.studentId, key);
  return { ...h, model, notebook, fairPolicy, weekly, commitment, storyUse, run, ok, plan, ms, history };
}
