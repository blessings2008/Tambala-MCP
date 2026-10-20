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
  'Only state business-specific facts explicitly present in supplied CRM or verified company context.',
  'Never invent URLs, phone numbers, email addresses, social profiles, prices, promises, meetings, travel, shipments, project claims, client claims, or previous conversations.',
  'Never expose internal notes, phase labels, addresses, UUIDs, or private pipeline metadata in prospect-facing text.',
  'A demo/test/staging site is not a completed live project.',
  'A lead status such as demo_sent does not prove a demo was actually delivered; activity history must support that claim.',
  'If a link is needed but not verified, use [LINK].',
  'Never use a lead/client phone number as the sender phone. Sender details come only from verified sender configuration or placeholders.',
  'All communication drafts require human approval and are never sent by these tools.',
];

function normalizeSubject(value: string): string {
  return value.split(',')[0].trim().replace(/\s+/g, ' ');
}

function searchTerm(value: string): string {
  return encodeURIComponent(value.trim().replace(/[%(),]/g, ''));
}

async function findLeadBySubject(subject: string): Promise<DbRow | null> {
  const cleaned = normalizeSubject(subject);
  if (!cleaned) return null;
  const pattern = searchTerm(`*${cleaned}*`);
  const rows = await supabaseSelect<DbRow>('leads', `select=*&or=(business_name.ilike.${pattern},name.ilike.${pattern})&limit=10`);
  const lower = cleaned.toLowerCase();
  const exact = rows.filter((row) => [row.business_name, row.name].filter(Boolean).some((v) => String(v).trim().toLowerCase() === lower));
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) return { ambiguous: true, lookup_subject: subject, candidates: rows.map((row) => ({ id: row.id, name: row.name, business_name: row.business_name, status: row.status })) };
  return null;
}

async function findClientBySubject(subject: string): Promise<DbRow | null> {
  const cleaned = normalizeSubject(subject);
  if (!cleaned) return null;
  const pattern = searchTerm(`*${cleaned}*`);
  const rows = await supabaseSelect<DbRow>('clients', `select=*&or=(business_name.ilike.${pattern},name.ilike.${pattern})&limit=10`);
  const lower = cleaned.toLowerCase();
  const exact = rows.filter((row) => [row.business_name, row.name].filter(Boolean).some((v) => String(v).trim().toLowerCase() === lower));
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) return { ambiguous: true, lookup_subject: subject, candidates: rows.map((row) => ({ id: row.id, name: row.name, business_name: row.business_name, status: row.status })) };
  return null;
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

async function resolveLead(subject?: string, id?: string): Promise<DbRow | undefined> {
  if (id) return getLeadContext(id);
  if (!subject?.trim()) return undefined;
  const lead = await findLeadBySubject(subject);
  if (!lead) return { found: false, lookup_subject: subject };
  if (lead.ambiguous) return { found: false, ambiguous: true, lookup_subject: subject, candidates: lead.candidates };
  const leadId = typeof lead.id === 'string' ? lead.id : null;
  if (!leadId) return { found: false, lookup_subject: subject };
  return getLeadContext(leadId);
}

async function resolveClient(subject?: string, id?: string): Promise<DbRow | undefined> {
  if (id) return getClientContext(id);
  if (!subject?.trim()) return undefined;
  const client = await findClientBySubject(subject);
  if (!client) return { found: false, lookup_subject: subject };
  if (client.ambiguous) return { found: false, ambiguous: true, lookup_subject: subject, candidates: client.candidates };
  const clientId = typeof client.id === 'string' ? client.id : null;
  if (!clientId) return { found: false, lookup_subject: subject };
  return getClientContext(clientId);
}

async function getVerifiedCompanyContext(): Promise<DbRow> {
  const [services, products] = await Promise.all([supabaseSelect<DbRow>('services'), supabaseSelect<DbRow>('products')]);
  return {
    company: { name: 'Tambala Technologies', country: 'Malawi', base: 'Lilongwe, Malawi' },
    services,
    products,
    sender: { name: process.env.TAMBALA_SENDER_NAME?.trim() || '[SENDER NAME]', phone: process.env.TAMBALA_SENDER_PHONE?.trim() || '[SENDER PHONE]' },
    verified_portfolio_links: [],
    rules: GROUNDING_RULES,
  };
}

