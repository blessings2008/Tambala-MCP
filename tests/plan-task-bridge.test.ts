import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlanProposalEvent, preparePlanStepDispatches, type PlanEmployeeRoute } from '../src/organization/plan-task-bridge.js';
import type { OrganizationalPlan } from '../src/organization/runtime-contracts.js';

const plan: OrganizationalPlan = {
  id: 'plan-growth', objectiveId: 'objective-growth', rationale: 'Research before preparing a strategy.',
  assumptions: [], unresolvedQuestions: [], proposedByRoleId: 'ceo',
  createdAt: '2026-11-17T00:00:00.000Z', revision: 2,
  steps: [
    { id: 'research', title: 'Research', objective: 'Gather verified market evidence', accountableRoleId: 'research-director',
      supportingRoleIds: [], dependsOn: [], capabilityRequirements: [], expectedDeliverable: 'Evidence brief',
      acceptanceCriteria: ['Sources verified'], risk: 'low', approvalRequired: false, reversible: true },
    { id: 'strategy', title: 'Strategy', objective: 'Prepare a strategy recommendation', accountableRoleId: 'strategy-director',
      supportingRoleIds: ['research-director'], dependsOn: ['research'], capabilityRequirements: [],
      expectedDeliverable: 'Strategy brief', acceptanceCriteria: ['Evidence cited'], risk: 'low',
      approvalRequired: false, reversible: true },
  ],
};

const routes: PlanEmployeeRoute[] = [
  { agent: 'research', roleId: 'research-director', active: true, runtimeReady: true },
  { agent: 'strategy', roleId: 'strategy-director', active: true, runtimeReady: true },
];

test('builds a versioned proposal event on the existing parent task', () => {
  const event = buildPlanProposalEvent('task-123', plan);
  assert.equal(event.taskId, 'task-123');
  assert.equal(event.eventType, 'organizational_plan_proposed');
  assert.equal(event.stage, 'ceo');
  assert.equal(event.actorRoleId, 'ceo');
  assert.equal(event.payload.schemaVersion, 1);
  assert.equal(event.payload.planId, plan.id);
  assert.deepEqual(event.payload.plan, plan);
});

test('dispatches only currently ready steps through a unique active employee route', () => {
  const prepared = preparePlanStepDispatches(plan, {}, new Set(['research-director', 'strategy-director']), routes);
  assert.deepEqual(prepared.dispatches.map((item) => item.stepId), ['research']);
  assert.equal(prepared.dispatches[0]?.agent, 'research');
  assert.equal(prepared.dispatches[0]?.idempotencyKey, 'plan:plan-growth:revision:2:step:research');
  assert.equal(prepared.requiresReplanning, false);
});

test('does not dispatch when a role maps to multiple employee profiles', () => {
  const prepared = preparePlanStepDispatches(plan, {}, new Set(['research-director', 'strategy-director']), [
    ...routes,
    { agent: 'rnd', roleId: 'research-director', active: true, runtimeReady: true },
  ]);
  assert.equal(prepared.dispatches.length, 0);
  assert.match(prepared.blockers[0]?.reason ?? '', /More than one employee profile/);
  assert.equal(prepared.requiresReplanning, true);
});

test('blocks dispatch when the unique employee runtime is unavailable', () => {
  const prepared = preparePlanStepDispatches(plan, {}, new Set(['research-director', 'strategy-director']), [
    { ...routes[0], runtimeReady: false },
    routes[1],
  ]);
  assert.equal(prepared.dispatches.length, 0);
  assert.match(prepared.blockers[0]?.reason ?? '', /runtime is not ready/);
});

test('preserves approval and dependency gates from the existing plan coordinator', () => {
  const approvalPlan: OrganizationalPlan = {
    ...plan,
    steps: [{ ...plan.steps[0]!, approvalRequired: true }, plan.steps[1]!],
  };
  const waiting = preparePlanStepDispatches(approvalPlan, {}, new Set(['research-director', 'strategy-director']), routes);
  assert.equal(waiting.dispatches.length, 0);
  assert.equal(waiting.coordination.steps[0]?.status, 'awaiting_approval');
  const afterApproval = preparePlanStepDispatches(approvalPlan, {
    research: { executionStatus: 'pending', approvalStatus: 'approved' },
  }, new Set(['research-director', 'strategy-director']), routes);
  assert.deepEqual(afterApproval.dispatches.map((item) => item.stepId), ['research']);
});
