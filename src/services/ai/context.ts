import { supabaseSelect } from '../../lib/supabase.js';
import { getById } from '../../lib/database.js';
import { CLOSED_TASK_STATUSES, EXCLUDED_STATUSES, GROUNDING_RULES } from './rules.js';

type DbRow = Record<string, unknown>;

export function normalizeSubject(value: string) { return value.split(',')[0].trim().replace(/\s+/g, ' '); }
export function candidateNames(row: DbRow) { return [row.business_name, row.name].filter((v) => typeof v === 'string' && v.trim()).map(String); }
export function isExcluded(row: DbRow) {
  const status = String(row.status ?? '').trim().toLowerCase();
  const name = `${row.name ?? ''} ${row.business_name ?? ''}`;
  return EXCLUDED_STATUSES.has(status) || /(^|\s)test(\s|$)|test[-_]/i.test(name);
}

async function findBySubject(table: 'leads' | 'clients', subject: string): Promise<DbRow | null> {
  const raw = subject.trim(); if (!raw) return null;
  const cleaned = normalizeSubject(raw).toLowerCase(); const rawNeedle = raw.toLowerCase();
  const rows = await supabaseSelect<DbRow>(table, 'select=*');
  const matches = rows.filter((r) => !isExcluded(r)).filter((r) => candidateNames(r).some((name) => {
    const n = name.toLowerCase(); return n === cleaned || n.includes(cleaned) || rawNeedle.includes(n);
  }));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: true, lookup_subject: subject, candidates: matches.map((r) => ({ id: r.id, name: r.name, business_name: r.business_name, status: r.status })) };
  return null;
}

