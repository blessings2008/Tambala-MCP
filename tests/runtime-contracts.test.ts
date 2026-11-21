import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateOrganizationalPlan,
  type OrganizationalObjective,
  type OrganizationalPlan,
} from '../src/organization/runtime-contracts.js';

const objective: OrganizationalObjective = {
  id: 'objective-1',
  statement: 'Improve the client onboarding experience',
  desiredOutcome: 'A clearer and faster onboarding journey',
  origin: 'founder_request',
  requestedByRoleId: 'founder',
  ownerRoleId: 'ceo',
  constraints: ['Do not send external messages without approval'],
  deadline: null,
  priority: 'normal',
  createdAt: '2026-11-17T00:00:00.000Z',
  correlationId: 'corr-1',
};

function makePlan(steps: OrganizationalPlan['steps']): OrganizationalPlan {
  return {
    id: 'plan-1',
    objectiveId: objective.id,
    rationale: 'Break the outcome into verifiable work.',
    assumptions: [],
    unresolvedQuestions: [],
    steps,
    proposedByRoleId: 'ceo',
    createdAt: '2026-11-17T00:00:00.000Z',
    revision: 1,
  };
}

function step(id: string, overrides: Partial<OrganizationalPlan['steps'][number]> = {}): OrganizationalPlan['steps'][number] {
  return {
    id,
    title: `Step ${id}`,
    objective: `Complete ${id}`,
    accountableRoleId: 'role-1',
    supportingRoleIds: [],
    dependsOn: [],
    capabilityRequirements: [{
      capabilityId: 'internal_research',
      purpose: 'Inspect internal onboarding records',
      actionKind: 'read',
      requiredDataScopes: ['onboarding:read'],
      expectedEvidence: ['source records'],
    }],
    expectedDeliverable: 'A documented result',
    acceptanceCriteria: ['Evidence is linked', 'Result is reviewed'],
    risk: 'low',
    approvalRequired: false,
    reversible: true,
    ...overrides,
  };
}

test('accepts a valid plan with independent and dependent steps', () => {
  const plan = makePlan([
    step('research'),
    step('recommend', { dependsOn: ['research'] }),
  ]);
  assert.deepEqual(validateOrganizationalPlan(objective, plan), []);
});

test('rejects plans without actionable steps', () => {
  const plan = makePlan([]);
  assert.ok(validateOrganizationalPlan(objective, plan).some((issue) => issue.code === 'EMPTY_PLAN'));
});

test('rejects unknown dependencies and dependency cycles', () => {
  const unknown = makePlan([step('one', { dependsOn: ['missing'] })]);
  assert.ok(validateOrganizationalPlan(objective, unknown).some((issue) => issue.code === 'UNKNOWN_DEPENDENCY'));

  const cycle = makePlan([
    step('one', { dependsOn: ['two'] }),
    step('two', { dependsOn: ['one'] }),
  ]);
  assert.ok(validateOrganizationalPlan(objective, cycle).some((issue) => issue.code === 'DEPENDENCY_CYCLE'));
});

test('requires approval for financial and external communication capabilities', () => {
  const plan = makePlan([step('send', {
    capabilityRequirements: [{
      capabilityId: 'whatsapp_send',
      purpose: 'Send an external client message',
      actionKind: 'external_communication',
      requiredDataScopes: ['crm:read', 'whatsapp:send'],
      expectedEvidence: ['approved message'],
    }],
  })]);
  assert.ok(validateOrganizationalPlan(objective, plan).some((issue) => issue.code === 'SENSITIVE_ACTION_WITHOUT_APPROVAL'));
});

test('requires approval for high-risk and irreversible capability steps', () => {
  const plan = makePlan([step('change', {
    risk: 'critical',
    reversible: false,
  })]);
  const codes = validateOrganizationalPlan(objective, plan).map((issue) => issue.code);
  assert.ok(codes.includes('HIGH_RISK_WITHOUT_APPROVAL'));
  assert.ok(codes.includes('NON_REVERSIBLE_ACTION_WITHOUT_APPROVAL'));
});

test('requires a deliverable and acceptance criteria for every step', () => {
  const plan = makePlan([step('one', {
    expectedDeliverable: ' ',
    acceptanceCriteria: [],
  })]);
  const codes = validateOrganizationalPlan(objective, plan).map((issue) => issue.code);
  assert.ok(codes.includes('MISSING_DELIVERABLE'));
  assert.ok(codes.includes('MISSING_ACCEPTANCE_CRITERIA'));
});
