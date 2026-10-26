import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchQuery, routeObjective } from '../src/organization/capability-registry.js';
import type { OrganizationDefinition } from '../src/organization/model.js';

const definition: OrganizationDefinition = {
  id: 'test-org',
  name: 'Tambala Technologies',
  mission: 'Test',
  ownerRoleId: 'founder',
  ceoRoleId: 'ceo',
  boardRoleId: 'board',
  executiveCouncilRoleId: 'council',
  units: [
    { id: 'sales', name: 'Sales & Business Development', kind: 'department', parentId: null, purpose: 'Sales', status: 'active', accountableRoleIds: ['sales-head'], tags: ['sales', 'business-development', 'outreach'] },
    { id: 'research', name: 'Research & Intelligence', kind: 'department', parentId: null, purpose: 'Research', status: 'active', accountableRoleIds: ['research-head'], tags: ['research', 'intelligence'] },
    { id: 'finance', name: 'Finance', kind: 'department', parentId: null, purpose: 'Finance', status: 'active', accountableRoleIds: ['finance-head'], tags: ['finance', 'accounts'] },
    { id: 'payments', name: 'Payments', kind: 'department', parentId: null, purpose: 'Payments', status: 'active', accountableRoleIds: ['payments-head'], tags: ['payments', 'financial-operations'] },
  ],
  roles: [
    { id: 'sales-head', title: 'Head of Sales & Business Development', kind: 'ai_agent', unitId: 'sales', reportsToRoleId: 'ceo', purpose: 'Sales', capabilities: ['sales'], activation: 'active' },
    { id: 'research-head', title: 'Head of Research & Intelligence', kind: 'ai_agent', unitId: 'research', reportsToRoleId: 'ceo', purpose: 'Research', capabilities: ['research'], activation: 'active' },
    { id: 'finance-head', title: 'Head of Finance', kind: 'ai_agent', unitId: 'finance', reportsToRoleId: 'ceo', purpose: 'Finance', capabilities: ['finance'], activation: 'active' },
    { id: 'payments-head', title: 'Head of Payments', kind: 'ai_agent', unitId: 'payments', reportsToRoleId: 'ceo', purpose: 'Payments', capabilities: ['payments'], activation: 'active' },
  ],
};

test('routes client prospecting to sales', () => {
  const matches = routeObjective(definition, 'Find our next client');
  assert.equal(matches[0]?.capability.id, 'sales_prospecting');
  assert.equal(matches[0]?.unit?.id, 'sales');
});

test('research query stays short and keyword based', () => {
  const matches = routeObjective(definition, 'Research hotels in Malawi that need websites');
  const research = matches.find((match) => match.capability.id === 'web_research');
  assert.ok(research);
  const query = buildResearchQuery('Research hotels in Malawi that need websites', research);
  assert.ok(query.length < 250);
  assert.equal(query.includes('Research hotels in Malawi that need websites'), false);
});

test('routes payment objectives to payments capability', () => {
  const matches = routeObjective(definition, 'Create an invoice and collect a partial payment');
  assert.equal(matches[0]?.capability.id, 'payments');
});
