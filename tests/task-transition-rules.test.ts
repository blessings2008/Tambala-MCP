import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedOrganizationTaskTransition, ORGANIZATION_TASK_TRANSITIONS } from '../src/organization/task-transition-rules.js';

test('task transition map covers every persisted task status', () => {
  const statuses = Object.keys(ORGANIZATION_TASK_TRANSITIONS).sort();
  assert.deepEqual(statuses, [
    'ceo_analyzing',
    'completed',
    'created',
    'delegated',
    'department_review',
    'executing',
    'failed',
    'needs_more_work',
    'returned_to_ceo',
    'waiting_for_tool',
  ].sort());
});

test('normal Founder-to-CEO-to-department-to-review path is allowed', () => {
  assert.equal(isAllowedOrganizationTaskTransition('created', 'ceo_analyzing'), true);
  assert.equal(isAllowedOrganizationTaskTransition('ceo_analyzing', 'delegated'), true);
  assert.equal(isAllowedOrganizationTaskTransition('delegated', 'executing'), true);
  assert.equal(isAllowedOrganizationTaskTransition('executing', 'returned_to_ceo'), true);
  assert.equal(isAllowedOrganizationTaskTransition('returned_to_ceo', 'completed'), true);
});

test('invalid state jumps and changes after completion are rejected', () => {
  assert.equal(isAllowedOrganizationTaskTransition('created', 'completed'), false);
  assert.equal(isAllowedOrganizationTaskTransition('delegated', 'completed'), false);
  assert.equal(isAllowedOrganizationTaskTransition('completed', 'executing'), false);
  assert.equal(isAllowedOrganizationTaskTransition('failed', 'completed'), false);
});

test('failed tasks may be explicitly retried through CEO analysis', () => {
  assert.equal(isAllowedOrganizationTaskTransition('failed', 'ceo_analyzing'), true);
  assert.equal(isAllowedOrganizationTaskTransition('failed', 'delegated'), false);
});
