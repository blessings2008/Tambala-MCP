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
  'Only state business-specific facts that are explicitly present in the supplied CRM or verified company context.',
  'Never invent URLs, phone numbers, email addresses, social profiles, prices, promises, meetings, travel arrangements, shipments, project claims, client claims, or previous conversations.',
  'A website demo/sample is a digital link unless the context explicitly says a physical sample exists.',
  'Never claim an action happened unless the context confirms it.',
  'Never invent completed projects, features, clients, partnerships, case studies, results, or testimonials.',
  'If a required fact is missing, say it is unknown or use [REAL LINK NEEDED] instead of guessing.',
  'Do not introduce unrelated Tambala products or services unless they are relevant to the request and supported by the context.',
  'If no matching CRM record was found, clearly say so and do not pretend that the subject is a known lead or client.',
  'All communication drafts require human approval and are never sent by these tools.',
];

function searchTerm(value: string): string {
  return encodeURIComponent(value.trim().replace(/[%(),]/g, ''));
}

async function findLeadBySubject(subject: string): Promise<DbRow | null> {
  const cleaned = subject.trim();
  if (!cleaned) return null;
  const pattern = searchTerm(`*${cleaned}*`);
  const rows = await supabaseSelect<DbRow>(
    'leads',
    `select=*&or=(business_name.ilike.${pattern},name.ilike.${pattern})&limit=5`,
  );
  if (rows.length === 1) return rows[0];

  // Prefer an exact business/name match if multiple partial matches exist.
  const lower = cleaned.toLowerCase();
  return rows.find((row) =>
    [row.business_name, row.name]
      .filter(Boolean)
      .some((value) => String(value).trim().toLowerCase() === lower),
  ) ?? rows[0] ?? null;
}

async function resolveLead(subject?: string, id?: string): Promise<DbRow | undefined> {
  if (id) return getLeadContext(id);
  if (!subject?.trim()) return undefined;
  const lead = await findLeadBySubject(subject);
  if (!lead?.id) return { found: false, lookup_subject: subject };
  return getLeadContext(String(lead.id));
}

async function findClientBySubject(subject: string): Promise<DbRow | null> {
  const cleaned = subject.trim();
  if (!cleaned) return null;
  const pattern = searchTerm(`*${cleaned}*`);
  const rows = await supabaseSelect<DbRow>(
    'clients',
    `select=*&or=(business_name.ilike.${pattern},name.ilike.${pattern})&limit=5`,
  );
  if (rows.length === 1) return rows[0];
  const lower = cleaned.toLowerCase();
  return rows.find((row) =>
    [row.business_name, row.name]
      .filter(Boolean)
      .some((value) => String(value).trim().toLowerCase() === lower),
  ) ?? rows[0] ?? null;
}

async function resolveClient(subject?: string, id?: string): Promise<DbRow | undefined> {
  if (id) return getClientContext(id);
  if (!subject?.trim()) return undefined;
  const client = await findClientBySubject(subject);
  if (!client?.id) return { found: false, lookup_subject: subject };
  return getClientContext(String(client.id));
}

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
  return {
    found: true,
    generated_at: new Date().toISOString(),
    lead,
    activity: activities,
    matching_clients: matchingClients,
    related_projects: relatedProjects,
    related_tasks: relatedTasks,
  };
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
  const [services, products] = await Promise.all([
    supabaseSelect<DbRow>('services'),
    supabaseSelect<DbRow>('products'),
  ]);
  return {
    company: { name: 'Tambala Technologies', country: 'Malawi', base: 'Lilongwe, Malawi' },
    services,
    products,
    verified_portfolio_links: [],
    rules: GROUNDING_RULES,
  };
}

function crmStatus(lead?: DbRow, client?: DbRow): { lead_id: string | null; client_id: string | null; crm_loaded: boolean; match_found: boolean } {
  const leadId = lead?.lead?.id ? String(lead.lead.id) : null;
  const clientId = client?.client?.id ? String(client.client.id) : null;
  return {
    lead_id: leadId,
    client_id: clientId,
    crm_loaded: Boolean(leadId || clientId),
    match_found: Boolean(lead?.found || client?.found),
  };
}

