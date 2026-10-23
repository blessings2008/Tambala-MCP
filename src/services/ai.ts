import OpenAI from 'openai';
import { getAgentRuntimeConfig, getAgentRuntimeInfo, type AgentName } from './ai/models.js';
import { acquireAgentRequestSlot, getAgentLimitInfo } from './ai/limits.js';
import { AGENT_PROMPT_RULES } from './ai/rules.js';

const clients = new Map<AgentName, OpenAI>();

function getClient(agent: AgentName): OpenAI {
  const existing = clients.get(agent);
  if (existing) return existing;
  const config = getAgentRuntimeConfig(agent);
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 30000, maxRetries: 1 });
  clients.set(agent, client);
  return client;
}

export type { AgentName } from './ai/models.js';

/** Route to the assigned provider while enforcing per-agent local request caps. */
export async function askTambalaAI(agent: AgentName, input: string, context?: unknown): Promise<string> {
  const config = getAgentRuntimeConfig(agent);
  const releaseSlot = acquireAgentRequestSlot(agent);
  try {
    const contextText = context === undefined ? '' : `\n\nTambala business context:\n${JSON.stringify(context)}`;
    const response = await getClient(agent).chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: AGENT_PROMPT_RULES[agent] },
        { role: 'user', content: `${input}${contextText}` },
      ],
      temperature: 0.2,
    });
    const content = response.choices[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error(`The ${agent} AI provider returned an empty response.`);
    return content;
  } finally {
    releaseSlot();
  }
}

export function getAgentModel(agent: AgentName): string { return getAgentRuntimeInfo(agent).model ?? 'not-configured'; }
export { getAgentRuntimeInfo };
export function getAgentOperationalInfo(agent: AgentName) { return { ...getAgentRuntimeInfo(agent), limits: getAgentLimitInfo(agent) }; }
