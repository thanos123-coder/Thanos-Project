import { describe, expect, it } from 'vitest';
import { NARRATIVE_CONTRACT, type NarrativePayload } from '../../src/agents/a18-narrative/agent.js';
import { askAddressed, countText, distinctShare, schoolClaims, sharedSpans } from '../../src/agents/a18-narrative/text.js';
import { TENANT } from '../helpers/kernel.js';
import { ASHGROVE, BROOKFIELD, CLUB_BACKGROUND, HARBOR_FUND, makeNarrativeHarness, RESPONSES, RIVERTON, UAS } from '../helpers/narrative.js';

const base = { cycle: '2027', declaredProvenance: 'student_written' } as const;
const appText = (p: NarrativePayload) => JSON.stringify([p.findings.map((f) => [f.message, f.question, f.context]), p.notices, p.allowedSubset]);

describe('Agent 18 — text checks (unit)', () => {
  it('counts words and characters by code point, with and without spaces', () => {
    expect(countText('Café au lait 👍')).toEqual({ words: 4, charactersWithSpaces: 14, charactersWithoutSpaces: 11 });
    expect(countText('   ')).toEqual({ words: 0, charactersWithSpaces: 3, charactersWithoutSpaces: 0 });
  });

  it('finds passages shared word for word with exact offsets, and nothing for a shared topic alone', () => {
    const a = `Intro. ${CLUB_BACKGROUND} More.`;
    const b = `${CLUB_BACKGROUND} Different.`;
    const spans = sharedSpans(a, b);
    expect(spans).toHaveLength(1);
    expect(a.slice(spans[0]!.a.start, spans[0]!.a.end)).toBe(CLUB_BACKGROUND.replace(/\.$/, ''));
    expect(sharedSpans('I love the robotics club and its members.', 'The robotics club taught me patience with my members.')).toEqual([]);
    expect(distinctShare(b, [spans[0]!.b])).toBeLessThan(0.2);
  });

  it('checks whether a prompt ask is taken up, as a question rather than a verdict', () => {
    expect(askAddressed('What steps did you take?', 'The steps I took were simple.').addressed).toBe(true);
    expect(askAddressed('What would you do differently next time?', 'The steps I took were simple.').addressed).toBe(false);
  });

  it('flags school claims that need a source', () => {
    expect(schoolClaims('I love chemistry. Brookfield guarantees every student a lab position in their first year.').map((c) => c.text)).toEqual(['Brookfield guarantees every student a lab position in their first year.']);
    expect(schoolClaims('I want to study chemistry at Brookfield.')).toEqual([]);
  });
});

