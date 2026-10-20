import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseSelect } from '../lib/supabase.js';
import { getById } from '../lib/database.js';
import { askTambalaAI, getAgentModel, type AgentName } from '../services/ai.js';

type DbRow = Record<string, unknown>;
function text(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }; }
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
  'Only describe Tambala services that appear in the verified services context. Never add booking systems, payment systems, apps, or other services unless explicitly listed.',
  'All communication drafts require human approval and are never sent by these tools.',
];
const EXCLUDED_STATUSES = new Set(['archived', 'cancelled', 'canceled', 'deleted']);
const CLOSED_TASK_STATUSES = new Set(['done', 'completed', 'archived', 'cancelled', 'canceled', 'deleted']);
function isExcluded(row: DbRow) {
  const status = String(row.status ?? '').trim().toLowerCase();
  const name = `${row.name ?? ''} ${row.business_name ?? ''}`.toLowerCase();
  return EXCLUDED_STATUSES.has(status) || /(^|\s)test(\s|$)|test[-_]/i.test(name);
}
function normalizeSubject(value: string) { return value.split(',')[0].trim().replace(/\s+/g, ' '); }
function candidateNames(row: DbRow) { return [row.business_name, row.name].filter((v) => typeof v === 'string' && v.trim()).map((v) => String(v).trim()); }
async function findLeadBySubject(subject: string): Promise<DbRow | null> {
  const raw = subject.trim(); if (!raw) return null;
  const cleaned = normalizeSubject(raw);
  const rows = await supabaseSelect<DbRow>('leads', 'select=*');
  const active = rows.filter((row) => !isExcluded(row));
  const needle = cleaned.toLowerCase(); const rawNeedle = raw.toLowerCase();
  const matches = active.filter((row) => candidateNames(row).some((name) => {
    const n = name.toLowerCase(); return n === needle || n.includes(needle) || rawNeedle.includes(n);
  }));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: true, lookup_subject: subject, candidates: matches.map((row) => ({ id: row.id, name: row.name, business_name: row.business_name, status: row.status })) };
  return null;
}
async function findClientBySubject(subject: string): Promise<DbRow | null> {
  const raw = subject.trim(); if (!raw) return null;
  const cleaned = normalizeSubject(raw);
  const rows = await supabaseSelect<DbRow>('clients', 'select=*');
  const active = rows.filter((row) => !isExcluded(row));
  const needle = cleaned.toLowerCase(); const rawNeedle = raw.toLowerCase();
  const matches = active.filter((row) => candidateNames(row).some((name) => {
    const n = name.toLowerCase(); return n === needle || n.includes(needle) || rawNeedle.includes(n);
  }));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: true, lookup_subject: subject, candidates: matches.map((row) => ({ id: row.id, name: row.name, business_name: row.business_name, status: row.status })) };
  return null;
}
async function getLeadContext(id: string): Promise<DbRow> {
  const lead = await getById<DbRow>('leads', id); if (!lead) return { found: false, lead_id: id };
  const name = String(lead.name ?? ''); const business = String(lead.business_name ?? ''); const pattern = encodeURIComponent(`*${business || name}*`);
  const [activities, matchingClients, relatedProjects, relatedTasks] = await Promise.all([
    supabaseSelect<DbRow>('activity_log', `select=*&entity_type=eq.lead&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
    supabaseSelect<DbRow>('clients', `select=*&or=(name.ilike.${pattern},business_name.ilike.${pattern})&order=created_at.desc&limit=10`),
    supabaseSelect<DbRow>('projects', `select=*&or=(name.ilike.${pattern},description.ilike.${pattern},notes.ilike.${pattern})&order=created_at.desc&limit=20`),
    supabaseSelect<DbRow>('tasks', `select=*&or=(title.ilike.${pattern},description.ilike.${pattern})&order=created_at.desc&limit=20`),
  ]);
  return { found: true, generated_at: new Date().toISOString(), lead, activity: activities, matching_clients: matchingClients, related_projects: relatedProjects, related_tasks: relatedTasks };
}
async function getClientContext(id: string): Promise<DbRow> {
  const client = await getById<DbRow>('clients', id); if (!client) return { found: false, client_id: id };
  const [projects, tasks, activities] = await Promise.all([
    supabaseSelect<DbRow>('projects', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_date.asc.nullslast`),
    supabaseSelect<DbRow>('tasks', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_at.asc.nullslast`),
    supabaseSelect<DbRow>('activity_log', `select=*&entity_type=eq.client&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
  ]);
  return { found: true, generated_at: new Date().toISOString(), client, projects, tasks, activity: activities };
}
async function resolveLead(subject?: string, id?: string): Promise<DbRow | undefined> {
  if (id) return getLeadContext(id); if (!subject?.trim()) return undefined; const lead = await findLeadBySubject(subject);
  if (!lead) return { found: false, lookup_subject: subject }; if (lead.ambiguous) return { found: false, ambiguous: true, lookup_subject: subject, candidates: lead.candidates };
  return typeof lead.id === 'string' ? getLeadContext(lead.id) : { found: false, lookup_subject: subject };
}
async function resolveClient(subject?: string, id?: string): Promise<DbRow | undefined> {
  if (id) return getClientContext(id); if (!subject?.trim()) return undefined; const client = await findClientBySubject(subject);
  if (!client) return { found: false, lookup_subject: subject }; if (client.ambiguous) return { found: false, ambiguous: true, lookup_subject: subject, candidates: client.candidates };
  return typeof client.id === 'string' ? getClientContext(client.id) : { found: false, lookup_subject: subject };
}
async function getVerifiedCompanyContext(): Promise<DbRow> {
  const [services, products] = await Promise.all([supabaseSelect<DbRow>('services'), supabaseSelect<DbRow>('products')]);
  return { company: { name: 'Tambala Technologies', country: 'Malawi', base: 'Lilongwe, Malawi' }, services, products, sender: { name: process.env.TAMBALA_SENDER_NAME?.trim() || '[SENDER NAME]', phone: process.env.TAMBALA_SENDER_PHONE?.trim() || '[SENDER PHONE]' }, verified_portfolio_links: [], rules: GROUNDING_RULES };
}
async function getBusinessSummary(): Promise<DbRow> {
  const [leads, clients, projects, tasks] = await Promise.all([
    supabaseSelect<DbRow>('leads', 'select=id,name,business_name,status,next_follow_up_at,created_at'),
    supabaseSelect<DbRow>('clients', 'select=id,name,business_name,status,created_at'),
    supabaseSelect<DbRow>('projects', 'select=id,name,status,client_id,due_date,created_at'),
    supabaseSelect<DbRow>('tasks', 'select=id,title,status,due_at,client_id,project_id,created_at'),
  ]);
  const activeLeads = leads.filter((r) => !isExcluded(r));
  const activeClients = clients.filter((r) => !isExcluded(r));
  const activeProjects = projects.filter((r) => !EXCLUDED_STATUSES.has(String(r.status ?? '').trim().toLowerCase()) && !/test/i.test(String(r.name ?? '')));
  // Count all open operational tasks, including tasks with no client/project relationship.
  const activeTasks = tasks.filter((r) => {
    const status = String(r.status ?? '').trim().toLowerCase();
    return !CLOSED_TASK_STATUSES.has(status) && !/test/i.test(String(r.title ?? ''));
  });
  const countBy = (rows: DbRow[]) => rows.reduce<Record<string, number>>((a, r) => { const s = String(r.status ?? 'unknown'); a[s] = (a[s] ?? 0) + 1; return a; }, {});
  return { company_type: 'one-person business', default_outreach_channel: 'WhatsApp/chat', location: 'Lilongwe, Malawi', excluded_records: 'Archived, cancelled/canceled, deleted, and clearly test-named records are excluded from this operational snapshot.', leads_total: activeLeads.length, leads_by_status: countBy(activeLeads), clients_total: activeClients.length, clients_by_status: countBy(activeClients), projects_total: activeProjects.length, projects_by_status: countBy(activeProjects), tasks_total: activeTasks.length, open_tasks_total: activeTasks.length, tasks_by_status: countBy(activeTasks), calculation_rule: 'When reporting percentages, calculate numerator / denominator * 100 and show the numerator and denominator. Do not estimate. Open task counts include unassigned/unlinked tasks; do not filter tasks by client_id or project_id.' };
}
function crmStatus(lead?: DbRow, client?: DbRow) {
  const lv = lead?.lead; const cv = client?.client;
  const leadId = lv && typeof lv === 'object' && 'id' in lv ? String((lv as DbRow).id) : null;
  const clientId = cv && typeof cv === 'object' && 'id' in cv ? String((cv as DbRow).id) : null;
  return { lead_id: leadId, client_id: clientId, crm_loaded: Boolean(leadId || clientId), match_found: Boolean(lead?.found || client?.found) };
}
function requestSubject(request: string, knownNames: string[] = []) {
  const raw = request.trim();
  const lower = raw.toLowerCase();
  const matched = knownNames.filter((name) => lower.includes(name.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  return matched ?? (raw.length <= 120 ? raw : undefined);
}
async function findSubjectInCRM(request: string) {
  const [leads, clients] = await Promise.all([
    supabaseSelect<DbRow>('leads', 'select=id,name,business_name,status'),
    supabaseSelect<DbRow>('clients', 'select=id,name,business_name,status'),
  ]);
  const names = [...leads, ...clients].filter((r) => !isExcluded(r)).flatMap(candidateNames);
  return requestSubject(request, [...new Set(names)]);
}

export function registerAITools(server: McpServer): void {
  server.registerTool('ask_tambala_ai', {
    description: 'Ask a Tambala AI specialist. The server can find a CRM record from subject, lead_id/client_id, or a request containing a lead/client name.',
    inputSchema: { agent: agent.describe('AI specialist'), request: z.string().trim().min(1).max(10000), subject: z.string().trim().min(1).max(500).optional(), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ agent: agentName, request, subject, lead_id, client_id }) => {
    const resolvedSubject = subject ?? await findSubjectInCRM(request);
    const [company, summary, lead, client] = await Promise.all([getVerifiedCompanyContext(), getBusinessSummary(), resolveLead(resolvedSubject, lead_id), resolveClient(resolvedSubject, client_id)]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI(agentName as AgentName, request, { company, business_summary: summary, lead, client, grounding_rules: GROUNDING_RULES, context_status: status, current_time_africa_blantyre: new Date().toLocaleString('en-GB', { timeZone: 'Africa/Blantyre', dateStyle: 'full', timeStyle: 'long' }) });
    return text({ agent: agentName, model: getAgentModel(agentName as AgentName), context_used: { ...status, lookup_subject: resolvedSubject ?? null }, response: result, requires_approval: true });
  });

  server.registerTool('draft_outreach', {
    description: 'Draft a personalized prospect message using live CRM context. Default channel is WhatsApp/chat. The draft is never sent.',
    inputSchema: { prospect: z.string().trim().min(1).max(5000), goal: z.string().trim().min(1).max(2000), channel: z.enum(['email', 'sms', 'chat']).default('chat'), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ prospect, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([getVerifiedCompanyContext(), resolveLead(prospect, lead_id), resolveClient(prospect, client_id)]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI('outreach', `Draft a ${channel} message for the goal. Use only verified CRM facts and company context. Match the requested channel exactly; if channel is chat, write a WhatsApp-style message, not an email. Never expose internal notes, phase labels, addresses, statuses, UUIDs, or database metadata. Only say something was sent/shared/completed if activity history confirms it. If a link is needed but not verified, use [LINK]. Never use the prospect's phone number as the sender phone. Use configured sender details or placeholders. Only mention services explicitly listed in verified company context. Do not describe portfolio work, partnerships, experience, or completed projects unless explicitly verified in context. Goal: ${goal}.`, { company, lead, client, supplied_prospect: prospect, grounding_rules: GROUNDING_RULES, context_status: status });
    return text({ channel, draft: result, requires_approval: true, context_used: { ...status, lookup_subject: prospect } });
  });

  server.registerTool('analyze_followup', {
    description: 'Analyze a follow-up using live CRM/activity context. Default channel is WhatsApp/chat. It never sends anything.',
    inputSchema: { subject: z.string().trim().min(1).max(500), history: z.string().trim().min(1).max(10000).optional(), goal: z.string().trim().min(1).max(2000), channel: z.enum(['email', 'sms', 'chat']).default('chat'), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ subject, history, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([getVerifiedCompanyContext(), resolveLead(subject, lead_id), resolveClient(subject, client_id)]);
    const status = crmStatus(lead, client);
    const result = await askTambalaAI('followup', `Analyze this ${channel} follow-up using CRM/activity context and supplied history only. The lead's notes and activity history are authoritative. Recommend timing relative to the current time and any verified follow-up due date. Distinguish requested demos/examples from demos/examples actually sent. Do not infer delivery from lead status alone. Never say a demo, example, sample, proposal, message, link, or other item was shared/sent/provided unless the activity history explicitly records that it happened. Never invent links, promises, meetings, travel, shipments, contact details, project claims, client claims, previous events, or vague claims about Tambala's experience. If a link is needed but not verified, use [LINK]. Only mention services explicitly listed in verified company context. Match the requested channel exactly; if channel is chat, produce a WhatsApp-style draft, not an email. Goal: ${goal}. Supplied history: ${history ?? '[No additional manual history provided.]'}`, { company, lead, client, supplied_history: history ?? null, grounding_rules: GROUNDING_RULES, context_status: status, current_time_africa_blantyre: new Date().toLocaleString('en-GB', { timeZone: 'Africa/Blantyre', dateStyle: 'full', timeStyle: 'long' }) });
    return text({ channel, recommendation: result, requires_approval: true, context_used: { ...status, lookup_subject: subject } });
  });
}
