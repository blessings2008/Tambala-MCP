import type { OrganizationDefinition, OrganizationalRole, OrganizationUnit } from './model.js';

export interface DepartmentCapability {
  id: string;
  /** Exact owning unit. Preferred over tag matching so shared tags can never reroute a capability. */
  unitId?: string;
  unitTags: string[];
  roleTags: string[];
  description: string;
  objectiveKeywords: string[];
  researchKeywords: string[];
  deliverableHints: string[];
}

export interface CapabilityMatch {
  capability: DepartmentCapability;
  unit: OrganizationUnit | null;
  role: OrganizationalRole | null;
  score: number;
  keywordScore: number;
  researchQuery: string;
}

/**
 * Deterministic routing metadata for the organization.
 *
 * The CEO/LLM may choose among these results, but it must not invent a
 * department's responsibility. Research queries are deliberately short:
 * they are keywords for the research tool, not a copy of the Founder prompt.
 */
export const DEPARTMENT_CAPABILITIES: DepartmentCapability[] = [
  {
    id: 'sales_prospecting',
    unitId: 'sales-business-development',
    unitTags: ['sales', 'business-development', 'outreach'],
    roleTags: ['sales', 'business development', 'outreach'],
    description: 'Find, qualify, prioritize and pursue new business opportunities.',
    objectiveKeywords: ['client', 'customer', 'prospect', 'prospects', 'lead', 'leads', 'sales', 'outreach', 'business development', 'deal', 'hotel', 'hotels', 'lodge', 'lodges', 'tourism', 'website', 'websites', 'businesses', 'target businesses', 'pitch'],
    researchKeywords: ['prospective client', 'business lead', 'decision maker', 'company contact'],
    deliverableHints: ['qualified prospect', 'lead shortlist', 'outreach target'],
  },
  {
    id: 'web_research',
    unitId: 'research-intelligence',
    unitTags: ['research', 'intelligence'],
    roleTags: ['research', 'intelligence'],
    description: 'Conduct independent web research and return verified evidence.',
    objectiveKeywords: ['research', 'investigate', 'find information', 'verify', 'market', 'competitor', 'source', 'evidence'],
    researchKeywords: ['research topic', 'official sources', 'recent information', 'verified evidence'],
    deliverableHints: ['research brief', 'source list', 'evidence summary'],
  },
  {
    id: 'customer_relations',
    unitId: 'customer-relations',
    unitTags: ['customer-relations', 'support', 'client-success'],
    roleTags: ['customer relations', 'support', 'client success'],
    description: 'Manage existing client relationships, support and follow-up.',
    objectiveKeywords: ['client', 'customer', 'support', 'complaint', 'follow-up', 'retention', 'relationship', 'feedback'],
    researchKeywords: ['client relationship', 'customer support', 'follow-up'],
    deliverableHints: ['client response', 'follow-up plan', 'support resolution'],
  },
  {
    id: 'marketing_strategy',
    unitId: 'marketing-brand',
    unitTags: ['marketing', 'brand'],
    roleTags: ['marketing', 'brand', 'campaign', 'audience'],
    description: 'Own brand positioning, campaign strategy, audience development and marketing performance.',
    objectiveKeywords: ['marketing strategy', 'marketing', 'brand', 'audience', 'positioning', 'marketing performance', 'campaign strategy'],
    researchKeywords: ['Malawi market', 'target audience', 'brand positioning', 'campaign performance'],
    deliverableHints: ['marketing strategy', 'brand positioning', 'campaign plan', 'audience plan'],
  },
  {
    id: 'media_content',
    unitId: 'media-content',
    unitTags: ['media-content', 'content', 'communications'],
    roleTags: ['media', 'content', 'production', 'social media'],
    description: 'Produce content drafts, social posts, scripts, creative briefs and media production plans.',
    objectiveKeywords: ['content', 'post', 'social media', 'caption', 'video', 'script', 'creative', 'production', 'publish'],
    researchKeywords: ['content trends', 'audience interests', 'social media formats', 'creative references'],
    deliverableHints: ['content pack', 'social post', 'video script', 'creative brief'],
  },
  {
    id: 'finance',
    unitId: 'finance-accounting',
    unitTags: ['finance', 'accounts', 'financial-management'],
    roleTags: ['finance', 'accounts', 'financial'],
    description: 'Manage internal financial records, reporting and controls.',
    objectiveKeywords: ['finance', 'revenue', 'expense', 'budget', 'financial', 'account', 'reporting', 'reconcile'],
    researchKeywords: ['financial analysis', 'revenue report', 'expense review'],
    deliverableHints: ['financial report', 'reconciliation', 'budget summary'],
  },
  {
    id: 'payments',
    unitId: 'fintech-ventures',
    unitTags: ['tambala-pay', 'fintech', 'payments'],
    roleTags: ['payments', 'finance', 'financial operations', 'financial technology', 'fintech'],
    description: 'Operate Tambala Pay and payment collection workflows for the organization.',
    objectiveKeywords: ['payment', 'invoice', 'receipt', 'partial payment', 'balance', 'refund', 'transaction', 'Tambala Pay'],
    researchKeywords: ['payment provider', 'payment integration', 'transaction reconciliation'],
    deliverableHints: ['invoice', 'receipt', 'payment status', 'reconciliation'],
  },
  {
    id: 'technology_engineering',
    unitId: 'technology-engineering',
    unitTags: ['engineering', 'software', 'ai-automation'],
    roleTags: ['technology', 'engineering', 'developer', 'ai', 'automation'],
    description: 'Build and maintain software, infrastructure, AI systems and automation.',
    objectiveKeywords: ['build', 'code', 'software', 'bug', 'server', 'database', 'API', 'automation', 'AI', 'MCP', 'deploy'],
    researchKeywords: ['technical research', 'API documentation', 'software architecture', 'implementation'],
    deliverableHints: ['implementation', 'technical plan', 'bug fix', 'deployment'],
  },
  {
    id: 'strategy_planning',
    unitId: 'strategy-planning',
    unitTags: ['strategy', 'planning'],
    roleTags: ['strategy', 'planning'],
    description: 'Turn approved organizational direction into priorities, plans, objectives, and measurable outcomes.',
    objectiveKeywords: ['strategy', 'strategic plan', 'objective', 'roadmap', 'priority', 'quarterly plan', 'business plan', 'growth plan'],
    researchKeywords: ['strategic options', 'organizational objectives', 'implementation roadmap'],
    deliverableHints: ['strategic roadmap', 'operating plan', 'measurable objectives'],
  },
  {
    id: 'product_management',
    unitId: 'product-innovation',
    unitTags: ['product', 'innovation'],
    roleTags: ['product', 'innovation'],
    description: 'Shape product requirements, validate user needs, prioritize features, and coordinate product delivery.',
    objectiveKeywords: ['product', 'feature', 'user needs', 'requirements', 'MVP', 'product roadmap', 'customer discovery', 'prototype'],
    researchKeywords: ['user needs', 'product alternatives', 'feature validation'],
    deliverableHints: ['product brief', 'requirements document', 'prioritized backlog'],
  },
  {
    id: 'security_it',
    unitId: 'cybersecurity-it',
    unitTags: ['security', 'it'],
    roleTags: ['cybersecurity', 'security', 'IT'],
    description: 'Assess security risks, access controls, reliability, incidents, and infrastructure operations.',
    objectiveKeywords: ['security', 'vulnerability', 'incident', 'access control', 'backup', 'uptime', 'reliability', 'privacy'],
    researchKeywords: ['security best practices', 'risk assessment', 'incident response'],
    deliverableHints: ['security review', 'risk register', 'recovery plan'],
  },
  {
    id: 'operations_administration',
    unitId: 'operations-administration',
    unitTags: ['operations', 'administration'],
    roleTags: ['operations', 'administration'],
    description: 'Improve internal processes, records, coordination, procedures, and operational efficiency.',
    objectiveKeywords: ['operations', 'procedure', 'SOP', 'workflow', 'administration', 'process improvement', 'internal records', 'schedule'],
    researchKeywords: ['operating procedure', 'workflow improvement', 'process controls'],
    deliverableHints: ['standard operating procedure', 'workflow map', 'operations checklist'],
  },
  {
    id: 'people_agent_management',
    unitId: 'people-agent-management',
    unitTags: ['people', 'agent-management', 'roles'],
    roleTags: ['human resources', 'agent management', 'director'],
    description: 'Define responsibilities, staffing or agent needs, role activation, evaluation, and development.',
    objectiveKeywords: ['human resources', 'HR', 'agent performance', 'role assignment', 'staffing', 'onboarding', 'performance review', 'agent lifecycle'],
    researchKeywords: ['role requirements', 'performance criteria', 'agent evaluation'],
    deliverableHints: ['role description', 'performance rubric', 'onboarding plan'],
  },
  {
    id: 'legal_risk_compliance',
    unitId: 'legal-risk-compliance',
    unitTags: ['legal', 'compliance'],
    roleTags: ['legal', 'risk', 'compliance'],
    description: 'Identify legal, policy, regulatory, and operational risks and recommend controls.',
    objectiveKeywords: ['legal', 'compliance', 'regulation', 'regulatory', 'risk assessment', 'policy review', 'contract risk', 'data protection'],
    researchKeywords: ['applicable requirements', 'official regulations', 'risk controls'],
    deliverableHints: ['risk assessment', 'compliance checklist', 'policy review'],
  },
  {
    id: 'procurement_resources',
    unitId: 'procurement-resources',
    unitTags: ['procurement', 'resources'],
    roleTags: ['procurement', 'resource management'],
    description: 'Compare suppliers, document requirements, and plan approved resource acquisition.',
    objectiveKeywords: ['procurement', 'supplier', 'vendor', 'quote', 'purchase', 'equipment', 'resource allocation', 'supplier comparison'],
    researchKeywords: ['supplier options', 'price comparison', 'procurement requirements'],
    deliverableHints: ['supplier shortlist', 'procurement brief', 'resource plan'],
  },
  {
    id: 'executive_management',
    unitId: 'executive-management',
    unitTags: ['executive', 'coordination'],
    roleTags: ['executive management'],
    description: 'Coordinate organizational operating rhythms, cross-department execution, performance reviews, and executive reporting.',
    objectiveKeywords: ['executive management', 'operating rhythm', 'department coordination', 'management review', 'executive report', 'performance review', 'operational status'],
    researchKeywords: ['operating model', 'management practices', 'performance measures', 'cross-functional coordination'],
    deliverableHints: ['executive status report', 'management review', 'department coordination plan'],
  },
  {
    id: 'research_development',
    unitId: 'research-development',
    unitTags: ['technical-research', 'r-and-d'],
    roleTags: ['research & development'],
    description: 'Investigate technical concepts, test feasibility, and validate prototypes through controlled experiments.',
    objectiveKeywords: ['research and development', 'R&D', 'technical experiment', 'proof of concept', 'feasibility study', 'prototype validation', 'technical concept'],
    researchKeywords: ['technical feasibility', 'prototype methods', 'technical experiments', 'implementation constraints'],
    deliverableHints: ['feasibility report', 'experiment plan', 'prototype evaluation'],
  },
  {
    id: 'governance_oversight',
    unitId: 'board-governance',
    unitTags: ['board', 'governance'],
    roleTags: ['governance', 'board'],
    description: 'Prepare governance records, decision briefs, approval requests, and oversight materials.',
    objectiveKeywords: ['board', 'governance', 'approval request', 'decision record', 'audit', 'oversight', 'reserved matter', 'policy'],
    researchKeywords: ['governance standards', 'decision evidence', 'oversight checklist'],
    deliverableHints: ['decision brief', 'approval record', 'governance report'],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function countMatches(text: string, keywords: string[]): number {
  // Match complete normalized words/phrases. Substring matching makes short
  // terms such as "IT" fire inside unrelated words such as "website".
  const normalized = ` ${normalize(text)} `;
  return keywords.reduce((score, keyword) => {
    const normalizedKeyword = normalize(keyword);
    if (!normalizedKeyword) return score;
    return score + (normalized.includes(` ${normalizedKeyword} `) ? 1 : 0);
  }, 0);
}

function findUnit(definition: OrganizationDefinition, tags: string[], unitId?: string): OrganizationUnit | null {
  const exact = unitId ? definition.units.find((unit) => unit.id === unitId) : undefined;
  if (exact) return exact;
  const matches = definition.units.filter((unit) =>
    tags.some((tag) => unit.tags.map(normalize).includes(normalize(tag)))
  );
  const priority: Record<OrganizationUnit['kind'], number> = {
    department: 0,
    business_unit: 1,
    division: 2,
  };
  return matches.sort((a, b) => priority[a.kind] - priority[b.kind])[0] ?? null;
}

function findRole(definition: OrganizationDefinition, tags: string[], unitId: string | null): OrganizationalRole | null {
  return definition.roles.find((role) =>
    (unitId === null || role.unitId === unitId) &&
    tags.some((tag) => normalize(role.title).includes(normalize(tag)))
  ) ?? null;
}

export function routeObjective(definition: OrganizationDefinition, objective: string): CapabilityMatch[] {
  return DEPARTMENT_CAPABILITIES
    .map((capability) => {
      const keywordScore = countMatches(objective, [
        ...capability.objectiveKeywords,
        ...capability.deliverableHints,
      ]);
      const unit = findUnit(definition, capability.unitTags, capability.unitId);
      const role = findRole(definition, capability.roleTags, unit?.id ?? null);
      const score = keywordScore + (unit ? 1 : 0) + (role ? 1 : 0);
      return {
        capability,
        unit,
        role,
        score,
        keywordScore,
        researchQuery: capability.researchKeywords.slice(0, 4).join(', '),
      };
    })
    .filter((match) => match.keywordScore > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Build a compact research query from the matched capability only.
 * Never pass the Founder/CEO prompt through as the search query.
 */
export function buildResearchQuery(_objective: string, match: CapabilityMatch): string {
  const terms = match.capability.researchKeywords
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6);

  // Keep tool input comfortably below provider/request limits even if capability metadata changes.
  return terms.join(', ').slice(0, 500);
}
