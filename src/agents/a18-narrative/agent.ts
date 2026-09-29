import { z } from 'zod';
import type { ModelGateway } from '../../model/gateway.js';
import { AssistanceOperationSchema, DestinationRefSchema, detectOutlineStructure, looksLikeSubmissionProse, type AssistanceOperation, type DestinationRef, type OperationDecision } from '../../policy/assistance.js';
import type { TaskContext } from '../../runtime/tool-gateway.js';
import type { ContractDefinition } from '../../runtime/validation.js';
import { RoleIdSchema, type Handoff } from '../../shared/envelopes.js';
import { sha256Hex } from '../../shared/hash.js';
import { buildClaim, conversationEvidence } from '../a04-record-steward/claims.js';
import type { DerivedArtifact, MutationResponse } from '../a04-record-steward/types.js';
import { claimRef, type ClaimRecord, type WritingPromptValue } from '../a11-research/claims.js';
import type { CatalogEntry, ReadClaimsResult } from '../a11-research/tools.js';
import type { StoryEntry } from '../a17-stories/bank.js';
import { storyRef } from '../a17-stories/bank.js';
import { failedResult, makeResult, mutationIdFor, readView, type SpecialistAgent } from '../common/specialist.js';
import { DISPOSITIONS, DraftInputSchema, draftRef, type DraftArtifact, type StoredDisposition } from './drafts.js';
import { askAddressed, countText, distinctShare, LAUNCH_WORDS, measure, otherInstitutionsNamed, schoolClaims, sharedSpans } from './text.js';

/**
 * Agent 18 — Narrative portfolio coordinator.
 *
 * Looks across a student's responses, within what the destination allows:
 * a factual prompt inventory, lengths and required fields in code, anchored
 * repetition, prompt asks that may be unanswered, and facts that disagree
 * with the record. Every operation is checked for the exact artifacts and
 * destinations first; an outline is never produced, and nothing is written
 * for the student. It does not impose a theme or a brand, respects a
 * student's dismissal, and closes when nothing material is left.
 */

export const NarrativeScopeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register_draft'), draft: DraftInputSchema, requester: RoleIdSchema.default('01') }).strict(),
  z
    .object({
      action: z.literal('review'),
      applicationId: z.string().regex(/^[a-z0-9_]+$/).nullable().default(null),
      artifactIds: z.array(z.string().min(1)).max(10).default([]),
      operations: z.array(AssistanceOperationSchema).min(1).max(4).default(['mechanical_check', 'review_student_text']),
      /** Candidate pairs from a similarity model; shown only with matching text as evidence (18T10). */
      similarityCandidates: z.array(z.object({ a: z.string(), b: z.string(), score: z.number().min(0).max(1) }).strict()).max(20).default([]),
      requester: RoleIdSchema.default('01'),
    })
    .strict(),
  z.object({ action: z.literal('dispose'), fingerprint: z.string().min(1), disposition: z.enum(DISPOSITIONS), studentMeaning: z.string().max(600).nullable().default(null), requester: RoleIdSchema.default('01') }).strict(),
  z.object({ action: z.literal('resolve_fact'), artifactId: z.string().min(1), factIndex: z.number().int().min(0), correct: z.enum(['record', 'draft']), requester: RoleIdSchema.default('01') }).strict(),
  z.object({ action: z.literal('add_destination'), artifactId: z.string().min(1), destination: DestinationRefSchema, requester: RoleIdSchema.default('01') }).strict(),
]);
export type NarrativeScope = z.infer<typeof NarrativeScopeSchema>;
type Scope<A extends NarrativeScope['action']> = Extract<NarrativeScope, { action: A }>;

// ---------------------------------------------------------------- payload

