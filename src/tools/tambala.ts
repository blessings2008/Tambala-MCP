import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseSelect } from '../lib/supabase.js';
import { getById, insertRow, updateRow } from '../lib/database.js';

function text(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const datetime = z.string().datetime({ offset: true });

const clientStatus = z.enum(['lead', 'active', 'inactive', 'archived']);
const leadStatus = z.enum(['new', 'contacted', 'interested', 'demo_sent', 'negotiating', 'won', 'lost', 'follow_up']);
const projectStatus = z.enum(['planning', 'active', 'waiting_client', 'review', 'completed', 'cancelled', 'on_hold']);
const priority = z.enum(['low', 'normal', 'high', 'urgent']);
const taskStatus = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);

export function registerTambalaTools(server: McpServer): void {
  server.registerTool('get_company_info', {
    description: 'Get the official basic profile of Tambala Technologies.',
    inputSchema: { topic: z.string().optional().describe('Optional topic such as company, focus, or location.') },
  }, async ({ topic }) => text({
    company: 'Tambala Technologies',
    country: 'Malawi',
    focus: 'Software, websites, and digital products',
    topic: topic ?? 'general',
  }));

  server.registerTool('list_services', {
    description: 'List services stored in the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('services')));

  server.registerTool('list_products', {
    description: 'List products stored in the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('products')));

  server.registerTool('list_clients', {
    description: 'List clients from the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('clients')));

  server.registerTool('get_client', {
    description: 'Get one Tambala client by UUID.',
    inputSchema: { id: uuid.describe('Client UUID') },
  }, async ({ id }) => text(await getById('clients', id)));

  server.registerTool('create_client', {
    description: 'Create a new Tambala client. Use only when explicitly asked to add a client.',
    inputSchema: {
      name: z.string().min(1),
      business_name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
      location: z.string().optional(),
      status: clientStatus.optional(),
      notes: z.string().optional(),
    },
  }, async (input) => text(await insertRow('clients', input)));

  server.registerTool('update_client', {
    description: 'Update an existing Tambala client. Only supplied fields are changed.',
    inputSchema: {
      id: uuid.describe('Client UUID'),
      name: z.string().min(1).optional(),
      business_name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
      location: z.string().optional(),
      status: clientStatus.optional(),
      notes: z.string().optional(),
    },
  }, async ({ id, ...input }) => text(await updateRow('clients', id, input)));

  server.registerTool('list_projects', {
    description: 'List projects from the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('projects')));

  server.registerTool('get_project', {
    description: 'Get one Tambala project by UUID.',
    inputSchema: { id: uuid.describe('Project UUID') },
  }, async ({ id }) => text(await getById('projects', id)));

  server.registerTool('create_project', {
    description: 'Create a project. Use only when explicitly asked to add one.',
    inputSchema: {
      name: z.string().min(1),
      client_id: uuid.optional(),
      description: z.string().optional(),
      project_type: z.string().optional(),
      status: projectStatus.optional(),
      priority: priority.optional(),
      budget: z.number().nonnegative().optional(),
      start_date: date.optional(),
      due_date: date.optional(),
      repository_url: z.string().url().optional(),
      live_url: z.string().url().optional(),
      notes: z.string().optional(),
    },
  }, async (input) => text(await insertRow('projects', input)));

  server.registerTool('update_project', {
    description: 'Update an existing project. Only supplied fields are changed.',
    inputSchema: {
      id: uuid.describe('Project UUID'),
      name: z.string().min(1).optional(),
      client_id: uuid.optional(),
      description: z.string().optional(),
      project_type: z.string().optional(),
      status: projectStatus.optional(),
      priority: priority.optional(),
      budget: z.number().nonnegative().optional(),
      start_date: date.optional(),
      due_date: date.optional(),
      repository_url: z.string().url().optional(),
      live_url: z.string().url().optional(),
      notes: z.string().optional(),
    },
  }, async ({ id, ...input }) => text(await updateRow('projects', id, input)));

  server.registerTool('list_leads', {
    description: 'List sales leads from the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('leads')));

  server.registerTool('get_lead', {
    description: 'Get one sales lead by UUID.',
    inputSchema: { id: uuid.describe('Lead UUID') },
  }, async ({ id }) => text(await getById('leads', id)));

  server.registerTool('create_lead', {
    description: 'Create a new sales lead. Use only when explicitly asked to add one.',
    inputSchema: {
      name: z.string().min(1),
      business_name: z.string().optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
      email: z.string().email().optional(),
      source: z.string().optional(),
      status: leadStatus.optional(),
      notes: z.string().optional(),
      next_follow_up_at: datetime.optional(),
    },
  }, async (input) => text(await insertRow('leads', input)));

  server.registerTool('update_lead', {
    description: 'Update an existing sales lead. Only supplied fields are changed.',
    inputSchema: {
      id: uuid.describe('Lead UUID'),
      name: z.string().min(1).optional(),
      business_name: z.string().optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
      email: z.string().email().optional(),
      source: z.string().optional(),
      status: leadStatus.optional(),
      notes: z.string().optional(),
      next_follow_up_at: datetime.optional(),
    },
  }, async ({ id, ...input }) => text(await updateRow('leads', id, input)));

  server.registerTool('list_tasks', {
    description: 'List tasks from the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('tasks')));

  server.registerTool('get_task', {
    description: 'Get one task by UUID.',
    inputSchema: { id: uuid.describe('Task UUID') },
  }, async ({ id }) => text(await getById('tasks', id)));

  server.registerTool('create_task', {
    description: 'Create a task. Use only when explicitly asked to add one.',
    inputSchema: {
      title: z.string().min(1),
      project_id: uuid.optional(),
      client_id: uuid.optional(),
      description: z.string().optional(),
      status: taskStatus.optional(),
      priority: priority.optional(),
      due_at: datetime.optional(),
    },
  }, async (input) => text(await insertRow('tasks', input)));

  server.registerTool('update_task', {
    description: 'Update an existing task. Only supplied fields are changed.',
    inputSchema: {
      id: uuid.describe('Task UUID'),
      title: z.string().min(1).optional(),
      project_id: uuid.optional(),
      client_id: uuid.optional(),
      description: z.string().optional(),
      status: taskStatus.optional(),
      priority: priority.optional(),
      due_at: datetime.optional(),
      completed_at: datetime.optional(),
    },
  }, async ({ id, ...input }) => text(await updateRow('tasks', id, input)));

  server.registerTool('get_business_summary', {
    description: 'Get a live high-level summary of Tambala clients, leads, projects, tasks, services, and products.',
    inputSchema: {},
  }, async () => {
    const [clients, leads, projects, tasks, services, products] = await Promise.all([
      supabaseSelect('clients'),
      supabaseSelect('leads'),
      supabaseSelect('projects'),
      supabaseSelect('tasks'),
      supabaseSelect('services'),
      supabaseSelect('products'),
    ]);

    const countBy = (rows: Array<Record<string, unknown>>, field: string) => rows.reduce<Record<string, number>>((acc, row) => {
      const value = String(row[field] ?? 'unknown');
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});

    return text({
      generated_at: new Date().toISOString(),
      totals: {
        clients: clients.length,
        leads: leads.length,
        projects: projects.length,
        tasks: tasks.length,
        active_services: services.filter((row) => row.active === true).length,
        products: products.length,
      },
      by_status: {
        clients: countBy(clients, 'status'),
        leads: countBy(leads, 'status'),
        projects: countBy(projects, 'status'),
        tasks: countBy(tasks, 'status'),
      },
    });
  });

  server.registerTool('get_active_projects', {
    description: 'Get projects currently active or waiting on a client, ordered by due date.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('projects', 'select=*&status=in.(active,waiting_client,review,on_hold)&order=due_date.asc.nullslast')));

  server.registerTool('get_overdue_tasks', {
    description: 'Get unfinished tasks whose due time has passed.',
    inputSchema: {},
  }, async () => {
    const now = new Date().toISOString();
    const query = `select=*&due_at=lt.${encodeURIComponent(now)}&status=not.in.(done,cancelled)&order=due_at.asc`;
    return text(await supabaseSelect('tasks', query));
  });

  server.registerTool('get_follow_ups_due', {
    description: 'Get sales leads whose follow-up time is due or overdue, excluding won and lost leads.',
    inputSchema: {},
  }, async () => {
    const now = new Date().toISOString();
    const query = `select=*&next_follow_up_at=not.is.null&next_follow_up_at=lte.${encodeURIComponent(now)}&status=not.in.(won,lost)&order=next_follow_up_at.asc`;
    return text(await supabaseSelect('leads', query));
  });

  server.registerTool('get_sales_pipeline', {
    description: 'Summarize the current sales pipeline by lead status and return the underlying leads.',
    inputSchema: {},
  }, async () => {
    const leads = await supabaseSelect('leads');
    const byStatus = leads.reduce<Record<string, number>>((acc, lead) => {
      const status = String(lead.status ?? 'unknown');
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});
    return text({ total_leads: leads.length, by_status: byStatus, leads });
  });

  server.registerTool('get_client_summary', {
    description: 'Get a client together with their projects and tasks.',
    inputSchema: { id: uuid.describe('Client UUID') },
  }, async ({ id }) => {
    const [client, projects, tasks] = await Promise.all([
      getById('clients', id),
      supabaseSelect('projects', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_date.asc.nullslast`),
      supabaseSelect('tasks', `select=*&client_id=eq.${encodeURIComponent(id)}&order=due_at.asc.nullslast`),
    ]);
    return text({ client, projects, tasks });
  });
}
