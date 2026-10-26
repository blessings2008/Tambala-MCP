export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export const AGENT_DEFAULT_MODELS = {
  orchestrator: 'openai/gpt-oss-120b',
  outreach: 'openai/gpt-oss-120b',
  followup: 'openai/gpt-oss-20b',
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
  const apiKey = agent === 'orchestrator' ? dedicatedKey ?? process.env.GROQ_API_KEY : dedicatedKey;
  const apiKeySource = dedicatedKey ? dedicatedKeyName : agent === 'orchestrator' && process.env.GROQ_API_KEY ? 'GROQ_API_KEY (legacy orchestrator-only fallback)' : dedicatedKeyName;
  const baseURL = process.env[`TAMBALA_${upper}_BASE_URL`] ?? (agent === 'orchestrator' ? GROQ_BASE_URL : undefined);
  const model = process.env[`TAMBALA_${upper}_MODEL`] ?? (agent === 'orchestrator' ? AGENT_DEFAULT_MODELS.orchestrator : undefined);
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
  const apiKeyConfigured = Boolean(process.env[dedicatedKeyName] || legacyOrchestratorKey);
  const baseURL = process.env[`TAMBALA_${upper}_BASE_URL`] ?? (agent === 'orchestrator' ? GROQ_BASE_URL : null);
  const model = process.env[`TAMBALA_${upper}_MODEL`] ?? (agent === 'orchestrator' ? AGENT_DEFAULT_MODELS.orchestrator : null);
  return {
    agent,
    ...AGENT_DIRECTORY[agent],
    baseURL,
    model,
    apiKeyEnv: process.env[dedicatedKeyName] ? dedicatedKeyName : legacyOrchestratorKey ? 'GROQ_API_KEY (legacy orchestrator-only fallback)' : dedicatedKeyName,
    apiKeyConfigured,
    ready: apiKeyConfigured && Boolean(baseURL) && Boolean(model),
  };
}
