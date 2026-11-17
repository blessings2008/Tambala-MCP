import { supabaseInsert, supabaseSelect } from '../lib/supabase.js';
import { askTambalaAI, type AgentName } from '../services/ai.js';

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

export function isInternalChatChannel(value: unknown): value is InternalChatChannel {
  return typeof value === 'string' && Object.hasOwn(CHANNELS, value);
}

export async function readInternalChat(channel: InternalChatChannel) {
  const messages = await supabaseSelect<MessageRow>(
    'organization_internal_chat_messages',
    `select=id,channel,sender_type,sender_role_id,sender_name,body,created_at&channel=eq.${channel}&order=created_at.asc&limit=150`,
  );
  return { channel, messages };
}

export async function sendInternalChat(channel: InternalChatChannel, message: string) {
  const agent = CHANNELS[channel];
  const founderMessage = await supabaseInsert<MessageRow>('organization_internal_chat_messages', {
    channel, sender_type: 'founder', sender_role_id: 'founder', sender_name: 'Founder', body: message,
  });
  try {
    const response = await askTambalaAI(agent.agent as AgentName, message);
    const agentMessage = await supabaseInsert<MessageRow>('organization_internal_chat_messages', {
      channel, sender_type: 'agent', sender_role_id: agent.role, sender_name: agent.name,
      body: response,
    });
    return { founderMessage, agentMessage };
  } catch (error) {
    return { founderMessage, error: error instanceof Error ? error.message : 'The agent could not respond.' };
  }
}
