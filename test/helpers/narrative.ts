import { NarrativeCoordinatorAgent, type NarrativePayload } from '../../src/agents/a18-narrative/agent.js';
import { DraftRegistry, registerDraftTools, type DraftInput } from '../../src/agents/a18-narrative/drafts.js';
import { registerStoryTools, StoryBank, type StoryEntry } from '../../src/agents/a17-stories/bank.js';
import { InstitutionClaimStore } from '../../src/agents/a11-research/claims.js';
import { InstitutionRegistry } from '../../src/agents/a11-research/entities.js';
import { registerInstitutionTools } from '../../src/agents/a11-research/tools.js';
import { buildClaim } from '../../src/agents/a04-record-steward/claims.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import type { ResultEnvelope } from '../../src/shared/envelopes.js';
import type { Actor } from '../../src/shared/permissions.js';
import { connectDraftRegistry } from '../../src/system/draft-wiring.js';
import { connectInstitutionClaims } from '../../src/system/institution-wiring.js';
import { connectStoryBank } from '../../src/system/story-wiring.js';
import { makeKernel, said, TENANT } from './kernel.js';

/**
 * Agent 18 harness. Brookfield College, Ashgrove Institute, Riverton College,
 * the Undergraduate Admissions Service platform and the Harbor Community
 * Fund are fictional. Brookfield allows review of the student's own text but
 * never outlines; Ashgrove does not allow AI review of essay content; the
 * Harbor Community Fund's award rules do not allow it either.
 */

export const BROOKFIELD = { kind: 'institution', ref: 'brookfield_c', cycle: '2027' } as const;
export const ASHGROVE = { kind: 'institution', ref: 'ashgrove_i', cycle: '2027' } as const;
export const RIVERTON = { kind: 'institution', ref: 'riverton_c', cycle: '2027' } as const;
export const UAS = { kind: 'platform', ref: 'uas', cycle: '2027' } as const;
export const HARBOR_FUND = { kind: 'scholarship', ref: 'harbor_fund', cycle: '2027' } as const;

