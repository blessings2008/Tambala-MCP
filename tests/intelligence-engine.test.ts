import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessObjective,
  validateAssessmentPlan,
  type ObjectiveInterpretation,
} from '../src/organization/intelligence-engine.js';
import type { OrganizationDefinition } from '../src/organization/model.js';
import type { OrganizationalObjective, OrganizationalPlan } from '../src/organization/runtime-contracts.js';

const organization: OrganizationDefinition = {
  id: 'tambala',
  name: 'Tambala Technologies',
  mission: 'Build useful technology and digital services.',
  ownerRoleId: 'founder',
  boardRoleId: 'board',
  ceoRoleId: 'ceo',
  executiveCouncilRoleId: 'executive-council',
  units: [{
    id: 'research',
    name: 'Central Research & Intelligence',
    kind: 'department',
    parentId: null,
    purpose: 'Produce verified research.',
    status: 'active',
    accountableRoleIds: ['research-director'],
    tags: ['research', 'intelligence'],
  }],
  roles: [{
    id: 'research-director',
    title: 'Head of Central Research & Intelligence',
    kind: 'ai_agent',
    unitId: 'research',
    reportsToRoleId: 'ceo',
    purpose: 'Lead research and evidence verification.',
    capabilities: ['research'],
    activation: 'active',
  }],
};

const objective: OrganizationalObjective = {
  id: 'objective-1',
  statement: 'Investigate a market opportunity',
  desiredOutcome: 'A verified market opportunity brief',
  origin: 'founder_request',
  requestedByRoleId: 'founder',
  ownerRoleId: 'ceo',
  constraints: ['Use verified sources'],
  deadline: null,
  priority: 'normal',
  createdAt: '2026-11-17T00:00:00.000Z',
  correlationId: 'corr-1',
};

const interpretation: ObjectiveInterpretation = {
  originalRequest: 'Investigate a market opportunity and return a verified brief.',
  desiredOutcome: 'A verified market opportunity brief',
  successDescription: 'The Founder can make an informed decision from traceable evidence.',
  requiredCapabilityIds: ['web_research'],
  assumptions: [],
  unresolvedQuestions: [],
  constraints: ['Use verified sources'],
};

const readyRuntime = {
  web_research: {
    ready: true,
    apiKeyConfigured: true,
    apiKeyEnv: 'TAMBALA_RESEARCH_API_KEY',
    baseURL: 'https://api.example/v1',
    model: 'free-model',
  },
};

test('assesses explicit capability requirements without relying on objective keywords', () => {
  const assessment = assessObjective(
    objective,
    { ...interpretation, desiredOutcome: 'Evidence for a decision' },
    organization,
    readyRuntime,
  );
  assert.equal(assessment.status, 'ready_for_planning');
  assert.equal(assessment.capabilityReadiness[0]?.readiness, 'ready');
});

test('blocks unknown capability IDs rather than inventing an executor', () => {
  const assessment = assessObjective(
    objective,
    { ...interpretation, requiredCapabilityIds: ['imaginary_capability'] },
    organization,
    readyRuntime,
  );
  assert.equal(assessment.status, 'blocked');
  assert.ok(assessment.blockers.some((item) => item.includes('Unknown capability')));
});

test('blocks a declared capability when its role or runtime is unavailable', () => {
  const missingRuntime = assessObjective(objective, interpretation, organization, {});
  assert.equal(missingRuntime.status, 'blocked');
  assert.equal(missingRuntime.capabilityReadiness[0]?.readiness, 'needs_configuration');

  const noRole = assessObjective(objective, interpretation, {
    ...organization,
    roles: [],
  }, readyRuntime);
  assert.equal(noRole.status, 'blocked');
  assert.equal(noRole.capabilityReadiness[0]?.readiness, 'not_activated');
});

test('requires clarification when unresolved questions remain', () => {
  const assessment = assessObjective(
    objective,
    { ...interpretation, unresolvedQuestions: ['Which customer segment should be prioritized?'] },
    organization,
    readyRuntime,
  );
  assert.equal(assessment.status, 'needs_clarification');
});

test('surfaces relevant capabilities as suggestions without silently adding them', () => {
  const assessment = assessObjective(
    objective,
    interpretation,
    organization,
    readyRuntime,
  );
  assert.ok(Array.isArray(assessment.suggestedCapabilities));
  assert.deepEqual(assessment.interpretation.requiredCapabilityIds, ['web_research']);
});

test('plan validation rejects a step that depends on a capability not discovered', () => {
  const assessment = assessObjective(objective, interpretation, organization, readyRuntime);
  const plan: OrganizationalPlan = {
    id: 'plan-1',
    objectiveId: objective.id,
    rationale: 'Produce evidence before making a recommendation.',
    assumptions: [],
    unresolvedQuestions: [],
    proposedByRoleId: 'ceo',
    createdAt: '2026-11-17T00:00:00.000Z',
    revision: 1,
    steps: [{
      id: 'step-1',
      title: 'Build a market brief',
      objective: 'Produce a verified brief',
      accountableRoleId: 'research-director',
      supportingRoleIds: [],
      dependsOn: [],
      capabilityRequirements: [{
        capabilityId: 'finance',
        purpose: 'Check financial viability',
        actionKind: 'read',
        requiredDataScopes: ['finance:read'],
        expectedEvidence: ['financial analysis'],
      }],
      expectedDeliverable: 'Market brief',
      acceptanceCriteria: ['Evidence is linked'],
      risk: 'low',
      approvalRequired: false,
      reversible: true,
    }],
  };
  assert.ok(validateAssessmentPlan(assessment, plan).some((issue) => issue.includes('undiscovered capability finance')));
});
