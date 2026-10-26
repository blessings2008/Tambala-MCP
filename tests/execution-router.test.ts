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

test('sales capability resolves to the activated sales agent', () => {
  const result = resolveExecutionRoute(route());
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.agent, 'outreach');
  assert.equal(result.department, 'Sales & Business Development');
});

test('customer relations resolves to the activated follow-up agent', () => {
  const result = resolveExecutionRoute(route({
    capabilityId: 'customer_relations',
    department: 'Customer Relations & Support',
    role: 'Head of Customer Relations & Support',
  }));
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.agent, 'followup');
});

test('planned departments are not silently routed to sales', () => {
  const result = resolveExecutionRoute(route({
    capabilityId: 'marketing_content',
    department: 'Marketing & Content',
    role: 'Marketing Manager',
    roleActivation: 'planned',
  }));
  assert.equal(result.status, 'not_activated');
  if (result.status !== 'not_activated') return;
  assert.equal(result.agent, null);
  assert.match(result.reason, /planned|no activated execution agent/i);
});

test('unknown objectives require ownership clarification', () => {
  const result = resolveExecutionRoute(undefined);
  assert.equal(result.status, 'not_activated');
  if (result.status !== 'not_activated') return;
  assert.equal(result.capabilityId, null);
  assert.match(result.reason, /clarify ownership/i);
});
