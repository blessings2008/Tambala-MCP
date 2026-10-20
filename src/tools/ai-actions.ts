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

const GROUNDING_RULES = [
  'CRM records and activity history are the source of truth for what happened.',
  'Never invent URLs, phone numbers, email addresses, social profiles, prices, promises, meetings, travel arrangements, shipments, or previous conversations.',
  'A website demo/sample is a digital link unless the context explicitly says a physical sample exists.',
  'Never claim an action happened unless the context confirms it.',
  'If a required fact is missing, say it is unknown or use [REAL LINK NEEDED] instead of guessing.',
  'All communication drafts require human approval and are never sent by these tools.',
];

async function getLeadContext(id: string): Promise<DbRow> {
  const lead = await getById<DbRow>('leads', id);
  if (!lead) return { found: false, lead_id: id };
  const name = String(lead.name ?? '');
  const business = String(lead.business_name ?? '');
  const pattern = encodeURIComponent(`*${business || name}*`);
  const [activities, matchingClients, relatedProjects, relatedTasks] = await Promise.all([
    supabaseSelect<DbRow>('activity_log', `select=*&entity_type=eq.lead&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
    supabaseSelect<DbRow>('clients', `select=*&or=(name.ilike.${pattern},business_name.ilike.${pattern})&order=created_at.desc&limit=10`),
    supabaseSelect<DbRow>('projects', `select=*&or=(name.ilike.${pattern},description.ilike.${pattern},notes.ilike.${pattern})&order=created_at.desc&limit=20`),
    supabaseSelect<DbRow>('tasks', `select=*&or=(title.ilike.${pattern},description.ilike.${pattern})&order=created_at.desc&limit=20`),
  ]);
  return { found: true, generated_at: new Date().toISOString(), lead, activity: activities, matching_clients: matchingClients, related_projects: relatedProjects, related_tasks: relatedTasks };
}

async function getClientContext(id: string): Promise<DbRow> {
  const client = await getById<DbRow>('clients', id);
  if (!client) return { found: false, client_id: id };
  const [projects, tasks, activities] = await Promise.all([
    supabaseSelect<DbRow>('projects', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_date.asc.nullslast`),
    supabaseSelect<DbRow>('tasks', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_at.asc.nullslast`),
    supabaseSelect<DbRow>('activity_log', `select=*&entity_type=eq.client&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
  ]);
  return { found: true, generated_at: new Date().toISOString(), client, projects, tasks, activity: activities };
}

async function getVerifiedCompanyContext(): Promise<DbRow> {
  const [services, products] = await Promise.all([supabaseSelect<DbRow>('services'), supabaseSelect<DbRow>('products')]);
  return {
    company: { name: 'Tambala Technologies', country: 'Malawi', base: 'Lilongwe, Malawi' },
    services,
    products,
    verified_portfolio_links: [],
    rules: GROUNDING_RULES,
  };
}

export function registerAITools(server: McpServer): void {
  server.registerTool('ask_tambala_ai', {
    description: 'Ask a Tambala AI specialist for read-only analysis or drafting. When a lead or client UUID is supplied, live CRM records and activity are loaded automatically.',
    inputSchema: {
      agent: agent.describe('AI specialist'),
      request: z.string().trim().min(1).max(10000).describe('What you want the AI specialist to do'),
      lead_id: uuid.optional().describe('Optional sales lead UUID'),
      client_id: uuid.optional().describe('Optional client UUID'),
    },
  }, async ({ agent: agentName, request, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([
      getVerifiedCompanyContext(),
      lead_id ? getLeadContext(lead_id) : Promise.resolve(undefined),
      client_id ? getClientContext(client_id) : Promise.resolve(undefined),
    ]);
    const result = await askTambalaAI(agentName as AgentName, request, { company, lead, client, grounding_rules: GROUNDING_RULES });
    return text({ agent: agentName, model: getAgentModel(agentName as AgentName), context_used: { lead_id: lead_id ?? null, client_id: client_id ?? null, crm_loaded: Boolean(lead_id || client_id) }, response: result, requires_approval: true });
  });

  server.registerTool('draft_outreach', {
    description: 'Draft a personalized prospect message. Prefer lead_id so live CRM context and activity are loaded automatically. The draft is never sent.',
    inputSchema: {
      prospect: z.string().trim().min(1).max(5000).optional(),
      goal: z.string().trim().min(1).max(2000),
      channel: z.enum(['email', 'sms', 'chat']).default('email'),
      lead_id: uuid.optional().describe('Sales lead UUID'),
      client_id: uuid.optional().describe('Existing client UUID'),
    },
  }, async ({ prospect, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([
      getVerifiedCompanyContext(),
      lead_id ? getLeadContext(lead_id) : Promise.resolve(undefined),
      client_id ? getClientContext(client_id) : Promise.resolve(undefined),
    ]);
    const result = await askTambalaAI('outreach', `Draft a ${channel} message for this goal. Use only verified facts in the context. Do not invent links, promises, contact details, meetings, travel, shipments, or previous conversations. If a link is needed but not verified, use [REAL LINK NEEDED]. Do not add an email subject unless channel=email. Keep the draft natural and concise. Goal: ${goal}.`, { company, lead, client, supplied_prospect_facts: prospect ?? null, grounding_rules: GROUNDING_RULES });
    return text({ channel, draft: result, requires_approval: true, context_used: { lead_id: lead_id ?? null, client_id: client_id ?? null, crm_loaded: Boolean(lead_id || client_id) } });
  });

  server.registerTool('analyze_followup', {
    description: 'Analyze a follow-up using live CRM/activity context when lead_id or client_id is supplied. It never sends anything.',
    inputSchema: {
      history: z.string().trim().min(1).max(10000).optional(),
      goal: z.string().trim().min(1).max(2000),
      channel: z.enum(['email', 'sms', 'chat']).default('chat'),
      lead_id: uuid.optional().describe('Sales lead UUID'),
      client_id: uuid.optional().describe('Existing client UUID'),
    },
  }, async ({ history, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([
      getVerifiedCompanyContext(),
      lead_id ? getLeadContext(lead_id) : Promise.resolve(undefined),
      client_id ? getClientContext(client_id) : Promise.resolve(undefined),
    ]);
    const result = await askTambalaAI('followup', `Analyze this ${channel} follow-up. Use CRM/activity context and supplied history only. Recommend timing and the safest next action, then provide a draft in the requested channel. Do not invent links, promises, meetings, travel, shipments, contact details, or previous events. If a link is needed but not verified, use [REAL LINK NEEDED]. Do not add an email subject unless channel=email. Goal: ${goal}. Supplied history: ${history ?? '[No additional manual history provided; rely on CRM context.]'}`, { company, lead, client, supplied_history: history ?? null, grounding_rules: GROUNDING_RULES });
    return text({ channel, recommendation: result, requires_approval: true, context_used: { lead_id: lead_id ?? null, client_id: client_id ?? null, crm_loaded: Boolean(lead_id || client_id) } });
  });
}
