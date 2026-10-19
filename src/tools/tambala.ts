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
}
