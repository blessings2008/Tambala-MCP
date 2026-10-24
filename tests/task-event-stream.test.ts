import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrganizationTask, transitionTask } from '../src/organization/task-engine.js';
import { publishOrganizationTaskEvent, taskEventBus } from '../src/organization/task-events.js';

test('organization lifecycle events are published to live subscribers', () => {
  const received: Array<{ taskId: string; status?: string; actor: string; type: string }> = [];
  const unsubscribe = taskEventBus.subscribe((event) => received.push(event));
  try {
    const task = createOrganizationTask('Research a lodge.');
    publishOrganizationTaskEvent(task.events[0]!);
    const next = transitionTask(task, 'ceo_analyzing', 'Chief Executive Officer (CEO)', 'CEO is analyzing.');
    publishOrganizationTaskEvent(next);

    assert.equal(received.length, 2);
    assert.equal(received[0]?.taskId, task.id);
    assert.equal(received[0]?.status, 'created');
    assert.equal(received[1]?.status, 'ceo_analyzing');
    assert.equal(received[1]?.actor, 'Chief Executive Officer (CEO)');
    assert.ok(received.every((event) => Boolean(event.type)));
  } finally {
    unsubscribe();
  }
});
