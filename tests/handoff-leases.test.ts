import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HANDOFF_LEASE_TIMEOUT_MS,
  InMemoryHandoffStore,
  processHandoffs,
  queueHandoff,
  type HandoffDeps,
} from '../src/organization/workforce/handoffs.js';

const initialTime = '2026-11-17T17:00:00.000Z';

async function createRunningHandoff(store: InMemoryHandoffStore) {
  const handoff = await queueHandoff(store, {
    fromRoleId: 'ceo',
    toAgent: 'research',
    request: 'Research the market and return a verified evidence brief.',
    now: new Date(initialTime),
  });
  assert.equal(await store.claim(handoff.id, initialTime), true);
  return handoff;
}

test('worker heartbeat refreshes a running handoff lease', async () => {
  const store = new InMemoryHandoffStore();
  const handoff = await createRunningHandoff(store);
  const heartbeatAt = new Date(Date.parse(initialTime) + HANDOFF_LEASE_TIMEOUT_MS - 1000).toISOString();
  assert.equal(await store.heartbeat(handoff.id, heartbeatAt), true);
  const cutoff = new Date(Date.parse(initialTime) + HANDOFF_LEASE_TIMEOUT_MS).toISOString();
  assert.equal((await store.expiredRunning(cutoff, 10)).length, 0);
});

test('expired running work is quarantined and cannot be claimed as queued work', async () => {
  const store = new InMemoryHandoffStore();
  const handoff = await createRunningHandoff(store);
  const cutoff = new Date(Date.parse(initialTime) + HANDOFF_LEASE_TIMEOUT_MS + 1000).toISOString();
  const expired = await store.expiredRunning(cutoff, 10);
  assert.equal(expired.length, 1);
  assert.equal(await store.quarantineExpired(handoff.id, cutoff, 'Needs Founder review.'), true);
  const saved = await store.get(handoff.id);
  assert.equal(saved?.status, 'awaiting_founder');
  assert.equal(saved?.error, 'Needs Founder review.');
  assert.equal(await store.claim(handoff.id, cutoff), false);
});

test('processHandoffs recovers stale workers to Founder review without replaying work', async () => {
  const store = new InMemoryHandoffStore();
  const handoff = await createRunningHandoff(store);
  await store.update(handoff.id, { task_id: 'child-task-1' });
  const roomId = handoff.room_id!;
  const transitions: unknown[] = [];
  const deps: HandoffDeps = {
    store,
    now: () => new Date(Date.parse(initialTime) + HANDOFF_LEASE_TIMEOUT_MS + 1000),
    agentUnavailableReason: async () => null,
    senderLabel: async () => 'CEO',
    recipientLabel: async () => 'Research Director',
    actions: { run: async () => '' },
    sign: async () => ({ block: '' }),
    buildContext: async () => ({}),
    askAgent: async () => '',
    tasks: {
      begin: async () => ({ taskId: 'unused' }),
      advance: async (_taskId, steps) => { transitions.push(...steps); },
      fail: async () => {},
    },
  };

  const outcomes = await processHandoffs(deps);
  const saved = await store.get(handoff.id);
  const room = store.rooms.find((item) => item.id === roomId);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, 'waiting');
  assert.equal(saved?.status, 'awaiting_founder');
  assert.equal(room?.status, 'awaiting_founder');
  assert.equal(transitions.length, 1);
  assert.equal((transitions[0] as { eventType: string }).eventType, 'handoff_worker_lease_expired');
  assert.equal((await store.queued(10)).length, 0);
});
