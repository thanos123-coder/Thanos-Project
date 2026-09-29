import type { NumericModelRegistry } from '../agents/a13-uncertainty/models.js';
import type { SystemKernel } from './kernel.js';

/**
 * A withdrawn numerical model version stops being used at once: every result
 * that cited it (and every result built on those) becomes stale for every
 * student, and a reference-only event is published (13T15).
 */
export function connectModelRegistry(kernel: SystemKernel, registry: NumericModelRegistry): void {
  registry.onWithdraw((c) => {
    kernel.records.invalidateEverywhereByRuleOrSource({ ruleVersion: c.ref }, `model withdrawn: ${c.ref} (${c.reason})`);
    kernel.events.publish({ eventId: kernel.ids.next('event'), type: 'rule_package.changed', tenantId: 'public', entityRef: c.ref, changedFields: ['status'], causeRef: c.ref, occurredAt: kernel.clock.nowIso(), sensitivePayloadIncluded: false });
  });
}
