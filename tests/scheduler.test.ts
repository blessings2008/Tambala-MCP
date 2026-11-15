import test from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledQueueMaintenance } from '../src/organization/workforce/scheduler.ts';

test('in-process scheduler recovers reviewing rows before skipping queue dispatch in duty runner', async () => {
  const calls: string[] = [];
  const result = await runScheduledQueueMaintenance({
    dispatchReviewing: async (maxCount) => { calls.push(`recovery:${maxCount}`); return 3; },
    dispatchNew: async (maxCount) => { calls.push(`new:${maxCount}`); return maxCount; },
    dispatchApprovals: async () => { calls.push('approvals'); return 2; },
    runDuties: async (options) => {
      calls.push(options.skipDiscoveryQueue ? 'duties-skip-queue' : 'duties-normal');
      return { outcomes: [], handoffs: [] };
    },
  });
  assert.deepEqual(calls, ['recovery:5', 'new:2', 'approvals', 'duties-skip-queue']);
  assert.equal(result.newClaims, 2);
  assert.equal(result.recoveredReviews, 3);
  assert.equal(result.promotionApprovals, 2);
});
