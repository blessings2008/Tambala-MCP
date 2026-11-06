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

test('every declared department capability has its own dedicated runtime mapping', async () => {
  const { DEPARTMENT_CAPABILITIES } = await import('../src/organization/capability-registry.js');
  const expectedExecutors: Record<string, string> = {
    sales_prospecting: 'outreach',
    web_research: 'research',
    customer_relations: 'followup',
    marketing_strategy: 'marketing',
    media_content: 'content',
    finance: 'finance',
    payments: 'payments',
    technology_engineering: 'engineering',
    strategy_planning: 'strategy',
    product_management: 'product',
    security_it: 'security',
    operations_administration: 'operations',
    people_agent_management: 'people',
    legal_risk_compliance: 'legal',
    procurement_resources: 'procurement',
    executive_management: 'executive',
    research_development: 'rnd',
    governance_oversight: 'governance',
  };

  const declared = DEPARTMENT_CAPABILITIES.map((capability) => capability.id);
  assert.deepEqual(
    declared.slice().sort(),
    Object.keys(expectedExecutors).sort(),
    'Every declared capability must have an explicit executor classification.',
  );

  for (const [capabilityId, expectedAgent] of Object.entries(expectedExecutors)) {
    const result = resolveExecutionRoute(route({ capabilityId }));
    assert.equal(result.status, 'ready', `Expected a dedicated route for ${capabilityId}.`);
    if (result.status === 'ready') {
      assert.equal(result.agent, expectedAgent, `${capabilityId} must not route to an unrelated agent.`);
    }
  }
});

test('every routed agent has a directory entry, prompt rules and bounded runtime limits', async () => {
  const { AGENT_DIRECTORY, AGENT_DEFAULT_MODELS } = await import('../src/services/ai/models.js');
  const { AGENT_PROMPT_RULES } = await import('../src/services/ai/rules.js');
  const { getAgentLimitInfo } = await import('../src/services/ai/limits.js');
  const expectedAgents = [
    'orchestrator', 'outreach', 'followup', 'research', 'marketing', 'content',
    'finance', 'payments', 'engineering', 'strategy', 'product', 'security',
    'operations', 'people', 'legal', 'procurement', 'executive', 'rnd', 'governance',
  ].sort();

  assert.deepEqual(Object.keys(AGENT_DIRECTORY).sort(), expectedAgents);
  assert.deepEqual(Object.keys(AGENT_DEFAULT_MODELS).sort(), expectedAgents);
  assert.deepEqual(Object.keys(AGENT_PROMPT_RULES).sort(), expectedAgents);

  for (const agent of expectedAgents as Array<keyof typeof AGENT_DIRECTORY>) {
    const limits = getAgentLimitInfo(agent);
    assert.ok(limits.requestsPerMinute > 0, `${agent} must have a positive request limit.`);
    assert.ok(limits.concurrency > 0, `${agent} must have a positive concurrency limit.`);
    assert.equal(AGENT_DIRECTORY[agent].roleStatus, 'planned', `${agent} must not be auto-activated by adding a runtime profile.`);
  }
});
test('missing department and unknown capability never fall back to an unrelated agent', () => {
  const unknown = resolveExecutionRoute(route({ capabilityId: 'procurement' }));
  assert.equal(unknown.status, 'not_activated');
  if (unknown.status === 'not_activated') assert.equal(unknown.agent, null);
});
