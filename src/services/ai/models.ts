export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export const AGENT_DEFAULT_MODELS = {
  orchestrator: 'openai/gpt-oss-120b',
  outreach: 'openai/gpt-oss-120b',
  followup: 'openai/gpt-oss-20b',
} as const;

export type AgentName = keyof typeof AGENT_DEFAULT_MODELS;

/** Routing directory, not an authorization grant or proof that the role is activated. */
export const AGENT_DIRECTORY = {
  orchestrator: { responsibility: 'Organization-wide planning and coordination', unitId: 'executive-management', unitName: 'Executive Management', roleId: 'ceo', roleStatus: 'planned' },
  outreach: { responsibility: 'Prospect research and outreach drafts', unitId: 'sales-business-development', unitName: 'Sales & Business Development', roleId: null, roleStatus: 'not-bound' },
  followup: { responsibility: 'Follow-up analysis and follow-up drafts', unitId: 'customer-relations', unitName: 'Customer Relations & Support', roleId: null, roleStatus: 'not-bound' },
} as const;

export interface AgentRuntimeConfig {
  agent: AgentName;
  baseURL: string;
  model: string;
  apiKey: string | undefined;
  apiKeySource: string;
}

/**
 * Each agent gets its own API credential and route. Only the orchestrator may
 * use the legacy GROQ_API_KEY fallback; specialist agents fail closed until
 * their own credentials are configured, preventing accidental API concentration.
 * Endpoints must be compatible with the OpenAI chat-completions API.
 */
export function getAgentRuntimeConfig(agent: AgentName): AgentRuntimeConfig {
  const upper = agent.toUpperCase();
  const dedicatedKeyName = `TAMBALA_${upper}_API_KEY`;
  const dedicatedKey = process.env[dedicatedKeyName];

  const apiKey = agent === 'orchestrator'
    ? dedicatedKey ?? process.env.GROQ_API_KEY
    : dedicatedKey;

  const apiKeySource = dedicatedKey
    ? dedicatedKeyName
    : agent === 'orchestrator' && process.env.GROQ_API_KEY
      ? 'GROQ_API_KEY (legacy orchestrator-only fallback)'
      : dedicatedKeyName;

  const baseURL = process.env[`TAMBALA_${upper}_BASE_URL`]
    ?? (agent === 'orchestrator' ? GROQ_BASE_URL : undefined);

  const model = process.env[`TAMBALA_${upper}_MODEL`]
    ?? (agent === 'orchestrator' ? AGENT_DEFAULT_MODELS.orchestrator : undefined);

  if (!apiKey) {
    throw new Error(`No API key configured for the ${agent} agent. Set ${dedicatedKeyName}; specialist agents do not fall back to GROQ_API_KEY.`);
  }
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
  const baseURL = process.env[`TAMBALA_${upper}_BASE_URL`]
    ?? (agent === 'orchestrator' ? GROQ_BASE_URL : null);
  const model = process.env[`TAMBALA_${upper}_MODEL`]
    ?? (agent === 'orchestrator' ? AGENT_DEFAULT_MODELS.orchestrator : null);
  return {
    agent,
    ...AGENT_DIRECTORY[agent],
    baseURL,
    model,
    apiKeyEnv: process.env[dedicatedKeyName]
      ? dedicatedKeyName
      : legacyOrchestratorKey
        ? 'GROQ_API_KEY (legacy orchestrator-only fallback)'
        : dedicatedKeyName,
    apiKeyConfigured,
    ready: apiKeyConfigured && Boolean(baseURL) && Boolean(model),
  };
}
