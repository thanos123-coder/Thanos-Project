import { claimRef, type InstitutionClaimStore } from '../agents/a11-research/claims.js';
import type { SystemKernel } from './kernel.js';

/**
 * Connect the shared institution claim store to the student-record service
 * (11 "Worked example and downstream repair"). A changed official claim makes
 * every saved result that cited it stale for every student at once, and a
 * reference-only event tells dependent roles to recompute; no content travels
 * in the event. A student's private evidence is deleted with their documents
 * and their account like any other derivative store.
 */
export function connectInstitutionClaims(kernel: SystemKernel, store: InstitutionClaimStore): void {
  store.onChange((c) => {
    const ref = claimRef(c.claimId);
    kernel.records.invalidateEverywhereByRuleOrSource({ sourceId: ref }, `official claim ${c.claimId} changed (${c.changed.join(', ')}): version ${c.previousVersion} -> ${c.version}`);
    kernel.events.publish({
      eventId: kernel.ids.next('event'),
      type: 'source.changed',
      tenantId: 'public',
      entityRef: ref,
      oldVersion: c.previousVersion,
      newVersion: c.version,
      changedFields: c.changed,
      causeRef: `${ref}@${c.version}`,
      occurredAt: kernel.clock.nowIso(),
      sensitivePayloadIncluded: false,
    });
  });
  kernel.records.registerDerivativeStore({
    name: 'institution_private_evidence',
    purgeByDocument: (tenantId, studentId, documentId) => store.purgeDocument(tenantId, studentId, documentId),
    purgeByClaims: () => 0,
    purgeByStudent: (tenantId, studentId) => store.purgeStudent(tenantId, studentId),
  });
}
