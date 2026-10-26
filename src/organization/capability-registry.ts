import type { OrganizationDefinition, OrganizationalRole, OrganizationUnit } from './model.js';

export interface DepartmentCapability {
  id: string;
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
    unitTags: ['sales', 'business-development', 'outreach'],
    roleTags: ['sales', 'business development', 'outreach'],
    description: 'Find, qualify, prioritize and pursue new business opportunities.',
    objectiveKeywords: ['client', 'customer', 'prospect', 'lead', 'sales', 'outreach', 'business development', 'deal'],
    researchKeywords: ['prospective client', 'business lead', 'decision maker', 'company contact'],
    deliverableHints: ['qualified prospect', 'lead shortlist', 'outreach target'],
  },
  {
    id: 'web_research',
    unitTags: ['research', 'intelligence'],
    roleTags: ['research', 'intelligence'],
    description: 'Conduct independent web research and return verified evidence.',
    objectiveKeywords: ['research', 'investigate', 'find information', 'verify', 'market', 'competitor', 'source', 'evidence'],
    researchKeywords: ['research topic', 'official sources', 'recent information', 'verified evidence'],
    deliverableHints: ['research brief', 'source list', 'evidence summary'],
  },
  {
    id: 'customer_relations',
    unitTags: ['customer-relations', 'support', 'client-success'],
    roleTags: ['customer relations', 'support', 'client success'],
    description: 'Manage existing client relationships, support and follow-up.',
    objectiveKeywords: ['client', 'customer', 'support', 'complaint', 'follow-up', 'retention', 'relationship', 'feedback'],
    researchKeywords: ['client relationship', 'customer support', 'follow-up'],
    deliverableHints: ['client response', 'follow-up plan', 'support resolution'],
  },
  {
    id: 'marketing_content',
    unitTags: ['marketing', 'content', 'communications'],
    roleTags: ['marketing', 'content', 'communications', 'social media'],
    description: 'Create and distribute content, campaigns and brand communications.',
    objectiveKeywords: ['content', 'post', 'campaign', 'social media', 'marketing', 'brand', 'caption', 'video'],
    researchKeywords: ['content trends', 'audience', 'campaign ideas', 'social media'],
    deliverableHints: ['content plan', 'campaign', 'social post', 'creative brief'],
  },
  {
    id: 'finance',
    unitTags: ['finance', 'accounts', 'financial-management'],
    roleTags: ['finance', 'accounts', 'financial'],
    description: 'Manage internal financial records, reporting and controls.',
    objectiveKeywords: ['finance', 'revenue', 'expense', 'budget', 'financial', 'account', 'reporting', 'reconcile'],
    researchKeywords: ['financial analysis', 'revenue report', 'expense review'],
    deliverableHints: ['financial report', 'reconciliation', 'budget summary'],
  },
  {
    id: 'payments',
    unitTags: ['payments', 'finance', 'financial-operations'],
    roleTags: ['payments', 'finance', 'financial operations'],
    description: 'Operate Tambala Pay and payment collection workflows for the organization.',
    objectiveKeywords: ['payment', 'invoice', 'receipt', 'partial payment', 'balance', 'refund', 'transaction', 'Tambala Pay'],
    researchKeywords: ['payment provider', 'payment integration', 'transaction reconciliation'],
    deliverableHints: ['invoice', 'receipt', 'payment status', 'reconciliation'],
  },
  {
    id: 'technology_engineering',
    unitTags: ['technology', 'engineering', 'software', 'ai-automation'],
    roleTags: ['technology', 'engineering', 'developer', 'ai', 'automation'],
    description: 'Build and maintain software, infrastructure, AI systems and automation.',
    objectiveKeywords: ['build', 'code', 'software', 'bug', 'server', 'database', 'API', 'automation', 'AI', 'MCP', 'deploy'],
    researchKeywords: ['technical research', 'API documentation', 'software architecture', 'implementation'],
    deliverableHints: ['implementation', 'technical plan', 'bug fix', 'deployment'],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function countMatches(text: string, keywords: string[]): number {
  const normalized = normalize(text);
  return keywords.reduce((score, keyword) => score + (normalized.includes(normalize(keyword)) ? 1 : 0), 0);
}

function findUnit(definition: OrganizationDefinition, tags: string[]): OrganizationUnit | null {
  return definition.units.find((unit) => tags.some((tag) => unit.tags.map(normalize).includes(normalize(tag)))) ?? null;
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
      const score = keywordScore + (findUnit(definition, capability.unitTags) ? 1 : 0) + (findRole(definition, capability.roleTags, findUnit(definition, capability.unitTags)?.id ?? null) ? 1 : 0);
      const unit = findUnit(definition, capability.unitTags);
      const role = findRole(definition, capability.roleTags, unit?.id ?? null);
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

export function buildResearchQuery(objective: string, match: CapabilityMatch): string {
  const objectiveTerms = normalize(objective)
    .split(' ')
    .filter((term) => term.length >= 4)
    .filter((term) => !['find', 'next', 'that', 'with', 'from', 'into', 'this', 'our'].includes(term));

  const relevant = match.capability.objectiveKeywords
    .map(normalize)
    .filter((keyword) => objectiveTerms.some((term) => keyword.includes(term) || term.includes(keyword)));

  return [...new Set([...relevant, ...match.capability.researchKeywords.slice(0, 3)])]
    .slice(0, 6)
    .join(', ');
}
