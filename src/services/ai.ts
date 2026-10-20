import OpenAI from 'openai';
import { AGENT_MODELS, GROQ_BASE_URL, type AgentName } from './ai/models.js';
import { AGENT_PROMPT_RULES } from './ai/rules.js';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not configured');
    client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
  }
  return client;
}

export type { AgentName } from './ai/models.js';

export async function askTambalaAI(agent: AgentName, input: string, context?: unknown): Promise<string> {
  const contextText = context === undefined ? '' : `\n\nTambala business context:\n${JSON.stringify(context)}`;
  const response = await getClient().responses.create({
    model: AGENT_MODELS[agent],
    instructions: AGENT_PROMPT_RULES[agent],
    input: `${input}${contextText}`,
    temperature: 0.2,
  });
  return response.output_text;
}

export function getAgentModel(agent: AgentName): string {
  return AGENT_MODELS[agent];
}
