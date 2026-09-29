import { storyRef, type StoryBank } from '../agents/a17-stories/bank.js';
import type { SystemKernel } from './kernel.js';

/**
 * Connect the story bank to the student-record service (17 "Failure
 * handling", 17T09, 17T15): when a story is corrected, excluded or its use
 * changes, every derived result that cited it (a summary, a narrative map)
 * becomes stale for that student, and the bank is purged on account deletion.
 */
export function connectStoryBank(kernel: SystemKernel, bank: StoryBank): void {
  kernel.records.registerDerivativeStore(bank);
  bank.onChange((c) => {
    kernel.records.invalidateByRuleOrSource(c.tenantId, c.studentId, { sourceId: storyRef(c.storyId) }, `story ${c.storyId} changed: ${c.change}`.slice(0, 200));
  });
}
