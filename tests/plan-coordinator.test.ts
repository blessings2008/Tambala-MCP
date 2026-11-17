import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinatePlan, type StepProgressRecord } from '../src/organization/plan-coordinator.js';
import type { OrganizationalPlan } from '../src/organization/runtime-contracts.js';

const plan: OrganizationalPlan = {
  id: 'plan-1', objectiveId: 'objective-1', rationale: 'Research then prepare a recommendation.',
  assumptions: [], unresolvedQuestions: [], proposedByRoleId: 'ceo',
  createdAt: '2026-11-17T00:00:00.000Z', revision: 1,
  steps: [
    { id: 'research', title: 'Research', objective: 'Gather evidence', accountableRoleId: 'research-director',
      supportingRoleIds: [], dependsOn: [], capabilityRequirements: [], expectedDeliverable: 'Evidence brief',
      acceptanceCriteria: ['Sources verified'], risk: 'low', approvalRequired: false, reversible: true },
    { id: 'recommend', title: 'Recommend', objective: 'Prepare recommendation', accountableRoleId: 'strategy-director',
      supportingRoleIds: ['research-director'], dependsOn: ['research'], capabilityRequirements: [],
      expectedDeliverable: 'Recommendation', acceptanceCriteria: ['Evidence cited'], risk: 'low',
      approvalRequired: true, reversible: true },
  ],
};
const active = new Set(['research-director', 'strategy-director']);

test('makes independent work ready and dependent work wait', () => {
  const snapshot = coordinatePlan(plan, {}, active);
  assert.deepEqual(snapshot.readyStepIds, ['research']);
  assert.equal(snapshot.steps.find((item) => item.stepId === 'recommend')?.status, 'awaiting_approval');
});

test('unblocks a dependent step only after dependency completion and approval', () => {
  const progress: Record<string, StepProgressRecord> = {
    research: { executionStatus: 'completed', approvalStatus: 'not_required' },
    recommend: { executionStatus: 'pending', approvalStatus: 'approved' },
  };
  const snapshot = coordinatePlan(plan, progress, active);
  assert.deepEqual(snapshot.readyStepIds, ['recommend']);
  assert.deepEqual(snapshot.completedStepIds, ['research']);
});

test('blocks work when accountable role is inactive and requests replanning', () => {
  const snapshot = coordinatePlan(plan, {}, new Set(['strategy-director']));
  assert.equal(snapshot.steps.find((item) => item.stepId === 'research')?.status, 'blocked_owner_inactive');
  assert.equal(snapshot.requiresReplanning, true);
  assert.ok(snapshot.replanReasons[0]?.includes('research'));
});

test('failed work and rejected approvals trigger replanning', () => {
  const snapshot = coordinatePlan(plan, {
    research: { executionStatus: 'failed', approvalStatus: 'not_required', failureReason: 'Source service unavailable.' },
    recommend: { executionStatus: 'pending', approvalStatus: 'rejected' },
  }, active);
  assert.deepEqual(snapshot.failedStepIds, ['research']);
  assert.equal(snapshot.steps.find((item) => item.stepId === 'recommend')?.status, 'blocked_approval_rejected');
  assert.equal(snapshot.requiresReplanning, true);
});

test('preserves running, completed and cancelled execution states', () => {
  const snapshot = coordinatePlan(plan, {
    research: { executionStatus: 'running', approvalStatus: 'not_required' },
    recommend: { executionStatus: 'cancelled', approvalStatus: 'approved' },
  }, active);
  assert.equal(snapshot.steps.find((item) => item.stepId === 'research')?.status, 'in_progress');
  assert.equal(snapshot.steps.find((item) => item.stepId === 'recommend')?.status, 'cancelled');
});


test('keeps queued and Founder-waiting handoffs out of the ready queue', () => {
  const snapshot = coordinatePlan(plan, {
    research: { executionStatus: 'queued', approvalStatus: 'not_required' },
    recommend: { executionStatus: 'awaiting_founder', approvalStatus: 'approved' },
  }, active);
  assert.deepEqual(snapshot.readyStepIds, []);
  assert.equal(snapshot.steps.find((item) => item.stepId === 'research')?.status, 'queued');
  assert.equal(snapshot.steps.find((item) => item.stepId === 'recommend')?.status, 'awaiting_founder');
});


test('a rejected approval overrides a queued handoff state', () => {
  const snapshot = coordinatePlan(plan, {
    recommend: { executionStatus: 'queued', approvalStatus: 'rejected' },
  }, active);
  assert.equal(snapshot.steps.find((item) => item.stepId === 'recommend')?.status, 'blocked_approval_rejected');
  assert.equal(snapshot.readyStepIds.includes('recommend'), false);
});
