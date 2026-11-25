import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages, hasDiscoveryQueueHandoff, isFalseMissingDeliverableReview } from '../src/organization/workforce/discovery-queue-utils.ts';

test('recognises false missing-deliverable escalations only when an employee result exists', () => {
  const errors = [
    'DECISION: FOUNDER_INPUT_REQUIRED — No employee deliverable was provided. Please supply the submitted report.',
    'DECISION: FOUNDER_INPUT_REQUIRED — The employee’s completed deliverable has not been provided.',
    'DECISION: FOUNDER_INPUT_REQUIRED — The employee’s output for this record was not included.',
    'DECISION: FOUNDER_INPUT_REQUIRED — The employee’s completed review has not been provided.',
  ];
  for (const error of errors) assert.equal(isFalseMissingDeliverableReview(error, 'Stored employee report'), true);
  assert.equal(isFalseMissingDeliverableReview(errors[0], null), false);
  assert.equal(isFalseMissingDeliverableReview('DECISION: FOUNDER_INPUT_REQUIRED — Please supply an official contact number.', 'Stored employee report'), false);
});

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


test('allows an old failed handoff to be retried after its cooldown', () => {
  const marker = 'Review this record. Queue record ID: queue-789.';
  const rows = [
    { request: marker, status: 'failed', created_at: '2026-11-17T08:00:00.000Z', completed_at: '2026-11-18T08:00:00.000Z' },
  ];
  assert.equal(hasDiscoveryQueueHandoff('queue-789', rows, '2026-11-19T08:00:00.000Z'), false);
});

test('does not retry a recent failure during its cooldown', () => {
  const marker = 'Review this record. Queue record ID: queue-789.';
  const rows = [
    { request: marker, status: 'failed', created_at: '2026-11-18T08:00:00.000Z', completed_at: '2026-11-20T08:00:00.000Z' },
  ];
  assert.equal(hasDiscoveryQueueHandoff('queue-789', rows, '2026-11-19T08:00:00.000Z'), true);
});

test('active and completed handoffs remain idempotent', () => {
  const marker = 'Review this record. Queue record ID: queue-789.';
  for (const status of ['queued', 'running', 'awaiting_founder', 'completed']) {
    assert.equal(hasDiscoveryQueueHandoff('queue-789', [{ request: marker, status }], '2026-11-19T08:00:00.000Z'), true);
  }
});


test('failed handoff cooldown is measured from its final failed attempt, not initial creation', () => {
  const marker = 'Review this record. Queue record ID: queue-790.';
  const rows = [
    { request: marker, status: 'failed', created_at: '2026-11-17T08:00:00.000Z', completed_at: '2026-11-20T08:00:00.000Z' },
  ];
  assert.equal(hasDiscoveryQueueHandoff('queue-790', rows, '2026-11-19T08:00:00.000Z'), true);
  assert.equal(hasDiscoveryQueueHandoff('queue-790', rows, '2026-11-21T08:00:00.000Z'), false);
});
