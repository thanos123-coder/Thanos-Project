import { describe, expect, it } from 'vitest';
import { PROJECT_CONTRACT, type ProjectPayload } from '../../src/agents/a10-projects/agent.js';
import { checkMeasure, detectPrivateDetails, requestsFabrication, safetyAreas, supportedOutputState } from '../../src/agents/a10-projects/checks.js';
import { viewOf } from '../../src/agents/a10-projects/notebook.js';
import { checkGraph, MilestoneSchema, schedule, type MilestoneInput } from '../../src/agents/a10-projects/schedule.js';
import { APPROVALS, BRIEF, FAIR, makeProjectHarness, RESOURCE_PAGE, START } from '../helpers/projects.js';

const m = (over: MilestoneInput) => MilestoneSchema.parse(over);
const wk = (n: number, low: number) => Array.from({ length: n }, (_, i) => ({ week: i + 1, low, high: low, reason: null }));
const appText = (p: ProjectPayload) => JSON.stringify([p.notices, p.questions, p.estimateReview, p.scopeOptions, p.exploration, p.assist]);

describe('Agent 10 — scheduling and checks (unit)', () => {
  it('rejects cycles, unknown dependencies and duplicate ids, naming the milestones', () => {
    const issues = checkGraph([m({ id: 'a', purpose: 'p', action: 'a', effort: { low: 1, high: 1 }, evidence: 'e', dependsOn: ['c'] }), m({ id: 'b', purpose: 'p', action: 'b', effort: { low: 1, high: 1 }, evidence: 'e', dependsOn: ['a'] }), m({ id: 'c', purpose: 'p', action: 'c', effort: { low: 1, high: 1 }, evidence: 'e', dependsOn: ['b', 'zz'] })]);
    expect(issues.find((i) => i.kind === 'cycle')!.milestoneIds.sort()).toEqual(['a', 'b', 'c']);
    expect(issues.find((i) => i.kind === 'unknown_dependency')!.milestoneIds).toEqual(['c', 'zz']);
    expect(checkGraph([m({ id: 'a', purpose: 'p', action: 'a', effort: { low: 1, high: 1 }, evidence: 'e' }), m({ id: 'a', purpose: 'p', action: 'a', effort: { low: 1, high: 1 }, evidence: 'e' })])[0]!.kind).toBe('duplicate_id');
  });

  it('never places more than the usable hours, respects waits, and returns hours for work that does not fit', () => {
    const ms = [m({ id: 'a', purpose: 'p', action: 'a', effort: { low: 1, high: 2 }, evidence: 'e', waitWeeks: 2 }), m({ id: 'b', purpose: 'p', action: 'b', effort: { low: 1, high: 1 }, evidence: 'e', dependsOn: ['a'] }), m({ id: 'c', purpose: 'p', action: 'c', effort: { low: 5, high: 9 }, evidence: 'e' })];
    const s = schedule({ milestones: ms, capacity: wk(4, 2.5), reservePerWeek: 0.5, approvals: [] });
    expect(s.load.every((l) => l.placed <= l.usable && l.usable === 2)).toBe(true);
    const b = s.milestones.find((x) => x.id === 'b')!;
    // a finishes in week 1; a two-week wait means b starts in week 3 at the earliest.
    expect(b.startWeek).toBe(3);
    expect(s.milestones.find((x) => x.id === 'c')!.state).toBe('does_not_fit');
    expect(s.fits).toBe(false);
    // The failed milestone's hours are given back, not left occupying weeks.
    expect(s.load.reduce((a, l) => a + l.placed, 0)).toBe(3);
  });

  it('detects fabrication requests without catching genuine plans', () => {
    expect(requestsFabrication('Can you make up a nonprofit so my application looks better?')).toBe(true);
    expect(requestsFabrication('Just say I founded a coding club.')).toBe(true);
    expect(requestsFabrication('I want to start a coding club at my school.')).toBe(false);
    expect(requestsFabrication('I volunteer at the food bank and want to organize their volunteer schedule.')).toBe(false);
  });

  it('finds safety areas from what the work involves, not from a project being a website', () => {
    expect(safetyAreas('I will survey classmates about their sleep')).toEqual(['human_participants']);
    expect(safetyAreas('Culturing bacteria from door handles')).toEqual(['microorganisms']);
    expect(safetyAreas('A page with links for the robotics club members')).toEqual([]);
    expect(safetyAreas('A website for the animal shelter')).toEqual([]);
  });

  it('keeps output states to what the evidence supports', () => {
    expect(supportedOutputState('published', 'submission_confirmation', true).state).toBe('submitted');
    expect(supportedOutputState('published', 'acceptance_notice', true).state).toBe('accepted');
    expect(supportedOutputState('published', 'publication_link', true).state).toBe('published');
    expect(supportedOutputState('deployed', 'public_url', false).state).toBe('private_demo');
    expect(supportedOutputState('deployed', 'public_url', true).state).toBe('deployed');
  });

  it('keeps measured quantities and asks before recording impact', () => {
    const c = checkMeasure({ value: 500, unit: 'visits', kind: 'page_views', method: 'platform_metric' }, 'helped 500 students');
    expect(c.measure.kind).toBe('page_views');
    expect(c.question).toContain('What does “helped” mean here');
    expect(checkMeasure({ value: 40, unit: 'visits', kind: 'page_views', method: 'platform_metric' }, null).question).toBeNull();
  });

  it('redacts other people’s private details', () => {
    const d = detectPrivateDetails('Participant 3: Dana Reyes, dana.reyes@example.com, 555-201-3344, lives at 12 Elm Street.');
    expect(d.kinds).toEqual(['address', 'email', 'participant_name', 'phone']);
    expect(d.redacted).not.toMatch(/Dana|dana\.reyes|555-201|Elm Street/);
  });
});