function crmStatus(lead?: DbRow, client?: DbRow) {
  const leadValue = lead?.lead;
  const clientValue = client?.client;
  const leadId = leadValue && typeof leadValue === 'object' && 'id' in leadValue ? String((leadValue as DbRow).id) : null;
  const clientId = clientValue && typeof clientValue === 'object' && 'id' in clientValue ? String((clientValue as DbRow).id) : null;
  return { lead_id: leadId, client_id: clientId, crm_loaded: Boolean(leadId || clientId), match_found: Boolean(lead?.found || client?.found) };
}

function requestSubject(request: string): string | undefined {
  const cleaned = request.trim();
  return cleaned.length <= 120 ? cleaned : undefined;
}

export function registerAITools(server: McpServer): void {
  server.registerTool('ask_tambala_ai', {
    description: 'Ask a Tambala AI specialist. The server can find a CRM record from subject, lead_id/client_id, or a short request containing a lead/client name.',
    inputSchema: { agent: agent.describe('AI specialist'), request: z.string().trim().min(1).max(10000), subject: z.string().trim().min(1).max(500).optional(), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ agent: agentName, request, subject, lead_id, client_id }) => {
    const resolvedSubject = subject ?? requestSubject(request);
    const [company, lead, client] = await Promise.all([getVerifiedCompanyContext(), resolveLead(resolvedSubject, lead_id), resolveClient(resolvedSubject, client_id)]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI(agentName as AgentName, request, { company, lead, client, grounding_rules: GROUNDING_RULES, context_status: status });
    return text({ agent: agentName, model: getAgentModel(agentName as AgentName), context_used: { ...status, lookup_subject: resolvedSubject ?? null }, response: result, requires_approval: true });
  });

  server.registerTool('draft_outreach', {
    description: 'Draft a personalized prospect message using live CRM context. Default channel is WhatsApp/chat. The draft is never sent.',
    inputSchema: { prospect: z.string().trim().min(1).max(5000), goal: z.string().trim().min(1).max(2000), channel: z.enum(['email', 'sms', 'chat']).default('chat'), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ prospect, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([getVerifiedCompanyContext(), resolveLead(prospect, lead_id), resolveClient(prospect, client_id)]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI('outreach', `Draft a ${channel} message for the goal. Use only verified CRM facts and company context. Never expose internal notes, phase labels, addresses, statuses, UUIDs, or database metadata. Only say something was sent/shared/completed if activity history confirms it. If a link is needed but not verified, use [LINK]. Never use the prospect's phone number as the sender phone. Use configured sender details or placeholders. Goal: ${goal}.`, { company, lead, client, supplied_prospect: prospect, grounding_rules: GROUNDING_RULES, context_status: status });
    return text({ channel, draft: result, requires_approval: true, context_used: { ...status, lookup_subject: prospect } });
  });

  server.registerTool('analyze_followup', {
    description: 'Analyze a follow-up using live CRM/activity context. Default channel is WhatsApp/chat. It never sends anything.',
    inputSchema: { subject: z.string().trim().min(1).max(500), history: z.string().trim().min(1).max(10000).optional(), goal: z.string().trim().min(1).max(2000), channel: z.enum(['email', 'sms', 'chat']).default('chat'), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ subject, history, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([getVerifiedCompanyContext(), resolveLead(subject, lead_id), resolveClient(subject, client_id)]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI('followup', `Analyze this ${channel} follow-up using CRM/activity context and supplied history only. Recommend timing relative to the current time and any verified follow-up due date. Distinguish requested demos/examples from demos/examples actually sent. Then provide a draft. Never invent links, promises, meetings, travel, shipments, contact details, project claims, client claims, or previous events. If a link is needed but not verified, use [LINK]. Goal: ${goal}. Supplied history: ${history ?? '[No additional manual history provided.]'}`, { company, lead, client, supplied_history: history ?? null, grounding_rules: GROUNDING_RULES, context_status: status, current_time_africa_blantyre: new Date().toLocaleString('en-GB', { timeZone: 'Africa/Blantyre', dateStyle: 'full', timeStyle: 'long' }) });
    return text({ channel, recommendation: result, requires_approval: true, context_used: { ...status, lookup_subject: subject } });
  });
}
