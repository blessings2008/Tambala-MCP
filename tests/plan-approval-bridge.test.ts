import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrganizationalPlan, OrganizationalPlanStep } from '../src/organization/runtime-contracts.js';
import { matchesExactPlanApproval, planApprovalSubjectId, planFingerprint } from '../src/organization/workforce/plan-approval-bridge.js';

const step: OrganizationalPlanStep = {
  id: 'research', title: 'Research market', objective: 'Gather verified market evidence',
  accountableRoleId: 'research-director', supportingRoleIds: [], dependsOn: [],
  capabilityRequirements: [{ capabilityId: 'market_research', purpose: 'Evidence gathering', actionKind: 'research', requiredDataScopes: [], expectedEvidence: ['Source URLs'] }],
  expectedDeliverable: 'A sourced evidence brief', acceptanceCriteria: ['Claims have sources'],
  risk: 'high', approvalRequired: true, reversible: true,
};

const plan: OrganizationalPlan = {
  id: 'plan-123', objectiveId: 'objective-123', rationale: 'Research before action',
  assumptions: [], unresolvedQuestions: [], steps: [step], proposedByRoleId: 'ceo',
  createdAt: '2026-11-19T00:00:00.000Z', revision: 3,
};

function approvalContent(value: OrganizationalPlan = plan, stepId = 'research') {
  return JSON.stringify({
    schema: 'tambala.plan-step-approval.v1',
    planHash: planFingerprint(value),
    stepId,
    plan: value,
  });
}

test('accepts approval evidence bound to the exact plan revision and step', () => {
  const hash = planFingerprint(plan);
  const subject = planApprovalSubjectId(plan, step, hash);
  assert.equal(matchesExactPlanApproval(approvalContent(), subject, plan, step), true);
});

test('rejects an approval from an older plan revision', () => {
  const oldPlan = { ...plan, revision: 2 };
  const subject = planApprovalSubjectId(oldPlan, step, planFingerprint(oldPlan));
  assert.equal(matchesExactPlanApproval(approvalContent(oldPlan), subject, plan, step), false);
});

test('rejects approval content whose plan was modified after the approval was created', () => {
  const changed = { ...plan, rationale: 'Changed after approval' };
  const subject = planApprovalSubjectId(plan, step, planFingerprint(plan));
  assert.equal(matchesExactPlanApproval(approvalContent(changed), subject, plan, step), false);
});

test('rejects an approval bound to a different step or subject key', () => {
  const subject = planApprovalSubjectId(plan, step, planFingerprint(plan));
  assert.equal(matchesExactPlanApproval(approvalContent(plan, 'another-step'), subject, plan, step), false);
  assert.equal(matchesExactPlanApproval(approvalContent(), 'wrong-subject', plan, step), false);
});
