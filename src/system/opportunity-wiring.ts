import type { OpportunityCatalog } from '../agents/a09-opportunities/catalog.js';
import type { SystemKernel } from './kernel.js';

/**
 * Connect the public opportunity catalog to the student-record service
 * (09R14, "Failure handling and source changes"): a material curated change
 * to an opportunity makes every saved match and shortlist that used it stale
 * for every student at once, and publishes a reference-only event. Consumers
 * then refresh the affected saved plans; a cosmetic edit produces no event.
 */
export function connectOpportunityCatalog(kernel: SystemKernel, catalog: OpportunityCatalog): void {
  catalog.onChange((c) => {
    kernel.records.invalidateEverywhereByRuleOrSource({ sourceId: c.ref }, `opportunity ${c.opportunityId} changed (${c.material.join(', ')}): version ${c.previousVersion} -> ${c.version}`);
    kernel.events.publish({
      eventId: kernel.ids.next('event'),
      type: 'opportunity.changed',
      tenantId: 'public',
      entityRef: c.ref,
      oldVersion: c.previousVersion,
      newVersion: c.version,
      changedFields: c.material,
      causeRef: `${c.ref}@${c.version}`,
      occurredAt: kernel.clock.nowIso(),
      sensitivePayloadIncluded: false,
    });
  });
}
