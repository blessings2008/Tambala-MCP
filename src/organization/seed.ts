import type { OrganizationDefinition, OrganizationalRole, OrganizationUnit } from './model.js';

const roles: OrganizationalRole[] = [
  {
    id: 'founder',
    title: 'Founder & Owner',
    kind: 'human',
    unitId: null,
    reportsToRoleId: null,
    purpose: 'Set ultimate direction, retain reserved powers, and approve matters assigned to the Founder.',
    capabilities: [
      'organization.view_all', 'governance.decide_reserved', 'approvals.resolve_founder',
      'ventures.launch', 'finance.commit_material', 'organization.mission.change',
      'business_unit.close', 'communications.send_sensitive', 'finance.transaction.execute',
    ],
    activation: 'active',
  },
  {
    id: 'board',
    title: 'Board of Directors',
    kind: 'shared_responsibility',
    unitId: 'executive-governance',
    reportsToRoleId: 'founder',
    purpose: 'Provide strategic oversight, review risk and performance, and decide matters assigned to the Board.',
    capabilities: ['governance.review', 'strategy.review', 'approvals.resolve_board'],
    activation: 'planned',
  },
  {
    id: 'ceo',
    title: 'Chief Executive Officer',
    kind: 'ai_agent',
    unitId: 'executive-governance',
    reportsToRoleId: 'board',
    purpose: 'Coordinate day-to-day operations and pursue approved organizational objectives within delegated authority.',
    capabilities: [
      'organization.view_operational', 'work.coordinate', 'work.delegate', 'reports.create',
      'ventures.launch', 'finance.commit_material', 'organization.mission.change',
      'business_unit.close', 'communications.send_sensitive', 'finance.transaction.execute',
    ],
    activation: 'planned',
  },
  {
    id: 'executive-council',
    title: 'Executive Council',
    kind: 'shared_responsibility',
    unitId: 'executive-governance',
    reportsToRoleId: 'ceo',
    purpose: 'Provide specialist analysis, challenge assumptions, and review important decisions when consulted.',
    capabilities: ['decisions.advise', 'risk.review', 'strategy.analyze'],
    activation: 'planned',
  },
];

