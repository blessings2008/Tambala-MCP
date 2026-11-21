import assert from 'node:assert/strict';
import test from 'node:test';
import { workerDelayAfterFailure } from '../src/organization/workforce/worker-policy.js';

test('worker uses its configured interval after a successful cycle', () => {
  assert.equal(workerDelayAfterFailure(60_000, 0), 60_000);
});

test('worker backs off exponentially after repeated failures', () => {
  assert.equal(workerDelayAfterFailure(60_000, 1), 120_000);
  assert.equal(workerDelayAfterFailure(60_000, 2), 240_000);
});

test('worker retry backoff is capped at five minutes', () => {
  assert.equal(workerDelayAfterFailure(60_000, 10), 300_000);
});

test('worker clamps invalid and excessively small intervals', () => {
  assert.equal(workerDelayAfterFailure(Number.NaN, 0), 60_000);
  assert.equal(workerDelayAfterFailure(100, 0), 1_000);
});