describe('Agent 10 — project mentor and workload planner', () => {
  it('10T01 offers a small exploration step and asks what the student wants to learn', async () => {
    const h = makeProjectHarness();
    const r = await h.ok({ action: 'explore', interest: 'marine biology' });
    expect(r.status).toBe('needs_student_input');
    expect(r.payload.exploration!.step).toContain('marine biology');
    expect(r.payload.exploration!.sessions).toBe('1–2 sessions of about an hour');
    expect(r.payload.exploration!.questions[0]).toBe('What would you like to learn or be able to do?');
    // Nothing large is invented, and no project is created.
    expect(appText(r.payload)).not.toMatch(/\b(found|launch|nonprofit|start a (club|company))\b/i);
    expect(h.history('project:club_page.definition')).toEqual([]);
    expect(h.kernel.records.listArtifacts(h.ui, 'tenant_a', h.studentId, { kind: 'project_plan' })).toEqual([]);
  });

  it('10T02 keeps a one-hour week proportionate and never fills time the student does not have', async () => {
    const h = makeProjectHarness();
    const r = await h.plan({ weeklyHours: { low: 1, high: 1 }, approve: true });
    expect(r.payload.capacity!.reservePerWeek).toBe(0.25);
    for (const w of r.payload.capacity!.weeks) expect(w.placed).toBeLessThanOrEqual(0.75);
    expect(r.payload.fits).toBe(false);
    expect(r.payload.status).toBe('needs_review');
    expect(r.payload.notices.map((n) => n.code)).toEqual(expect.arrayContaining(['does_not_fit', 'cannot_approve']));
    const extend = r.payload.scopeOptions.find((o) => o.option === 'extend_timeline')!;
    expect(extend.fits).toBe(true);
    expect(extend.extraWeeks).toBeGreaterThan(6);
    // Estimates are kept exactly as given.
    expect(h.ms(r, 'm3').effort).toEqual({ low: 3, high: 4 });
    // A proportionate scope for one hour a week fits.
    const small = await h.plan({ weeklyHours: { low: 1, high: 1 }, milestones: RESOURCE_PAGE.slice(0, 2), approve: true });
    expect(small.payload.fits).toBe(true);
    expect(small.payload.status).toBe('approved');
  });

  it('10T03 revises only affected milestones after exams reduce capacity, and offers a smaller scope', async () => {
    const h = makeProjectHarness();
    const v1 = await h.plan({ approve: true });
    expect(v1.payload.status).toBe('approved');
    expect(v1.payload.fits).toBe(true);
    h.clock.set('2026-10-05T10:00:00Z');
    const c = await h.ok({ action: 'check_in', projectId: 'club_page', reports: [{ milestoneId: 'm1', status: 'done', actualHours: { low: 2, high: 2 } }], capacityChanges: [{ fromWeek: 2, toWeek: 2, hours: { low: 1, high: 1 }, reason: 'exams' }] });
    expect(c.payload.version).toBe(2);
    expect(c.payload.fits).toBe(false);
    expect(c.payload.status).toBe('needs_review');
    expect(c.payload.capacity!.weeks[0]).toMatchObject({ week: 1, usable: 0, reason: 'already past' });
    expect(c.payload.capacity!.weeks[1]).toMatchObject({ week: 2, usable: 0.5, reason: 'exams' });
    expect(c.payload.affected).not.toContain('m1');
    expect(h.ms(c, 'm1').state).toBe('done');
    const smaller = c.payload.scopeOptions.find((o) => o.option === 'smaller_version')!;
    expect(smaller.fits).toBe(true);
    // The remaining weeks are not made heavier and no estimate is squeezed.
    for (const w of c.payload.capacity!.weeks) expect(w.placed).toBeLessThanOrEqual(w.usable);
    expect(RESOURCE_PAGE.map((x) => x.effort)).toEqual(c.payload.milestones.map((x) => x.effort));
    // The student chooses the smaller version; the earlier scope is kept with the reason.
    const v3 = await h.plan({ scopeChoice: 'smallest', scopeChangeReason: 'Exams in week two', approve: true });
    expect(v3.payload.status).toBe('approved');
    expect(h.ms(v3, 'search').state).toBe('dropped');
    expect(v3.payload.scopeVersions.map((v) => [v.version, v.choice, v.reason])).toEqual([[1, 'full', null], [2, 'smallest', 'Exams in week two']]);
  });

  it('10T04 rejects a schedule with a dependency cycle and names the milestones', async () => {
    const h = makeProjectHarness();
    const loop = [
      { id: 'a', purpose: 'p', action: 'Draft', effort: { low: 1, high: 1 }, evidence: 'e', dependsOn: ['b'] },
      { id: 'b', purpose: 'p', action: 'Review', effort: { low: 1, high: 1 }, evidence: 'e', dependsOn: ['a'] },
    ];
    const r = await h.plan({ milestones: loop });
    expect(r.payload.status).toBe('rejected');
    expect(r.payload.graphIssues[0]).toMatchObject({ kind: 'cycle' });
    expect(r.payload.graphIssues[0]!.milestoneIds.sort()).toEqual(['a', 'b']);
    expect(r.payload.graphIssues[0]!.message).toContain('At least one dependency has to go.');
    expect(h.kernel.records.listArtifacts(h.ui, 'tenant_a', h.studentId, { kind: 'project_plan' })).toEqual([]);
  });

  it('10T05 blocks work waiting for an external approval and keeps independent work available', async () => {
    const h = makeProjectHarness();
    const withPosting = [...RESOURCE_PAGE, { id: 'post', purpose: 'Share it with the club', action: 'Post the page on the club site', effort: { low: 0.5, high: 1 }, dependsOn: ['m5'], evidence: 'public_link', needsApproval: 'adviser_posting' }, { id: 'announce', purpose: 'Let members know', action: 'Tell members where to find it', effort: { low: 0.5, high: 0.5 }, dependsOn: ['post'], evidence: 'student_note' }];
    const r = await h.plan({ milestones: withPosting, weeks: 8 });
    expect(h.ms(r, 'post')).toMatchObject({ state: 'blocked', weeks: [] });
    expect(h.ms(r, 'post').blockedBy[0]).toBe('waiting for approval from the club adviser');
    expect(h.ms(r, 'announce').blockedBy).toEqual(['depends on post, which is blocked']);
    expect(h.ms(r, 'm1').state).toBe('scheduled');
    expect(r.payload.approvals[0]).toMatchObject({ id: 'adviser_posting', status: 'pending', blocks: ['post'] });
    expect(r.payload.notices.find((n) => n.code === 'waiting_for_approval')!.message).toContain('That is a dependency, not something you did wrong');
    expect(r.payload.publicRelease).toBe('awaiting_permission');
    // When the approval arrives, the work is scheduled.
    const c = await h.ok({ action: 'check_in', projectId: 'club_page', approvals: [{ id: 'adviser_posting', status: 'granted' }] });
    expect(h.ms(c, 'post').state).toBe('scheduled');
    expect(c.payload.publicRelease).toBe('permitted');
  });

  it('10T06 declines to fabricate an activity and explores genuine interests instead', async () => {
    const h = makeProjectHarness();
    const r = await h.ok({ action: 'explore', interest: 'coding', request: 'Can you make up a nonprofit I can put on my college application?' });
    expect(r.payload.status).toBe('declined');
    expect(r.payload.notices[0]).toMatchObject({ code: 'no_fabricated_activity' });
    expect(r.payload.exploration!.questions).toContain('Is there something you already do or care about that this could connect to?');
    const genuine = await h.ok({ action: 'explore', interest: 'coding', request: 'I help at the food bank and want to make their volunteer sign-up easier.' });
    expect(genuine.payload.status).toBe('exploring');
  });

  it('10T07 separates the team’s output from the student’s own contribution', async () => {
    const h = makeProjectHarness();
    await h.plan({ approve: true });
    const r = await h.ok({
      action: 'close',
      projectId: 'club_page',
      outcome: 'completed',
      outputs: [{ description: 'Club scheduling app prototype', state: 'prototype' }],
      contributions: [
        { description: 'Wrote the calendar import', by: 'student', evidence: 'commits in the shared repository' },
        { description: 'Built the interface', by: 'team', evidence: 'shared repository' },
        { description: 'Designed the logo', by: 'other_student', evidence: null },
        { description: 'Suggested code for date parsing', by: 'tool', evidence: 'support log' },
        { description: 'Reviewed the data model', by: 'mentor', evidence: null },
      ],
      confirmedByStudent: true,
    });
    const c = r.payload.completionProposal!;
    expect(c.studentContribution).toEqual(['Wrote the calendar import']);
    expect(c.teamContribution).toEqual(['Built the interface']);
    expect(c.otherContributions).toEqual([{ by: 'other_student', description: 'Designed the logo' }, { by: 'tool', description: 'Suggested code for date parsing' }, { by: 'mentor', description: 'Reviewed the data model' }]);
    expect(r.payload.questions.find((q) => q.code === 'explain_decisions')!.question).toContain('A shared repository shows the work exists but not who did which part');
    expect(h.history('project:club_page.contribution_log').at(-1)!.value).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ by: 'tool' })]) });
  });

  it('10T08 keeps visits as visits and asks before recording people helped', async () => {
    const h = makeProjectHarness();
    await h.plan({ approve: true });
    const r = await h.ok({ action: 'close', projectId: 'club_page', outcome: 'completed', outputs: [{ description: 'Resource page', state: 'private_demo' }], measures: [{ measure: { value: 500, unit: 'visits', kind: 'page_views', method: 'platform_metric' }, statedAs: 'helped 500 students' }], confirmedByStudent: true });
    expect(r.payload.completionProposal!.measures).toEqual([{ value: 500, unit: 'visits', kind: 'page_views', method: 'platform_metric' }]);
    expect(r.payload.questions.find((q) => q.code === 'measure_page_views')!.question).toContain('The number counts page views');
    expect(r.payload.notices.find((n) => n.code === 'measure_kept')!.message).toBe('Kept as page views; it is not recorded as people helped.');
    expect(JSON.stringify(h.history('project:club_page.completion').at(-1)!.value)).not.toContain('people_served');
    expect(r.status).toBe('needs_student_input');
  });

  it('10T09 applies the competition’s policy and does not generate a prohibited research plan', async () => {
    const h = makeProjectHarness();
    h.fairPolicy();
    const r = await h.ok({ action: 'assist', operation: 'research_plan_generation', destination: FAIR });
    expect(r.payload.status).toBe('declined');
    expect(r.payload.assist).toMatchObject({ operation: 'research_plan_generation', decision: 'prohibited', sources: ['src_northgate_rules'] });
    expect(r.payload.assist!.alternatives[0]).toBe('I can explain what the rules say a research plan must contain and who reviews it.');
    expect(r.sourceRefs).toEqual(['src_northgate_rules']);
    // The plan records the context policy at the operation level.
    const p = await h.plan({ brief: { ...BRIEF, context: 'competition', contextRef: FAIR, publicRelease: { wanted: false, approvalId: null } } });
    expect(p.payload.contextPolicy).toEqual([
      { operation: 'research_plan_generation', decision: 'prohibited', explanation: 'This app does not do that: you stay the author of everything you submit.', sourceId: 'src_northgate_rules' },
      { operation: 'review_student_text', decision: 'allowed', explanation: 'Allowed for every destination this material is for.', sourceId: 'src_northgate_rules' },
    ]);
    // Without a reviewed policy, review of the student's own text is unclear, not assumed allowed.
    const h2 = makeProjectHarness();
    const unclear = await h2.ok({ action: 'assist', operation: 'review_student_text', destination: FAIR });
    expect(unclear.payload.assist!.decision).toBe('unclear');
    expect(unclear.payload.questions[0]!.code).toBe('ask_organizer');
  });

  it('10T10 routes safety-relevant work to a responsible adult and gives no procedure', async () => {
    const h = makeProjectHarness();
    const survey = [
      { id: 'read', purpose: 'Learn what is already known', action: 'Read two articles about teen sleep', effort: { low: 1, high: 2 }, evidence: 'reading_notes' },
      { id: 'run', purpose: 'Collect data', action: 'Run the survey with classmates', effort: { low: 2, high: 3 }, dependsOn: ['read'], evidence: 'responses_summary' },
      { id: 'write', purpose: 'Explain what was learned', action: 'Write up what the responses show', effort: { low: 1, high: 2 }, dependsOn: ['run'], evidence: 'student_summary' },
    ];
    const r = await h.plan({ brief: { ...BRIEF, title: 'Sleep survey', goal: 'Learn how classmates sleep', description: 'I want to survey classmates about how much they sleep.', publicRelease: { wanted: false, approvalId: null } }, milestones: survey, approvals: [] });
    expect(r.payload.supervision).toMatchObject({ required: true, areas: ['human_participants'] });
    expect(r.payload.supervision!.safeAlternatives).toContain('Use a non-sensitive demonstration dataset, where the rules allow it.');
    expect(h.ms(r, 'run')).toMatchObject({ state: 'blocked', needsSupervision: true });
    expect(h.ms(r, 'read').state).toBe('scheduled');
    expect(r.payload.notices.find((n) => n.code === 'supervision_needed')!.message).toContain('needs a responsible adult or review before it starts');
    // With a supervising adult in place, the work can be scheduled.
    const ok = await h.plan({ brief: { ...BRIEF, description: 'I want to survey classmates about how much they sleep.', publicRelease: { wanted: false, approvalId: null } }, milestones: survey, approvals: [{ id: 'teacher', authority: 'the psychology teacher', status: 'granted', supervision: true }] });
    expect(h.ms(ok, 'run').state).toBe('scheduled');
    // A plain website project is not given a review requirement it does not have.
    const site = await h.plan();
    expect(site.payload.supervision).toBeNull();
  });

  it('10T11 supports approximate planning when the student declines detailed tracking', async () => {
    const h = makeProjectHarness();
    await h.plan({ tracking: 'none', approve: true });
    h.clock.set('2026-10-05T10:00:00Z');
    const c = await h.ok({ action: 'check_in', projectId: 'club_page', reports: [{ milestoneId: 'm1', status: 'done', actualHours: { low: 9, high: 9 } }, { milestoneId: 'm2', status: 'in_progress', actualHours: { low: 9, high: 9 } }] });
    expect(c.payload.tracking).toBe('none');
    expect(c.payload.status).toBe('approved');
    expect(c.payload.reminders).toBe('on');
    expect(c.payload.nextAction).not.toBeNull();
    // Hours given while tracking is off are not used to judge an estimate.
    expect(c.payload.estimateReview).toBeNull();
  });

  it('10T12 reviews the estimate and scope after repeated overruns, without judging the student', async () => {
    const h = makeProjectHarness();
    await h.plan({ approve: true, tracking: 'approximate' });
    await h.ok({ action: 'check_in', projectId: 'club_page', reports: [{ milestoneId: 'm1', status: 'in_progress', actualHours: { low: 3, high: 3 } }] });
    const second = await h.ok({ action: 'check_in', projectId: 'club_page', reports: [{ milestoneId: 'm1', status: 'took_longer' }] });
    expect(second.payload.estimateReview!.milestoneIds).toEqual(['m1']);
    expect(second.payload.estimateReview!.questions[0]).toBe('Was the estimate too small for this kind of task, or has the task grown since you planned it?');
    expect(second.payload.notices.find((n) => n.code === 'estimate_review')!.message).toContain('the plan will not assume you should work more hours');
    expect(appText(second.payload)).not.toMatch(/lazy|motivat|procrastinat|anxi|diagnos|disorder|discipline/i);
    // The estimate itself is not changed for the student.
    expect(h.ms(second, 'm1').effort).toEqual({ low: 1, high: 2 });
  });

  it('10T13 stops reminders and records the work actually done when the student ends the project', async () => {
    const h = makeProjectHarness();
    await h.plan({ approve: true });
    await h.ok({ action: 'check_in', projectId: 'club_page', reports: [{ milestoneId: 'm1', status: 'done' }] });
    const r = await h.ok({ action: 'close', projectId: 'club_page', outcome: 'stopped', reason: 'I would rather focus on the robotics team', outputs: [{ description: 'List of the club’s existing resources', state: 'draft' }], contributions: [{ description: 'Collected the resource list', by: 'student', evidence: 'notebook' }], confirmedByStudent: true });
    expect(r.payload.reminders).toBe('off');
    expect(r.payload.notices.find((n) => n.code === 'reminders_stopped')!.message).toBe('Reminders for this project have stopped. It will not be reopened unless you choose to.');
    expect(r.payload.completionProposal!.unfinished).toEqual(['Choose a simple structure for the page', 'Build the page with five checked links', 'Share the page with the club adviser for review', 'Make corrections and write a short reflection']);
    expect(h.history('project:club_page.status').at(-1)!.value).toBe('stopped');
    const after = await h.ok({ action: 'check_in', projectId: 'club_page', reports: [] });
    expect(after.payload).toMatchObject({ status: 'not_applicable', reminders: 'off' });
    const replan = await h.plan();
    expect(replan.payload.status).toBe('not_applicable');
    const reopened = await h.plan({ reopen: true });
    expect(reopened.payload.status).toBe('proposed');
  });

  it('10T14 restricts a notebook entry with private participant details and proposes redaction', async () => {
    const h = makeProjectHarness();
    const r = await h.ok({ action: 'add_evidence', projectId: 'club_page', kind: 'note', text: 'Participant 3: Dana Reyes, dana.reyes@example.com, 555-201-3344, said the page was confusing.' });
    expect(r.payload.notebook).toMatchObject({ access: 'restricted', privateKinds: ['email', 'participant_name', 'phone'] });
    expect(r.payload.notebook!.redactionProposal).toBe('Participant 3: [name removed], [email removed], [phone removed], said the page was confusing.');
    expect(r.payload.notebook!.minimalEvidence).toContain('instead of the details themselves');
    expect(JSON.stringify(r.payload)).not.toMatch(/Dana Reyes|dana\.reyes@example\.com|555-201-3344/);
    // No agent can read the restricted text back.
    const entry = h.notebook.list('tenant_a', h.studentId, 'club_page')[0]!;
    expect(entry.access).toBe('restricted');
    expect(viewOf(entry).text).toBeNull();
    // Deleting the account removes the entries.
    expect(h.notebook.purgeByStudent('tenant_a', h.studentId)).toBe(1);
    // An ordinary note is kept normally.
    const plain = await h.ok({ action: 'add_evidence', projectId: 'club_page', kind: 'link', text: 'Link list checked on Tuesday', url: 'https://clubsite.example.org/resources' });
    expect(plain.payload.notebook!.access).toBe('normal');
  });

  it('10T15 keeps submitted and published states distinct', async () => {
    const h = makeProjectHarness();
    await h.plan({ approve: true });
    const r = await h.ok({ action: 'close', projectId: 'club_page', outcome: 'completed', outputs: [{ description: 'Article about the club for the district newsletter', state: 'published', evidence: 'submission_confirmation' }], confirmedByStudent: true });
    expect(r.payload.completionProposal!.outputs).toEqual([{ description: 'Article about the club for the district newsletter', state: 'submitted' }]);
    expect(r.payload.notices.find((n) => n.code === 'output_state_kept')!.message).toContain('Recorded as submitted: published needs a link to the published work.');
  });

  it('10T16 saves the student’s correction to the completion summary as a new version', async () => {
    const h = makeProjectHarness();
    await h.plan({ approve: true });
    await h.ok({ action: 'close', projectId: 'club_page', outcome: 'completed', outputs: [{ description: 'Resource page', state: 'private_demo' }], contributions: [{ description: 'Built the page', by: 'student', evidence: null }], confirmedByStudent: true });
    const r = await h.ok({ action: 'correct_completion', projectId: 'club_page', studentContribution: ['Built the page', 'Checked every link with the adviser'], note: 'I also checked the links with the adviser' });
    expect(r.payload.completionChanges).toEqual(['studentContribution']);
    const versions = h.history('project:club_page.completion');
    expect(versions).toHaveLength(2);
    expect((versions.at(-1)!.value as { studentContribution: string[] }).studentContribution).toEqual(['Built the page', 'Checked every link with the adviser']);
    expect(versions[0]!.status).toBe('superseded');
  });

  it('10T17 does not send a project reflection to essay help without story-use permission', async () => {
    const h = makeProjectHarness();
    await h.plan({ approve: true });
    const close = { action: 'close', projectId: 'club_page', outcome: 'completed', outputs: [{ description: 'Resource page', state: 'private_demo' }], reflection: 'I learned that organizing is mostly deciding what to leave out.', confirmedByStudent: true };
    const r = await h.ok(close);
    expect(r.handoffs.some((x) => x.toRole === '17')).toBe(false);
    expect(r.payload.notices.find((n) => n.code === 'reflection_private')).toBeDefined();
    // With permission, only a reference is handed on, never the reflection itself.
    const h2 = makeProjectHarness();
    await h2.plan({ approve: true });
    h2.storyUse('club_page', 'possible_writing_material');
    const r2 = await h2.ok(close);
    const handoff = r2.handoffs.find((x) => x.toRole === '17')!;
    expect(handoff.inputRefs).toEqual(['project:club_page']);
    expect(JSON.stringify(handoff)).not.toContain('deciding what to leave out');
  });

  it('10T18 preserves the prior state and returns a recoverable update when a tool fails during a check-in', async () => {
    const h = makeProjectHarness();
    await h.plan({ approve: true });
    h.notebook.add = () => {
      throw new Error('storage unavailable');
    };
    const r = await h.ok({ action: 'check_in', projectId: 'club_page', reports: [{ milestoneId: 'm1', status: 'done' }], note: 'Finished the list of resources' });
    expect(r.status).toBe('partial');
    expect(r.payload.pendingUpdate).toMatchObject({ reports: [{ milestoneId: 'm1', status: 'done' }], note: 'Finished the list of resources' });
    expect(r.payload.notices[0]!.code).toBe('saved_nothing_yet');
    const plans = h.kernel.records.listArtifacts(h.ui, 'tenant_a', h.studentId, { kind: 'project_plan' });
    expect(plans.filter((p) => p.status === 'current').map((p) => (p.payload as { version: number }).version)).toEqual([1]);
    expect((plans.find((p) => p.status === 'current')!.payload as { done: string[] }).done).toEqual([]);
  });

  it('starts with a short trial when the student does not know their weekly time', async () => {
    const h = makeProjectHarness();
    const r = await h.plan({ weeklyHours: null });
    expect(r.payload.capacity).toMatchObject({ trial: true, base: { low: 1, high: 2 } });
    expect(r.payload.capacity!.weeks).toHaveLength(2);
    expect(r.payload.questions.find((q) => q.code === 'weekly_hours')!.question).toContain('Which evenings or days are already full');
    // The student's stated time is used when it is on record.
    h.weekly(2, 4);
    const r2 = await h.plan({ weeklyHours: null });
    expect(r2.payload.capacity).toMatchObject({ trial: false, base: { low: 2, high: 4 } });
  });

  it('the worked example: a club resource page, an exam week, a smaller version, and an honest completion record', async () => {
    const h = makeProjectHarness();
    const v1 = await h.plan({ approve: true });
    expect(v1.payload.milestones.map((x) => [x.id, x.startWeek, x.finishWeek])).toEqual([['m1', 1, 1], ['m2', 1, 2], ['m3', 2, 4], ['search', 4, 5], ['m4', 5, 5], ['m5', 6, 6]]);
    expect(v1.payload.nextAction).toMatchObject({ milestoneId: 'm1', week: 1, question: 'This usually takes 1–2 hours. Does that fit your week?' });
    expect(h.history('project:club_page.status').at(-1)!.value).toBe('active');
    // Week two: exams reduce the week to one hour.
    h.clock.set('2026-10-05T10:00:00Z');
    const c = await h.ok({ action: 'check_in', projectId: 'club_page', reports: [{ milestoneId: 'm1', status: 'done' }], capacityChanges: [{ fromWeek: 2, toWeek: 2, hours: { low: 1, high: 1 }, reason: 'exams' }] });
    expect(c.payload.fits).toBe(false);
    expect(c.payload.scopeOptions.map((o) => [o.option, o.fits])).toEqual([['smaller_version', true], ['extend_timeline', true], ['keep_and_review_estimates', false]]);
    const v3 = await h.plan({ scopeChoice: 'smallest', scopeChangeReason: 'Exams in week two', approve: true });
    expect(v3.payload.fits).toBe(true);
    expect(h.ms(v3, 'search').state).toBe('dropped');
    // The adviser has not approved public posting, so a "launched" page is recorded as a private demonstration.
    h.clock.set('2026-11-08T10:00:00Z');
    const close = await h.ok({
      action: 'close',
      projectId: 'club_page',
      outcome: 'completed',
      outputs: [{ description: 'Resource page with five checked links', state: 'deployed', evidence: 'public_url' }],
      contributions: [{ description: 'Chose the structure and built the page', by: 'student', evidence: 'notebook entries' }],
      measures: [{ measure: { value: 5, unit: 'classmates', kind: 'participants', method: 'counted' }, statedAs: 'five classmates used it and it helped them' }],
      learned: 'How to decide what information belongs on a page.',
      confirmedByStudent: true,
    });
    expect(close.payload.completionProposal!.outputs).toEqual([{ description: 'Resource page with five checked links', state: 'private_demo' }]);
    expect(close.payload.notices.find((n) => n.code === 'output_state_kept')!.message).toContain('public release has not been approved');
    expect(close.payload.questions.find((q) => q.code === 'measure_participants')!.question).toContain('What does “helped” mean here');
    expect(close.payload.admissionsClaim).toBeNull();
  });

  it('the contract rejects overfilled weeks, judgments about the student, and approval of a plan that does not fit', () => {
    const base = { action: 'plan', projectId: 'x', version: 1, status: 'proposed', brief: null, contextPolicy: [], capacity: { base: { low: 2, high: 2 }, reservePerWeek: 0.5, trial: false, weeks: [{ week: 1, capacityLow: 2, usable: 1.5, placed: 2, reason: null }], protectedCommitments: [] }, milestones: [], graphIssues: [], fits: true, requiredHours: null, scopeVersions: [], scopeOptions: [], affected: [], approvals: [], supervision: null, nextAction: null, reminders: 'off', tracking: 'approximate', estimateReview: null, exploration: null, assist: null, notebook: null, completionProposal: null, completionChanges: [], publicRelease: null, admissionsClaim: null, questions: [], notices: [], pendingUpdate: null } as ProjectPayload;
    expect(PROJECT_CONTRACT.semantic!(base, {} as never)).toContain('week 1: more work placed than the time available');
    const judged = { ...base, capacity: null, notices: [{ code: 'x', message: 'You seem unmotivated this week.' }] };
    expect(PROJECT_CONTRACT.semantic!(judged, {} as never)).toContain('no inference about the student’s character, motivation or health');
    const approved = { ...base, capacity: null, status: 'approved', fits: false } as ProjectPayload;
    expect(PROJECT_CONTRACT.semantic!(approved, {} as never)).toContain('only a plan that fits can be approved');
    const framing = { ...base, capacity: null, notices: [{ code: 'x', message: 'This will impress admissions.' }] };
    expect(PROJECT_CONTRACT.semantic!(framing, {} as never)).toContain('a project plan does not use admissions framing');
    // The student's own words are not policed.
    const own = { ...base, capacity: null, brief: { title: 't', goal: 'g', audience: null, context: 'personal_learning', contextRef: null, learningQuestion: 'Why do I procrastinate on big tasks?', smallestResult: 's', extension: null } };
    expect(PROJECT_CONTRACT.semantic!(own, {} as never)).toEqual([]);
    void START;
    void APPROVALS;
  });
});
