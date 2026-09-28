import { describe, expect, it } from 'vitest';
import { AssistancePolicyRegistry, detectOutlineStructure, looksLikeSubmissionProse, type DestinationRef } from '../../src/policy/assistance.js';

/**
 * The deterministic part of the authorship policy interface (Agent 22's
 * interface in volume two). All institutions are fictional.
 */

const strict: DestinationRef = { kind: 'institution', ref: 'fictional_tech_institute', cycle: '2027' };
const lenient: DestinationRef = { kind: 'institution', ref: 'fictional_liberal_arts', cycle: '2027' };
const silent: DestinationRef = { kind: 'scholarship', ref: 'fictional_local_award', cycle: '2027' };

function registry() {
  const r = new AssistancePolicyRegistry();
  const base = { reviewStatus: 'reviewed' as const, reviewedBy: 'policy_reviewer', reviewedAt: '2026-09-20T00:00:00Z' };
  r.add({ id: 'tech_ai', version: '1', destination: strict, decisions: { tailored_brainstorming: 'allowed', outline: 'prohibited', translation: 'prohibited', review_student_text: 'allowed', story_prompt_mapping: 'prohibited' }, source: { sourceId: 'src_tech_ai', url: 'https://admissions.tech.example.edu/ai', quote: 'Brainstorming questions are fine; AI outlines and drafts are not.' }, ...base });
  r.add({ id: 'arts_ai', version: '1', destination: lenient, decisions: { tailored_brainstorming: 'allowed', review_student_text: 'allowed', story_prompt_mapping: 'allowed' }, source: { sourceId: 'src_arts_ai', url: 'https://admissions.arts.example.edu/ai', quote: 'General advice and early topic suggestions are acceptable.' }, ...base });
  return r;
}

describe('operation-specific assistance decisions', () => {
  it('the strictest destination decides for a shared artifact', () => {
    const r = registry();
    expect(r.evaluate('story_prompt_mapping', [lenient]).decision).toBe('allowed');
    const shared = r.evaluate('story_prompt_mapping', [lenient, strict]);
    expect(shared.decision).toBe('prohibited');
    expect(shared.perDestination.find((p) => p.destination.ref === strict.ref)!.quote).toMatch(/outlines and drafts are not/);
  });

  it('a destination with no reviewed policy, or a policy that is silent on the operation, is unclear, never allowed', () => {
    const r = registry();
    expect(r.evaluate('tailored_brainstorming', [silent]).decision).toBe('unclear');
    expect(r.evaluate('interview_preparation', [lenient]).decision).toBe('unclear');
    // A draft policy never decides.
    r.add({ id: 'local_ai', version: '1', destination: silent, decisions: { tailored_brainstorming: 'allowed' }, source: { sourceId: 'src_local', url: 'https://award.example.org/rules', quote: 'Draft wording.' }, reviewStatus: 'draft', reviewedBy: null, reviewedAt: null });
    expect(r.evaluate('tailored_brainstorming', [silent]).decision).toBe('unclear');
  });

  it('the product boundary applies everywhere: no prose, editing, outlines or submission translation even where a destination allows more', () => {
    const r = new AssistancePolicyRegistry();
    r.add({ id: 'permissive', version: '1', destination: lenient, decisions: { prose_generation: 'allowed', outline: 'allowed', editing: 'allowed' }, source: { sourceId: 's', url: 'https://x.example.edu/ai', quote: 'Any use is fine.' }, reviewStatus: 'reviewed', reviewedBy: 'r', reviewedAt: '2026-09-20T00:00:00Z' });
    for (const op of ['prose_generation', 'outline', 'editing', 'translation', 'research_plan_generation'] as const) expect(r.evaluate(op, [lenient]).decision).toBe('prohibited');
  });

  it('general exploration with no destination follows the product default and clears the material for no destination', () => {
    const d = registry().evaluate('exploration_questions', []);
    expect(d).toMatchObject({ decision: 'allowed', generalOnly: true });
    expect(d.explanation).toMatch(/not yet cleared for any particular application/);
    // Mechanical checks do not shape content and need no destination decision.
    expect(registry().evaluate('mechanical_check', [silent]).decision).toBe('allowed');
  });

  it('a revised policy notifies listeners with the version it replaces', () => {
    const r = registry();
    const changes: string[] = [];
    r.onChange((c) => changes.push(`${c.previousRef}->${c.policyRef}`));
    r.add({ id: 'tech_ai', version: '2', destination: strict, decisions: { tailored_brainstorming: 'prohibited' }, source: { sourceId: 'src_tech_ai_v2', url: 'https://admissions.tech.example.edu/ai', quote: 'No AI assistance of any kind.' }, reviewStatus: 'reviewed', reviewedBy: 'r', reviewedAt: '2026-09-25T00:00:00Z' });
    expect(changes).toEqual(['policy:tech_ai@1->policy:tech_ai@2']);
    expect(r.evaluate('tailored_brainstorming', [strict]).decision).toBe('prohibited');
  });
});

describe('output checks look at function, not labels', () => {
  it('a coverage table with opening, turning point and lesson columns is an outline (XT13)', () => {
    expect(detectOutlineStructure({ headers: ['Prompt', 'Opening scene', 'Turning point', 'Final lesson'], rows: [['Challenge', 'club page', 'friend', 'clarity']] }).outline).toBe(true);
  });

  it('questions that dictate every paragraph are an outline; ordinary exploration questions are not', () => {
    expect(detectOutlineStructure('Start with the moment you saw the old forms. Then describe what you changed. End with what it taught you.').outline).toBe(true);
    expect(detectOutlineStructure('What was confusing before you made it? What did you decide to do next?').outline).toBe(false);
    expect(detectOutlineStructure({ headers: ['Prompt', 'Your chosen material', 'Unanswered ask'], rows: [['Collaboration', 'club page disagreement', 'why it mattered to you']] }).outline).toBe(false);
  });

  it('recognizes offered or narrative submission prose', () => {
    expect(looksLikeSubmissionProse("Here's an opening: The links were a maze.")).toBe(true);
    expect(looksLikeSubmissionProse('I opened the page. I saw the mess. I fixed it one link at a time.')).toBe(true);
    expect(looksLikeSubmissionProse('Student reorganized the existing links after watching a friend search for one.')).toBe(false);
  });
});
