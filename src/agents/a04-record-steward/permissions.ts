import type { AuditLog } from '../../runtime/audit.js';
import type { Clock } from '../../shared/clock.js';
import { sha256Hex, stableStringify } from '../../shared/hash.js';
import type { IdGenerator } from '../../shared/ids.js';
import {
  DATA_CATEGORIES,
  PermissionGrantSchema,
  type Access,
  type Actor,
  type DataCategory,
  type PermissionGrant,
  type Purpose,
} from '../../shared/permissions.js';

/**
 * Permission service owned by Agent 04. Access is an executable decision, not
 * something an agent remembers: "Access decisions should combine actor,
 * relationship, object, purpose, and current policy." Denials for a record in
 * another tenant and a record that does not exist are indistinguishable (04T15).
 */

export type AuthorizationDecision = { allowed: true; basis: 'owner' | 'grant'; grantId?: string } | { allowed: false; code: 'not_found_or_denied' };

export interface AuthorizationRequest {
  actor: Actor;
  tenantId: string;
  studentId: string;
  category: DataCategory;
  access: Access;
  purpose: Purpose;
}

/** Minimal lookup the permission service needs from the record store. */
export interface OwnershipLookup {
  ownerOf(tenantId: string, studentId: string): string | undefined;
}

export type PermissionReviewTrigger = 'age_change' | 'school_enrollment_change' | 'account_ownership_change' | 'invitation_change';

export interface ShareLink {
  token: string;
  grantId: string;
  artifactId: string;
  createdAt: string;
}

export class PermissionService {
  private readonly grants = new Map<string, PermissionGrant>();
  private readonly reviewFlags = new Map<string, PermissionReviewTrigger[]>();
  private readonly links = new Map<string, ShareLink>();
  private policyVersion = 1;

  constructor(
    private readonly ownership: OwnershipLookup,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly audit: AuditLog,
  ) {}

  private isOwner(actor: Actor, tenantId: string, studentId: string): boolean {
    return actor.kind === 'student' && actor.tenantId === tenantId && this.ownership.ownerOf(tenantId, studentId) === actor.id;
  }

  private activeGrants(actorId: string, tenantId: string, studentId: string): PermissionGrant[] {
    const now = this.clock.nowIso();
    return [...this.grants.values()].filter(
      (g) => g.granteeActorId === actorId && g.tenantId === tenantId && g.studentId === studentId && !g.revokedAt && (!g.expiresAt || g.expiresAt > now),
    );
  }

  authorize(req: AuthorizationRequest): AuthorizationDecision {
    const denied: AuthorizationDecision = { allowed: false, code: 'not_found_or_denied' };
    if (req.actor.tenantId !== req.tenantId) return denied;
    if (this.ownership.ownerOf(req.tenantId, req.studentId) === undefined) return denied;
    // Agents never hold authority of their own: they act for the task's person.
    if (req.actor.kind === 'agent') return denied;
    if (this.isOwner(req.actor, req.tenantId, req.studentId)) return { allowed: true, basis: 'owner' };
    for (const g of this.activeGrants(req.actor.id, req.tenantId, req.studentId)) {
      if (g.categories.includes(req.category) && g.access.includes(req.access) && g.purposes.includes(req.purpose)) {
        return { allowed: true, basis: 'grant', grantId: g.id };
      }
    }
    return denied;
  }

  /** Categories the actor may access for a purpose. Empty when nothing is permitted. */
  permittedCategories(actor: Actor, tenantId: string, studentId: string, purpose: Purpose, access: Access = 'read'): Set<DataCategory> {
    const out = new Set<DataCategory>();
    for (const category of DATA_CATEGORIES) {
      if (this.authorize({ actor, tenantId, studentId, category, access, purpose }).allowed) out.add(category);
    }
    return out;
  }

  /** Used by the tool gateway at every call: is this person still allowed to have work done for this purpose? */
  isStillAuthorized(actor: Actor, tenantId: string, studentId: string, purpose: Purpose): boolean {
    return this.permittedCategories(actor, tenantId, studentId, purpose).size > 0;
  }

