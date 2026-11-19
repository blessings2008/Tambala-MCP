import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlanProposalEvent, loadPlanProgressFromHandoffs, preparePlanStepDispatches, queuePreparedPlanHandoffs, type PlanEmployeeRoute } from '../src/organization/plan-task-bridge.js';
import { InMemoryHandoffStore } from '../src/organization/workforce/handoffs.js';
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


test('persists ready steps as existing handoffs linked to the parent task', async () => {
  const store = new InMemoryHandoffStore();
  const prepared = preparePlanStepDispatches(plan, {}, new Set(['research-director', 'strategy-director']), routes);
  const result = await queuePreparedPlanHandoffs({
    prepared, store, parentTaskId: 'parent-123', actorRoleId: 'ceo',
    now: new Date('2026-11-17T12:00:00.000Z'),
  });
  assert.equal(result.queued.length, 1);
  assert.equal(result.queued[0]?.source_task_id, 'parent-123');
  assert.equal(result.queued[0]?.to_agent, 'research');
  assert.equal(result.queued[0]?.dispatch_key, 'plan:plan-growth:revision:2:step:research');
  assert.equal(store.rooms.length, 1);
  assert.equal(store.rooms[0]?.parent_task_id, 'parent-123');
  assert.equal(result.blocked.length, 0);
});

test('concurrent retries for one plan step return the same handoff and room', async () => {
  const store = new InMemoryHandoffStore();
  const prepared = preparePlanStepDispatches(plan, {}, new Set(['research-director', 'strategy-director']), routes);
  const input = {
    prepared, store, parentTaskId: 'parent-123', actorRoleId: 'ceo',
    now: new Date('2026-11-17T12:00:00.000Z'),
  };
  const [first, second] = await Promise.all([
    queuePreparedPlanHandoffs(input),
    queuePreparedPlanHandoffs(input),
  ]);
  assert.equal(first.queued[0]?.id, second.queued[0]?.id);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rooms.length, 1);
});

test('rejects reuse of a dispatch key for different work', async () => {
  const store = new InMemoryHandoffStore();
  const prepared = preparePlanStepDispatches(plan, {}, new Set(['research-director', 'strategy-director']), routes);
  await queuePreparedPlanHandoffs({ prepared, store, parentTaskId: 'parent-123', actorRoleId: 'ceo' });
  const changedPlan = {
    ...plan,
    steps: [{ ...plan.steps[0]!, objective: 'A different assignment' }, plan.steps[1]!],
  };
  const changed = preparePlanStepDispatches(changedPlan, {}, new Set(['research-director', 'strategy-director']), routes);
  await assert.rejects(
    queuePreparedPlanHandoffs({ prepared: changed, store, parentTaskId: 'parent-123', actorRoleId: 'ceo' }),
    /already associated with different work/,
  );
});


test('reconstructs queued, running, founder-waiting and completed progress from handoffs', async () => {
  const store = new InMemoryHandoffStore();
  const prepared = preparePlanStepDispatches(plan, {}, new Set(['research-director', 'strategy-director']), routes);
  await queuePreparedPlanHandoffs({ prepared, store, parentTaskId: 'parent-123', actorRoleId: 'ceo' });

  let progress = await loadPlanProgressFromHandoffs(plan, store);
  assert.equal(progress.research?.executionStatus, 'queued');

  store.rows[0]!.status = 'running';
  progress = await loadPlanProgressFromHandoffs(plan, store);
  assert.equal(progress.research?.executionStatus, 'running');

  store.rows[0]!.status = 'awaiting_founder';
  progress = await loadPlanProgressFromHandoffs(plan, store);
  assert.equal(progress.research?.executionStatus, 'awaiting_founder');

  store.rows[0]!.status = 'completed';
  progress = await loadPlanProgressFromHandoffs(plan, store);
  assert.equal(progress.research?.executionStatus, 'completed');
});

test('approval state is never inferred as approved from a handoff', async () => {
  const store = new InMemoryHandoffStore();
  const approvalPlan: OrganizationalPlan = {
    ...plan,
    steps: [{ ...plan.steps[0]!, approvalRequired: true }, plan.steps[1]!],
  };
  const pending = await loadPlanProgressFromHandoffs(approvalPlan, store);
  assert.equal(pending.research?.approvalStatus, 'pending');
  const approved = await loadPlanProgressFromHandoffs(approvalPlan, store, { research: 'approved' });
  assert.equal(approved.research?.approvalStatus, 'approved');
});


test('formats the handoff request as readable multi-line work instructions', async () => {
  const store = new InMemoryHandoffStore();
  const prepared = preparePlanStepDispatches(plan, {}, new Set(['research-director', 'strategy-director']), routes);
  const result = await queuePreparedPlanHandoffs({
    prepared, store, parentTaskId: 'parent-123', actorRoleId: 'ceo',
  });
  assert.equal(
    result.queued[0]?.request,
    'Gather verified market evidence\\nExpected deliverable: Evidence brief\\nAcceptance criteria: Sources verified',
  );
  assert.equal(result.queued[0]?.request.includes(String.fromCharCode(92) + 'n'), false);
});
