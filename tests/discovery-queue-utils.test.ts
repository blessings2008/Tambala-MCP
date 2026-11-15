import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages, hasDiscoveryQueueHandoff } from '../src/organization/workforce/discovery-queue-utils.ts';

test('recognises a record already handed to Research by either workflow', () => {
  const marker = 'Please review. Queue record ID: queue-123.';
  assert.equal(hasDiscoveryQueueHandoff('queue-123', [{ request: marker }]), true);
  assert.equal(hasDiscoveryQueueHandoff('queue-456', [{ request: marker }]), false);
});

test('fetches every page, including a final empty page when total is an exact multiple', async () => {
  const source = Array.from({ length: 1000 }, (_, index) => index);
  const offsets: number[] = [];
  const result = await fetchAllPages(async (offset, limit) => {
    offsets.push(offset);
    return source.slice(offset, offset + limit);
  }, 500);
  assert.equal(result.length, 1000);
  assert.deepEqual(offsets, [0, 500, 1000]);
});

test('preserves rows across a partial final page', async () => {
  const source = Array.from({ length: 1207 }, (_, index) => index);
  const result = await fetchAllPages(async (offset, limit) => source.slice(offset, offset + limit), 500);
  assert.equal(result.length, 1207);
  assert.equal(result[1206], 1206);
});