  /**
   * Snapshot of the actor's effective permissions for this student. Changes when
   * a relevant grant is created, revoked or expires, or when policy changes, so
   * caches keyed by it can never serve content after a revocation.
   */
  snapshot(actor: Actor, tenantId: string, studentId: string): string {
    const owner = this.isOwner(actor, tenantId, studentId);
    const grants = this.activeGrants(actor.id, tenantId, studentId)
      .map((g) => ({ id: g.id, c: [...g.categories].sort(), p: [...g.purposes].sort(), a: [...g.access].sort(), e: g.expiresAt ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return `perm_${sha256Hex(stableStringify({ a: actor.id, k: actor.kind, t: tenantId, s: studentId, owner, grants, v: this.policyVersion })).slice(0, 20)}`;
  }

  /**
   * Create a grant. A student may invite supporters and counselors to specific
   * categories and purposes. An institution administrator may create
   * school-counselor grants only under a recorded school-contract basis.
   * Nobody gains access merely by paying for or being mentioned in an account.
   */
  grant(by: Actor, input: Omit<PermissionGrant, 'id' | 'grantedBy' | 'grantedAt' | 'revokedAt'>): PermissionGrant {
    const ownerGrant = this.isOwner(by, input.tenantId, input.studentId);
    const schoolGrant = by.kind === 'institution_admin' && by.tenantId === input.tenantId && input.relationship === 'school_counselor' && input.policyBasis.startsWith('school_contract:');
    if (!ownerGrant && !schoolGrant) throw new Error('Only the student, or a school administrator under a school contract policy, can create this grant');
    if (input.relationship === 'internal_support' && !input.expiresAt) throw new Error('Internal support access must expire');
    const g = PermissionGrantSchema.parse({ ...input, id: this.ids.next('grant'), grantedBy: by.id, grantedAt: this.clock.nowIso() });
    this.grants.set(g.id, g);
    this.audit.record({ kind: 'permission_change', actorId: by.id, tenantId: g.tenantId, studentId: g.studentId, name: 'grant', outcome: 'created' });
    return g;
  }

  /** Revoke immediately. Future access, cached views, share links and queued jobs all fail from this point. */
  revoke(by: Actor, grantId: string): PermissionGrant {
    const g = this.grants.get(grantId);
    if (!g) throw new Error('Unknown grant');
    const allowed = this.isOwner(by, g.tenantId, g.studentId) || by.id === g.grantedBy || by.id === g.granteeActorId;
    if (!allowed) throw new Error('Not allowed to revoke this grant');
    if (!g.revokedAt) g.revokedAt = this.clock.nowIso();
    for (const [token, link] of this.links) if (link.grantId === grantId) this.links.delete(token);
    this.audit.record({ kind: 'permission_change', actorId: by.id, tenantId: g.tenantId, studentId: g.studentId, name: 'grant', outcome: 'revoked' });
    return g;
  }

  listGrants(tenantId: string, studentId: string): PermissionGrant[] {
    return [...this.grants.values()].filter((g) => g.tenantId === tenantId && g.studentId === studentId);
  }

  /**
   * A change in school enrollment, account ownership, age or invitation status
   * flags affected grants for review under the configured policy. Rights are not
   * changed automatically (turning 18 does not change every right everywhere in
   * the same way); a qualified, deployment-specific policy must decide (04T14).
   */
  flagForReview(tenantId: string, studentId: string, trigger: PermissionReviewTrigger): PermissionGrant[] {
    const affected = this.listGrants(tenantId, studentId).filter((g) => !g.revokedAt);
    for (const g of affected) this.reviewFlags.set(g.id, [...(this.reviewFlags.get(g.id) ?? []), trigger]);
    this.audit.record({ kind: 'permission_change', tenantId, studentId, name: 'permission_review', outcome: `flagged:${trigger}:${affected.length}` });
    return affected;
  }

  reviewTriggers(grantId: string): readonly PermissionReviewTrigger[] {
    return this.reviewFlags.get(grantId) ?? [];
  }

  bumpPolicyVersion(): void {
    this.policyVersion += 1;
  }

  createShareLink(by: Actor, grantId: string, artifactId: string): ShareLink {
    const g = this.grants.get(grantId);
    if (!g || g.revokedAt) throw new Error('Grant is not active');
    if (!this.isOwner(by, g.tenantId, g.studentId)) throw new Error('Only the student can share');
    const link: ShareLink = { token: this.ids.next('link'), grantId, artifactId, createdAt: this.clock.nowIso() };
    this.links.set(link.token, link);
    return link;
  }

  /** Resolve a share link at use time: an expired or revoked grant makes the link useless. */
  resolveShareLink(token: string): { grant: PermissionGrant; artifactId: string } | undefined {
    const link = this.links.get(token);
    if (!link) return undefined;
    const g = this.grants.get(link.grantId);
    if (!g || g.revokedAt || (g.expiresAt && g.expiresAt <= this.clock.nowIso())) return undefined;
    return { grant: g, artifactId: link.artifactId };
  }
}
