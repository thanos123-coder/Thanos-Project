import { draftRef, type DraftRegistry } from '../agents/a18-narrative/drafts.js';
import type { SystemKernel } from './kernel.js';

/**
 * Connect the draft registry to the student-record service (18 step 7): a
 * new draft version, or a change of destinations or policy status, makes
 * every review that used the earlier version stale, so only affected checks
 * rerun. The registry is purged on account deletion.
 */
export function connectDraftRegistry(kernel: SystemKernel, registry: DraftRegistry): void {
  kernel.records.registerDerivativeStore(registry);
  registry.onChange((c) => {
    kernel.records.invalidateByRuleOrSource(c.tenantId, c.studentId, { sourceId: draftRef(c.artifactId) }, `draft ${c.artifactId} changed to version ${c.version}`);
  });
}
