import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrganizationTask, transitionTask } from '../src/organization/task-engine.js';

test('organization task follows the CEO delegation lifecycle', () => {
  const task = createOrganizationTask('Research Malabi Exclusive Lodge and identify opportunities for Tambala Technologies.');

  assert.equal(task.status, 'created');
  assert.equal(task.currentActor, 'Founder / Bless');
  assert.equal(task.currentRecipient, 'Chief Executive Officer (CEO)');

  transitionTask(task, 'ceo_analyzing', 'Chief Executive Officer (CEO)', 'CEO is analyzing the objective.');
  transitionTask(task, 'delegated', 'Chief Executive Officer (CEO)', 'CEO delegated the objective.', 'Head of Sales & Business Development');
  transitionTask(task, 'executing', 'Head of Sales & Business Development', 'Department is executing the delegation.');
  transitionTask(task, 'waiting_for_tool', 'Head of Sales & Business Development', 'Web research is required.', 'Web Research');
  transitionTask(task, 'tool_complete', 'Web Research', 'Research evidence returned.', 'Head of Sales & Business Development');
  transitionTask(task, 'executing', 'Head of Sales & Business Development', 'Department continues using the evidence.');
  transitionTask(task, 'department_review', 'Head of Sales & Business Development', 'Department is reviewing its completed deliverable.');
  transitionTask(task, 'returned_to_ceo', 'Head of Sales & Business Development', 'Completed deliverable returned.', 'Chief Executive Officer (CEO)');
  transitionTask(task, 'ceo_review', 'Chief Executive Officer (CEO)', 'CEO is evaluating the completed work.', 'Founder / Bless');
  transitionTask(task, 'completed', 'Chief Executive Officer (CEO)', 'Final deliverable approved and returned to Founder / Bless.', 'Founder / Bless');

  assert.equal(task.status, 'completed');
  assert.equal(task.events.length, 11);
  assert.equal(task.events.at(-1)?.type, 'task_completed');
});

test('invalid organization transitions are rejected', () => {
  const task = createOrganizationTask('Test task');
  assert.throws(() => transitionTask(task, 'completed', 'Chief Executive Officer (CEO)', 'Cannot skip the lifecycle.'));
});
