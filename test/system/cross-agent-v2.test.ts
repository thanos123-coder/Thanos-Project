import { describe, expect, it } from 'vitest';
import { NARRATIVE_CONTRACT, type NarrativePayload } from '../../src/agents/a18-narrative/agent.js';
import { detectOutlineStructure } from '../../src/policy/assistance.js';
import type { Actor } from '../../src/shared/permissions.js';
import { BEACON_SCHOLARS, scholarship } from '../fixtures/scholarships.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import { said, TENANT } from '../helpers/kernel.js';
import { makeV2, USD } from '../helpers/v2.js';

/**
 * Volume two cross-agent acceptance suite (XT01-XT18 of the Agents 10-18
 * specification). Each scenario runs through the whole system: shared
 * stores, the record service, invalidation and the specialists' own
 * contracts. Every institution, award, person and fact is fictional.
 */

const BROOKFIELD = { kind: 'institution', ref: 'brookfield_c', cycle: '2027' } as const;
const ASHGROVE = { kind: 'institution', ref: 'ashgrove_i', cycle: '2027' } as const;

function policies(h: ReturnType<typeof makeV2>) {
  h.registry.add({ id: 'brookfield_c', kind: 'institution', name: 'Brookfield College', parentId: null, country: 'US', officialDomains: ['brookfield.example.edu'] });
  h.registry.add({ id: 'ashgrove_i', kind: 'institution', name: 'Ashgrove Institute', parentId: null, country: 'US', officialDomains: ['ashgrove.example.edu'] });
  const add = (id: string, destination: typeof BROOKFIELD | typeof ASHGROVE, decisions: Record<string, 'allowed' | 'prohibited'>) => h.system.kernel.policies.add({ id, version: '2027.1', destination, decisions, source: { sourceId: `src_${id}`, url: `https://policies.example.org/${id}`, quote: `${id} assistance rules` }, reviewStatus: 'reviewed', reviewedBy: 'policy_reviewer', reviewedAt: '2026-09-01T00:00:00Z' });
  add('brookfield_ai', BROOKFIELD, { tailored_brainstorming: 'allowed', exploration_questions: 'allowed', review_student_text: 'allowed', story_prompt_mapping: 'allowed', outline: 'prohibited' });
  add('ashgrove_ai', ASHGROVE, { tailored_brainstorming: 'prohibited', review_student_text: 'prohibited', story_prompt_mapping: 'prohibited', outline: 'prohibited' });
}

const PROJECT_BRIEF = { title: 'Club scheduling app', goal: 'Learn to build a small scheduling tool', description: 'A small scheduling tool for the chess club.', context: 'personal_learning', smallestResult: 'A working prototype', extension: null };
const PROJECT_MILESTONES = [{ id: 'm1', purpose: 'The smallest result', action: 'Build the calendar import', effort: { low: 2, high: 3 }, evidence: 'working_demo' }];

