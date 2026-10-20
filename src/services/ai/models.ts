export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export const AGENT_MODELS = {
  orchestrator: 'openai/gpt-oss-120b',
  outreach: 'openai/gpt-oss-120b',
  followup: 'openai/gpt-oss-20b',
} as const;

export type AgentName = keyof typeof AGENT_MODELS;
