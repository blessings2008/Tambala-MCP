import { supabaseInsert, supabaseSelect } from '../lib/supabase.js';
import { askTambalaAI, type AgentName } from '../services/ai.js';
import { AGENT_DIRECTORY } from '../services/ai/models.js';

const CHANNELS = {
  executive: { agent: 'orchestrator', role: 'ceo', name: 'CEO Orchestrator' },
  board: { agent: 'governance', role: 'director-board-governance', name: 'Board Governance' },
  research: { agent: 'research', role: 'director-research-intelligence', name: 'Research & Intelligence' },
  sales: { agent: 'outreach', role: 'director-sales-business-development', name: 'Sales & Business Development' },
  customer: { agent: 'followup', role: 'director-customer-relations', name: 'Customer Relations' },
  technology: { agent: 'engineering', role: 'director-technology-engineering', name: 'Technology & Engineering' },
  finance: { agent: 'finance', role: 'director-finance-accounting', name: 'Finance & Accounting' },
  founder: { agent: 'executive', role: 'director-executive-management', name: 'Executive Management' },
} as const;

export type InternalChatChannel = keyof typeof CHANNELS;
type MessageRow = { id: string; channel: string; sender_type: 'founder' | 'agent'; sender_role_id: string; sender_name: string; body: string; created_at: string };
const AGENT_NAMES = Object.keys(AGENT_DIRECTORY) as AgentName[];

export function isInternalChatChannel(value: unknown): value is InternalChatChannel {
  return typeof value === 'string' && Object.hasOwn(CHANNELS, value);
}

export function listInternalChatAgents() {\n  return AGENT_NAMES.map((agent) => ({ id: agent, name: AGENT_DIRECTORY[agent].title, department: AGENT_DIRECTORY[agent].unitName }));\n}\n\nexport function isInternalChatAgent(value: unknown): value is AgentName {
  return typeof value === 'string' && AGENT_NAMES.includes(value as AgentName);
}

export async function readInternalChat(channel: InternalChatChannel) {
  const messages = await supabaseSelect<MessageRow>(
    'organization_internal_chat_messages',
    `select=id,channel,sender_type,sender_role_id,sender_name,body,created_at&channel=eq.${channel}&order=created_at.asc&limit=150`,
  );
  return { channel, messages };
}

/** Founder can convene up to four agents. Each agent receives a compact record of earlier contributions. */
export async function sendInternalChat(channel: InternalChatChannel, message: string, requestedAgents?: unknown) {
  const defaultAgent = CHANNELS[channel].agent as AgentName;
  const participants = Array.isArray(requestedAgents)
    ? [...new Set(requestedAgents.filter(isInternalChatAgent))]
    : [defaultAgent];
  if (!participants.length || participants.length > 4 || (Array.isArray(requestedAgents) && participants.length !== requestedAgents.length)) {
    throw new Error('Choose between one and four valid AI employees.');
  }

  const founderMessage = await supabaseInsert<MessageRow>('organization_internal_chat_messages', {
    channel, sender_type: 'founder', sender_role_id: 'founder', sender_name: 'Founder', body: message,
  });

  const contributions: Array<{ agent: AgentName; name: string; response: string }> = [];
  const errors: Array<{ agent: AgentName; name: string; error: string }> = [];
  for (const agent of participants) {
    const identity = AGENT_DIRECTORY[agent];
    const previous = contributions.map((item) => ({
      employee: item.name,
      department: AGENT_DIRECTORY[item.agent].unitName,
      contribution: item.response.slice(0, 1400),
    }));
    const prompt = [
      'You are participating in a private Tambala Technologies internal team discussion convened by the Founder.',
      'Respond in your own professional role. Consider the Founder request and previous employee contributions.',
      'You may respectfully challenge earlier conclusions when evidence or your department perspective warrants it.',
      'Do not claim to have performed external actions, contacted people, changed records, or completed tasks unless tools explicitly did so.',
      'Keep your contribution focused, practical, and concise.',
      `FOUNDER REQUEST:\n${message}`,
      previous.length ? `PREVIOUS TEAM CONTRIBUTIONS:\n${JSON.stringify(previous)}` : 'You are the first employee to contribute.',
    ].join('\n\n');
    try {
      const response = await askTambalaAI(agent, prompt);
      const row = await supabaseInsert<MessageRow>('organization_internal_chat_messages', {
        channel, sender_type: 'agent', sender_role_id: agent, sender_name: identity.title, body: response,
      });
      contributions.push({ agent, name: identity.title, response });
      // Keep the database row as the durable source of truth for the thread.
      void row;
    } catch (error) {
      errors.push({ agent, name: identity.title, error: error instanceof Error ? error.message : 'The employee could not respond.' });
    }
  }
  return { founderMessage, contributions, errors };
}
