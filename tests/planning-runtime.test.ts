import assert from 'node:assert/strict';
import test from 'node:test';
import { assessObjective, type ObjectiveInterpretation } from '../src/organization/intelligence-engine.js';
import { parseOrganizationalPlanProposal, PlanProposalError } from '../src/organization/planning-runtime.js';
import type { OrganizationDefinition } from '../src/organization/model.js';
import type { OrganizationalObjective } from '../src/organization/runtime-contracts.js';

const organization: OrganizationDefinition = {
  id: 'tambala', name: 'Tambala Technologies', mission: 'Build useful technology.',
  ownerRoleId: 'founder', boardRoleId: 'board', ceoRoleId: 'ceo', executiveCouncilRoleId: 'executive-council',
  units: [{ id: 'research', name: 'Central Research & Intelligence', kind: 'department', parentId: null,
    purpose: 'Produce verified research.', status: 'active', accountableRoleIds: ['research-director'], tags: ['research', 'intelligence'] }],
  roles: [{ id: 'research-director', title: 'Head of Central Research & Intelligence', kind: 'ai_agent',
    unitId: 'research', reportsToRoleId: 'ceo', purpose: 'Lead research.', capabilities: ['research'], activation: 'active' }],
};
const objective: OrganizationalObjective = {
  id: 'objective-1', statement: 'Investigate a market opportunity', desiredOutcome: 'Verified market brief',
  origin: 'founder_request', requestedByRoleId: 'founder', ownerRoleId: 'ceo', constraints: ['Use verified sources'],
  deadline: null, priority: 'normal', createdAt: '2026-11-17T00:00:00.000Z', correlationId: 'corr-1',
};
const interpretation: ObjectiveInterpretation = {
  originalRequest: objective.statement, desiredOutcome: objective.desiredOutcome,
  successDescription: 'The Founder can make a decision from traceable evidence.',
  requiredCapabilityIds: ['web_research'], assumptions: [], unresolvedQuestions: [], constraints: objective.constraints,
};
const assessment = assessObjective(objective, interpretation, organization, {
  web_research: { ready: true, apiKeyConfigured: true, apiKeyEnv: 'TAMBALA_RESEARCH_API_KEY',
    baseURL: 'https://api.example/v1', model: 'free-model' },
});
const step = {
  id: 'research-1', title: 'Investigate market', objective: 'Collect current verified market evidence.',
  capabilityId: 'web_research', supportingCapabilityIds: [], dependsOn: [], actionKind: 'research',
  requiredDataScopes: ['public:web'], expectedEvidence: ['Official sources and publication dates'],
  expectedDeliverable: 'Market research brief', acceptanceCriteria: ['Claims have traceable sources'],
  risk: 'low', approvalRequired: false, reversible: true,
};
const proposal = (steps: unknown[]) => JSON.stringify({
  rationale: 'Research the market before making a recommendation.', assumptions: [], unresolvedQuestions: [], steps,
});

test('composes a plan and binds ownership to the discovered accountable role', () => {
  assert.equal(assessment.status, 'ready_for_planning');
  const plan = parseOrganizationalPlanProposal(proposal([step]), assessment, { planId: 'plan-1' });
  assert.equal(plan.steps[0]?.accountableRoleId, 'research-director');
  assert.deepEqual(plan.steps[0]?.supportingRoleIds, []);
  assert.equal(plan.steps[0]?.capabilityRequirements[0]?.capabilityId, 'web_research');
});

test('rejects a model-invented capability instead of routing it elsewhere', () => {
  assert.throws(
    () => parseOrganizationalPlanProposal(proposal([{ ...step, capabilityId: 'invented_department' }]), assessment, { planId: 'plan-2' }),
    /undiscovered capability/i,
  );
});

test('requires every interpreted capability to be represented in the plan', () => {
  const twoCapabilityAssessment = assessObjective(objective, {
    ...interpretation, requiredCapabilityIds: ['web_research', 'finance'],
  }, {
    ...organization,
    units: [...organization.units, { id: 'finance', name: 'Finance & Accounting', kind: 'department',
      parentId: null, purpose: 'Manage internal finance.', status: 'active', accountableRoleIds: ['finance-director'], tags: ['finance'] }],
    roles: [...organization.roles, { id: 'finance-director', title: 'Head of Finance & Accounting', kind: 'ai_agent',
      unitId: 'finance', reportsToRoleId: 'ceo', purpose: 'Manage finance.', capabilities: ['finance'], activation: 'active' }],
  }, {
    web_research: { ready: true, apiKeyConfigured: true, apiKeyEnv: 'RESEARCH_KEY', baseURL: 'https://example.test', model: 'free' },
    finance: { ready: true, apiKeyConfigured: true, apiKeyEnv: 'FINANCE_KEY', baseURL: 'https://example.test', model: 'free' },
  });
  assert.throws(
    () => parseOrganizationalPlanProposal(proposal([step]), twoCapabilityAssessment, { planId: 'plan-3' }),
    /does not assign work to required capability finance/i,
  );
});

test('rejects unknown dependencies and missing approval for external communication', () => {
  assert.throws(
    () => parseOrganizationalPlanProposal(proposal([{ ...step, dependsOn: ['missing-step'] }]), assessment, { planId: 'plan-4' }),
    /unknown step missing-step/i,
  );
  assert.throws(
    () => parseOrganizationalPlanProposal(proposal([{ ...step, actionKind: 'external_communication' }]), assessment, { planId: 'plan-5' }),
    /approval-gated action/i,
  );
});

test('blocks plan composition when objective assessment needs clarification', () => {
  const unclear = assessObjective(objective, {
    ...interpretation, unresolvedQuestions: ['Which segment matters most?'],
  }, organization, {
    web_research: { ready: true, apiKeyConfigured: true, apiKeyEnv: 'RESEARCH_KEY', baseURL: 'https://example.test', model: 'free' },
  });
  assert.throws(
    () => parseOrganizationalPlanProposal(proposal([step]), unclear, { planId: 'plan-6' }),
    PlanProposalError,
  );
});
