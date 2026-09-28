import { scholarshipRef, type ScholarshipCatalog } from '../agents/a16-scholarships/catalog.js';
import type { SystemKernel } from './kernel.js';

/**
 * Connect the scholarship catalog to the student-record service (16
 * "Efficiency and evaluation"): a material change to an award's terms, rules,
 * stages, cycle or trust status makes every saved shortlist and plan that
 * cited it stale for every student, and publishes a reference-only event.
 */
export function connectScholarshipCatalog(kernel: SystemKernel, catalog: ScholarshipCatalog): void {
  catalog.onChange((c) => {
    kernel.records.invalidateEverywhereByRuleOrSource({ sourceId: scholarshipRef(c.scholarshipId) }, `scholarship ${c.scholarshipId} changed (${c.material.join(', ')}): version ${c.previousVersion} -> ${c.version}`);
    kernel.events.publish({ eventId: kernel.ids.next('event'), type: 'source.changed', tenantId: 'public', entityRef: c.ref, oldVersion: c.previousVersion, newVersion: c.version, changedFields: c.material, causeRef: `${c.ref}@${c.version}`, occurredAt: kernel.clock.nowIso(), sensitivePayloadIncluded: false });
  });
}
