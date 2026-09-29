/**
 * A short walk through volume two, end to end, with real agents: a round
 * conflict caught in code, a repaired application plan, and an essay request
 * answered with a brainstorming session instead of an essay.
 *
 * Everything here is fictional: the colleges, their rules and dates, and the
 * student. Run with `npm run demo:v2`. No model is needed.
 */
import { CounselorSystem, shared, type CounselorResponse } from '../src/index.js';

const TENANT = 'demo_school';
const clock = new shared.FixedClock('2026-09-27T10:00:00Z');
const system = new CounselorSystem({ clock, documents: { fingerprintSecret: 'demo-only-secret' } });

// ---- Reviewed public claims, as Agent 11 stores them --------------------------------------------

system.institutions.add({ id: 'harbor_ridge_u', kind: 'institution', name: 'Harbor Ridge University', parentId: null, country: 'US', officialDomains: ['harborridge.example.edu'], attributes: { control: 'private' } });
system.institutions.add({ id: 'lakeview_c', kind: 'institution', name: 'Lakeview College', parentId: null, country: 'US', officialDomains: ['lakeview.example.edu'], attributes: { control: 'private' } });

let n = 0;
function official(entityId: string, predicate: 'round_rule' | 'application_deadline', qualifier: string, value: unknown, quote: string): void {
  n += 1;
  const owner = system.institutions.institutionOf(entityId)!;
  const url = `https://${owner.officialDomains[0]}/apply/${n}`;
  const sourceId = `src_demo_${n}`;
  system.institutionClaims.recordSnapshot({ sourceId, url, finalUrl: url, ownerEntityId: entityId, office: 'admissions', retrievedAt: clock.nowIso(), contentHash: 'd'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle: '2027', text: quote }] });
  system.institutionClaims.upsert({ subject: { entityId, institutionId: owner.id, campusId: null, programId: null }, cycle: '2027', applicantCategory: 'all', predicate, qualifier, value, sourceOwner: { entityId: owner.id, office: 'admissions', name: owner.name }, anchor: { sourceId, url, finalUrl: url, passageId: `${sourceId}#p1`, section: null, page: null, quote }, retrievedAt: clock.nowIso(), status: 'verified', extraction: 'curated', extractionConfidence: 'high' });
}
const rule = (entityId: string, round: string, kind: string, text: string, restrictions: unknown[] = []) => official(entityId, 'round_rule', round, { round, kind, binding: false, restrictions, requiresOutcome: [], decisionRelease: null, replyBy: null, agreementCycle: null, commitmentText: null, text }, text);
const deadline = (entityId: string, round: string, date: string) => {
  const text = `${round.replace(/_/g, ' ')} applications must be submitted by ${date} at 23:59 Eastern Time.`;
  official(entityId, 'application_deadline', round, { date, month: null, time: '23:59', timezone: 'America/New_York', timezoneLabel: 'Eastern Time', receipt: 'submitted_by', originalText: text }, text);
};

rule('harbor_ridge_u', 'restrictive_early_action', 'restrictive_early_action', 'Restrictive Early Action applicants may not apply to another private institution’s early round.', [{ target: 'private_early_action', exceptions: [{ condition: 'public_institution', text: 'Public institutions’ non-binding early rounds are allowed.' }] }]);
deadline('harbor_ridge_u', 'restrictive_early_action', '2026-11-01');
rule('lakeview_c', 'early_action', 'early_action', 'Lakeview Early Action is non-binding and places no restriction on other applications.');
rule('lakeview_c', 'regular', 'regular', 'Regular Decision places no restrictions on other applications.');
deadline('lakeview_c', 'early_action', '2026-11-01');
deadline('lakeview_c', 'regular', '2027-01-05');

// ---- The student --------------------------------------------------------------------------------

const student = { id: 'acct_demo_student', kind: 'student' as const, tenantId: TENANT };
const studentId = system.createStudent({ tenantId: TENANT, ownerActorId: student.id });
const ask = (text: string, context: Record<string, unknown> = {}) => system.ask(student, TENANT, studentId, { text, context });

function show(title: string, r: CounselorResponse): void {
  console.log(`\n=== ${title}`);
  console.log(`Headline: ${r.answer?.headline ?? r.summary}`);
  for (const p of r.answer?.progress ?? []) console.log(`  · ${p.task} (${p.role}): ${p.state}`);
  if (r.answer?.question) console.log(`  Next question: ${r.answer.question.text}`);
}

async function main(): Promise<void> {
  const plan = (options: unknown[]) => ask('Can you help with my application plan?', { cycle: '2027', options });

  // 1. Two early rounds that one college's rule forbids together: blocked in code.
  const first = await plan([
    { optionRef: 'harbor', institution: 'Harbor Ridge University', round: 'restrictive_early_action' },
    { optionRef: 'lakeview', institution: 'Lakeview College', round: 'early_action' },
  ]);
  show('1. A round conflict is found before anything is approved', first);
  const node = system.objectives.get(TENANT, studentId, student.id, first.objectiveId!).nodes.find((x) => x.role === '14');
  const payload = node?.result?.payload as { status: string; notices: Array<{ code: string; message: string }> } | undefined;
  console.log(`  Plan status: ${payload?.status}`);
  for (const m of payload?.notices.filter((x) => x.code === 'round_conflict') ?? []) console.log(`  ${m.message}`);

  // 2. The repaired set: Lakeview moves to its regular round.
  const second = await plan([
    { optionRef: 'harbor', institution: 'Harbor Ridge University', round: 'restrictive_early_action' },
    { optionRef: 'lakeview', institution: 'Lakeview College', round: 'regular' },
  ]);
  show('2. A compatible set of rounds, with the schedule worked back from the deadlines', second);
  const repaired = system.objectives.get(TENANT, studentId, student.id, second.objectiveId!).nodes.find((x) => x.role === '14')?.result?.payload as { status: string; tasks: Array<{ taskId: string; controllingDate: string | null; internalTarget: string | null }> } | undefined;
  console.log(`  Plan status: ${repaired?.status}`);
  for (const t of repaired?.tasks ?? []) console.log(`  ${t.taskId}: official ${t.controllingDate}, your target ${t.internalTarget}`);

  // 3. An essay request becomes a brainstorming session; nothing is written for the student.
  show('3. "Write my essay" starts a brainstorming session instead', await ask('Can you write my college essay about my robotics club?'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
