import test from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledQueueMaintenance } from '../src/organization/workforce/scheduler.ts';

test('in-process scheduler recovers reviewing rows before skipping queue dispatch in duty runner', async () => {
  const calls: string[] = [];
  const result = await runScheduledQueueMaintenance({
    dispatchNew: async () => { calls.push('new'); return 5; },
    dispatchReviewing: async () => { calls.push('recovery'); return 15; },
    dispatchApprovals: async () => { calls.push('approvals'); return 2; },
    runDuties: async (options) => {
      calls.push(options.skipDiscoveryQueue ? 'duties-skip-queue' : 'duties-normal');
      return { outcomes: [], handoffs: [] };
    },
  });
  assert.deepEqual(calls, ['new', 'recovery', 'approvals', 'duties-skip-queue']);
  assert.equal(result.newClaims, 5);
  assert.equal(result.recoveredReviews, 15);
  assert.equal(result.promotionApprovals, 2);
});
