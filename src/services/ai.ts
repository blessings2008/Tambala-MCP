import OpenAI from 'openai';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Models are intentionally fixed in code so agent behavior is predictable.
// These are current Groq production models. The older Llama 3.1/3.3 IDs
// were deprecated by Groq on August 16, 2026.
const AGENT_MODELS = {
  orchestrator: 'openai/gpt-oss-120b',
  outreach: 'openai/gpt-oss-120b',
  followup: 'openai/gpt-oss-20b',
} as const;

export type AgentName = keyof typeof AGENT_MODELS;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is not configured');
    client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
  }
  return client;
}

const AGENT_INSTRUCTIONS: Record<AgentName, string> = {
  orchestrator:
    'You are the Tambala Orchestrator. Break business goals into practical work for specialist agents. Protect the user\'s time, prioritize revenue-generating work, and never invent business facts or claim an action happened when it did not.',
  outreach:
    'You are the Tambala Outreach Agent. Create natural, personalized, professional prospect outreach from supplied facts. Never invent contact details, business facts, pricing, promises, or previous conversations. Avoid spammy or desperate language.',
  followup:
    'You are the Tambala Follow-up Agent. Analyze supplied prospect/client history and recommend the next appropriate follow-up. Keep messages concise, human, contextual, and non-pushy. Never invent conversation history.',
};

export async function askTambalaAI(
  agent: AgentName,
  input: string,
  context?: unknown,
): Promise<string> {
  const contextText = context === undefined
    ? ''
    : `\n\nTambala business context:\n${JSON.stringify(context)}`;

  const response = await getClient().responses.create({
    model: AGENT_MODELS[agent],
    instructions: AGENT_INSTRUCTIONS[agent],
    input: `${input}${contextText}`,
  });

  return response.output_text;
}

export function getAgentModel(agent: AgentName): string {
  return AGENT_MODELS[agent];
}
