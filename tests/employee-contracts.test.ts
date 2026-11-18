import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateEmployeeContract,
  type EmployeeContract,
} from '../src/organization/employee-contracts.js';

function contract(overrides: Partial<EmployeeContract> = {}): EmployeeContract {
  return {
    id: 'employee-research-01',
    displayName: 'Research Analyst',
    roleId: 'research-analyst',
    departmentId: 'research-intelligence',
    reportsToRoleId: 'ceo',
    lifecycle: 'planned',
    purpose: 'Produce reliable research and evidence briefs.',
    responsibilities: ['Research assigned questions', 'Verify sources and evidence'],
    exclusions: ['Do not send external communications'],
    expertise: [{
      domain: 'business research',
      description: 'Market and organisation research',
      proficiency: 'advanced',
    }],
    capabilityIds: ['web_research', 'source_verification'],
    authority: {
      decisionScopes: ['analyze', 'research', 'draft', 'internal_coordination'],
      approvalRequiredFor: ['external_communication', 'financial_action', 'security_change', 'legal_commitment'],
      dataScopes: ['research:read'],
    },
    operatingLimits: {
      maxConcurrentTasks: 2,
      maxStepsPerTask: 8,
      maxProviderRequestsPerHour: 20,
      maxInputCharacters: 12000,
      mayCreateTemporaryTeams: false,
    },
    runtimeProfileId: null,
    contractVersion: 1,
    effectiveFrom: '2026-11-17T00:00:00.000Z',
    reviewAt: null,
    ...overrides,
  };
}

test('accepts a valid planned employee contract without activating a runtime', () => {
  assert.deepEqual(validateEmployeeContract(contract()), []);
});

test('requires a runtime profile before an employee can be marked active', () => {
  const issues = validateEmployeeContract(contract({ lifecycle: 'active' }));
  assert.ok(issues.some((issue) => issue.code === 'ACTIVE_WITHOUT_RUNTIME_PROFILE'));
});

test('rejects duplicate capabilities and invalid operating limits', () => {
  const issues = validateEmployeeContract(contract({
    capabilityIds: ['web_research', 'web_research'],
    operatingLimits: {
      maxConcurrentTasks: 0,
      maxStepsPerTask: -1,
      maxProviderRequestsPerHour: 0,
      maxInputCharacters: 0,
      mayCreateTemporaryTeams: false,
    },
  }));
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes('DUPLICATE_CAPABILITY'));
  assert.ok(codes.includes('INVALID_CONCURRENCY'));
  assert.ok(codes.includes('INVALID_STEP_LIMIT'));
  assert.ok(codes.includes('INVALID_REQUEST_BUDGET'));
  assert.ok(codes.includes('INVALID_INPUT_LIMIT'));
});

test('keeps external and consequential action scopes approval-gated', () => {
  const issues = validateEmployeeContract(contract({
    authority: {
      decisionScopes: ['analyze', 'financial_action', 'legal_commitment'],
      approvalRequiredFor: [],
      dataScopes: [],
    },
  }));
  assert.equal(issues.filter((issue) => issue.code === 'UNSAFE_AUTHORITY_SCOPE').length, 2);
});
