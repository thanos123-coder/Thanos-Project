import type { EvidenceRef } from '../../shared/evidence.js';
import type { ClaimInput, Confirmation, ExtractionReview, Holder, Lifecycle, Origin, Validity } from '../../shared/facts.js';
import type { Actor } from '../../shared/permissions.js';

/** Build a claim input with consistent attribution. Agents never write claims without evidence. */
export function buildClaim(input: {
  /** Defaults to 'student' (student-level singleton fields). */
  entity?: string;
  entityId?: string;
  attribute: string;
  value: unknown;
  origin: Origin;
  confirmation?: Confirmation;
  lifecycle?: Lifecycle;
  evidence: EvidenceRef[];
  actor: Actor;
  viaRole: string;
  holder?: Holder;
  validity?: Validity;
  extractionReview?: ExtractionReview;
  supersedes?: string[];
  restrictToCategory?: string;
}): ClaimInput {
  const claim: ClaimInput = {
    field: { entity: input.entity ?? 'student', entityId: input.entityId ?? 'self', attribute: input.attribute },
    value: input.value,
    origin: input.origin,
    confirmation: input.confirmation ?? 'unreviewed',
    lifecycle: input.lifecycle ?? 'current',
    validity: input.validity ?? {},
    dispute: 'none',
    evidence: input.evidence,
    assertedBy: { actorId: input.actor.id, actorKind: input.actor.kind, viaRole: input.viaRole },
    supersedes: input.supersedes ?? [],
  };
  if (input.holder) claim.holder = input.holder;
  if (input.extractionReview) claim.extractionReview = input.extractionReview;
  if (input.restrictToCategory) claim.restrictToCategory = input.restrictToCategory;
  return claim;
}

export function conversationEvidence(conversationId: string, turnId: string, quote: string | undefined, modality: 'text' | 'voice', recognitionUncertain = false): EvidenceRef {
  const e: EvidenceRef = { kind: 'conversation_span', conversationId, turnId, modality, recognitionUncertain };
  if (quote !== undefined) e.quote = quote.length > 280 ? `${quote.slice(0, 277)}...` : quote;
  return e;
}
