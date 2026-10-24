import test from 'node:test';
import assert from 'node:assert/strict';
import { OrganizationTaskRunner } from '../src/organization/task-runner.js';

test('runner records the full Founder to CEO to department lifecycle', () => {
  const runner = new OrganizationTaskRunner('Research Malabi Exclusive Lodge.', {
    specialist: 'outreach',
    departmentTitle: 'Head of Sales & Business Development',
  });

  runner.startCeoAnalysis();
  runner.delegate('Research the lodge and return an evidence-based opportunity assessment.');
  runner.startDepartment();
  runner.waitForResearch('Malabi Exclusive Lodge');
  runner.researchComplete(5);
  runner.resumeDepartment();
  runner.submitDepartmentWork('Completed evidence-based assessment.');
  runner.returnToCeo();
  runner.beginCeoReview();
  runner.complete('Final assessment delivered to Founder.');

  assert.equal(runner.task.status, 'completed');
  assert.equal(runner.task.events[0]?.type, 'task_created');
  assert.equal(runner.task.events.at(-1)?.type, 'task_completed');
  assert.ok(runner.task.events.some((event) => event.type === 'tool_requested'));
  assert.ok(runner.task.events.some((event) => event.type === 'tool_completed'));
  assert.ok(runner.task.events.some((event) => event.type === 'ceo_review_started'));
});

test('runner cannot complete before CEO review', () => {
  const runner = new OrganizationTaskRunner('Do a task.', {
    specialist: 'outreach',
    departmentTitle: 'Head of Sales & Business Development',
  });

  assert.throws(() => runner.complete('Too early.'), /Invalid task transition/);
});