const units: OrganizationUnit[] = [
  {
    id: 'executive-governance', name: 'Executive & Governance', kind: 'division', parentId: null,
    purpose: 'Corporate governance, executive coordination, and strategic planning.', status: 'planned',
    accountableRoleIds: ['board', 'ceo', 'director-executive-governance'], tags: ['governance', 'executive', 'strategy'],
  },
  {
    id: 'technology-innovation', name: 'Technology & Innovation', kind: 'division', parentId: null,
    purpose: 'Engineering, AI, automation, product development, research and technical security.', status: 'planned',
    accountableRoleIds: ['director-technology-innovation'], tags: ['technology', 'engineering', 'innovation'],
  },
  {
    id: 'commercial-growth', name: 'Commercial & Growth', kind: 'division', parentId: null,
    purpose: 'Marketing, sales, business development, media production, and customer relationships.', status: 'planned',
    accountableRoleIds: ['director-commercial-growth'], tags: ['commercial', 'growth', 'customers'],
  },
  {
    id: 'corporate-services', name: 'Corporate Services', kind: 'division', parentId: null,
    purpose: 'Finance, operations, people and agent management, legal risk, compliance, and procurement.', status: 'planned',
    accountableRoleIds: ['director-corporate-services'], tags: ['finance', 'operations', 'risk', 'administration'],
  },

  // Executive & Governance departments
  {
    id: 'board-governance', name: 'Board & Corporate Governance', kind: 'department', parentId: 'executive-governance',
    purpose: 'Governance records, Board processes, oversight, and policy stewardship.', status: 'planned',
    accountableRoleIds: ['director-board-governance'], tags: ['board', 'governance'],
  },
  {
    id: 'executive-management', name: 'Executive Management', kind: 'department', parentId: 'executive-governance',
    purpose: 'Executive coordination, organization-wide operating rhythm, and performance reviews.', status: 'planned',
    accountableRoleIds: ['director-executive-management'], tags: ['executive', 'coordination'],
  },
  {
    id: 'strategy-planning', name: 'Strategy & Corporate Planning', kind: 'department', parentId: 'executive-governance',
    purpose: 'Translate approved direction into strategies, plans, priorities, and measurable objectives.', status: 'planned',
    accountableRoleIds: ['director-strategy-planning'], tags: ['strategy', 'planning'],
  },

  // Technology & Innovation departments
  {
    id: 'technology-engineering', name: 'Technology & Engineering', kind: 'department', parentId: 'technology-innovation',
    purpose: 'Design, build, maintain, and improve the organization’s software and technical infrastructure.', status: 'planned',
    accountableRoleIds: ['director-technology-engineering'], tags: ['engineering', 'software'],
  },
  {
    id: 'ai-automation', name: 'AI & Automation', kind: 'department', parentId: 'technology-innovation',
    purpose: 'Build agent workflows, automation, model routing, and orchestration capabilities.', status: 'planned',
    accountableRoleIds: ['director-ai-automation'], tags: ['ai', 'automation', 'agents'],
  },
  {
    id: 'product-innovation', name: 'Product Management & Innovation', kind: 'department', parentId: 'technology-innovation',
    purpose: 'Discover user needs, shape product strategy, and coordinate product delivery.', status: 'planned',
    accountableRoleIds: ['director-product-innovation'], tags: ['product', 'innovation'],
  },
  {
    id: 'research-development', name: 'Research & Development', kind: 'department', parentId: 'technology-innovation',
    purpose: 'Explore and validate technical concepts, prototypes, and emerging capabilities.', status: 'planned',
    accountableRoleIds: ['director-research-development'], tags: ['technical-research', 'r-and-d'],
  },
  {
    id: 'cybersecurity-it', name: 'Cybersecurity & IT', kind: 'department', parentId: 'technology-innovation',
    purpose: 'Protect systems, manage access, monitor security, and maintain reliable IT operations.', status: 'planned',
    accountableRoleIds: ['director-cybersecurity-it'], tags: ['security', 'it', 'risk'],
  },

  // Commercial & Growth departments
  {
    id: 'marketing-brand', name: 'Marketing & Brand Management', kind: 'department', parentId: 'commercial-growth',
    purpose: 'Manage brand positioning, campaigns, audience development, and marketing performance.', status: 'planned',
    accountableRoleIds: ['director-marketing-brand'], tags: ['marketing', 'brand'],
  },
  {
    id: 'sales-business-development', name: 'Sales & Business Development', kind: 'department', parentId: 'commercial-growth',
    purpose: 'Generate opportunities, qualify prospects, manage partnerships, and grow revenue.', status: 'planned',
    accountableRoleIds: ['director-sales-business-development'], tags: ['sales', 'business-development'],
  },
  {
    id: 'media-content', name: 'Media & Content Production', kind: 'department', parentId: 'commercial-growth',
    purpose: 'Research, plan, produce, publish, and evaluate content and media assets.', status: 'planned',
    accountableRoleIds: ['director-media-content'], tags: ['media', 'content', 'publishing'],
  },
  {
    id: 'customer-relations', name: 'Customer Relations & Support', kind: 'department', parentId: 'commercial-growth',
    purpose: 'Manage customer communications, service quality, support workflows, and feedback.', status: 'planned',
    accountableRoleIds: ['director-customer-relations'], tags: ['customer', 'support'],
  },

  // Corporate Services departments
  {
    id: 'finance-accounting', name: 'Finance & Accounting', kind: 'department', parentId: 'corporate-services',
    purpose: 'Maintain budgets, cost records, financial reporting, and internal financial controls.', status: 'planned',
    accountableRoleIds: ['director-finance-accounting'], tags: ['finance', 'accounting', 'budget'],
  },
  {
    id: 'operations-administration', name: 'Operations & Administration', kind: 'department', parentId: 'corporate-services',
    purpose: 'Maintain operating procedures, coordination, records, and administrative services.', status: 'planned',
    accountableRoleIds: ['director-operations-administration'], tags: ['operations', 'administration'],
  },
  {
    id: 'people-agent-management', name: 'Human Resources & Agent Management', kind: 'department', parentId: 'corporate-services',
    purpose: 'Define role requirements, agent lifecycle, capability assignment proposals, and performance reviews.', status: 'planned',
    accountableRoleIds: ['director-people-agent-management'], tags: ['people', 'agents', 'roles'],
  },
  {
    id: 'legal-risk-compliance', name: 'Legal, Risk & Compliance', kind: 'department', parentId: 'corporate-services',
    purpose: 'Identify legal and operational risks, maintain compliance requirements, and escalate regulated activities.', status: 'planned',
    accountableRoleIds: ['director-legal-risk-compliance'], tags: ['legal', 'risk', 'compliance'],
  },
  {
    id: 'procurement-resources', name: 'Procurement & Resource Management', kind: 'department', parentId: 'corporate-services',
    purpose: 'Evaluate suppliers and manage approved resource allocation and procurement workflows.', status: 'planned',
    accountableRoleIds: ['director-procurement-resources'], tags: ['procurement', 'resources'],
  },

  // Central intelligence is independent of the Technology division and serves the whole organization.
  {
    id: 'research-intelligence', name: 'Central Research & Intelligence', kind: 'department', parentId: null,
    purpose: 'Provide cross-organizational research, evidence evaluation, market intelligence, technical investigation, and opportunity analysis.', status: 'planned',
    accountableRoleIds: ['director-research-intelligence'], tags: ['research', 'intelligence', 'evidence'],
  },

  // Business units are operating ventures, not corporate departments.
  {
    id: 'fintech-ventures', name: 'Financial Technology', kind: 'business_unit', parentId: null,
    purpose: 'Operate financial technology products and ventures, subject to applicable risk and compliance controls.', status: 'planned',
    accountableRoleIds: ['leader-fintech-ventures'], tags: ['business-unit', 'fintech', 'pocketvault', 'tambala-pay'],
  },
  {
    id: 'software-digital-services', name: 'Software & Digital Services', kind: 'business_unit', parentId: null,
    purpose: 'Deliver software products, websites, automation, and digital services.', status: 'planned',
    accountableRoleIds: ['leader-software-digital-services'], tags: ['business-unit', 'software', 'digital-services'],
  },
  {
    id: 'media-publishing', name: 'Media & Publishing', kind: 'business_unit', parentId: null,
    purpose: 'Develop and operate content channels, publishing brands, and media products.', status: 'planned',
    accountableRoleIds: ['leader-media-publishing'], tags: ['business-unit', 'media', 'publishing'],
  },
];