describe('Volume two cross-agent acceptance suite', () => {
  it('XT01: an overstated project completion is rejected by the record, and story notes keep the real attribution', async () => {
    const h = makeV2();
    await h.ok('10', { action: 'plan', projectId: 'club_app', brief: PROJECT_BRIEF, weeks: 6, weeklyHours: { low: 3, high: 3 }, milestones: PROJECT_MILESTONES, approve: true });
    await h.ok('10', { action: 'close', projectId: 'club_app', outcome: 'completed', outputs: [{ description: 'Scheduling app prototype', state: 'prototype' }], contributions: [{ description: 'Wrote the calendar import', by: 'student', evidence: 'notebook' }, { description: 'Built the interface', by: 'team', evidence: 'shared repository' }], confirmedByStudent: true });
    // Later the completion is "corrected" to credit the student with the team's work.
    const r = await h.run('10', { action: 'correct_completion', projectId: 'club_app', studentContribution: ['Wrote the calendar import', 'Built the interface'], note: 'I did all of it' });
    expect(r.result.completionReason).toBe('record_rejected');
    const completion = h.history('project:club_app.completion').filter((c) => c.status === 'active').at(-1)!.value as { studentContribution: string[]; teamContribution: string[] };
    expect(completion).toMatchObject({ studentContribution: ['Wrote the calendar import'], teamContribution: ['Built the interface'] });
    // The essay interviewer's notes keep what the student actually said about who did what.
    const s = await h.ok('17', { action: 'start', interest: 'the scheduling app' });
    const t = h.say('I wrote the calendar import, and the team built the interface.');
    const a = await h.ok('17', { action: 'answer', sessionId: s.payload.sessionId, turnId: t.turnId });
    expect(a.payload.story.facts.map((f: { text: string }) => f.text)).toEqual(['I wrote the calendar import, and the team built the interface.']);
  });

  it('XT02: a changed deadline after approval is versioned by research, and the plan names the affected task and decision', async () => {
    const h = makeV2();
    h.regular('ashby_c');
    const d1 = h.deadline('ashby_c', 'regular', '2027-01-15');
    await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'ashby', institution: 'Ashby College', round: 'regular' }] });
    await h.ok('14', { action: 'approve', cycle: '2027', planVersion: 1, confirmedByStudent: true });
    // The official page now shows an earlier date: a new version of the same claim.
    h.deadline('ashby_c', 'regular', '2027-01-05', { url: d1.anchor.url });
    expect(h.system.institutionClaims.get(d1.claimId)!.version).toBe(2);
    expect((h.system.institutionClaims.get(d1.claimId, 1)!.value as { date: string }).date).toBe('2027-01-15');
    expect(h.artifacts('portfolio_plan')[0]!.status).toBe('stale');
    expect(h.artifacts('portfolio_approval')[0]!.status).toBe('stale');
    const v2 = await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'ashby', institution: 'Ashby College', round: 'regular' }] });
    expect(v2.payload.changes[0]).toBe('Ashby College: the official regular deadline changed from 2027-01-15 23:59 Eastern Time to 2027-01-05 23:59 Eastern Time; 1 task moved (submit_ashby).');
    expect(v2.payload.notices.map((n: { code: string }) => n.code)).toEqual(expect.arrayContaining(['plan_revised', 'prior_approval_historical']));
    expect(v2.payload.tasks.find((t: { taskId: string }) => t.taskId === 'submit_ashby').officialDeadline.date).toBe('2027-01-05');
  });

  it('XT03: an award that replaces part of institutional aid is netted by the ledger before the plan uses affordability', async () => {
    const h = makeV2();
    h.workedCosts();
    h.outsidePolicy('aldermere_c', { rule: 'reduce_student_contribution_first', studentContributionFirst: USD('2000.00'), text: 'Outside awards first replace the student contribution of $2,000; beyond that the Aldermere Grant is reduced.' });
    h.funding('grant', { name: 'Aldermere Grant', kind: 'institutional_grant', amount: USD('20000.00'), optionRef: 'aldermere', basis: 'need_based' });
    h.funding('rotary', { name: 'Harbor Rotary Scholarship', provider: 'Harbor Rotary Club', kind: 'external_scholarship', amount: USD('5000.00'), basis: 'merit' });
    h.budget('20000.00');
    const f = await h.ok('15', { action: 'compare', options: [{ optionRef: 'aldermere', institution: 'Aldermere College', cycle: '2027' }] });
    const base = f.payload.options[0].scenarios.find((x: { scenarioId: string }) => x.scenarioId === 'base');
    // 25,000 of offers, but the award's net benefit is 2,000: the grant falls to 17,000.
    expect(base.totals.giftAid).toBe('22000.00');
    expect(f.payload.options[0].state).toBe('gap_identified');
    const p = await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'aldermere', institution: 'Aldermere College', round: 'regular' }] });
    expect(p.payload.options[0].affordability).toBe('gap_identified');
    expect(p.payload.coverage.confirmedAffordablePath).toBe(false);
  });

  it('XT04: the same award recorded from two imports is counted once across agents', async () => {
    const h = makeV2();
    h.workedCosts();
    h.outsidePolicy('aldermere_c', { rule: 'no_displacement', studentContributionFirst: null, text: 'Outside scholarships do not reduce Aldermere grants.' });
    h.funding('grant', { name: 'Aldermere Grant', kind: 'institutional_grant', amount: USD('20000.00'), optionRef: 'aldermere' });
    h.funding('rotary_letter', { name: 'Harbor Rotary Scholarship', provider: 'Harbor Rotary Club', kind: 'external_scholarship', amount: USD('5000.00') });
    h.funding('rotary_second_import', { name: 'Harbor Rotary Scholarship', provider: 'Harbor Rotary Club', kind: 'external_scholarship', amount: USD('5000.00') });
    h.budget('25000.00');
    const f = await h.ok('15', { action: 'compare', options: [{ optionRef: 'aldermere', institution: 'Aldermere College', cycle: '2027' }] });
    const base = f.payload.options[0].scenarios.find((x: { scenarioId: string }) => x.scenarioId === 'base');
    expect(base.totals.giftAid).toBe('25000.00');
    const p = await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'aldermere', institution: 'Aldermere College', round: 'regular' }] });
    expect(p.payload.options[0].affordability).toBe(f.payload.options[0].state);
  });

  it('XT05: a citizenship or fee-status change invalidates scholarship and cost results, not an unrelated project plan', async () => {
    const h = makeV2();
    h.stated('education.stage', 'secondary');
    h.stated('education.expected_graduation', '2027-06');
    h.stated('education.school_country', 'US');
    h.stated('identity.citizenships', ['US']);
    h.stated('identity.residence_country', 'US');
    h.stated('education.postsecondary_enrollment', 'none');
    h.award(BEACON_SCHOLARS);
    await h.ok('16', { action: 'shortlist', cycle: '2027' });
    h.workedCosts();
    h.budget('20000.00');
    await h.ok('15', { action: 'compare', options: [{ optionRef: 'aldermere', institution: 'Aldermere College', cycle: '2027' }] });
    await h.ok('10', { action: 'plan', projectId: 'club_app', brief: PROJECT_BRIEF, weeks: 6, weeklyHours: { low: 3, high: 3 }, milestones: PROJECT_MILESTONES });
    h.stated('identity.citizenships', ['CA']);
    expect(h.artifacts('scholarship_shortlist')[0]!.status).toBe('stale');
    expect(h.artifacts('project_plan')[0]!.status).toBe('current');
    expect(h.artifacts('affordability_scenario')[0]!.status).toBe('current');
    // A fee-status change reaches the cost result, and still not the project plan.
    h.seed([buildClaim({ entity: 'fee_status', entityId: 'aldermere', attribute: 'assessment', value: { jurisdiction: 'US', institutionRef: 'aldermere_c', status: 'out_of_state', basis: 'student_belief' }, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said('out of state')], actor: h.student, viaRole: 'ui' })]);
    expect(h.artifacts('affordability_scenario')[0]!.status).toBe('stale');
    expect(h.artifacts('project_plan')[0]!.status).toBe('current');
  });

  it('XT06: a program with a separate competitive entry route keeps that uncertainty in fit and in the portfolio', async () => {
    const h = makeV2();
    h.official('maplecrest_nursing', 'program_access_route', '', { route: 'later_competitive_selection', guaranteed: false, text: 'Admitted students apply to the nursing major after the first year; places are limited.' }, 'Admitted students apply to the nursing major after the first year; places are limited.', { office: 'department' });
    const fit = await h.ok('12', { action: 'match', cycle: '2027', useCatalog: false, candidates: [{ optionRef: 'maple', institution: 'Maplecrest University', program: 'Nursing' }] });
    const card = [...fit.payload.cards, ...fit.payload.more, ...fit.payload.exploration, ...fit.payload.excluded].find((c: { optionRef: string }) => c.optionRef === 'maple');
    expect(card.programAccess).toEqual({ route: 'later_competitive_selection', condition: 'Admission to the university does not guarantee the subject: students apply to it later, competitively.' });
    // Even with plausible admission to the university, the plan keeps the program question open.
    h.system.kernel.records.putDerived({ ...h.ui, viaRole: '13' }, { tenantId: TENANT, studentId: h.studentId, kind: 'admissions_assessment', scopeKey: 'maple', payload: { version: 1, state: 'plausible_option_with_material_uncertainty', optionRef: 'maple', reasons: [] }, inputClaimIds: [], recordVersion: h.system.kernel.records.recordVersion(TENANT, h.studentId)! });
    const p = await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'maple', institution: 'Maplecrest University', program: 'Nursing', round: 'regular' }] });
    const o = p.payload.options[0];
    expect(o).toMatchObject({ selection: 'plausible_option_with_material_uncertainty', programAccess: 'separate_competitive' });
    expect(o.notes).toContain('Admission does not secure the intended program: entry is a later competitive selection.');
    expect(p.payload.coverage.gaps.map((g: { code: string }) => g.code)).toContain('program_access_uncertain');
  });

  it('XT07: an official source that conflicts with a cached rule leaves the dependent decision unresolved', async () => {
    const h = makeV2();
    h.regular('ashby_c');
    h.deadline('ashby_c', 'regular', '2027-01-15');
    // A second official page states a different date for the same round.
    h.deadline('ashby_c', 'regular', '2027-02-01');
    const p = await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'ashby', institution: 'Ashby College', round: 'regular' }] });
    expect(p.payload.options[0].deadline.official).toBeNull();
    expect(p.payload.notices.find((n: { code: string }) => n.code === 'deadline_conflict').message).toContain('no date is treated as the deadline until that is resolved');
    expect(p.handoffs.some((x: { toRole: string }) => x.toRole === '11')).toBe(true);
  });

  it('XT08: exact odds after a favorable essay evaluation are not produced from the writing score', async () => {
    const h = makeV2();
    const r = await h.ok('13', { action: 'assess', question: 'exact_chance', options: [{ optionRef: 'ashby', institution: 'Ashby College', cycle: '2027' }], otherSignals: [{ kind: 'essay_evaluation', value: 9 }] });
    expect(JSON.stringify(r.payload)).not.toMatch(/\b\d{1,3}(\.\d+)?\s?%\s*(chance|probability|likely)/i);
    expect(r.payload.notices.map((n: { code: string }) => n.code)).toEqual(expect.arrayContaining([expect.stringMatching(/^not_selection_evidence/)]));
    // A plain context question with the same signal does not turn it into odds either.
    const a = await h.ok('13', { action: 'assess', question: 'context', options: [{ optionRef: 'ashby', institution: 'Ashby College', cycle: '2027' }], otherSignals: [{ kind: 'essay_evaluation', value: 9 }] });
    expect(JSON.stringify(a.payload)).not.toMatch(/essay.{0,40}(raises|improves|increases).{0,40}(chance|odds)/i);
  });

  it('XT09: a parent with budget access cannot see private brainstorming notes', async () => {
    const h = makeV2();
    const s = await h.ok('17', { action: 'start', interest: 'my grandmother' });
    const t = h.say('I help my grandmother fill in her medication forms every week.');
    await h.ok('17', { action: 'answer', sessionId: s.payload.sessionId, turnId: t.turnId });
    const parent: Actor = { id: 'acct_parent_v2', kind: 'supporter', tenantId: TENANT };
    h.system.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['financial_planning', 'essay_exploration', 'counseling'], categories: ['financial'], access: ['read', 'write'], policyBasis: 'student_invitation' });
    const review = await h.run('17', { action: 'review' }, parent);
    expect(review.result.status).toBe('blocked');
    expect(JSON.stringify(review.result.payload)).not.toMatch(/grandmother|medication/);
    const counselor = await h.ask('What has my child been writing about?', {}, parent);
    expect(JSON.stringify(counselor)).not.toMatch(/grandmother|medication/);
  });

  it('XT10: revoking a story’s writing permission stops maps, summaries and retrieval from using it', async () => {
    const h = makeV2();
    policies(h);
    const s = await h.ok('17', { action: 'start', interest: 'the robotics club' });
    const t = h.say('I rebuilt the robot arm after it broke at the regional meet.');
    const a = await h.ok('17', { action: 'answer', sessionId: s.payload.sessionId, turnId: t.turnId });
    const storyId = a.payload.story.storyId;
    await h.ok('17', { action: 'set_use', storyId, state: 'possible_writing_material' });
    await h.ok('17', { action: 'close', sessionId: s.payload.sessionId, selections: [{ storyId, choice: 'chosen' }] });
    await h.ok('18', { action: 'register_draft', draft: { artifactId: 'essay', title: 'Essay', applicationId: 'app_b', cycle: '2027', destinations: [BROOKFIELD], fieldId: 'brookfield_essay', text: 'I rebuilt the robot arm after it broke at the regional meet.', declaredProvenance: 'student_written', storyIds: [storyId] } });
    await h.ok('18', { action: 'review', applicationId: 'app_b', operations: ['story_prompt_mapping'] });
    await h.ok('17', { action: 'set_use', storyId, state: 'do_not_use' });
    expect(h.artifacts('story_summary')[0]!.status).toBe('stale');
    expect(h.artifacts('narrative_review')[0]!.status).toBe('stale');
    expect(h.system.stories.permitted(TENANT, h.studentId)).toEqual([]);
    const again = await h.ok('18', { action: 'review', applicationId: 'app_b', operations: ['story_prompt_mapping'] });
    expect(again.payload.mapping[0].storyIds).toEqual([]);
  });

  it('XT11: a misheard role is corrected before it becomes a note that later review can use', async () => {
    const h = makeV2();
    const s = await h.ok('17', { action: 'start', mode: 'voice', recordAudio: true, interest: 'the science club' });
    const t = h.say('I led the group project.', { modality: 'voice', segments: [{ text: 'I led the group project', confidence: 0.8, alternatives: ['I did not lead the group project'] }] });
    const a = await h.ok('17', { action: 'answer', sessionId: s.payload.sessionId, turnId: t.turnId });
    const storyId = a.payload.story.storyId;
    expect(a.payload.story.facts).toEqual([]);
    await h.ok('17', { action: 'set_use', storyId, state: 'possible_writing_material' });
    // Nothing about leading reaches the material other roles may read until the student confirms.
    expect(JSON.stringify(h.system.stories.permitted(TENANT, h.studentId))).not.toMatch(/led the group/);
    await h.ok('17', { action: 'confirm', storyId, sessionId: s.payload.sessionId, resolvePending: [{ pendingId: a.payload.pending[0].id, chosen: 'I did not lead the group project' }] });
    expect(h.system.stories.permitted(TENANT, h.studentId)[0]!.anchors.map((x) => x.text)).toEqual(['I did not lead the group project']);
    expect(h.history('episode:science_club.contribution')).toEqual([]);
  });

  it('XT12: a shared essay that gains a stricter destination is rechecked and keeps its assistance lineage', async () => {
    const h = makeV2();
    policies(h);
    await h.ok('18', { action: 'register_draft', draft: { artifactId: 'shared', title: 'Shared essay', applicationId: null, cycle: '2027', destinations: [BROOKFIELD], fieldId: 'essay', text: 'I rebuilt the robot arm after it broke at the regional meet.', declaredProvenance: 'student_with_help', assistance: [{ operation: 'review_student_text', detail: 'repetition review' }] } });
    const r = await h.ok('18', { action: 'add_destination', artifactId: 'shared', destination: ASHGROVE });
    expect(r.payload.status).toBe('paused');
    expect(r.payload.artifacts[0].assistance).toEqual([{ operation: 'review_student_text', inheritedFrom: null }]);
    const copy = await h.ok('18', { action: 'register_draft', draft: { artifactId: 'ashgrove_copy', title: 'Ashgrove version', applicationId: null, cycle: '2027', destinations: [ASHGROVE], fieldId: 'essay', text: 'I rebuilt the robot arm after it broke at the regional meet.', declaredProvenance: 'student_written', derivedFrom: { artifactId: 'shared', version: 1 } } });
    expect(copy.payload.artifacts[0].assistance).toEqual([{ operation: 'review_student_text', inheritedFrom: 'shared' }]);
    expect(copy.payload.status).toBe('paused');
  });

  it('XT13: a table that functions as an outline is blocked whatever it is called', async () => {
    const h = makeV2();
    policies(h);
    expect(detectOutlineStructure({ headers: ['Opening', 'Turning point', 'Final lesson'], rows: [['club', 'broken arm', 'patience']] }).outline).toBe(true);
    expect(detectOutlineStructure({ headers: ['Coordination view', 'Notes'], rows: [['Start with the meet, then describe the repair, and end with what you learned', '']] }).outline).toBe(true);
    await h.ok('18', { action: 'register_draft', draft: { artifactId: 'e', title: 'Essay', applicationId: 'app_b', cycle: '2027', destinations: [BROOKFIELD], fieldId: 'brookfield_essay', text: 'Some student text about the robotics club.', declaredProvenance: 'student_written' } });
    const r = await h.ok('18', { action: 'review', applicationId: 'app_b', operations: ['outline'] });
    expect(r.payload.blocked[0].operation).toBe('outline');
    const smuggled = { ...(r.payload as NarrativePayload), notices: [{ code: 'map', message: 'Coordination view: opening at the meet, turning point when the arm broke, final lesson about patience.' }] };
    expect(NARRATIVE_CONTRACT.semantic!(smuggled, {} as never)).toContain('the output prescribes a structure for the student’s writing');
  });

  it('XT14: a school nomination needed before the admission deadline controls the schedule and is not assumed available', async () => {
    const h = makeV2();
    h.regular('maplecrest_u');
    h.deadline('maplecrest_u', 'regular', '2027-01-10');
    h.award(
      scholarship('maple_leaders', {
        name: 'Maplecrest Leaders Scholarship',
        award: { kind: 'fixed', amount: USD('15000.00'), duration: 'full_degree', portability: 'destination_restricted', destinations: [{ institutionRef: 'maplecrest_u', programRef: null }] },
        stages: [
          { stageId: 'nomination', kind: 'nomination', label: 'School nomination', owner: 'school', deadline: { date: '2026-11-15', time: null, timezone: null, sourceRef: 'ssrc_maple_leaders' }, internalDeadline: 'unknown', details: { perSchoolLimit: 1 } },
          { stageId: 'admission', kind: 'admission_application', label: 'Apply for admission', owner: 'student', deadline: { date: '2026-12-01', time: '23:59', timezone: 'America/New_York', sourceRef: 'ssrc_maple_leaders' }, dependsOn: [] },
        ],
      }),
    );
    const p = await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'maple', institution: 'Maplecrest University', round: 'regular' }], scholarships: ['maple_leaders'] });
    const nom = p.payload.tasks.find((t: { taskId: string }) => t.taskId === 'scholarship_maple_leaders_nomination');
    expect(nom).toMatchObject({ owner: 'school', controllingDate: '2026-11-15', requestBy: '2026-10-25' });
    expect(p.payload.tasks.find((t: { taskId: string }) => t.taskId === 'submit_maple').controllingDate).toBe('2026-12-01');
    expect(p.payload.questions.find((q: { code: string }) => q.code === 'nomination_maple_leaders')).toMatchObject({ for: 'school' });
    expect(p.handoffs.find((x: { toRole: string }) => x.toRole === '16')).toBeDefined();
  });

  it('XT15: an approved plan executes no email, payment, application, acceptance or withdrawal', async () => {
    const h = makeV2();
    h.regular('ashby_c');
    h.deadline('ashby_c', 'regular', '2027-01-15');
    await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'ashby', institution: 'Ashby College', round: 'regular', applicationFee: USD('60.00') }] });
    const a = await h.ok('14', { action: 'approve', cycle: '2027', planVersion: 1, confirmedByStudent: true });
    expect(a.externalActions).toEqual([]);
    expect(h.system.kernel.actions.list(TENANT, h.studentId)).toEqual([]);
    expect(h.history('application:ashby.status').map((c) => c.value)).toEqual(['approved']);
  });

  it('XT16: enough funds for the year but a late disbursement is passed to strategy as a cash timing gap', async () => {
    const h = makeV2();
    h.workedCosts();
    h.outsidePolicy('aldermere_c', { rule: 'no_displacement', studentContributionFirst: null, text: 'Outside scholarships do not reduce Aldermere grants.' });
    h.funding('grant', { name: 'Aldermere Grant', kind: 'institutional_grant', amount: USD('20000.00'), optionRef: 'aldermere', disbursesOn: '2027-08-25' });
    h.budget('31000.00', { availableFrom: '2027-08-01' });
    const f = await h.ok('15', { action: 'compare', view: 'upfront_cash', options: [{ optionRef: 'aldermere', institution: 'Aldermere College', cycle: '2027', dueDates: { tuition: '2027-08-15' } }] });
    expect(f.payload.options[0].state).toBe('supported');
    expect(f.payload.options[0].cashFlow.upfrontShortfall).toMatchObject({ on: '2027-08-15', coveredOn: '2027-08-25' });
    const p = await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'aldermere', institution: 'Aldermere College', round: 'regular' }] });
    const o = p.payload.options[0];
    expect(o.affordability).toBe('cash_timing_gap');
    expect(o.notes.join(' ')).toContain('is due on 2027-08-15 before the funding arrives on 2027-08-25');
    expect(p.payload.coverage.confirmedAffordablePath).toBe(false);
    expect(p.payload.coverage.gaps.map((g: { code: string }) => g.code)).toContain('cash_timing');
  });

  it('XT17: one shared external dependency failing across applications is shown as a common failure with a scoped recovery', async () => {
    const h = makeV2();
    for (const [id] of [['ashby_c'], ['maplecrest_u'], ['copperfield_su']] as const) h.regular(id);
    h.deadline('ashby_c', 'regular', '2026-10-10');
    h.deadline('maplecrest_u', 'regular', '2026-10-12');
    h.deadline('copperfield_su', 'regular', '2026-10-15');
    const report = { key: 'school_report', label: 'School report from the counseling office', kind: 'school_report_request', owner: 'school' };
    const p = await h.ok('14', { action: 'plan', cycle: '2027', options: [{ optionRef: 'ashby', institution: 'Ashby College', round: 'regular', externalItems: [report] }, { optionRef: 'maple', institution: 'Maplecrest University', round: 'regular', externalItems: [report] }, { optionRef: 'copper', institution: 'Copperfield State University', round: 'regular', externalItems: [report] }] });
    expect(p.payload.coverage.sharedDependencies).toEqual([{ label: 'School report from the counseling office', owner: 'school', optionRefs: ['ashby', 'copper', 'maple'] }]);
    const late = p.payload.notices.find((n: { code: string }) => n.code === 'late_request');
    expect(late.message).toContain('School report from the counseling office should have been requested by 2026-09-26');
    expect(p.payload.coverage.gaps.find((g: { code: string }) => g.code === 'shared_dependency').message).toContain('so they are not independent');
  });

  it('XT18: a task cancelled while it runs commits nothing, and the earlier state is kept', async () => {
    const h = makeV2();
    await h.ok('10', { action: 'plan', projectId: 'club_app', brief: PROJECT_BRIEF, weeks: 6, weeklyHours: { low: 3, high: 3 }, milestones: PROJECT_MILESTONES, approve: true });
    const request = h.system.kernel.buildRequest({ tenantId: TENANT, studentId: h.studentId, actor: h.student, role: '10', purpose: 'project_mentoring', objective: 'project_mentoring', completionContract: 'project_plan_v1', scope: { action: 'check_in', projectId: 'club_app', reports: [{ milestoneId: 'm1', status: 'done' }], note: 'Finished the import' } });
    const original = h.system.notebook.add.bind(h.system.notebook);
    h.system.notebook.add = (input) => {
      const e = original(input);
      // The student cancels while the check-in is still running.
      h.system.kernel.cancel(request.taskId, 'cancelled by the student');
      return e;
    };
    const out = await h.system.kernel.invoke(request);
    expect(out.accepted).toBe(false);
    expect(out.result.status).toBe('cancelled');
    const plans = h.artifacts('project_plan').filter((a) => a.status === 'current');
    expect(plans.map((a) => (a.payload as { version: number; done: string[] }).version)).toEqual([1]);
    expect((plans[0]!.payload as { done: string[] }).done).toEqual([]);
  });
});