describe('Agent 18 — narrative portfolio coordinator', () => {
  it('18T01 withholds a coverage map that would be an outline and offers the allowed subset', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    h.story('club_page_story');
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage, storyIds: ['club_page_story'] });
    const r = await h.review({ applicationId: 'app_brookfield', operations: ['outline', 'mechanical_check', 'story_prompt_mapping'] });
    expect(r.payload.blocked).toEqual([{ operation: 'outline', explanation: 'This app does not do that: you stay the author of everything you submit.' }]);
    expect(r.payload.allowedSubset).toEqual(['A factual list of each prompt’s explicit asks and limits', 'Your own story choices for each prompt, exactly as you set them', 'Length and required-field checks']);
    expect(r.payload.manifest.find((m) => m.promptId === 'brookfield_problem')!.asks).toHaveLength(3);
    expect(r.payload.mapping).toEqual([{ artifactId: 'problem', fieldId: 'brookfield_problem', storyIds: ['club_page_story'] }]);
    expect(r.payload.generatedOutline).toBeNull();
    // Only mechanical findings appear, since reading the text was not requested.
    expect(r.payload.findings.every((f) => ['missing_required_response', 'length', 'group_length'].includes(f.type))).toBe(true);
    // Outline alone: nothing else to give but the subset.
    const only = await h.review({ applicationId: 'app_brookfield', operations: ['outline'] });
    expect(only.payload.status).toBe('blocked');
  });

  it('18T02 distinguishes a shared background from a redundant contribution', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage });
    await h.draft({ ...base, artifactId: 'collab', title: 'Collaboration essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_collab', text: RESPONSES.collaboration });
    const r = await h.review({ applicationId: 'app_brookfield' });
    const f = r.payload.findings.find((x) => x.type === 'shared_background')!;
    expect(f.message).toBe('“Problem essay” and “Collaboration essay” share the same background passage, and each goes on to something of its own.');
    expect(f.question).toBe('Do both answers need this much of the same context?');
    expect(f.anchors.map((x) => x.artifactId)).toEqual(['problem', 'collab']);
    expect(f.anchors[0]!.text).toBe(CLUB_BACKGROUND.replace(/\.$/, ''));
    expect(r.payload.findings.some((x) => x.type === 'largely_repeated')).toBe(false);
  });

  it('18T03 does not penalize the same student-written essay used for separate applications', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'essay_b', title: 'Essay for Brookfield', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage });
    await h.draft({ ...base, artifactId: 'essay_r', title: 'Essay for Riverton', applicationId: 'app_riverton', destinations: [RIVERTON], fieldId: 'riverton_essay', text: RESPONSES.resourcePage });
    const r = await h.review({ artifactIds: ['essay_b', 'essay_r'] });
    expect(r.payload.findings.filter((f) => f.type === 'shared_background' || f.type === 'largely_repeated')).toEqual([]);
  });

  it('18T04 identifies a missing prompt ask without writing its answer', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    const prompts = h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage });
    const r = await h.review({ artifactIds: ['problem'] });
    const missing = r.payload.findings.filter((f) => f.type === 'possible_missing_ask');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toBe('The prompt asks: “What would you do differently next time?” It is not clear where “Problem essay” takes this up.');
    expect(missing[0]!.question).toBe('Where does your response address this part, or do you want to add it in your own words?');
    expect(missing[0]!.recordRef).toBe(`iclaim:${prompts.problem.claimId}`);
    expect(r.payload.replacementProse).toBeNull();
  });

  it('18T05 does not impose a single personal brand across unrelated interests', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: `${RESPONSES.resourcePage} Next time I would ask members first and do it differently.` });
    await h.draft({ ...base, artifactId: 'interest', title: 'Interest essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_interest', text: RESPONSES.interest });
    await h.draft({ ...base, artifactId: 'collab', title: 'Collaboration essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_collab', text: 'I play violin in a community orchestra, and I worked with others toward a shared goal when our section rehearsed a hard passage. My role was to count the rests aloud.' });
    const r = await h.review({ applicationId: 'app_brookfield' });
    expect(appText(r.payload)).not.toMatch(/theme|brand|identity|coheren|spike|unify/i);
    expect(r.payload.findings.map((f) => f.type)).not.toContain('largely_repeated');
  });

  it('18T06 asks which date is correct and routes a versioned correction to the record', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    h.seedRecord('episode', 'robotics_2025', 'definition', { experienceRef: 'robotics', roleTitle: 'member', titleIsOfficial: false, period: { start: '2025-09', ongoing: true }, time: null });
    const text = 'I joined the robotics club in March 2025 and started fixing the forms. The steps I took were to list and check every link. Next time I would do it differently and ask members first.';
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text, factLinks: [{ quote: 'I joined the robotics club in March 2025', fieldKey: 'episode:robotics_2025.definition', path: ['period', 'start'], asserted: '2025-03' }] });
    const r = await h.review({ artifactIds: ['problem'] });
    const f = r.payload.findings.find((x) => x.type === 'fact_mismatch')!;
    expect(f.message).toBe('Your draft says “I joined the robotics club in March 2025”, and your record has "2025-09".');
    expect(f.recordRef).toMatch(/^claim_/);
    expect(f.anchors[0]!.text).toBe('I joined the robotics club in March 2025');
    // The student says the draft is right: the record gets a new version, the old one kept.
    const fix = await h.ok({ action: 'resolve_fact', artifactId: 'problem', factIndex: 0, correct: 'draft' });
    expect(fix.completionReason).toBe('record_corrected');
    const history = h.kernel.records.history(h.ui, TENANT, h.studentId, 'episode:robotics_2025.definition');
    expect(history).toHaveLength(2);
    expect((history.at(-1)!.value as { period: { start: string } }).period.start).toBe('2025-03');
    // The draft itself is never rewritten.
    expect(h.drafts.get(TENANT, h.studentId, 'problem')!.text).toBe(text);
    const again = await h.review({ artifactIds: ['problem'] });
    expect(again.payload.findings.some((x) => x.type === 'fact_mismatch')).toBe(false);
  });

  it('18T07 allows a repeated fact needed for a short answer to stand on its own', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: `${RESPONSES.resourcePage} Next time I would do it differently and ask members first.` });
    await h.draft({ ...base, artifactId: 'short', title: 'Short answer', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_collab', text: `${CLUB_BACKGROUND} I worked with others toward a shared goal: my role was testing the new page with two members and writing down what confused them, then we fixed it together.` });
    const r = await h.review({ applicationId: 'app_brookfield' });
    const f = r.payload.findings.find((x) => x.type === 'shared_background')!;
    expect(f.severity).toBe('minor');
    expect(f.context).toBe('A short answer may need this context to make sense on its own; keeping it is fine.');
    await h.ok({ action: 'dispose', fingerprint: f.fingerprint, disposition: 'keep', studentMeaning: 'The short answer needs it to make sense.' });
    const again = await h.review({ applicationId: 'app_brookfield' });
    expect(again.payload.findings.some((x) => x.fingerprint === f.fingerprint)).toBe(false);
  });

  it('18T08 rechecks permission for a new destination and keeps the assistance history', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'essay', title: 'Main essay', applicationId: null, destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage, assistance: [{ operation: 'review_student_text', detail: 'Repetition review in October' }] });
    const r = await h.ok({ action: 'add_destination', artifactId: 'essay', destination: ASHGROVE });
    expect(r.payload.status).toBe('paused');
    expect(r.payload.artifacts[0]).toMatchObject({ status: 'paused_for_policy', destinations: ['institution:brookfield_c:2027', 'institution:ashgrove_i:2027'], assistance: [{ operation: 'review_student_text', inheritedFrom: null }] });
    expect(r.payload.notices[0]!.message).toContain('renaming or copying the file would not change this');
    const rev = await h.review({ artifactIds: ['essay'] });
    expect(rev.payload.notices.find((n) => n.code === 'paused_for_policy')).toBeDefined();
    expect(rev.payload.findings).toEqual([]);
  });

  it('18T09 invalidates findings when the student excludes a story, and stops using it', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    h.story('club_story');
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage, storyIds: ['club_story'] });
    const r = await h.review({ applicationId: 'app_brookfield', operations: ['story_prompt_mapping', 'review_student_text'] });
    expect(r.payload.mapping).toEqual([{ artifactId: 'problem', fieldId: 'brookfield_problem', storyIds: ['club_story'] }]);
    const stored = h.reviews()[0]!;
    // The student marks the story "do not use".
    const s = h.bank.getStory(TENANT, h.studentId, 'club_story')!;
    h.bank.putStory({ ...s, privacy: 'do_not_use', status: 'excluded' }, 'use set to do_not_use');
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, stored.id)!.status).toBe('stale');
    const after = await h.review({ applicationId: 'app_brookfield', operations: ['story_prompt_mapping', 'review_student_text'] });
    expect(after.payload.mapping).toEqual([{ artifactId: 'problem', fieldId: 'brookfield_problem', storyIds: [] }]);
    expect(after.payload.notices.find((n) => n.code === 'story_not_available')!.message).toContain('you have not allowed for writing work');
  });

  it('18T10 requires anchored evidence before presenting a similarity finding', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: `${RESPONSES.resourcePage} Next time I would do it differently.` });
    await h.draft({ ...base, artifactId: 'interest', title: 'Interest essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_interest', text: RESPONSES.interest });
    const r = await h.review({ applicationId: 'app_brookfield', similarityCandidates: [{ a: 'problem', b: 'interest', score: 0.91 }] });
    expect(r.payload.findings.filter((f) => f.type === 'shared_background' || f.type === 'largely_repeated')).toEqual([]);
    expect(r.payload.notices.find((n) => n.code === 'unsupported_similarity')!.message).toBe('A similarity signal between problem and interest was not shown, because no matching text supports it.');
  });

  it('18T11 marks prompt-dependent findings stale when a prompt changes', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    const prompts = h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage });
    await h.review({ artifactIds: ['problem'] });
    const stored = h.reviews()[0]!;
    expect(stored.status).toBe('current');
    // The official prompt page changes: a new version of the same claim.
    const c = prompts.problem;
    const { claimId: _i, version: _v, conflictLinks: _c, nextReviewDue: _n, recordedAt: _r, dependents: _d, ...input } = c;
    const text = 'A problem you solved: Describe a problem you worked to solve. What did you learn?';
    h.store.recordSnapshot({ sourceId: 'src_nar_new', url: c.anchor.url, finalUrl: c.anchor.url, ownerEntityId: 'brookfield_c', office: 'admissions', retrievedAt: h.clock.nowIso(), contentHash: 'c'.repeat(64), archived: false, passages: [{ passageId: 'src_nar_new#p1', heading: null, cycle: '2027', text }] });
    h.store.upsert({ ...input, value: { ...(c.value as object), asks: ['Describe a problem you worked to solve.', 'What did you learn?'], text }, anchor: { ...c.anchor, sourceId: 'src_nar_new', passageId: 'src_nar_new#p1', quote: text }, retrievedAt: h.clock.nowIso(), status: 'verified' });
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, stored.id)!.status).toBe('stale');
  });

  it('18T12 checks per-field minimums and a limit shared across fields', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    for (const q of ['uas_q1', 'uas_q2', 'uas_q3']) h.prompt('uas', q, `Question ${q.slice(-1)}`, ['Answer this question in your own words.'], { unit: 'characters', min: 350, countsSpaces: true, groupId: 'uas_statement', groupMax: 4000 });
    const words = (n: number) => 'a'.repeat(n);
    await h.draft({ ...base, artifactId: 'q1', title: 'Answer 1', applicationId: 'app_uas', destinations: [UAS], fieldId: 'uas_q1', text: words(300) });
    await h.draft({ ...base, artifactId: 'q2', title: 'Answer 2', applicationId: 'app_uas', destinations: [UAS], fieldId: 'uas_q2', text: words(2000) });
    await h.draft({ ...base, artifactId: 'q3', title: 'Answer 3', applicationId: 'app_uas', destinations: [UAS], fieldId: 'uas_q3', text: words(1900) });
    const r = await h.review({ applicationId: 'app_uas', operations: ['mechanical_check'] });
    expect(r.payload.groupLimits).toEqual([{ groupId: 'uas_statement', total: 4200, max: 4000, within: false, fields: [{ artifactId: 'q1', count: 300, min: 350, within: false }, { artifactId: 'q2', count: 2000, min: 350, within: true }, { artifactId: 'q3', count: 1900, min: 350, within: true }] }]);
    expect(r.payload.findings.find((f) => f.type === 'group_length')!.message).toBe('Together these answers are 4200 characters; the limit for all of them is 4000.');
    expect(r.payload.findings.find((f) => f.type === 'length')!.message).toBe('“Answer 1” is 300 characters; this field takes at least 350.');
    expect(r.payload.lengths[0]).toMatchObject({ unit: 'characters with spaces' });
  });

  it('18T13 does not call an absent optional response required', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage });
    const r = await h.review({ applicationId: 'app_brookfield', operations: ['mechanical_check'] });
    expect(r.payload.findings.filter((f) => f.type === 'missing_required_response').map((f) => f.message).sort()).toEqual(['“An academic interest” is required and has no draft yet.', '“Working with others” is required and has no draft yet.']);
    expect(r.payload.notices.find((n) => n.code === 'optional_left_out')!.message).toBe('“Anything else” is optional. Leaving it out is a choice, not a gap.');
  });

  it('18T14 preserves the student’s own meaning and lets them dismiss a finding', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage });
    await h.draft({ ...base, artifactId: 'collab', title: 'Collaboration essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_collab', text: RESPONSES.collaboration });
    const r = await h.review({ applicationId: 'app_brookfield' });
    const f = r.payload.findings.find((x) => x.type === 'shared_background')!;
    const d = await h.ok({ action: 'dispose', fingerprint: f.fingerprint, disposition: 'dismiss', studentMeaning: 'Each reader needs the club context; the essays are about different decisions.' });
    expect(d.payload.notices[0]!.message).toBe('Saved. This won’t be raised again unless the text changes.');
    const again = await h.review({ applicationId: 'app_brookfield' });
    expect(again.payload.findings.some((x) => x.fingerprint === f.fingerprint)).toBe(false);
    expect(again.payload.studentMeanings).toEqual([{ fingerprint: f.fingerprint, meaning: 'Each reader needs the club context; the essays are about different decisions.' }]);
  });

  it('18T15 flags an unsupported school claim for research without writing a replacement', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    await h.draft({ ...base, artifactId: 'interest', title: 'Interest essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_interest', text: `${RESPONSES.interest} Brookfield guarantees every student a research position in their first year.` });
    const r = await h.review({ artifactIds: ['interest'] });
    const f = r.payload.findings.find((x) => x.type === 'claim_needs_source')!;
    expect(f.anchors[0]!.text).toBe('Brookfield guarantees every student a research position in their first year.');
    expect(r.handoffs.find((x) => x.toRole === '11')!.requestedOutcome).toBe('Find the official source, if there is one, for each flagged statement.');
    expect(r.payload.replacementProse).toBeNull();
  });

  it('18T16 keeps assistance provenance on a copy with a new filename', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    await h.draft({ ...base, artifactId: 'essay_main', title: 'Main essay', applicationId: null, destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage, assistance: [{ operation: 'review_student_text', detail: null }] });
    const copy = await h.draft({ ...base, artifactId: 'essay_copy_final', title: 'Final essay (new name)', applicationId: null, destinations: [ASHGROVE], fieldId: 'ashgrove_community', text: RESPONSES.resourcePage, derivedFrom: { artifactId: 'essay_main', version: 1 } });
    expect(copy.payload.artifacts[0]).toMatchObject({ status: 'paused_for_policy', assistance: [{ operation: 'review_student_text', inheritedFrom: 'essay_main' }] });
    // Pasting the same text into a new draft without saying so carries the history too.
    const pasted = await h.draft({ ...base, artifactId: 'untitled_3', title: 'Untitled', applicationId: null, destinations: [ASHGROVE], fieldId: 'ashgrove_community', text: RESPONSES.resourcePage });
    expect(pasted.payload.notices.find((n) => n.code === 'copied_passage')!.message).toBe('This draft shares passages with “Main essay”, so the help recorded for that draft travels with it.');
    expect(pasted.payload.artifacts[0]!.assistance).toEqual([{ operation: 'review_student_text', inheritedFrom: 'essay_main' }]);
    expect(pasted.payload.status).toBe('paused');
  });

  it('18T17 closes a review with no material issues instead of generating new ones', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.prompt('riverton_c', 'riverton_essay', 'Your essay', ['Tell us about something you enjoy doing.'], { max: 400 });
    await h.draft({ ...base, artifactId: 'essay', title: 'Essay', applicationId: 'app_riverton', destinations: [RIVERTON], fieldId: 'riverton_essay', text: 'I enjoy doing chemistry experiments at home, like watching crystals grow on a string.' });
    const r = await h.review({ applicationId: 'app_riverton' });
    expect(r.payload.status).toBe('complete');
    expect(r.payload.findings).toEqual([]);
    expect(r.payload.notices.find((n) => n.code === 'review_complete')!.message).toBe('Nothing material is left to review. Any remaining choices about style are yours.');
    const again = await h.review({ applicationId: 'app_riverton' });
    expect(again.payload).toMatchObject({ status: 'complete', findings: [] });
  });

  it('18T18 evaluates a scholarship workflow separately before reusing an admissions essay', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    await h.draft({ ...base, artifactId: 'essay', title: 'Main essay', applicationId: null, destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: RESPONSES.resourcePage, assistance: [{ operation: 'review_student_text', detail: null }] });
    const r = await h.ok({ action: 'add_destination', artifactId: 'essay', destination: HARBOR_FUND });
    expect(r.payload.status).toBe('paused');
    expect(r.payload.operations).toEqual([expect.objectContaining({ operation: 'review_student_text', decision: 'prohibited', scope: 'scholarship:harbor_fund:2027' })]);
    // An essay with no prior help moves to the award workflow without a conflict.
    await h.draft({ ...base, artifactId: 'essay2', title: 'Second essay', applicationId: null, destinations: [BROOKFIELD], fieldId: 'brookfield_interest', text: RESPONSES.interest });
    const r2 = await h.ok({ action: 'add_destination', artifactId: 'essay2', destination: HARBOR_FUND });
    expect(r2.payload.status).toBe('updated');
  });

  it('only the student registers drafts or decides about findings', async () => {
    const h = makeNarrativeHarness();
    const parent = { id: 'acct_parent_nar', kind: 'supporter' as const, tenantId: TENANT };
    h.kernel.records.permissions.grant(h.student, { tenantId: TENANT, studentId: h.studentId, granteeActorId: parent.id, relationship: 'supporter', purposes: ['narrative_review'], categories: ['writing_drafts'], access: ['read', 'write'], policyBasis: 'student_invitation' });
    const r = await h.run({ action: 'register_draft', draft: { ...base, artifactId: 'x', title: 'X', applicationId: null, destinations: [BROOKFIELD], fieldId: 'f', text: 'Parent text.' } }, { actor: parent });
    expect(r.result.status).toBe('blocked');
  });

  it('the worked review example: shared background, a distinct decision, a prototype called a service', async () => {
    const h = makeNarrativeHarness();
    h.policies();
    h.brookfieldPrompts();
    h.seedRecord('project', 'club_page', 'completion', { outputs: [{ description: 'Club resource page', state: 'prototype' }], studentContribution: ['Built the page'], teamContribution: [], otherContributions: [], measures: [], unfinished: [], learned: null });
    const inflated = RESPONSES.resourcePage.replace('built a small page with five checked links', 'launched a school-wide service that is now widely used');
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: `${inflated} Next time I would do it differently and ask members first.`, recordRefs: ['project:club_page'] });
    await h.draft({ ...base, artifactId: 'collab', title: 'Collaboration essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_collab', text: RESPONSES.collaboration });
    await h.draft({ ...base, artifactId: 'interest', title: 'Interest essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_interest', text: RESPONSES.interest });
    const r = await h.review({ applicationId: 'app_brookfield' });
    const types = r.payload.findings.map((f) => f.type);
    expect(types).toContain('shared_background');
    expect(types).not.toContain('largely_repeated');
    expect(r.payload.findings.filter((f) => f.type === 'fact_mismatch')).toHaveLength(1);
    const launch = r.payload.findings.find((f) => f.type === 'fact_mismatch')!;
    expect(launch.message).toBe('The draft says “launched”, and the project record describes a prototype.');
    expect(launch.question).toBe('Which description is accurate?');
    // Nothing in the draft is replaced; the student revises it and the old review becomes stale.
    expect(h.drafts.get(TENANT, h.studentId, 'problem')!.text).toContain('widely used');
    const before = h.reviews().find((x) => x.status === 'current')!;
    await h.draft({ ...base, artifactId: 'problem', title: 'Problem essay', applicationId: 'app_brookfield', destinations: [BROOKFIELD], fieldId: 'brookfield_problem', text: `${RESPONSES.resourcePage} Next time I would do it differently and ask members first.`, recordRefs: ['project:club_page'] });
    expect(h.kernel.records.getArtifact(h.ui, TENANT, h.studentId, before.id)!.status).toBe('stale');
    const after = await h.review({ applicationId: 'app_brookfield' });
    expect(after.payload.findings.some((f) => f.message.includes('project record'))).toBe(false);
  });

  it('the contract rejects outlines, prose, personas, scores, unanchored repetition and unpermitted findings', () => {
    const empty: NarrativePayload = { action: 'review', applicationId: null, status: 'reviewed', operations: [{ operation: 'review_student_text', decision: 'allowed', explanation: 'x', scope: 's', decisionId: 'd' }], blocked: [], allowedSubset: [], artifacts: [], manifest: [], lengths: [], groupLimits: [], findings: [], mapping: null, studentMeanings: [], notices: [], generatedOutline: null, replacementProse: null };
    const finding = (over: Partial<NarrativePayload['findings'][number]>) => ({ fingerprint: 'f', type: 'possible_missing_ask' as const, severity: 'material' as const, message: 'm', question: 'q', anchors: [], context: null, recordRef: null, disposition: null, ...over });
    expect(NARRATIVE_CONTRACT.semantic!(empty, {} as never)).toEqual([]);
    expect(NARRATIVE_CONTRACT.semantic!({ ...empty, notices: [{ code: 'x', message: 'Start with the club, then describe the change, and end with the lesson learned.' }] }, {} as never)).toContain('the output prescribes a structure for the student’s writing');
    expect(NARRATIVE_CONTRACT.semantic!({ ...empty, notices: [{ code: 'x', message: 'Your personal brand should be the builder.' }] }, {} as never)).toContain('no imposed persona or brand');
    expect(NARRATIVE_CONTRACT.semantic!({ ...empty, notices: [{ code: 'x', message: 'Narrative score: 92.' }] }, {} as never)).toContain('no narrative score');
    expect(NARRATIVE_CONTRACT.semantic!({ ...empty, findings: [finding({ type: 'shared_background', anchors: [] })] }, {} as never)).toContain('f: a repetition finding needs anchored text in both responses');
    const noReview = { ...empty, operations: [{ operation: 'review_student_text', decision: 'prohibited' as const, explanation: 'x', scope: 's', decisionId: 'd' }], findings: [finding({})] };
    expect(NARRATIVE_CONTRACT.semantic!(noReview, {} as never)).toContain('a finding from reading the student’s text needs that operation to be allowed');
    expect(NARRATIVE_CONTRACT.payload.safeParse({ ...empty, replacementProse: 'New sentence.' }).success).toBe(false);
  });
});
