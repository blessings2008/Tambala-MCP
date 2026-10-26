import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchQuery, routeObjective } from '../src/organization/capability-registry.js';
import type { OrganizationDefinition } from '../src/organization/model.js';

const definition: OrganizationDefinition = {
  organization: {
    id: 'org-test',
    name: 'Tambala Technologies',
    mission: 'Build useful technology.',
    ownerRoleId: 'founder',
    boardRoleId: 'board',
    ceoRoleId: 'ceo',
    executiveCouncilRoleId: 'exec',
    units: [
      { id: 'sales', name: 'Sales & Business Development', kind: 'department', status: 'active', parentId: null, tags: ['sales', 'business-development', 'outreach'] },
      { id: 'research', name: 'Research & Intelligence', kind: 'department', status: 'active', parentId: null, tags: ['research', 'intelligence'] },
    ],
    roles: [
      { id: 'sales-head', title: 'Head of Sales & Business Development', kind: 'department_head', unitId: 'sales', reportsToRoleId: 'ceo', activation: 'active' },
      { id: 'research-head', title: 'Head of Research & Intelligence', kind: 'department_head', unitId: 'research', reportsToRoleId: 'ceo', activation: 'active' },
    ],
  },
  roles: [],
  units: [],
};

test('routes next-client objectives to sales and produces a short research query', () => {
  const objective = 'Find our next client and identify a qualified prospect we can contact.';
  const matches = routeObjective(definition, objective);
  assert.equal(matches[0]?.capability.id, 'sales_prospecting');
  const query = buildResearchQuery(objective, matches[0]!);
  assert.ok(query.length > 0);
  assert.ok(query.length < objective.length);
  assert.doesNotMatch(query, /Find our next client/i);
});

test('research query stays keyword-oriented for web research', () => {
  const objective = 'Research current hospitality prospects in Malawi and verify official contact information.';
  const matches = routeObjective(definition, objective);
  const research = matches.find((match) => match.capability.id === 'web_research');
  assert.ok(research);
  const query = buildResearchQuery(objective, research!);
  assert.match(query, /official sources|recent information|verified evidence/i);
  assert.ok(query.length <= 500);
});
