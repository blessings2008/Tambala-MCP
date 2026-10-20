import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseSelect } from '../lib/supabase.js';
import { getById, insertRow } from '../lib/database.js';

type DbRow = Record<string, unknown>;

function text(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const uuid = z.string().uuid();

export function registerActivityTools(server: McpServer): void {
  server.registerTool('record_activity', {
    description: 'Record a business activity in the Tambala history. Use this when an important business event needs to be remembered.',
    inputSchema: {
      activity_type: z.string().trim().min(2).max(80),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2000).optional(),
      entity_type: z.enum(['client', 'lead', 'project', 'task', 'service', 'product', 'business']).optional(),
      entity_id: uuid.optional(),
      actor: z.string().trim().max(100).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
  }, async (input) => text(await insertRow('activity_log', { ...input, metadata: input.metadata ?? {} })));

  server.registerTool('get_activity_timeline', {
    description: 'Get recent Tambala activity history, optionally filtered to one entity or activity type.',
    inputSchema: {
      entity_type: z.enum(['client', 'lead', 'project', 'task', 'service', 'product', 'business']).optional(),
      entity_id: uuid.optional(),
      activity_type: z.string().trim().max(80).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ entity_type, entity_id, activity_type, limit = 50 }) => {
    const filters: string[] = [];
    if (entity_type) filters.push(`entity_type=eq.${encodeURIComponent(entity_type)}`);
    if (entity_id) filters.push(`entity_id=eq.${encodeURIComponent(entity_id)}`);
    if (activity_type) filters.push(`activity_type=eq.${encodeURIComponent(activity_type)}`);
    const query = `select=*&${filters.length ? `${filters.join('&')}&` : ''}order=created_at.desc&limit=${limit}`;
    const activities = await supabaseSelect<DbRow>('activity_log', query);
    return text({ count: activities.length, activities });
  });

  server.registerTool('get_client_context', {
    description: 'Build one live context view for a Tambala client, combining the client profile, related leads, projects, tasks, and activity history.',
    inputSchema: { id: uuid.describe('Client UUID') },
  }, async ({ id }) => {
    const client = await getById<DbRow>('clients', id);
    if (!client) return text({ found: false, client_id: id, message: 'Client not found' });
    const name = String(client.name ?? '');
    const business = String(client.business_name ?? '');
    const pattern = encodeURIComponent(`*${business || name}*`);
    const now = Date.now();
    const [leads, projects, tasks, activities] = await Promise.all([
      supabaseSelect<DbRow>('leads', `select=*&or=(name.ilike.${pattern},business_name.ilike.${pattern})&order=created_at.desc`),
      supabaseSelect<DbRow>('projects', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_date.asc.nullslast`),
      supabaseSelect<DbRow>('tasks', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_at.asc.nullslast`),
      supabaseSelect<DbRow>('activity_log', `select=*&entity_type=eq.client&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
    ]);
    const openTasks = tasks.filter(t => !['done', 'cancelled'].includes(String(t.status)));
    const overdueTasks = openTasks.filter(t => typeof t.due_at === 'string' && Date.parse(t.due_at) < now);
    const activeProjects = projects.filter(p => !['completed', 'cancelled'].includes(String(p.status)));
    return text({ found: true, generated_at: new Date().toISOString(), client, leads, projects: { total: projects.length, active: activeProjects.length, items: projects }, tasks: { total: tasks.length, open: openTasks.length, overdue: overdueTasks.length, items: tasks }, activity: { total: activities.length, items: activities }, attention: overdueTasks.map(t => ({ priority: 'high', type: 'overdue_task', title: `Overdue task: ${String(t.title ?? 'Untitled task')}`, id: t.id })).concat(activeProjects.filter(p => p.status === 'waiting_client').map(p => ({ priority: 'medium', type: 'waiting_client', title: `Waiting on client: ${String(p.name ?? 'Untitled project')}`, id: p.id }))) });
  });

  server.registerTool('get_lead_context', {
    description: 'Build one live context view for a sales lead, combining the lead record, matching client, related projects/tasks, and full lead activity history. Use this before AI outreach or follow-up work when a lead ID is available.',
    inputSchema: { id: uuid.describe('Lead UUID') },
  }, async ({ id }) => {
    const lead = await getById<DbRow>('leads', id);
    if (!lead) return text({ found: false, lead_id: id, message: 'Lead not found' });

    const name = String(lead.name ?? '');
    const business = String(lead.business_name ?? '');
    const pattern = encodeURIComponent(`*${business || name}*`);

    const [clients, projects, tasks, activities] = await Promise.all([
      supabaseSelect<DbRow>('clients', `select=*&or=(name.ilike.${pattern},business_name.ilike.${pattern})&order=created_at.desc&limit=10`),
      supabaseSelect<DbRow>('projects', `select=*&or=(name.ilike.${pattern},description.ilike.${pattern},notes.ilike.${pattern})&order=created_at.desc&limit=20`),
      supabaseSelect<DbRow>('tasks', `select=*&or=(title.ilike.${pattern},description.ilike.${pattern})&order=created_at.desc&limit=20`),
      supabaseSelect<DbRow>('activity_log', `select=*&entity_type=eq.lead&entity_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
    ]);

    return text({
      found: true,
      generated_at: new Date().toISOString(),
      lead,
      matching_clients: clients,
      related_projects: projects,
      related_tasks: tasks,
      activity: { total: activities.length, items: activities },
      grounding_rules: [
        'Treat lead and activity records as the source of truth for what has actually happened.',
        'Do not invent URLs, contact details, promises, meetings, travel arrangements, shipments, or prior conversations.',
        'If a required fact is missing, mark it as unknown or use a placeholder rather than guessing.',
      ],
    });
  });
}
