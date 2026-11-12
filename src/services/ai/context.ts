import { supabaseSelect } from '../../lib/supabase.js';
import { getById } from '../../lib/database.js';
import { getApprovedPortfolio } from '../portfolio.js';
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
  const [profiles, services, products, portfolio, leads, clients] = await Promise.all([
    supabaseSelect<DbRow>('company_profile', 'select=*&id=eq.default&limit=1'),
    supabaseSelect<DbRow>('services'),
    supabaseSelect<DbRow>('products'),
    getApprovedPortfolio(),
    supabaseSelect<DbRow>('leads', 'select=name,business_name,status&limit=300'),
    supabaseSelect<DbRow>('clients', 'select=name,business_name,status&limit=300'),
  ]);
  const profile = profiles[0] ?? {};
  const activeServices = services.filter((row) => row.active === true && !isExcluded(row));
  const existingProspectNames = [...new Set([...leads, ...clients]
    .filter((row) => !isExcluded(row))
    .flatMap((row) => candidateNames(row))
    .map((name) => name.trim())
    .filter(Boolean))].slice(0, 60);
  const country = String(profile.country ?? 'Malawi');
  const base = String(profile.base_location ?? 'Lilongwe, Malawi');
  return {
    company: {
      name: profile.company_name ?? 'Tambala Technologies',
      country,
      base,
      description: profile.description ?? 'Software, websites, and digital products',
      contact_name: profile.contact_name ?? null,
    },
    services: activeServices,
    products,
    verified_portfolio: portfolio,
    prospecting_defaults: {
      geographic_scope: `${country}-wide; do not restrict prospecting to the base city unless the Founder says so`,
      base_location: base,
      market_approach: 'Cross-sector prospecting. Identify real businesses and organizations whose needs plausibly match an active Tambala service; do not ask the Founder to choose a market type or industry.',
      first_batch_target: 20,
      fit_signals: [
        'No website, outdated website, poor mobile experience, or weak online presence',
        'A visible need for a business website or web application',
        'A workflow that could reasonably benefit from custom software or a digital product',
        'A business that actively needs social media account management and content support, when that service is active',
      ],
      decision_maker_profiles: ['Owner', 'Founder', 'Managing Director', 'General Manager', 'Operations Manager', 'Marketing Manager'],
      qualification_rule: 'Infer company size and decision-maker title from public evidence where available. Do not ask the Founder for revenue bands, employee counts, room counts, or preferred job titles.',
      excluded_existing_prospects: existingProspectNames,
      excluded_existing_prospects_count: [...new Set([...leads, ...clients].filter((row) => !isExcluded(row)).flatMap((row) => candidateNames(row)))].length,
      contact_rule: 'Include only publicly verified contact names and contact details. Leave unavailable fields blank and cite the source URL; never fabricate an email, phone number, or person.',
      clarification_rule: 'Use these defaults and proceed. Ask the Founder only when a genuinely blocking ambiguity cannot be resolved from the request, company records, or web research.',
    },
    sender: { name: process.env.TAMBALA_SENDER_NAME?.trim() || '[SENDER NAME]', phone: process.env.TAMBALA_SENDER_PHONE?.trim() || '[SENDER PHONE]' },
    rules: GROUNDING_RULES,
  };
}

