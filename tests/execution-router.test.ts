import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveExecutionRoute, type RoutedCapability } from '../src/organization/execution-router.js';

function route(overrides: Partial<RoutedCapability> = {}): RoutedCapability {
  return {
    capabilityId: 'sales_prospecting',
    department: 'Sales & Business Development',
    role: 'Head of Sales & Business Development',
    roleActivation: 'active',
    researchQuery: 'Malawi business prospects',
    description: 'Find and qualify leads.',
    deliverableHints: ['qualified prospect'],
    ...overrides,
  };
}

test('sales capability resolves to the available sales runtime profile', () => {
  const result = resolveExecutionRoute(route());
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.agent, 'outreach');
  assert.equal(result.department, 'Sales & Business Development');
});

test('customer relations resolves to the available follow-up runtime profile', () => {
  const result = resolveExecutionRoute(route({
    capabilityId: 'customer_relations',
    department: 'Customer Relations & Support',
    role: 'Head of Customer Relations & Support',
  }));
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.agent, 'followup');
});

test('planned marketing role maps to its own runtime profile, never sales', () => {
  const result = resolveExecutionRoute(route({
    capabilityId: 'marketing_strategy',
    department: 'Marketing & Brand Management',
    role: 'Director — Marketing & Brand Management',
    roleActivation: 'planned',
  }));
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.agent, 'marketing');
  assert.equal(result.organizationRoleStatus, 'planned');
});

test('all core capabilities map to the matching department profile', () => {
  const cases = [
    ['web_research', 'Central Research & Intelligence', 'research'],
    ['marketing_strategy', 'Marketing & Brand Management', 'marketing'],
    ['media_content', 'Media & Content Production', 'content'],
    ['finance', 'Finance & Accounting', 'finance'],
    ['payments', 'Fintech Ventures / Tambala Pay', 'payments'],
    ['technology_engineering', 'Technology & Engineering', 'engineering'],
  ] as const;
  for (const [capabilityId, department, expectedAgent] of cases) {
    const result = resolveExecutionRoute(route({
      capabilityId,
      department,
      role: 'Planned department director',
      roleActivation: 'planned',
    }));
    assert.equal(result.status, 'ready', `${capabilityId} should map to an execution profile`);
    if (result.status === 'ready') assert.equal(result.agent, expectedAgent);
  }
});

test('unknown objectives require ownership clarification', () => {
  const result = resolveExecutionRoute(undefined);
  assert.equal(result.status, 'not_activated');
  if (result.status !== 'not_activated') return;
  assert.equal(result.capabilityId, null);
  assert.match(result.reason, /clarify ownership/i);
});

test('configured agent runtime is required before execution', async () => {
  const { requireConfiguredRuntime } = await import('../src/organization/execution-router.js');
  const readyRoute = resolveExecutionRoute(route());
  assert.equal(readyRoute.status, 'ready');
  if (readyRoute.status !== 'ready') return;

  const blocked = requireConfiguredRuntime(readyRoute, {
    ready: false,
    apiKeyConfigured: false,
    apiKeyEnv: 'TAMBALA_OUTREACH_API_KEY',
    baseURL: null,
    model: null,
  });
  assert.equal(blocked.status, 'needs_configuration');
  if (blocked.status !== 'needs_configuration') return;
  assert.match(blocked.reason, /TAMBALA_OUTREACH_API_KEY/);
  assert.match(blocked.reason, /TAMBALA_OUTREACH_BASE_URL/);
  assert.match(blocked.reason, /TAMBALA_OUTREACH_MODEL/);
});

test('ready agent runtime preserves the routed executor', async () => {
  const { requireConfiguredRuntime } = await import('../src/organization/execution-router.js');
  const readyRoute = resolveExecutionRoute(route());
  assert.equal(readyRoute.status, 'ready');
  if (readyRoute.status !== 'ready') return;
  const configured = requireConfiguredRuntime(readyRoute, {
    ready: true,
    apiKeyConfigured: true,
    apiKeyEnv: 'TAMBALA_OUTREACH_API_KEY',
    baseURL: 'https://api.example/v1',
    model: 'example-model',
  });
  assert.equal(configured.status, 'ready');
  if (configured.status !== 'ready') return;
  assert.equal(configured.agent, 'outreach');
});

test('missing department in the organization snapshot blocks execution', () => {
  const result = resolveExecutionRoute(route({ department: null }));
  assert.equal(result.status, 'not_activated');
  if (result.status !== 'not_activated') return;
  assert.match(result.reason, /missing from the loaded organization snapshot/i);
});
