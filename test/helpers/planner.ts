import { AcademicPlannerAgent, type PlanPayload } from '../../src/agents/a07-planner/agent.js';
import { registerCalendarTools, TestCalendarRegistry } from '../../src/agents/a07-planner/calendars.js';
import { EligibilityAgent } from '../../src/agents/a06-eligibility/agent.js';
import type { RulePackageInput } from '../../src/agents/a06-eligibility/rules.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { EligibilityScopeInput } from '../../src/shared/scope.js';
import { ACT_DEC, calendarSource, SAT_DEC, SAT_MAR, SAT_NOV } from '../fixtures/calendars.js';
import { makeKernel } from './kernel.js';

export function makePlannerHarness(opts: { calendar?: (c: TestCalendarRegistry) => void } = {}) {
  const h = makeKernel();
  const calendars = new TestCalendarRegistry();
  calendars.addSource(calendarSource('src_cal_sat', 'SAT'));
  calendars.addSource(calendarSource('src_cal_act', 'ACT'));
  calendars.addSource(calendarSource('src_cal_toefl', 'TOEFL'));
  for (const a of [SAT_NOV, SAT_DEC, SAT_MAR, ACT_DEC]) calendars.addAdministration(a);
  calendars.setCoverage({ family: 'SAT', publishedThrough: '2027-06-30', sourceId: 'src_cal_sat' });
  calendars.setCoverage({ family: 'ACT', publishedThrough: '2027-07-31', sourceId: 'src_cal_act' });
  calendars.setCoverage({ family: 'TOEFL_IBT', publishedThrough: '2026-12-31', sourceId: 'src_cal_toefl' });
  opts.calendar?.(calendars);
  registerCalendarTools(h.kernel.gateway, calendars);
  h.kernel.registerSpecialist(new AcademicPlannerAgent());
  h.kernel.registerSpecialist(new EligibilityAgent());
  const addPackage = (p: RulePackageInput) => h.kernel.rules.add(p);
  const checkEligibility = async (eligibility: EligibilityScopeInput) => {
    const req = h.task({ role: '06', purpose: 'eligibility_check', objective: 'check_program_requirements', completionContract: 'eligibility_finding_v1', scope: { eligibility } });
    const out = await h.kernel.invoke(req);
    if (!out.accepted) throw new Error(`eligibility rejected: ${out.issues.join('; ')}`);
    return out.result;
  };
  const run = async (scope: Record<string, unknown>) => {
    const req = h.task({ role: '07', purpose: 'academic_planning', objective: 'academic_plan', completionContract: 'academic_plan_v1', scope });
    return (await h.kernel.invoke(req)) as Awaited<ReturnType<typeof h.kernel.invoke>> & { result: ResultEnvelope<PlanPayload> };
  };
  const ok = async (scope: Record<string, unknown>) => {
    const out = await run(scope);
    if (!out.accepted) throw new Error(`plan rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 800)}`);
    return out.result;
  };
  return { ...h, calendars, addPackage, checkEligibility, run, ok };
}