export async function getCompactCompanyContext(): Promise<DbRow> {
  const context = await getVerifiedCompanyContext();
  const services = Array.isArray(context.services)
    ? (context.services as DbRow[]).map((service) => ({
      name: service.name,
      description: service.description,
      active: service.active === true,
    }))
    : [];
  return {
    company: context.company,
    services,
    prospecting_defaults: context.prospecting_defaults,
  };
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

/** Detailed, least-privilege CRM data for Sales and Customer Relations duties only. */
export async function getDetailedCRMContext(): Promise<DbRow> {
  const [leads, clients, tasks, messages, projects] = await Promise.all([
    supabaseSelect<DbRow>('leads', 'select=id,name,business_name,phone,whatsapp,email,source,status,notes,next_follow_up_at,created_at,updated_at&order=created_at.desc&limit=500'),
    supabaseSelect<DbRow>('clients', 'select=id,name,business_name,phone,whatsapp,email,location,status,notes,created_at,updated_at&order=created_at.desc&limit=500'),
    supabaseSelect<DbRow>('tasks', 'select=id,project_id,client_id,title,description,status,priority,due_at,completed_at,created_at,updated_at&order=due_at.asc.nullslast&limit=500'),
    supabaseSelect<DbRow>('organization_messages', 'select=direction,number,audience,purpose,status,contact_label,sent_at,created_at&order=created_at.desc&limit=1000'),
    supabaseSelect<DbRow>('projects', 'select=*&order=created_at.desc&limit=100'),
  ]);
  const now = Date.now();
  const activeLeads = leads.filter((row) => !isExcluded(row));
  const activeClients = clients.filter((row) => !isExcluded(row));
  const openTasks = tasks.filter((row) => !CLOSED_TASK_STATUSES.has(String(row.status ?? '').trim().toLowerCase()) && !/(^|\s)test(\s|[-_])/i.test(String(row.title ?? '')));
  const outbound = messages.filter((row) => row.direction === 'out' && row.audience === 'client');
  const sent = outbound.filter((row) => row.status === 'sent');
  const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
  const sentNumbers = new Set(sent.map((row) => digits(row.number)).filter(Boolean));
  const numberFor = (row: DbRow) => [row.whatsapp, row.phone].map(digits).find(Boolean) ?? null;
  const decorateContact = (row: DbRow) => {
    const number = numberFor(row);
    const contacted = Boolean(number && sentNumbers.has(number));
    const lastMessage = contacted
      ? sent.find((message) => digits(message.number) === number)?.sent_at ?? null
      : null;
    return {
      id: row.id, name: row.name, business_name: row.business_name,
      phone: row.phone ?? null, whatsapp: row.whatsapp ?? null, email: row.email ?? null,
      status: row.status ?? null, source: row.source ?? null,
      next_follow_up_at: row.next_follow_up_at ?? null,
      notes: typeof row.notes === 'string' ? row.notes.slice(0, 300) : null,
      has_contact_number: Boolean(number), has_successful_outreach: contacted,
      last_successful_outreach_at: lastMessage,
      created_at: row.created_at ?? null,
    };
  };
  const leadRecords = activeLeads.map(decorateContact);
  const clientRecords = activeClients.map((row) => ({
    ...decorateContact(row),
    location: row.location ?? null,
  }));
  const clientById = new Map(clientRecords.map((row) => [String(row.id), row]));
  const openClientTasks = openTasks
    .filter((task) => typeof task.client_id === 'string' && clientById.has(String(task.client_id)))
    .map((task) => ({
      id: task.id, title: task.title, description: typeof task.description === 'string' ? task.description.slice(0, 240) : null,
      status: task.status, priority: task.priority ?? null, due_at: task.due_at ?? null,
      completed_at: task.completed_at ?? null, client: clientById.get(String(task.client_id)),
    }));
  const projectRecords = projects.map((project) => ({
    id: project.id ?? null,
    client_id: project.client_id ?? null,
    name: project.name ?? null,
    description: typeof project.description === 'string' ? project.description.slice(0, 300) : null,
    notes: typeof project.notes === 'string' ? project.notes.slice(0, 500) : null,
    status: project.status ?? null,
    website_url: project.website_url ?? project.url ?? null,
    demo_url: project.demo_url ?? project.preview_url ?? null,
    repository_url: project.repository_url ?? project.repo_url ?? null,
    created_at: project.created_at ?? null,
    updated_at: project.updated_at ?? null,
  }));
  const dueLeads = leadRecords.filter((lead) => {
    const due = typeof lead.next_follow_up_at === 'string' ? Date.parse(lead.next_follow_up_at) : NaN;
    return Number.isFinite(due) && due <= now;
  });
  const dueClientTasks = openClientTasks.filter((task) => {
    const due = typeof task.due_at === 'string' ? Date.parse(task.due_at) : NaN;
    return Number.isFinite(due) && due <= now;
  });
  const counts = (rows: DbRow[]) => rows.reduce<Record<string, number>>((result, row) => {
    const key = String(row.status ?? 'unknown');
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  return {
    generated_at: new Date(now).toISOString(),
    data_scope: 'Detailed CRM contact records are supplied only to Sales & Business Development and Customer Relations & Support duties.',
    lead_pipeline: {
      total: leadRecords.length,
      by_status: counts(activeLeads),
      records: leadRecords.slice(0, 40),
      uncontacted_with_number: leadRecords.filter((lead) => lead.has_contact_number && !lead.has_successful_outreach).slice(0, 20),
    },
    clients: {
      total: clientRecords.length,
      by_status: counts(activeClients),
      records: clientRecords.slice(0, 30),
    },
    projects: {
      total: projectRecords.length,
      records: projectRecords,
      instruction: 'Use project name, description, notes and URLs to identify any concept/demo genuinely prepared for a matching organisation. A project record alone does not prove a website concept is complete; require explicit completed concept/demo evidence before using the prepared-concept WhatsApp format.',
    },
    customer_followups: {
      due_leads: dueLeads.slice(0, 30),
      open_client_tasks: openClientTasks.slice(0, 40),
      overdue_client_tasks: dueClientTasks.slice(0, 30),
      note: 'A lead is due only when next_follow_up_at is present and at or before generated_at. Client follow-up work is represented by open tasks linked through client_id; tasks without a due_at are open but not classified as overdue.',
    },
    outreach_history: {
      outbound_client_messages_loaded: outbound.length,
      successfully_sent: sent.length,
      by_status: counts(outbound),
      recent: outbound.slice(0, 40).map((message) => ({
        purpose: message.purpose, status: message.status, contact_label: message.contact_label,
        sent_at: message.sent_at ?? null, created_at: message.created_at ?? null,
      })),
      note: 'A contact is marked as successfully contacted only when a matching phone number has an outbound client message with status=sent. Queued, pending, failed and Founder-directed messages are not counted as sent.',
    },
  };
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