describe('The lead counselor routes to the volume-two specialists', () => {
  it('asks for the entry year before a scholarship search, then runs it', async () => {
    const h = makeV2();
    const q = await h.counsel('Can you help me find scholarships for college?');
    expect(q.answer!.question!.text).toBe('Which entry year are you applying for?');
    expect(q.answer!.progress).toEqual([]);
    h.award(BEACON_SCHOLARS);
    const r = await h.counsel('Can you help me find scholarships for college?', { context: { cycle: '2027' } });
    expect(r.answer!.progress.map((p) => p.role)).toEqual(['16']);
  });

  it('runs the admissions context before the application plan that integrates it', async () => {
    const h = makeV2();
    h.regular('ashby_c');
    h.deadline('ashby_c', 'regular', '2027-01-15');
    const r = await h.counsel('What are my chances at Ashby, and can you help with my application plan?', { context: { cycle: '2027', options: [{ optionRef: 'ashby', institution: 'Ashby College', round: 'regular' }] } });
    expect(r.answer!.progress.map((p) => p.role)).toEqual(['13', '14']);
    const nodes = h.system.objectives.get(TENANT, h.studentId, h.student.id, r.objectiveId!).nodes;
    expect(nodes.find((n) => n.role === '14')!.dependsOn).toEqual(['uncertainty']);
    expect(JSON.stringify(r.answer)).not.toMatch(/\b\d{1,3}\s?% (chance|likely)/i);
  });

  it('starts a small project conversation and a cross-response review from plain requests', async () => {
    const h = makeV2();
    const p = await h.counsel('I want to start a project and build an app for my chess club.');
    expect(p.answer!.progress.map((x) => x.role)).toEqual(['10']);
    expect(p.answer!.question!.text).toBe('What would you like to learn or be able to do?');
    policies(h);
    await h.ok('18', { action: 'register_draft', draft: { artifactId: 'e1', title: 'Essay one', applicationId: null, cycle: '2027', destinations: [BROOKFIELD], fieldId: 'essay', text: 'I rebuilt the robot arm after it broke at the regional meet.', declaredProvenance: 'student_written' } });
    const r = await h.counsel('Am I repeating myself across my essays?');
    expect(r.answer!.progress.map((x) => x.role)).toEqual(['18']);
    expect(JSON.stringify(r.answer)).not.toMatch(/theme|brand/i);
  });
});
