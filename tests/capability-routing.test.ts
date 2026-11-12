import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchQuery, routeObjective } from '../src/organization/capability-registry.js';
import type { OrganizationDefinition } from '../src/organization/model.js';
import { initialOrganization } from '../src/organization/seed.js';

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

test('routes inbox and support-ticket work to Customer Relations', () => {
  const objectives = [
    'Review the shared customer inbox and reply to unresolved conversations',
    'Create support tickets for customer complaints',
    'Resolve an open customer support issue',
  ];
  for (const objective of objectives) {
    const matches = routeObjective(initialOrganization, objective);
    assert.equal(matches[0]?.capability.id, 'customer_relations', objective);
    assert.equal(matches[0]?.unit?.id, 'customer-relations', objective);
  }
});

test('routes natural-language new potential client requests to Sales & Business Development', () => {
  const objectives = [
    'Identify new potential clients for Tambala Technologies',
    'Find potential customers we can approach for website and digital services',
    'Generate leads and build a qualified prospect list',
    'Research businesses that could become new clients',
  ];

  for (const objective of objectives) {
    const matches = routeObjective(initialOrganization, objective);
    assert.equal(matches[0]?.capability.id, 'sales_prospecting', objective);
    assert.equal(matches[0]?.unit?.id, 'sales-business-development', objective);
    assert.ok(matches[0]?.role, `Expected an accountable sales role for: ${objective}`);
  }
});

test('sales prospecting research defaults to Malawi and Tambala service fit', () => {
  const match = routeObjective(initialOrganization, 'Identify new potential clients for Tambala Technologies')
    .find((candidate) => candidate.capability.id === 'sales_prospecting');
  assert.ok(match);
  const query = buildResearchQuery('Identify new potential clients for Tambala Technologies', match);
  assert.match(query, /Malawi/i);
  assert.match(query, /website development/i);
  assert.match(query, /custom software/i);
  assert.match(query, /social media management/i);
});

test('prospecting intent remains routed when the wording is conversational', () => {
  const objectives = [
    'Can you find potential clients for us?',
    'Build a list of new customers we could approach',
    'I need a prospect list for Tambala',
    'Please identify new potential clients for Tambala Technologies!!!',
  ];
  for (const objective of objectives) {
    const matches = routeObjective(initialOrganization, objective);
    assert.equal(matches[0]?.capability.id, 'sales_prospecting', objective);
    assert.equal(matches[0]?.unit?.id, 'sales-business-development', objective);
  }
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


test('does not route unrelated objectives merely because departments exist', () => {
  assert.deepEqual(routeObjective(definition, 'Tell me a joke about the moon.'), []);
});

test('marketing strategy and media content route to separate capabilities', () => {
  const marketing = routeObjective(definition, 'Plan brand positioning and campaign strategy');
  assert.equal(marketing[0]?.capability.id, 'marketing_strategy');

  const content = routeObjective(definition, 'Write a social media caption and video script');
  assert.equal(content[0]?.capability.id, 'media_content');
});


test('routes objectives across strategy, product, security, and operations', () => {
  const cases = [
    ['strategy_planning', 'Prepare a strategic roadmap and measurable objectives'],
    ['product_management', 'Define product requirements and prioritize features for the MVP'],
    ['security_it', 'Review server security, access controls, and backup reliability'],
    ['operations_administration', 'Document the internal workflow and standard operating procedure'],
  ] as const;

  for (const [capabilityId, objective] of cases) {
    const matches = routeObjective(initialOrganization, objective);
    assert.equal(matches[0]?.capability.id, capabilityId, objective);
    assert.ok(matches[0]?.unit, `Expected a department for ${capabilityId}`);
  }
});

test('routes objectives across people, compliance, procurement, and governance', () => {
  const cases = [
    ['people_agent_management', 'Create an agent performance review and onboarding plan'],
    ['legal_risk_compliance', 'Conduct a regulatory compliance and data protection risk assessment'],
    ['procurement_resources', 'Compare suppliers and prepare a procurement shortlist'],
    ['governance_oversight', 'Prepare a board decision brief and approval record'],
  ] as const;

  for (const [capabilityId, objective] of cases) {
    const matches = routeObjective(initialOrganization, objective);
    assert.equal(matches[0]?.capability.id, capabilityId, objective);
    assert.ok(matches[0]?.unit, `Expected a department for ${capabilityId}`);
  }
});


test('routes executive management and research-development work to their own departments', () => {
  const cases = [
    ['executive_management', 'Coordinate the executive operating rhythm and cross-department management review'],
    ['research_development', 'Conduct a feasibility study and prototype validation for a technical concept'],
  ] as const;

  for (const [capabilityId, objective] of cases) {
    const matches = routeObjective(initialOrganization, objective);
    assert.equal(matches[0]?.capability.id, capabilityId, objective);
    assert.ok(matches[0]?.unit, `Expected a department for ${capabilityId}`);
    assert.ok(matches[0]?.role, `Expected an accountable role for ${capabilityId}`);
  }
});

test('every organization capability resolves to its intended department and accountable role', () => {
  const cases = [
    ['sales_prospecting', 'Find and qualify new business prospects for outreach'],
    ['web_research', 'Investigate a market and verify information with evidence'],
    ['customer_relations', 'Resolve a customer complaint and plan client follow-up'],
    ['marketing_strategy', 'Develop brand positioning and a marketing campaign strategy'],
    ['media_content', 'Produce social media content, captions and a video script'],
    ['finance', 'Prepare a revenue and expense budget reconciliation report'],
    ['payments', 'Create an invoice, issue a receipt and reconcile a payment transaction'],
    ['technology_engineering', 'Build an API and fix a software database bug'],
    ['strategy_planning', 'Prepare a strategic roadmap with measurable objectives'],
    ['product_management', 'Define product requirements and prioritize MVP features'],
    ['security_it', 'Review cybersecurity, access controls and backup reliability'],
    ['operations_administration', 'Improve the internal workflow and document an SOP'],
    ['people_agent_management', 'Prepare agent onboarding and a performance review'],
    ['legal_risk_compliance', 'Review regulatory compliance and data protection risks'],
    ['procurement_resources', 'Compare suppliers and prepare an equipment procurement plan'],
    ['executive_management', 'Prepare an executive management review and coordinate departments'],
    ['research_development', 'Run a technical feasibility study and validate a prototype'],
    ['governance_oversight', 'Prepare a board oversight report and approval decision record'],
  ] as const;

  assert.equal(cases.length, 18);
  for (const [capabilityId, objective] of cases) {
    const matches = routeObjective(initialOrganization, objective);
    const match = matches.find((candidate) => candidate.capability.id === capabilityId);
    assert.ok(match, `Expected ${objective} to match ${capabilityId}`);
    assert.ok(match.unit, `${capabilityId} must resolve to an organization unit`);
    assert.ok(match.role, `${capabilityId} must resolve to an accountable role`);
    assert.equal(match.role.unitId, match.unit.id, `${capabilityId} role must belong to its routed unit`);
    assert.ok(match.researchQuery.length > 0, `${capabilityId} must define a bounded research query`);
  }
});