const AnchorSchema = z.object({ artifactId: z.string(), version: z.number(), start: z.number(), end: z.number(), text: z.string() }).strict();
const FINDING_TYPES = ['missing_required_response', 'length', 'group_length', 'possible_missing_ask', 'shared_background', 'largely_repeated', 'fact_mismatch', 'claim_needs_source', 'other_institution_named'] as const;
const FindingSchema = z
  .object({
    fingerprint: z.string(),
    type: z.enum(FINDING_TYPES),
    severity: z.enum(['material', 'minor']),
    message: z.string(),
    question: z.string(),
    anchors: z.array(AnchorSchema),
    context: z.string().nullable(),
    recordRef: z.string().nullable(),
    disposition: z.enum(DISPOSITIONS).nullable(),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

export const NarrativePayloadSchema = z
  .object({
    action: z.string(),
    applicationId: z.string().nullable(),
    status: z.enum(['reviewed', 'complete', 'blocked', 'registered', 'paused', 'updated']),
    operations: z.array(z.object({ operation: z.string(), decision: z.enum(['allowed', 'prohibited', 'unclear']), explanation: z.string(), scope: z.string(), decisionId: z.string() }).strict()),
    blocked: z.array(z.object({ operation: z.string(), explanation: z.string() }).strict()),
    allowedSubset: z.array(z.string()),
    artifacts: z.array(z.object({ artifactId: z.string(), version: z.number(), fieldId: z.string(), destinations: z.array(z.string()), status: z.string(), declaredProvenance: z.string(), assistance: z.array(z.object({ operation: z.string(), inheritedFrom: z.string().nullable() }).strict()) }).strict()),
    manifest: z.array(z.object({ promptId: z.string(), field: z.string(), destination: z.string(), required: z.boolean(), asks: z.array(z.string()), limit: z.string().nullable(), sourceRef: z.string() }).strict()),
    lengths: z.array(z.object({ artifactId: z.string(), fieldId: z.string(), count: z.number(), unit: z.string(), min: z.number().nullable(), max: z.number().nullable(), within: z.boolean() }).strict()),
    groupLimits: z.array(z.object({ groupId: z.string(), total: z.number(), max: z.number(), within: z.boolean(), fields: z.array(z.object({ artifactId: z.string(), count: z.number(), min: z.number().nullable(), within: z.boolean() }).strict()) }).strict()),
    findings: z.array(FindingSchema),
    mapping: z.array(z.object({ artifactId: z.string(), fieldId: z.string(), storyIds: z.array(z.string()) }).strict()).nullable(),
    studentMeanings: z.array(z.object({ fingerprint: z.string(), meaning: z.string() }).strict()),
    notices: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    generatedOutline: z.null(),
    replacementProse: z.null(),
  })
  .strict();
export type NarrativePayload = z.infer<typeof NarrativePayloadSchema>;

const PERSONA = /\b(personal brand|your brand|brand yourself|unifying theme|single theme|core identity|marketable|your narrative arc|spike)\b/i;
const SCORE = /\b(narrative|story|essay|portfolio) score\b|\b\d{1,3}\s?% (strong|compelling|complete narrative)/i;
const MECHANICAL: ReadonlySet<Finding['type']> = new Set(['missing_required_response', 'length', 'group_length']);

export const NARRATIVE_CONTRACT: ContractDefinition<NarrativePayload> = {
  id: 'narrative_review_v1',
  role: '18',
  payload: NarrativePayloadSchema,
  semantic: (p) => {
    const issues: string[] = [];
    const own = [...p.findings.flatMap((f) => [f.message, f.question, f.context ?? '']), ...p.notices.map((n) => n.message), ...p.allowedSubset].join('\n');
    if (detectOutlineStructure(own).outline) issues.push('the output prescribes a structure for the student’s writing');
    for (const t of [...p.findings.map((f) => f.message), ...p.notices.map((n) => n.message)]) if (looksLikeSubmissionProse(t)) issues.push('the output contains prose for the student');
    if (PERSONA.test(own)) issues.push('no imposed persona or brand');
    if (SCORE.test(own)) issues.push('no narrative score');
    for (const f of p.findings) {
      if ((f.type === 'shared_background' || f.type === 'largely_repeated') && (f.anchors.length < 2 || new Set(f.anchors.map((a) => a.artifactId)).size < 2 || f.anchors.some((a) => a.text.trim() === ''))) issues.push(`${f.fingerprint}: a repetition finding needs anchored text in both responses`);
    }
    // Findings only come from operations that were allowed.
    const reviewAllowed = p.operations.some((o) => o.operation === 'review_student_text' && o.decision === 'allowed');
    if (!reviewAllowed && p.findings.some((f) => !MECHANICAL.has(f.type))) issues.push('a finding from reading the student’s text needs that operation to be allowed');
    return issues;
  },
};

// ---------------------------------------------------------------- helpers

const destKey = (d: DestinationRef) => `${d.kind}:${d.ref}:${d.cycle}`;
const setKey = (ds: readonly DestinationRef[]) => ds.map(destKey).sort().join('|');
const fp = (parts: unknown) => `f_${sha256Hex(JSON.stringify(parts)).slice(0, 12)}`;

function valueAt(v: unknown, path: readonly string[]): unknown {
  let cur: unknown = v;
  for (const k of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
  return cur;
}

function setAt(v: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const copy = structuredClone((v ?? {}) as Record<string, unknown>);
  let cur: Record<string, unknown> = copy;
  for (const k of path.slice(0, -1)) {
    cur[k] = structuredClone((cur[k] ?? {}) as Record<string, unknown>);
    cur = cur[k] as Record<string, unknown>;
  }
  cur[path.at(-1)!] = value;
  return copy;
}

function parseFieldKey(key: string): { entity: string; entityId: string; attribute: string } | null {
  const m = /^([a-z_]+):([^.]+)\.(.+)$/.exec(key);
  return m ? { entity: m[1]!, entityId: m[2]!, attribute: m[3]! } : null;
}

export class NarrativeCoordinatorAgent implements SpecialistAgent {
  readonly role = '18' as const;
  readonly contracts = [NARRATIVE_CONTRACT];

  /** Checks are code; a model could only help with bounded interpretive review after the policy gate. */
  constructor(private readonly model: ModelGateway) {}

  get modelConfigured(): boolean {
    return this.model.configured;
  }

  async handle(ctx: TaskContext) {
    const parsed = NarrativeScopeSchema.safeParse(ctx.request.scope);
    if (!parsed.success) return failedResult(ctx, 'failed', 'The review request was incomplete.', 'invalid_scope');
    const s = parsed.data;
    switch (s.action) {
      case 'register_draft':
        return this.register(ctx, s);
      case 'review':
        return this.review(ctx, s);
      case 'dispose':
        return this.dispose(ctx, s);
      case 'resolve_fact':
        return this.resolveFact(ctx, s);
      case 'add_destination':
        return this.addDestination(ctx, s);
    }
  }

  private empty(action: string, applicationId: string | null = null): NarrativePayload {
    return { action, applicationId, status: 'updated', operations: [], blocked: [], allowedSubset: [], artifacts: [], manifest: [], lengths: [], groupLimits: [], findings: [], mapping: null, studentMeanings: [], notices: [], generatedOutline: null, replacementProse: null };
  }

  private artifactOut(a: DraftArtifact): NarrativePayload['artifacts'][number] {
    return { artifactId: a.artifactId, version: a.version, fieldId: a.fieldId, destinations: a.destinations.map(destKey), status: a.status, declaredProvenance: a.declaredProvenance, assistance: a.assistance.map((x) => ({ operation: x.operation, inheritedFrom: x.inheritedFrom })) };
  }

  /** Is help already given to this material allowed for these destinations? */
  private async historyCleared(ctx: TaskContext, a: Pick<DraftArtifact, 'assistance'>, destinations: readonly DestinationRef[], p: NarrativePayload): Promise<{ cleared: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    for (const op of [...new Set(a.assistance.map((x) => x.operation))]) {
      const d = await ctx.call<OperationDecision>('policy.check_operation', { operation: op, destinations });
      p.operations.push({ operation: op, decision: d.decision, explanation: d.explanation, scope: setKey(destinations), decisionId: d.id });
      if (d.decision !== 'allowed') reasons.push(`${op.replace(/_/g, ' ')} is ${d.decision} (${d.explanation})`);
    }
    return { cleared: reasons.length === 0, reasons };
  }

  // ------------------------------------------------------------ register (18T16)

  private async register(ctx: TaskContext, s: Scope<'register_draft'>) {
    const p = this.empty('register_draft', s.draft.applicationId);
    const existing = await ctx.call<DraftArtifact[]>('drafts.registry', { op: 'list' });
    const draft = { ...s.draft };
    // A passage copied from another draft carries that draft's assistance history, whatever the new file is called.
    if (!draft.derivedFrom && !existing.some((x) => x.artifactId === draft.artifactId)) {
      const source = existing.find((x) => x.assistance.length > 0 && sharedSpans(x.text, draft.text, 20).length > 0);
      if (source) {
        draft.derivedFrom = { artifactId: source.artifactId, version: source.version };
        p.notices.push({ code: 'copied_passage', message: `This draft shares passages with “${source.title}”, so the help recorded for that draft travels with it.` });
      }
    }
    const inherited = draft.derivedFrom ? existing.find((x) => x.artifactId === draft.derivedFrom!.artifactId) : undefined;
    const history = [...(inherited?.assistance ?? []), ...draft.assistance.map((x) => ({ operation: x.operation }))];
    const check = history.length > 0 ? await this.historyCleared(ctx, { assistance: history.map((x) => ({ operation: x.operation, detail: null, destinations: [], inheritedFrom: null })) }, draft.destinations, p) : { cleared: true, reasons: [] };
    const a = await ctx.call<DraftArtifact>('drafts.registry', { op: 'put', draft, ...(check.cleared ? {} : { status: 'paused_for_policy', pauseReason: check.reasons.join('; ') }) });
    p.artifacts = [this.artifactOut(a)];
    p.status = a.status === 'paused_for_policy' ? 'paused' : 'registered';
    if (!check.cleared) p.notices.push({ code: 'reuse_paused', message: `The help this material already had is not cleared for ${draft.destinations.map((d) => d.ref).join(', ')}: ${check.reasons.join('; ')}. Further help with it waits for a policy review; its history stays visible.` });
    if (a.declaredProvenance !== 'student_written') p.notices.push({ code: 'provenance_recorded', message: 'Your description of how this draft was written is recorded as you gave it. The app does not certify authorship and does not use detectors.' });
    return makeResult(ctx, { status: 'completed', summary: `Draft “${a.title}” saved as version ${a.version}${a.status === 'paused_for_policy' ? '; further help waits for a policy review' : ''}.`, payload: p, sourceRefs: [draftRef(a.artifactId, a.version)], completionReason: 'draft_registered' });
  }

  // ------------------------------------------------------------ review (steps 1-6)

  private async review(ctx: TaskContext, s: Scope<'review'>) {
    const p = this.empty('review', s.applicationId);
    const listed = s.artifactIds.length > 0 ? (await Promise.all(s.artifactIds.map((id) => ctx.call<DraftArtifact | null>('drafts.registry', { op: 'get', artifactId: id })))).filter((x): x is DraftArtifact => x !== null) : await ctx.call<DraftArtifact[]>('drafts.registry', { op: 'list', applicationId: s.applicationId });
    if (listed.length === 0) return failedResult(ctx, 'failed', 'There are no drafts to review yet.', 'no_drafts');
    const paused = listed.filter((a) => a.status === 'paused_for_policy');
    for (const a of paused) p.notices.push({ code: 'paused_for_policy', message: `“${a.title}” waits for a policy review before more help: ${a.pauseReason ?? 'its destinations changed'}.` });
    const drafts = listed.filter((a) => a.status === 'active');
    p.artifacts = listed.map((a) => this.artifactOut(a));
    const sources = new Set<string>(listed.map((a) => draftRef(a.artifactId, a.version)));
    const ruleVersions = new Set<string>();

    // Step 2: the exact operation for the exact destinations; a shared artifact needs every destination to allow it.
    const groups = new Map<string, { destinations: DestinationRef[]; drafts: DraftArtifact[] }>();
    for (const a of drafts) {
      const k = setKey(a.destinations);
      groups.set(k, { destinations: a.destinations, drafts: [...(groups.get(k)?.drafts ?? []), a] });
    }
    const allowedFor = new Map<string, Set<AssistanceOperation>>();
    for (const op of s.operations) {
      for (const [k, g] of groups) {
        const d = await ctx.call<OperationDecision>('policy.check_operation', { operation: op, destinations: g.destinations });
        p.operations.push({ operation: op, decision: d.decision, explanation: d.explanation, scope: k, decisionId: d.id });
        for (const x of d.perDestination) {
          if (x.sourceId) sources.add(x.sourceId);
          if (x.policyRef) ruleVersions.add(x.policyRef);
        }
        if (d.decision === 'allowed') for (const a of g.drafts) allowedFor.set(a.artifactId, new Set([...(allowedFor.get(a.artifactId) ?? []), op]));
        else if (!p.blocked.some((b) => b.operation === op)) p.blocked.push({ operation: op, explanation: d.explanation });
      }
    }
    const may = (a: DraftArtifact, op: AssistanceOperation) => allowedFor.get(a.artifactId)?.has(op) ?? false;
    if (p.blocked.length > 0) {
      p.allowedSubset = ['A factual list of each prompt’s explicit asks and limits', 'Your own story choices for each prompt, exactly as you set them', 'Length and required-field checks'];
      p.notices.push({ code: 'operation_withheld', message: `${p.blocked.map((b) => b.operation.replace(/_/g, ' ')).join(', ')} ${p.blocked.length === 1 ? 'is' : 'are'} not available for these responses. What remains available is listed; your request for help does not change the destination’s rules.` });
    }

    // Step 3: the minimum material: current prompts, permitted stories, record facts the drafts cite.
    const promptByDest = new Map<string, ClaimRecord[]>();
    for (const dk of new Set(drafts.flatMap((a) => a.destinations.filter((d) => d.kind === 'institution' || d.kind === 'platform').map(destKey)))) {
      const [, ref, cycle] = dk.split(':');
      const read = await ctx.tryCall<ReadClaimsResult>('institutions.read', { op: 'claims', entityId: ref, predicates: ['writing_prompt'], cycle, includeHistorical: false });
      const claims = read.ok ? read.value.claims.filter((c) => c.status === 'verified' || c.status === 'provisional') : [];
      promptByDest.set(dk, claims);
      for (const c of claims) {
        sources.add(claimRef(c.claimId));
        const v = c.value as WritingPromptValue;
        p.manifest.push({ promptId: v.promptId, field: v.field, destination: dk, required: v.required && v.conditionalOn === null, asks: v.asks, limit: v.limit ? `${v.limit.min ?? 0}–${v.limit.max ?? '∞'} ${v.limit.unit}${v.limit.countsSpaces === true ? ' including spaces' : v.limit.countsSpaces === false ? ' excluding spaces' : ''}${v.limit.groupId ? `; ${v.limit.groupMax} in total across ${v.limit.groupId}` : ''}` : null, sourceRef: claimRef(c.claimId) });
      }
    }
    p.manifest.sort((x, y) => x.destination.localeCompare(y.destination) || x.promptId.localeCompare(y.promptId));
    const promptFor = (a: DraftArtifact): { claim: ClaimRecord; v: WritingPromptValue } | null => {
      for (const d of a.destinations) {
        const c = promptByDest.get(destKey(d))?.find((x) => (x.value as WritingPromptValue).promptId === a.fieldId);
        if (c) return { claim: c, v: c.value as WritingPromptValue };
      }
      return null;
    };
    const permitted = new Set((await ctx.call<StoryEntry[]>('story.read_permitted', { destinations: [] })).map((e) => e.storyId));
    const dispositions = await ctx.call<StoredDisposition[]>('drafts.registry', { op: 'dispositions' });
    const disposed = new Map(dispositions.map((d) => [d.fingerprint, d]));
    p.studentMeanings = dispositions.filter((d) => d.studentMeaning).map((d) => ({ fingerprint: d.fingerprint, meaning: d.studentMeaning! }));
    const factKeys = [...new Set(drafts.flatMap((a) => a.factLinks.map((f) => f.fieldKey)))];
    const view = await readView(ctx, 'local', { entityTypes: ['project', 'experience', 'episode', 'award'] });
    const findings: Finding[] = [];
    const add = (f: Omit<Finding, 'fingerprint' | 'disposition'>, key: unknown) => {
      const fingerprint = fp(key);
      const d = disposed.get(fingerprint);
      // A finding the student dismissed or chose to keep is not raised again (18T14, 18T17).
      if (d && (d.disposition === 'dismiss' || d.disposition === 'keep')) return;
      findings.push({ ...f, fingerprint, disposition: d?.disposition ?? null });
    };

    // Stories the student no longer permits are not used, and whatever relied on them is not shown (18T09).
    for (const a of drafts) {
      const gone = a.storyIds.filter((id) => !permitted.has(id));
      if (gone.length > 0) p.notices.push({ code: 'story_not_available', message: `“${a.title}” refers to material you have not allowed for writing work, so it is left out of this review.` });
    }
    if (drafts.some((a) => may(a, 'story_prompt_mapping'))) p.mapping = drafts.filter((a) => may(a, 'story_prompt_mapping')).map((a) => ({ artifactId: a.artifactId, fieldId: a.fieldId, storyIds: a.storyIds.filter((id) => permitted.has(id)) }));

    // Step 4: deterministic checks in code.
    if (drafts.some((a) => may(a, 'mechanical_check'))) {
      for (const a of drafts.filter((x) => may(x, 'mechanical_check'))) {
        const pr = promptFor(a);
        if (!pr?.v.limit) continue;
        const lim = pr.v.limit;
        const count = measure(countText(a.text), lim.unit, lim.countsSpaces);
        const within = (lim.min === null || count >= lim.min) && (lim.max === null || count <= lim.max);
        p.lengths.push({ artifactId: a.artifactId, fieldId: a.fieldId, count, unit: lim.unit === 'words' ? 'words' : lim.countsSpaces === false ? 'characters without spaces' : 'characters with spaces', min: lim.min, max: lim.max, within });
        if (!within) add({ type: 'length', severity: 'material', message: `“${a.title}” is ${count} ${lim.unit}; this field takes ${lim.min !== null && count < lim.min ? `at least ${lim.min}` : `at most ${lim.max}`}.`, question: 'Would you like to adjust the length yourself? Check the count in the portal too, since systems count some characters differently.', anchors: [], context: null, recordRef: claimRef(pr.claim.claimId) }, ['length', a.artifactId, a.textHash]);
      }
      // A limit shared across several fields: each field's minimum and the total (18T12).
      const byGroup = new Map<string, Array<{ a: DraftArtifact; lim: NonNullable<WritingPromptValue['limit']> }>>();
      for (const a of drafts.filter((x) => may(x, 'mechanical_check'))) {
        const lim = promptFor(a)?.v.limit;
        if (lim?.groupId && lim.groupMax) byGroup.set(`${a.applicationId ?? a.artifactId}:${lim.groupId}`, [...(byGroup.get(`${a.applicationId ?? a.artifactId}:${lim.groupId}`) ?? []), { a, lim }]);
      }
      for (const [k, members] of byGroup) {
        const fields = members.map(({ a, lim }) => {
          const count = measure(countText(a.text), lim.unit, lim.countsSpaces);
          return { artifactId: a.artifactId, count, min: lim.min, within: lim.min === null || count >= lim.min };
        });
        const total = fields.reduce((x, f) => x + f.count, 0);
        const max = members[0]!.lim.groupMax!;
        p.groupLimits.push({ groupId: members[0]!.lim.groupId!, total, max, within: total <= max && fields.every((f) => f.within), fields });
        if (total > max) add({ type: 'group_length', severity: 'material', message: `Together these answers are ${total} ${members[0]!.lim.unit}; the limit for all of them is ${max}.`, question: 'Which answer would you like to shorten, if any?', anchors: [], context: 'The limit applies to the answers combined, not to each one.', recordRef: null }, ['group', k, total]);
      }
      // Required responses in the current manifest; optional ones stay optional (18T13).
      const app = new Set(drafts.map((a) => a.fieldId));
      for (const m of p.manifest.filter((x) => x.required && !app.has(x.promptId))) {
        if (!drafts.some((a) => a.destinations.some((d) => destKey(d) === m.destination))) continue;
        add({ type: 'missing_required_response', severity: 'material', message: `“${m.field}” is required and has no draft yet.`, question: 'Would you like to add a task for it?', anchors: [], context: null, recordRef: m.sourceRef }, ['missing', m.destination, m.promptId]);
      }
      const optionalAbsent = p.manifest.filter((x) => !x.required && !app.has(x.promptId));
      if (optionalAbsent.length > 0) p.notices.push({ code: 'optional_left_out', message: `${optionalAbsent.map((m) => `“${m.field}”`).join(', ')} ${optionalAbsent.length === 1 ? 'is' : 'are'} optional. Leaving ${optionalAbsent.length === 1 ? 'it' : 'them'} out is a choice, not a gap.` });
    }

    // Step 5: relationships, only where reading the student's text is allowed.
    const reading = drafts.filter((a) => may(a, 'review_student_text'));
    if (reading.length > 0) {
      // Prompt asks that may be unanswered: asked about, never answered for the student (18T04).
      for (const a of reading) {
        const pr = promptFor(a);
        if (!pr) continue;
        sources.add(claimRef(pr.claim.claimId));
        for (const ask of pr.v.asks) {
          const r = askAddressed(ask, a.text);
          if (!r.addressed) add({ type: 'possible_missing_ask', severity: 'material', message: `The prompt asks: “${ask}” It is not clear where “${a.title}” takes this up.`, question: 'Where does your response address this part, or do you want to add it in your own words?', anchors: [], context: null, recordRef: claimRef(pr.claim.claimId) }, ['ask', a.artifactId, a.textHash, ask]);
        }
      }
      // Repetition within one application only; reuse across separate applications is not penalized (18T02, 18T03, 18T07).
      const byApp = new Map<string, DraftArtifact[]>();
      for (const a of reading) if (a.applicationId) byApp.set(a.applicationId, [...(byApp.get(a.applicationId) ?? []), a]);
      const shownPairs = new Set<string>();
      for (const [, list] of byApp) {
        for (let i = 0; i < list.length; i += 1) {
          for (let j = i + 1; j < list.length; j += 1) {
            const x = list[i]!;
            const y = list[j]!;
            const spans = sharedSpans(x.text, y.text);
            if (spans.length === 0) continue;
            shownPairs.add([x.artifactId, y.artifactId].sort().join('|'));
            const dx = distinctShare(x.text, spans.map((sp) => sp.a));
            const dy = distinctShare(y.text, spans.map((sp) => sp.b));
            const short = [x, y].some((a) => countText(a.text).words <= 150);
            const anchors = spans.flatMap((sp) => [{ artifactId: x.artifactId, version: x.version, ...sp.a }, { artifactId: y.artifactId, version: y.version, ...sp.b }]);
            const distinct = dx >= 0.5 && dy >= 0.5;
            add(
              {
                type: distinct ? 'shared_background' : 'largely_repeated',
                severity: distinct && short ? 'minor' : 'material',
                message: distinct ? `“${x.title}” and “${y.title}” share the same background passage, and each goes on to something of its own.` : `“${x.title}” and “${y.title}” repeat much of the same text.`,
                question: distinct ? 'Do both answers need this much of the same context?' : 'Is each answer doing a different job, or would you like to use one of them for something else?',
                anchors,
                context: short ? 'A short answer may need this context to make sense on its own; keeping it is fine.' : 'Some repetition is required or useful; you decide.',
                recordRef: null,
              },
              ['repeat', x.artifactId, y.artifactId, spans.map((sp) => sp.a.text)],
            );
          }
        }
      }
      // A similarity score is only a candidate: without matching text it is not shown (18T10).
      for (const c of s.similarityCandidates) {
        const k = [c.a, c.b].sort().join('|');
        if (shownPairs.has(k)) continue;
        const x = reading.find((a) => a.artifactId === c.a);
        const y = reading.find((a) => a.artifactId === c.b);
        if (!x || !y || sharedSpans(x.text, y.text).length === 0) p.notices.push({ code: 'unsupported_similarity', message: `A similarity signal between ${c.a} and ${c.b} was not shown, because no matching text supports it.` });
      }
      // A different institution's name in a response is a likely copy mismatch.
      const catalog = await ctx.call<CatalogEntry[]>('institutions.read', { op: 'catalog' });
      const names = catalog.map((e) => ({ id: e.entity.id, name: e.entity.name }));
      for (const a of reading) {
        for (const o of otherInstitutionsNamed(a.text, names, a.destinations.map((d) => d.ref))) add({ type: 'other_institution_named', severity: 'material', message: `“${a.title}” is for ${a.destinations.map((d) => d.ref).join(', ')} but names ${o.name}.`, question: 'Is that intended?', anchors: [{ artifactId: a.artifactId, version: a.version, start: o.start, end: o.start + o.name.length, text: o.name }], context: 'Using your own material for several applications is fine; this only checks the names.', recordRef: null }, ['name', a.artifactId, a.textHash, o.id]);
        // A claim about a school needs a source, not a rewrite (18T15).
        for (const c of schoolClaims(a.text)) add({ type: 'claim_needs_source', severity: 'material', message: `This states a fact about the school or program: “${c.text}”`, question: 'Do you have an official source for it? It has been sent for research; the wording is yours to decide.', anchors: [{ artifactId: a.artifactId, version: a.version, ...c }], context: null, recordRef: null }, ['claim', a.artifactId, c.text]);
        // Facts that disagree with the record: a question with the record reference, never a silent rewrite (18T06).
        for (const [i, f] of a.factLinks.entries()) {
          const fk = parseFieldKey(f.fieldKey);
          const field = view.fieldByKey(f.fieldKey);
          const recorded = fk ? valueAt(view.value(fk.entity, fk.entityId, fk.attribute), f.path) : undefined;
          if (recorded === undefined || JSON.stringify(recorded) === JSON.stringify(f.asserted)) continue;
          const at = a.text.indexOf(f.quote);
          add({ type: 'fact_mismatch', severity: 'material', message: `Your draft says “${f.quote}”, and your record has ${JSON.stringify(recorded)}.`, question: 'Which is correct? If the record is out of date, it can be corrected; if the draft is, you can revise it yourself.', anchors: at >= 0 ? [{ artifactId: a.artifactId, version: a.version, start: at, end: at + f.quote.length, text: f.quote }] : [], context: `fact ${i}`, recordRef: field?.current ? field.current.claimId : null }, ['fact', a.artifactId, i, f.quote, recorded]);
        }
        // A result described as launched when the project record says otherwise.
        const launch = LAUNCH_WORDS.exec(a.text);
        if (launch) {
          for (const pid of view.entityIds('project')) {
            const comp = view.value<{ outputs: Array<{ state: string }> }>('project', pid, 'completion');
            if (comp && comp.outputs.length > 0 && comp.outputs.every((o) => ['idea', 'prototype', 'private_demo', 'draft', 'literature_review'].includes(o.state)) && (a.recordRefs.includes(`project:${pid}`) || a.factLinks.some((f) => f.fieldKey.startsWith(`project:${pid}.`)))) {
              add({ type: 'fact_mismatch', severity: 'material', message: `The draft says “${launch[0]}”, and the project record describes a ${comp.outputs.map((o) => o.state.replace(/_/g, ' ')).join(', ')}.`, question: 'Which description is accurate?', anchors: [{ artifactId: a.artifactId, version: a.version, start: launch.index, end: launch.index + launch[0].length, text: launch[0] }], context: null, recordRef: view.current('project', pid, 'completion')?.claimId ?? null }, ['launch', a.artifactId, a.textHash, pid]);
            }
          }
        }
      }
    }

    // A few material issues, not a long list of speculative improvements.
    const order: Finding['type'][] = ['missing_required_response', 'fact_mismatch', 'possible_missing_ask', 'group_length', 'length', 'largely_repeated', 'claim_needs_source', 'other_institution_named', 'shared_background'];
    p.findings = findings.sort((x, y) => (x.severity === y.severity ? order.indexOf(x.type) - order.indexOf(y.type) : x.severity === 'material' ? -1 : 1)).slice(0, 8);
    const open = p.findings.filter((f) => f.severity === 'material' && f.disposition !== 'defer');
    p.status = p.blocked.length > 0 && p.findings.length === 0 && p.lengths.length === 0 ? 'blocked' : open.length === 0 ? 'complete' : 'reviewed';
    if (p.status === 'complete') p.notices.push({ code: 'review_complete', message: 'Nothing material is left to review. Any remaining choices about style are yours.' });
    const handoffs: Handoff[] = [];
    const claims = p.findings.filter((f) => f.type === 'claim_needs_source');
    if (claims.length > 0) handoffs.push({ toRole: '11', reason: 'A response states a fact about a school or program without a source.', requestedOutcome: 'Find the official source, if there is one, for each flagged statement.', inputRefs: claims.flatMap((f) => f.anchors.map((x) => draftRef(x.artifactId, x.version))), unresolved: claims.map((f) => f.fingerprint), completionCondition: 'Each statement is supported by an official source or recorded as unsupported.' });

    // Findings depend on the drafts, prompts, stories and policies they used (step 7).
    await ctx.call<DerivedArtifact>('artifacts.put_derived', {
      tenantId: ctx.request.tenantId,
      studentId: ctx.request.studentId,
      kind: 'narrative_review',
      scopeKey: `review_${s.applicationId ?? listed.map((a) => a.artifactId).sort().join('_')}`.slice(0, 160),
      payload: { findings: p.findings.map((f) => ({ fingerprint: f.fingerprint, type: f.type })), status: p.status },
      inputClaimIds: [],
      inputFieldKeys: [...factKeys, ...drafts.flatMap((a) => a.storyIds.map((id) => `story_use:${id}.permission`))],
      ruleVersions: [...ruleVersions],
      sourceIds: [...sources, ...listed.map((a) => draftRef(a.artifactId)), ...drafts.flatMap((a) => a.storyIds.map(storyRef))],
      recordVersion: view.recordVersion,
    });
    return makeResult(ctx, {
      status: p.status === 'complete' ? 'completed' : p.status === 'blocked' ? 'partial' : 'needs_student_input',
      summary: p.status === 'complete' ? 'Review complete: nothing material is left.' : p.status === 'blocked' ? 'The requested help is not available for these responses; the allowed checks are listed.' : `${open.length} thing${open.length === 1 ? '' : 's'} for you to decide.`,
      payload: p,
      recordVersion: view.recordVersion,
      sourceRefs: [...sources].filter((x) => !x.startsWith('draft:') || /@\d+$/.test(x)),
      handoffs,
      completionReason: `review_${p.status}`,
    });
  }

  // ------------------------------------------------------------ the student's decisions (18T14)

  private async dispose(ctx: TaskContext, s: Scope<'dispose'>) {
    if (ctx.request.actor.kind !== 'student') return failedResult(ctx, 'blocked', 'Only the student decides about findings.', 'student_only');
    const p = this.empty('dispose');
    await ctx.call<StoredDisposition>('drafts.registry', { op: 'dispose', fingerprint: s.fingerprint, disposition: s.disposition, studentMeaning: s.studentMeaning });
    if (s.studentMeaning) p.studentMeanings = [{ fingerprint: s.fingerprint, meaning: s.studentMeaning }];
    p.notices.push({ code: 'decision_saved', message: s.disposition === 'dismiss' || s.disposition === 'keep' ? 'Saved. This won’t be raised again unless the text changes.' : 'Saved.' });
    return makeResult(ctx, { status: 'completed', summary: `Your decision (${s.disposition}) is saved.`, payload: p, completionReason: 'disposition_saved' });
  }

  // ------------------------------------------------------------ a factual discrepancy (18T06)

  private async resolveFact(ctx: TaskContext, s: Scope<'resolve_fact'>) {
    if (ctx.request.actor.kind !== 'student') return failedResult(ctx, 'blocked', 'Only the student can confirm which fact is correct.', 'student_only');
    const a = await ctx.call<DraftArtifact | null>('drafts.registry', { op: 'get', artifactId: s.artifactId });
    const f = a?.factLinks[s.factIndex];
    if (!a || !f) return failedResult(ctx, 'failed', 'That fact was not found.', 'fact_not_found');
    const p = this.empty('resolve_fact', a.applicationId);
    if (s.correct === 'record') {
      p.notices.push({ code: 'revise_yourself', message: 'The record stays as it is. Nothing in your draft was changed; you can revise it in your own words.' });
      return makeResult(ctx, { status: 'completed', summary: 'The record is kept; the draft is yours to revise.', payload: p, completionReason: 'record_kept' });
    }
    const fk = parseFieldKey(f.fieldKey);
    if (!fk) return failedResult(ctx, 'failed', 'That record field could not be read.', 'bad_field_key');
    const view = await readView(ctx, 'local', { entityTypes: [fk.entity] });
    const current = view.value(fk.entity, fk.entityId, fk.attribute);
    if (current === undefined) return failedResult(ctx, 'failed', 'That record field is not available.', 'field_not_visible');
    const claim = buildClaim({ entity: fk.entity, entityId: fk.entityId, attribute: fk.attribute, value: setAt(current, f.path, f.asserted), origin: 'student_statement', confirmation: 'student_confirmed', evidence: [conversationEvidence('conv_drafts', `fact_${a.artifactId}_${s.factIndex}`, f.quote, 'text', false)], actor: ctx.request.actor, viaRole: '18' });
    const res = await ctx.call<MutationResponse>('record.propose_change', { tenantId: ctx.request.tenantId, studentId: ctx.request.studentId, mutation: { mutationId: mutationIdFor(ctx, `fact_${a.artifactId}_${s.factIndex}`), operation: 'add_claims', claims: [claim], expectedRecordVersion: view.recordVersion, reason: `student_correction_from_draft:${a.artifactId}` } });
    if (res.outcome !== 'accepted') return failedResult(ctx, 'failed', `The correction could not be saved: ${res.reasons.slice(0, 2).join('; ')}`, `record_${res.outcome}`);
    p.notices.push({ code: 'record_corrected', message: 'Your record is corrected as a new version; the earlier value is kept in its history, and anything that used it will be checked again.' });
    return makeResult(ctx, { status: 'completed', summary: 'The record is corrected to match what you confirmed.', payload: p, recordVersion: res.recordVersion ?? view.recordVersion, completionReason: 'record_corrected' });
  }

  // ------------------------------------------------------------ a new destination (18T08, 18T18)

  private async addDestination(ctx: TaskContext, s: Scope<'add_destination'>) {
    const a = await ctx.call<DraftArtifact | null>('drafts.registry', { op: 'get', artifactId: s.artifactId });
    if (!a) return failedResult(ctx, 'failed', 'That draft was not found.', 'draft_not_found');
    const p = this.empty('add_destination', a.applicationId);
    const destinations = [...new Map([...a.destinations, s.destination].map((d) => [destKey(d), d])).values()];
    // A scholarship's own rules govern its workflow; they are checked for it rather than assumed from admissions.
    const check = await this.historyCleared(ctx, a, s.destination.kind === 'scholarship' ? [s.destination] : destinations, p);
    const updated = await ctx.call<DraftArtifact>('drafts.registry', { op: 'set_status', artifactId: a.artifactId, status: check.cleared ? 'active' : 'paused_for_policy', reason: check.cleared ? null : check.reasons.join('; '), destinations });
    p.artifacts = [this.artifactOut(updated)];
    p.status = check.cleared ? 'updated' : 'paused';
    p.notices.push(check.cleared ? { code: 'destination_added', message: `${s.destination.ref} added. The help this draft has had is allowed there too.` } : { code: 'reuse_paused', message: `Before more help with this draft: ${check.reasons.join('; ')}. The history of help stays visible; renaming or copying the file would not change this.` });
    return makeResult(ctx, { status: check.cleared ? 'completed' : 'needs_student_input', summary: check.cleared ? 'Destination added.' : 'Destination added; further help waits for a policy review.', payload: p, sourceRefs: [draftRef(updated.artifactId, updated.version)], completionReason: check.cleared ? 'destination_added' : 'policy_review_needed' });
  }
}