export function makeNarrativeHarness(opts: { model?: ModelGateway } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const registry = new InstitutionRegistry();
  registry.add({ id: 'brookfield_c', kind: 'institution', name: 'Brookfield College', parentId: null, country: 'US', officialDomains: ['brookfield.example.edu'] });
  registry.add({ id: 'ashgrove_i', kind: 'institution', name: 'Ashgrove Institute', parentId: null, country: 'US', officialDomains: ['ashgrove.example.edu'] });
  registry.add({ id: 'riverton_c', kind: 'institution', name: 'Riverton College', parentId: null, country: 'US', officialDomains: ['riverton.example.edu'] });
  registry.add({ id: 'uas', kind: 'platform', name: 'Undergraduate Admissions Service', parentId: null, country: 'GB', officialDomains: ['uas.example.org.uk'] });
  const store = new InstitutionClaimStore(() => h.clock.nowIso());
  registerInstitutionTools(h.kernel.gateway, registry, store);
  connectInstitutionClaims(h.kernel, store);
  const bank = new StoryBank(() => h.clock.nowIso());
  registerStoryTools(h.kernel.gateway, bank, h.kernel.records.permissions);
  connectStoryBank(h.kernel, bank);
  const drafts = new DraftRegistry(() => h.clock.nowIso());
  registerDraftTools(h.kernel.gateway, drafts, h.kernel.records.permissions);
  connectDraftRegistry(h.kernel, drafts);
  h.kernel.registerSpecialist(new NarrativeCoordinatorAgent(model));

  let n = 0;
  const prompt = (entityId: string, promptId: string, field: string, asks: string[], opts2: { required?: boolean; unit?: 'words' | 'characters'; min?: number | null; max?: number | null; countsSpaces?: boolean | null; groupId?: string | null; groupMax?: number | null } = {}) => {
    n += 1;
    const inst = registry.institutionOf(entityId)!;
    const url = `https://${inst.officialDomains[0]}/essays/${n}`;
    const sourceId = `src_nar_${n}`;
    const text = `${field}: ${asks.join(' ')}`;
    store.recordSnapshot({ sourceId, url, finalUrl: url, ownerEntityId: entityId, office: inst.kind === 'platform' ? 'application_platform' : 'admissions', retrievedAt: h.clock.nowIso(), contentHash: 'b'.repeat(64), archived: false, passages: [{ passageId: `${sourceId}#p1`, heading: null, cycle: '2027', text }] });
    const value = { promptId, field, text, asks, required: opts2.required ?? true, conditionalOn: null, artifactKind: 'supplement' as const, limit: { unit: opts2.unit ?? 'words', min: opts2.min ?? null, max: opts2.max ?? null, countsSpaces: opts2.countsSpaces ?? null, groupId: opts2.groupId ?? null, groupMax: opts2.groupMax ?? null } };
    const o = store.upsert({ subject: { entityId, institutionId: inst.id, campusId: null, programId: null }, cycle: '2027', applicantCategory: 'all', predicate: 'writing_prompt', qualifier: promptId, value, sourceOwner: { entityId: inst.id, office: inst.kind === 'platform' ? 'application_platform' : 'admissions', name: inst.name }, anchor: { sourceId, url, finalUrl: url, passageId: `${sourceId}#p1`, section: null, page: null, quote: text }, retrievedAt: h.clock.nowIso(), status: 'verified', extraction: 'curated', extractionConfidence: 'high' });
    if (o.status === 'rejected') throw new Error(o.issues.join('; '));
    return o.claim;
  };
  const brookfieldPrompts = () => ({
    problem: prompt('brookfield_c', 'brookfield_problem', 'A problem you solved', ['Describe a problem you worked to solve.', 'What steps did you take?', 'What would you do differently next time?'], { max: 350 }),
    collab: prompt('brookfield_c', 'brookfield_collab', 'Working with others', ['Tell us about a time you worked with others toward a shared goal.', 'What was your role?'], { max: 250 }),
    interest: prompt('brookfield_c', 'brookfield_interest', 'An academic interest', ['What academic subject excites you and why?'], { max: 250 }),
    optional: prompt('brookfield_c', 'brookfield_optional', 'Anything else', ['Is there anything else you would like us to know?'], { required: false, max: 150 }),
  });
  const policies = () => {
    const add = (id: string, destination: typeof BROOKFIELD | typeof ASHGROVE | typeof RIVERTON | typeof UAS | typeof HARBOR_FUND, decisions: Record<string, 'allowed' | 'prohibited' | 'unclear'>, quote: string) =>
      h.kernel.policies.add({ id, version: '2027.1', destination, decisions, source: { sourceId: `src_${id}`, url: `https://policies.example.org/${id}`, quote }, reviewStatus: 'reviewed', reviewedBy: 'policy_reviewer', reviewedAt: '2026-09-01T00:00:00Z' });
    add('brookfield_ai', BROOKFIELD, { review_student_text: 'allowed', story_prompt_mapping: 'allowed', tailored_brainstorming: 'allowed', outline: 'prohibited', prose_generation: 'prohibited', editing: 'prohibited' }, 'Feedback on your own drafts is allowed; outlines and drafted text are not.');
    add('riverton_ai', RIVERTON, { review_student_text: 'allowed', story_prompt_mapping: 'allowed', outline: 'prohibited' }, 'You may get feedback on your own writing.');
    add('ashgrove_ai', ASHGROVE, { review_student_text: 'prohibited', tailored_brainstorming: 'prohibited', story_prompt_mapping: 'prohibited', outline: 'prohibited' }, 'Applicants must not use AI tools to review or develop essay content.');
    add('uas_ai', UAS, { review_student_text: 'allowed', outline: 'prohibited' }, 'Your statement must be your own; feedback is allowed.');
    add('harbor_fund_ai', HARBOR_FUND, { review_student_text: 'prohibited', tailored_brainstorming: 'prohibited' }, 'Award essays must be written and revised without AI assistance.');
  };
  const story = (storyId: string, privacy: StoryEntry['privacy'] = 'possible_writing_material') =>
    bank.putStory({ storyId, tenantId: TENANT, studentId: h.studentId, version: 0, title: storyId, titleApproved: true, purpose: { kind: 'general', destinations: [], promptRef: null }, assistance: [], anchors: [], phrases: [], interpretation: { status: 'not_discussed', studentWords: null, source: { turnId: null, span: null } }, unresolved: [], reviewNotes: [], otherPeople: [], privacy, status: privacy === 'do_not_use' ? 'excluded' : 'active', history: [], createdAt: h.clock.nowIso(), updatedAt: h.clock.nowIso() }, 'test');
  const seedRecord = (entity: string, entityId: string, attribute: string, value: unknown) => h.seed([buildClaim({ entity, entityId, attribute, value, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [said(`${entity} ${attribute}`)], actor: h.student, viaRole: 'ui' })]);

  const run = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const spec: Parameters<typeof h.task>[0] = { role: '18', purpose: 'narrative_review', objective: 'narrative_review', completionContract: 'narrative_review_v1', scope };
    if (extra.actor) spec.actor = extra.actor;
    const out = await h.kernel.invoke(h.task(spec));
    return out as typeof out & { result: ResultEnvelope<NarrativePayload> };
  };
  const ok = async (scope: Record<string, unknown>, extra: { actor?: Actor } = {}) => {
    const out = await run(scope, extra);
    if (!out.accepted) throw new Error(`narrative task rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 900)}`);
    return out.result;
  };
  const draft = (d: DraftInput) => ok({ action: 'register_draft', draft: d });
  const review = (over: Record<string, unknown> = {}) => ok({ action: 'review', ...over });
  const reviews = () => h.kernel.records.listArtifacts(h.ui, TENANT, h.studentId, { kind: 'narrative_review' });
  return { ...h, model, registry, store, bank, drafts, prompt, brookfieldPrompts, policies, story, seedRecord, run, ok, draft, review, reviews };
}

/** Fictional student responses for the worked review example. */
export const CLUB_BACKGROUND = 'Our robotics club had a shared drive full of old forms, and new members kept opening the wrong ones every season.';
export const RESPONSES = {
  resourcePage: `${CLUB_BACKGROUND} The problem was that nobody could find the current sign-up form. I worked to solve it by listing every link and checking which ones still worked. The steps I took were simple: I sorted the links, removed the dead ones, and built a small page with five checked links.`,
  collaboration: `${CLUB_BACKGROUND} When I suggested a single page, another member wanted to keep the folders. We disagreed about whether to delete anything, and we agreed to archive old forms instead of deleting them. My role was to test the page with two new members and report what confused them.`,
  interest: 'Chemistry excites me because a small change in conditions can change what a reaction produces. I keep wondering why the same reaction behaves differently at home and in the lab.',
};
