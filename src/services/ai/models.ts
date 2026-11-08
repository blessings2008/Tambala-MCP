export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export const AGENT_DEFAULT_MODELS = {
  orchestrator: 'openai/gpt-oss-120b',
  outreach: 'openai/gpt-oss-20b',
  followup: 'openai/gpt-oss-20b',
  research: 'openai/gpt-oss-20b',
  marketing: 'openai/gpt-oss-20b',
  content: 'openai/gpt-oss-20b',
  finance: 'openai/gpt-oss-20b',
  payments: 'openai/gpt-oss-20b',
  engineering: 'openai/gpt-oss-20b',
  strategy: 'openai/gpt-oss-20b',
  product: 'openai/gpt-oss-20b',
  security: 'openai/gpt-oss-20b',
  operations: 'openai/gpt-oss-20b',
  people: 'openai/gpt-oss-20b',
  legal: 'openai/gpt-oss-20b',
  procurement: 'openai/gpt-oss-20b',
  executive: 'openai/gpt-oss-20b',
  rnd: 'openai/gpt-oss-20b',
  governance: 'openai/gpt-oss-20b',
} as const;

export type AgentName = keyof typeof AGENT_DEFAULT_MODELS;

/** The organization chart is authoritative agent identity context, not an authorization grant. */
export const AGENT_DIRECTORY = {
  orchestrator: {
    title: 'Chief Executive Officer (CEO)',
    responsibility: 'Organization-wide planning, delegation, coordination, prioritization, and executive synthesis',
    unitId: 'executive-management',
    unitName: 'Executive Management',
    reportsTo: 'Founder / Bless',
    manages: ['Sales & Business Development', 'Customer Relations & Support', 'future departments as activated'],
    roleId: null,
    roleStatus: 'planned',
  },
  outreach: {
    title: 'Head of Sales & Business Development',
    responsibility: 'Prospect research support, opportunity qualification, outreach strategy, and outreach drafts',
    unitId: 'sales-business-development',
    unitName: 'Sales & Business Development',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Sales/outreach work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  followup: {
    title: 'Head of Customer Relations & Support',
    responsibility: 'Follow-up analysis, relationship continuity, customer communication drafts, and next-step recommendations',
    unitId: 'customer-relations',
    unitName: 'Customer Relations & Support',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Customer follow-up work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  research: {
    title: 'Head of Central Research & Intelligence',
    responsibility: 'Independent research, evidence verification, source quality, and research briefs for departments',
    unitId: 'research-intelligence',
    unitName: 'Central Research & Intelligence',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Research requests assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  marketing: {
    title: 'Head of Marketing & Brand Management',
    responsibility: 'Brand positioning, marketing strategy, campaigns, audience development, and marketing performance analysis',
    unitId: 'marketing-brand',
    unitName: 'Marketing & Brand Management',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Marketing strategy and campaign work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  content: {
    title: 'Head of Media & Content Production',
    responsibility: 'Content planning, social posts, creative briefs, video concepts, and media production workflows',
    unitId: 'media-content',
    unitName: 'Media & Content Production',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Content production work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  finance: {
    title: 'Head of Finance & Accounting',
    responsibility: 'Internal financial records, budgets, financial reporting, controls, and reconciliation analysis',
    unitId: 'finance-accounting',
    unitName: 'Finance & Accounting',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Financial analysis and control work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  payments: {
    title: 'Head of Payments & Financial Operations',
    responsibility: 'Tambala Pay requirements, invoice and receipt workflows, payment-provider integration planning, and reconciliation controls',
    unitId: 'fintech-ventures',
    unitName: 'Fintech Ventures / Tambala Pay',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Payment workflow work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  engineering: {
    title: 'Head of Technology & Engineering',
    responsibility: 'Software delivery, infrastructure, database and API work, AI automation, and technical quality',
    unitId: 'technology-engineering',
    unitName: 'Technology & Engineering',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Engineering and automation work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  strategy: {
    title: 'Head of Strategy & Corporate Planning',
    responsibility: 'Translate approved Founder direction into measurable objectives, priorities, scenarios and operating plans',
    unitId: 'strategy-planning',
    unitName: 'Strategy & Corporate Planning',
    reportsTo: 'Director — Executive & Governance',
    manages: ['Strategic planning work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  product: {
    title: 'Head of Product Management & Innovation',
    responsibility: 'Discover user needs, define requirements, prioritize roadmaps and coordinate product delivery',
    unitId: 'product-innovation',
    unitName: 'Product Management & Innovation',
    reportsTo: 'Director — Technology & Innovation',
    manages: ['Product discovery and delivery planning assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  security: {
    title: 'Head of Cybersecurity & IT',
    responsibility: 'Assess security posture, access controls, incidents, backups, reliability and IT operations',
    unitId: 'cybersecurity-it',
    unitName: 'Cybersecurity & IT',
    reportsTo: 'Director — Technology & Innovation',
    manages: ['Security and IT reviews assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  operations: {
    title: 'Head of Operations & Administration',
    responsibility: 'Improve internal workflows, procedures, records, coordination and administrative efficiency',
    unitId: 'operations-administration',
    unitName: 'Operations & Administration',
    reportsTo: 'Director — Corporate Services',
    manages: ['Operational improvement work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  people: {
    title: 'Head of Human Resources & Agent Management',
    responsibility: 'Define role contracts, onboarding, agent lifecycle, performance criteria and capability development',
    unitId: 'people-agent-management',
    unitName: 'Human Resources & Agent Management',
    reportsTo: 'Director — Corporate Services',
    manages: ['People and agent-management work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  legal: {
    title: 'Head of Legal, Risk & Compliance',
    responsibility: 'Identify legal, regulatory, contractual and operational risks and recommend proportionate controls',
    unitId: 'legal-risk-compliance',
    unitName: 'Legal, Risk & Compliance',
    reportsTo: 'Director — Corporate Services',
    manages: ['Risk and compliance analysis assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  procurement: {
    title: 'Head of Procurement & Resource Management',
    responsibility: 'Compare suppliers, define purchase requirements and plan approved resource acquisition',
    unitId: 'procurement-resources',
    unitName: 'Procurement & Resource Management',
    reportsTo: 'Director — Corporate Services',
    manages: ['Supplier and resource planning assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  executive: {
    title: 'Head of Executive Management',
    responsibility: 'Coordinate cross-department priorities, operating reviews, performance reporting and escalation',
    unitId: 'executive-management',
    unitName: 'Executive Management',
    reportsTo: 'Chief Executive Officer (CEO)',
    manages: ['Cross-functional coordination and executive reporting assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  rnd: {
    title: 'Head of Research & Development',
    responsibility: 'Design controlled technical experiments, assess feasibility and validate prototypes',
    unitId: 'research-development',
    unitName: 'Research & Development',
    reportsTo: 'Director — Technology & Innovation',
    manages: ['Technical research and feasibility work assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
  governance: {
    title: 'Head of Board & Corporate Governance',
    responsibility: 'Prepare governance records, decision briefs, approval documentation and oversight materials',
    unitId: 'board-governance',
    unitName: 'Board & Corporate Governance',
    reportsTo: 'Director — Executive & Governance',
    manages: ['Governance administration and oversight support assigned by the CEO'],
    roleId: null,
    roleStatus: 'planned',
  },
} as const;

export interface AgentRuntimeConfig {
  agent: AgentName;
  baseURL: string;
  model: string;
  apiKey: string | undefined;
  apiKeySource: string;
}

export function getAgentRuntimeConfig(agent: AgentName): AgentRuntimeConfig {
  const upper = agent.toUpperCase();
  const dedicatedKeyName = `TAMBALA_${upper}_API_KEY`;
  const dedicatedKey = process.env[dedicatedKeyName];
  const sharedGroqEnabled = process.env.TAMBALA_ALLOW_SHARED_GROQ_KEY === 'true';
  const sharedGroqKey = sharedGroqEnabled
    ? process.env.GROQ_API_KEY ?? process.env.TAMBALA_ORCHESTRATOR_API_KEY
    : undefined;
  const apiKey = dedicatedKey
    ?? (agent === 'orchestrator' ? process.env.GROQ_API_KEY : undefined)
    ?? sharedGroqKey;
  const apiKeySource = dedicatedKey
    ? dedicatedKeyName
    : agent === 'orchestrator' && process.env.GROQ_API_KEY
      ? 'GROQ_API_KEY (orchestrator fallback)'
      : sharedGroqKey
        ? 'Shared Groq credential (explicitly enabled)'
        : dedicatedKeyName;
  const baseURL = process.env[`TAMBALA_${upper}_BASE_URL`] ?? GROQ_BASE_URL;
  const model = process.env[`TAMBALA_${upper}_MODEL`] ?? AGENT_DEFAULT_MODELS[agent];
  if (!apiKey) throw new Error(`No API key configured for the ${agent} agent. Set ${dedicatedKeyName}; specialist agents do not fall back to GROQ_API_KEY.`);
  if (!baseURL) throw new Error(`TAMBALA_${upper}_BASE_URL must be configured for the ${agent} agent.`);
  if (!model) throw new Error(`TAMBALA_${upper}_MODEL must be configured for the ${agent} agent.`);
  return { agent, baseURL, model, apiKey, apiKeySource };
}

/** Safe diagnostic view: never returns the API key itself. */
export function getAgentRuntimeInfo(agent: AgentName) {
  const upper = agent.toUpperCase();
  const dedicatedKeyName = `TAMBALA_${upper}_API_KEY`;
  const legacyOrchestratorKey = agent === 'orchestrator' && Boolean(process.env.GROQ_API_KEY);
  const sharedGroqEnabled = process.env.TAMBALA_ALLOW_SHARED_GROQ_KEY === 'true';
  const sharedGroqConfigured = sharedGroqEnabled && Boolean(process.env.GROQ_API_KEY || process.env.TAMBALA_ORCHESTRATOR_API_KEY);
  const apiKeyConfigured = Boolean(process.env[dedicatedKeyName] || legacyOrchestratorKey || sharedGroqConfigured);
  const baseURL = process.env[`TAMBALA_${upper}_BASE_URL`] ?? GROQ_BASE_URL;
  const model = process.env[`TAMBALA_${upper}_MODEL`] ?? AGENT_DEFAULT_MODELS[agent];
  return {
    agent,
    ...AGENT_DIRECTORY[agent],
    baseURL,
    model,
    apiKeyEnv: process.env[dedicatedKeyName] ? dedicatedKeyName : legacyOrchestratorKey ? 'GROQ_API_KEY' : sharedGroqConfigured ? 'Shared Groq credential (explicitly enabled)' : dedicatedKeyName,
    apiKeyConfigured,
    ready: apiKeyConfigured && Boolean(baseURL) && Boolean(model),
  };
}
