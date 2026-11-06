import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchQuery, routeObjective } from '../src/organization/capability-registry.js';
import type { OrganizationDefinition } from '../src/organization/model.js';

const definition: OrganizationDefinition = {
  id: 'org-test',
  name: 'Tambala Technologies',
  mission: 'Build useful technology.',
  ownerRoleId: 'founder',
  boardRoleId: 'board',
  ceoRoleId: 'ceo',
  executiveCouncilRoleId: 'exec',
  units: [
    { id: 'sales', name: 'Sales & Business Development', kind: 'department', purpose: 'Find business opportunities.', status: 'active', parentId: null, tags: ['sales', 'business-development', 'outreach'], accountableRoleIds: ['sales-head'] },
    { id: 'research', name: 'Research & Intelligence', kind: 'department', purpose: 'Verify information.', status: 'active', parentId: null, tags: ['research', 'intelligence'], accountableRoleIds: ['research-head'] },
  ],
  roles: [
    { id: 'sales-head', title: 'Head of Sales & Business Development', kind: 'ai_agent', unitId: 'sales', reportsToRoleId: 'ceo', purpose: 'Lead sales.', capabilities: ['sales'], activation: 'active' },
    { id: 'research-head', title: 'Head of Research & Intelligence', kind: 'ai_agent', unitId: 'research', reportsToRoleId: 'ceo', purpose: 'Lead research.', capabilities: ['research'], activation: 'active' },
  ],
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

test('every declared capability resolves to a real unit and an accountable role in the full organization', async () => {
  const { initialOrganization } = await import('../src/organization/seed.js');
  const { DEPARTMENT_CAPABILITIES } = await import('../src/organization/capability-registry.js');

  assert.equal(DEPARTMENT_CAPABILITIES.length, 18);

  for (const capability of DEPARTMENT_CAPABILITIES) {
    const objective = capability.objectiveKeywords.at(-1) ?? capability.description;
    const match = routeObjective(initialOrganization, objective)
      .find((candidate) => candidate.capability.id === capability.id);

    assert.ok(match, `Expected a match for ${capability.id}`);
    assert.ok(match.unit, `${capability.id} must resolve to a real organization unit`);
    assert.ok(match.role, `${capability.id} must resolve to an accountable role`);
    assert.equal(match.role.unitId, match.unit.id, `${capability.id} role must belong to its routed unit`);
    assert.ok(
      match.unit.accountableRoleIds.includes(match.role.id),
      `${capability.id} role must be listed as accountable by its unit`,
    );
  }
});