function director(
  id: string,
  title: string,
  unitId: string,
  reportsToRoleId: string,
  purpose: string,
): OrganizationalRole {
  return {
    id,
    title,
    kind: 'ai_agent',
    unitId,
    reportsToRoleId,
    purpose,
    capabilities: ['organization.view_operational', 'work.coordinate', 'work.delegate', 'reports.create', 'department.workflow.manage'],
    activation: 'planned',
  };
}

roles.push(
  director('director-executive-governance', 'Director — Executive & Governance', 'executive-governance', 'ceo', 'Coordinate governance and executive management functions.'),
  director('director-technology-innovation', 'Director — Technology & Innovation', 'technology-innovation', 'ceo', 'Coordinate technical delivery, AI, product, research, and security functions.'),
  director('director-commercial-growth', 'Director — Commercial & Growth', 'commercial-growth', 'ceo', 'Coordinate marketing, sales, media, and customer functions.'),
  director('director-corporate-services', 'Director — Corporate Services', 'corporate-services', 'ceo', 'Coordinate finance, operations, people, compliance, and procurement functions.'),
  director('director-board-governance', 'Director — Board & Corporate Governance', 'board-governance', 'director-executive-governance', 'Maintain governance processes, records, and oversight support.'),
  director('director-executive-management', 'Director — Executive Management', 'executive-management', 'director-executive-governance', 'Coordinate executive operating rhythm and performance reporting.'),
  director('director-strategy-planning', 'Director — Strategy & Corporate Planning', 'strategy-planning', 'director-executive-governance', 'Translate approved direction into plans and measurable objectives.'),
  director('director-technology-engineering', 'Director — Technology & Engineering', 'technology-engineering', 'director-technology-innovation', 'Lead software and infrastructure engineering delivery.'),
  director('director-ai-automation', 'Director — AI & Automation', 'ai-automation', 'director-technology-innovation', 'Lead agent orchestration and automation capabilities.'),
  director('director-product-innovation', 'Director — Product Management & Innovation', 'product-innovation', 'director-technology-innovation', 'Lead product discovery and delivery planning.'),
  director('director-research-development', 'Director — Research & Development', 'research-development', 'director-technology-innovation', 'Lead technical experiments and prototype validation.'),
  director('director-cybersecurity-it', 'Director — Cybersecurity & IT', 'cybersecurity-it', 'director-technology-innovation', 'Lead security and IT reliability work.'),
  director('director-marketing-brand', 'Director — Marketing & Brand Management', 'marketing-brand', 'director-commercial-growth', 'Lead brand, campaign, and audience growth work.'),
  director('director-sales-business-development', 'Director — Sales & Business Development', 'sales-business-development', 'director-commercial-growth', 'Lead prospecting, partnerships, and revenue development.'),
  director('director-media-content', 'Director — Media & Content Production', 'media-content', 'director-commercial-growth', 'Lead content planning, production, and publishing operations.'),
  director('director-customer-relations', 'Director — Customer Relations & Support', 'customer-relations', 'director-commercial-growth', 'Lead customer communication and support workflows.'),
  director('director-finance-accounting', 'Director — Finance & Accounting', 'finance-accounting', 'director-corporate-services', 'Lead budgeting, accounting, and financial reporting.'),
  director('director-operations-administration', 'Director — Operations & Administration', 'operations-administration', 'director-corporate-services', 'Lead administrative operations and process management.'),
  director('director-people-agent-management', 'Director — Human Resources & Agent Management', 'people-agent-management', 'director-corporate-services', 'Lead role design, agent lifecycle, and performance processes.'),
  director('director-legal-risk-compliance', 'Director — Legal, Risk & Compliance', 'legal-risk-compliance', 'director-corporate-services', 'Lead risk identification and compliance coordination.'),
  director('director-procurement-resources', 'Director — Procurement & Resource Management', 'procurement-resources', 'director-corporate-services', 'Lead supplier evaluation and resource allocation workflows.'),
  director('director-research-intelligence', 'Director — Central Research & Intelligence', 'research-intelligence', 'ceo', 'Coordinate independent research and intelligence for the whole organization.'),
  director('leader-fintech-ventures', 'Business Unit Lead — Financial Technology', 'fintech-ventures', 'ceo', 'Coordinate approved fintech products and operating plans.'),
  director('leader-software-digital-services', 'Business Unit Lead — Software & Digital Services', 'software-digital-services', 'ceo', 'Coordinate software products and client service operations.'),
  director('leader-media-publishing', 'Business Unit Lead — Media & Publishing', 'media-publishing', 'ceo', 'Coordinate content channels and publishing ventures.'),
);

export const initialOrganization: OrganizationDefinition = {
  id: 'tambala-organization',
  name: 'Tambala Organization',
  mission: 'Build and operate sustainable businesses and useful products through coordinated human direction, AI capabilities, and responsible automation.',
  ownerRoleId: 'founder',
  ceoRoleId: 'ceo',
  boardRoleId: 'board',
  executiveCouncilRoleId: 'executive-council',
  units,
  roles,
};
