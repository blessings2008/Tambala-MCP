import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseSelect } from '../lib/supabase.js';
import { getById } from '../lib/database.js';
import { askTambalaAI, getAgentModel, type AgentName } from '../services/ai.js';

type DbRow = Record<string, unknown>;

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

const agent = z.enum(['orchestrator', 'outreach', 'followup']);
const uuid = z.string().uuid();

async function getLeadContext(id: string): Promise<DbRow> {
  const lead = await getById<DbRow>('leads', id);
  if (!lead) return { found: false, lead_id: id };

  const activities = await supabaseSelect<DbRow>(
    'activity_log',
    `select=*&entity_type=eq.lead&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`,
  );

  return {
    found: true,
    generated_at: new Date().toISOString(),
    lead,
    activity: activities,
  };
}

async function getVerifiedCompanyContext(): Promise<DbRow> {
  const [services, products] = await Promise.all([
    supabaseSelect<DbRow>('services'),
    supabaseSelect<DbRow>('products'),
  ]);

  return {
    company: {
      name: 'Tambala Technologies',
      country: 'Malawi',
      base: 'Lilongwe, Malawi',
    },
    services,
    products,
    rules: [
      'Only use portfolio/demo URLs supplied in business context. Never invent a URL.',
      'Never invent a phone number, email address, social profile, meeting location, travel commitment, price, promise, or previous conversation.',
      'A website sample/demo is a digital link unless the supplied context explicitly says a physical sample exists.',
      'If a required fact is missing, state that it is unverified instead of guessing.',
      'Do not claim a message, email, meeting, shipment, or other action has happened unless the supplied context confirms it.',
    ],
  };
}

export function registerAITools(server: McpServer): void {
  server.registerTool('ask_tambala_ai', {
    description: 'Ask a Tambala AI specialist for read-only analysis or drafting. It can use live business context when a lead or client UUID is supplied. It does not modify business records or send messages.',
    inputSchema: {
      agent: agent.describe('AI specialist'),
      request: z.string().trim().min(1).max(10000).describe('What you want the AI specialist to do'),
      lead_id: uuid.optional().describe('Optional lead UUID. If supplied, live lead and activity context is retrieved.'),
      client_id: uuid.optional().describe('Optional client UUID. If supplied, live client context is retrieved.'),
    },
  }, async ({ agent: agentName, request, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([
      getVerifiedCompanyContext(),
      lead_id ? getLeadContext(lead_id) : Promise.resolve(undefined),
      client_id ? getById<DbRow>('clients', client_id) : Promise.resolve(undefined),
    ]);
    const context = { company, lead, client };
    const result = await askTambalaAI(agentName as AgentName, request, context);
    return text({ agent: agentName, model: getAgentModel(agentName as AgentName), context_used: { lead_id: lead_id ?? null, client_id: client_id ?? null }, response: result });
  });

  server.registerTool('draft_outreach', {
    description: 'Draft a personalized prospect message using live lead data when lead_id is supplied plus supplied facts. The draft is never sent by this tool.',
    inputSchema: {
      prospect: z.string().trim().min(1).max(5000),
      goal: z.string().trim().min(1).max(2000),
      channel: z.enum(['email', 'sms', 'chat']).default('email'),
      lead_id: uuid.optional().describe('Lead UUID. Prefer this so the AI can use the real lead record and activity history.'),
    },
  }, async ({ prospect, goal, channel, lead_id }) => {
    const [company, lead] = await Promise.all([
      getVerifiedCompanyContext(),
      lead_id ? getLeadContext(lead_id) : Promise.resolve(undefined),
    ]);
    const context = { company, lead, supplied_prospect_facts: prospect, goal, channel };
    const result = await askTambalaAI(
      'outreach',
      `Draft a ${channel} message for this goal. Use only verified facts in the supplied context. If the prospect facts conflict with the live lead record, do not silently choose; flag the conflict. Do not invent links, contact details, promises, meetings, travel, shipments, or previous conversations. A website sample means a digital link unless the context explicitly says otherwise. Return only the proposed message followed by a short 'Unverified items' section if anything is missing. Goal: ${goal}.`,
      context,
    );
    return text({ channel, draft: result, requires_approval: true, context_used: { lead_id: lead_id ?? null } });
  });

  server.registerTool('analyze_followup', {
    description: 'Analyze a lead follow-up using live lead/activity context when lead_id is supplied. It never sends anything.',
    inputSchema: {
      history: z.string().trim().min(1).max(10000),
      goal: z.string().trim().min(1).max(2000),
      lead_id: uuid.optional().describe('Lead UUID. Prefer this so the AI can use the real lead record and activity history.'),
    },
  }, async ({ history, goal, lead_id }) => {
    const [company, lead] = await Promise.all([
      getVerifiedCompanyContext(),
      lead_id ? getLeadContext(lead_id) : Promise.resolve(undefined),
    ]);
    const result = await askTambalaAI(
      'followup',
      `Analyze the follow-up situation. Use the live context and supplied history only. Do not invent a previous action, shipment, channel, phone number, email address, social account, meeting, travel commitment, or promise. If timing depends on an uncertain return date, state the uncertainty. Recommend the safest next action and provide a draft only from verified facts. Goal: ${goal}. Supplied history: ${history}`,
      { company, lead, supplied_history: history, goal },
    );
    return text({ recommendation: result, requires_approval: true, context_used: { lead_id: lead_id ?? null } });
  });
}