export async function getLeadContext(id: string): Promise<DbRow> {
  const lead = await getById<DbRow>('leads', id); if (!lead) return { found: false, lead_id: id };
  const name = String(lead.name ?? ''); const business = String(lead.business_name ?? ''); const pattern = encodeURIComponent(`*${business || name}*`);
  const [activity, matching_clients, related_projects, related_tasks] = await Promise.all([
    supabaseSelect<DbRow>('activity_log', `select=*&entity_type=eq.lead&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
    supabaseSelect<DbRow>('clients', `select=*&or=(name.ilike.${pattern},business_name.ilike.${pattern})&order=created_at.desc&limit=10`),
    supabaseSelect<DbRow>('projects', `select=*&or=(name.ilike.${pattern},description.ilike.${pattern},notes.ilike.${pattern})&order=created_at.desc&limit=20`),
    supabaseSelect<DbRow>('tasks', `select=*&or=(title.ilike.${pattern},description.ilike.${pattern})&order=created_at.desc&limit=20`),
  ]);
  return { found: true, generated_at: new Date().toISOString(), lead, activity, matching_clients, related_projects, related_tasks, grounding_rules: GROUNDING_RULES };
}

export async function getClientContext(id: string): Promise<DbRow> {
  const client = await getById<DbRow>('clients', id); if (!client) return { found: false, client_id: id };
  const [projects, tasks, activity] = await Promise.all([
    supabaseSelect<DbRow>('projects', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_date.asc.nullslast`),
    supabaseSelect<DbRow>('tasks', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_at.asc.nullslast`),
    supabaseSelect<DbRow>('activity_log', `select=*&entity_type=eq.client&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
  ]);
  return { found: true, generated_at: new Date().toISOString(), client, projects, tasks, activity, grounding_rules: GROUNDING_RULES };
}

export async function resolveLead(subject?: string, id?: string): Promise<DbRow | undefined> {
  if (id) return getLeadContext(id); if (!subject?.trim()) return undefined;
  const lead = await findBySubject('leads', subject); if (!lead) return { found: false, lookup_subject: subject };
  if (lead.ambiguous) return { found: false, ambiguous: true, lookup_subject: subject, candidates: lead.candidates };
  return typeof lead.id === 'string' ? getLeadContext(lead.id) : { found: false, lookup_subject: subject };
}
export async function resolveClient(subject?: string, id?: string): Promise<DbRow | undefined> {
  if (id) return getClientContext(id); if (!subject?.trim()) return undefined;
  const client = await findBySubject('clients', subject); if (!client) return { found: false, lookup_subject: subject };
  if (client.ambiguous) return { found: false, ambiguous: true, lookup_subject: subject, candidates: client.candidates };
  return typeof client.id === 'string' ? getClientContext(client.id) : { found: false, lookup_subject: subject };
}

export async function getVerifiedCompanyContext(): Promise<DbRow> {
  const [services, products] = await Promise.all([supabaseSelect<DbRow>('services'), supabaseSelect<DbRow>('products')]);
  return { company: { name: 'Tambala Technologies', country: 'Malawi', base: 'Lilongwe, Malawi' }, services, products, sender: { name: process.env.TAMBALA_SENDER_NAME?.trim() || '[SENDER NAME]', phone: process.env.TAMBALA_SENDER_PHONE?.trim() || '[SENDER PHONE]' }, verified_portfolio_links: [], rules: GROUNDING_RULES };
}

export async function getBusinessSummary(): Promise<DbRow> {
  const [leads, clients, projects, tasks] = await Promise.all([
    supabaseSelect<DbRow>('leads', 'select=id,name,business_name,status,next_follow_up_at,created_at'),
    supabaseSelect<DbRow>('clients', 'select=id,name,business_name,status,created_at'),
    supabaseSelect<DbRow>('projects', 'select=id,name,status,client_id,due_date,created_at'),
    supabaseSelect<DbRow>('tasks', 'select=id,title,status,due_at,client_id,project_id,created_at'),
  ]);
  const activeLeads = leads.filter((r) => !isExcluded(r));
  const activeClients = clients.filter((r) => !isExcluded(r));
  const activeProjects = projects.filter((r) => !EXCLUDED_STATUSES.has(String(r.status ?? '').trim().toLowerCase()) && !/(^|\s)test(\s|[-_])/i.test(String(r.name ?? '')));
  const activeTasks = tasks.filter((r) => !CLOSED_TASK_STATUSES.has(String(r.status ?? '').trim().toLowerCase()) && !/(^|\s)test(\s|[-_])/i.test(String(r.title ?? '')));
  const countBy = (rows: DbRow[]) => rows.reduce<Record<string, number>>((a, r) => { const s = String(r.status ?? 'unknown'); a[s] = (a[s] ?? 0) + 1; return a; }, {});
  const task_details = activeTasks.map((r) => { const created = new Date(String(r.created_at ?? '')); const due = r.due_at ? new Date(String(r.due_at)) : null; return { title: r.title, created_at: r.created_at, due_at: r.due_at, age_days: Number.isFinite(created.getTime()) ? Math.max(0, (Date.now() - created.getTime()) / 86400000) : null, overdue: Boolean(due && Number.isFinite(due.getTime()) && due.getTime() < Date.now()) }; });
  return { company_type: 'one-person business', default_outreach_channel: 'WhatsApp/chat', location: 'Lilongwe, Malawi', leads_total: activeLeads.length, leads_by_status: countBy(activeLeads), clients_total: activeClients.length, clients_by_status: countBy(activeClients), projects_total: activeProjects.length, projects_by_status: countBy(activeProjects), tasks_total: activeTasks.length, open_tasks_total: activeTasks.length, tasks_by_status: countBy(activeTasks), task_details, calculation_rule: 'Open task counts include unassigned/unlinked tasks. Judge workload by age, due dates, priority, blocked status and dependencies; never by completion percentage alone.' };
}

export function crmStatus(lead?: DbRow, client?: DbRow) {
  const lv = lead?.lead; const cv = client?.client;
  const leadId = lv && typeof lv === 'object' && 'id' in lv ? String((lv as DbRow).id) : null;
  const clientId = cv && typeof cv === 'object' && 'id' in cv ? String((cv as DbRow).id) : null;
  return { lead_id: leadId, client_id: clientId, crm_loaded: Boolean(leadId || clientId), match_found: Boolean(lead?.found || client?.found) };
}

export async function findSubjectInCRM(request: string) {
  const [leads, clients] = await Promise.all([supabaseSelect<DbRow>('leads', 'select=id,name,business_name,status'), supabaseSelect<DbRow>('clients', 'select=id,name,business_name,status')]);
  const names = [...leads, ...clients].filter((r) => !isExcluded(r)).flatMap(candidateNames);
  const lower = request.toLowerCase();
  return [...new Set(names)].sort((a, b) => b.length - a.length).find((name) => lower.includes(name.toLowerCase())) ?? (request.trim().length <= 120 ? normalizeSubject(request) : undefined);
}