export function registerAITools(server: McpServer): void {
  server.registerTool('ask_tambala_ai', {
    description: 'Ask a Tambala AI specialist for read-only analysis or drafting. Supply lead_id/client_id when known, or subject to let the server automatically find the matching CRM record.',
    inputSchema: {
      agent: agent.describe('AI specialist'),
      request: z.string().trim().min(1).max(10000).describe('What you want the AI specialist to do'),
      subject: z.string().trim().min(1).max(500).optional().describe('Lead/client business name or contact name. Used to automatically load CRM context.'),
      lead_id: uuid.optional().describe('Optional sales lead UUID'),
      client_id: uuid.optional().describe('Optional client UUID'),
    },
  }, async ({ agent: agentName, request, subject, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([
      getVerifiedCompanyContext(),
      resolveLead(subject, lead_id),
      resolveClient(subject, client_id),
    ]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI(agentName as AgentName, request, {
      company,
      lead,
      client,
      grounding_rules: GROUNDING_RULES,
      context_status: status,
    });
    return text({
      agent: agentName,
      model: getAgentModel(agentName as AgentName),
      context_used: { ...status, lookup_subject: subject ?? null },
      response: result,
      requires_approval: true,
    });
  });

  server.registerTool('draft_outreach', {
    description: 'Draft a personalized prospect message. Give a lead_id when known, or prospect as the lead/client name and the server will automatically load matching CRM context. The draft is never sent.',
    inputSchema: {
      prospect: z.string().trim().min(1).max(5000),
      goal: z.string().trim().min(1).max(2000),
      channel: z.enum(['email', 'sms', 'chat']).default('email'),
      lead_id: uuid.optional().describe('Optional sales lead UUID'),
      client_id: uuid.optional().describe('Optional existing client UUID'),
    },
  }, async ({ prospect, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([
      getVerifiedCompanyContext(),
      resolveLead(prospect, lead_id),
      resolveClient(prospect, client_id),
    ]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI('outreach', `Draft a ${channel} message for the stated goal. Use only verified facts in the CRM and company context. Do not invent links, promises, contact details, meetings, travel, shipments, project claims, client claims, or previous conversations. If a link is needed but not verified, use [REAL LINK NEEDED]. Do not add an email subject unless channel=email. Keep the draft natural and concise. Goal: ${goal}.`, {
      company,
      lead,
      client,
      supplied_prospect: prospect,
      grounding_rules: GROUNDING_RULES,
      context_status: status,
    });
    return text({
      channel,
      draft: result,
      requires_approval: true,
      context_used: { ...status, lookup_subject: prospect },
    });
  });

  server.registerTool('analyze_followup', {
    description: 'Analyze a follow-up using live CRM/activity context. Supply lead_id/client_id when known, or subject to automatically find the record. It never sends anything.',
    inputSchema: {
      subject: z.string().trim().min(1).max(500).describe('Lead/client business name or contact name used to find the CRM record'),
      history: z.string().trim().min(1).max(10000).optional(),
      goal: z.string().trim().min(1).max(2000),
      channel: z.enum(['email', 'sms', 'chat']).default('chat'),
      lead_id: uuid.optional().describe('Optional sales lead UUID'),
      client_id: uuid.optional().describe('Optional existing client UUID'),
    },
  }, async ({ subject, history, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([
      getVerifiedCompanyContext(),
      resolveLead(subject, lead_id),
      resolveClient(subject, client_id),
    ]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI('followup', `Analyze this ${channel} follow-up. Use CRM/activity context and supplied history only. Recommend timing and the safest next action, then provide a draft in the requested channel. Do not invent links, promises, meetings, travel, shipments, contact details, project claims, client claims, or previous events. If a link is needed but not verified, use [REAL LINK NEEDED]. Do not add an email subject unless channel=email. Goal: ${goal}. Supplied history: ${history ?? '[No additional manual history provided; rely on CRM context.]'}`, {
      company,
      lead,
      client,
      supplied_history: history ?? null,
      grounding_rules: GROUNDING_RULES,
      context_status: status,
    });
    return text({
      channel,
      recommendation: result,
      requires_approval: true,
      context_used: { ...status, lookup_subject: subject },
    });
  });
}
