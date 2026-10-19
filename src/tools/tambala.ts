import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseSelect } from '../lib/supabase.js';

const services = [
  { name: 'Web Development', description: 'Responsive websites and web applications for businesses and organizations.' },
  { name: 'Software Development', description: 'Custom software and digital products built around specific business needs.' },
  { name: 'Digital Product Development', description: 'Design and development of digital products and platforms.' },
];

const products = [
  { name: 'PocketVault', category: 'Savings platform', description: 'A digital savings product designed around organized savings goals and contributions.' },
  { name: 'Tambala Pay', category: 'Payments', description: 'A planned Tambala payments product.' },
  { name: 'Tambala Email', category: 'Business communication', description: 'A planned Tambala email service.' },
];

function text(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

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
    description: 'List Tambala services stored in the MCP.',
    inputSchema: {},
  }, async () => text(services));

  server.registerTool('list_products', {
    description: 'List Tambala products stored in the MCP.',
    inputSchema: {},
  }, async () => text(products));

  server.registerTool('list_clients', {
    description: 'List clients from the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('clients')));

  server.registerTool('list_projects', {
    description: 'List projects from the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('projects')));

  server.registerTool('list_leads', {
    description: 'List leads from the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('leads')));

  server.registerTool('list_tasks', {
    description: 'List tasks from the Tambala MCP database.',
    inputSchema: {},
  }, async () => text(await supabaseSelect('tasks')));
}
