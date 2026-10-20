import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { getCompanyProfile } from '../services/business-context.js';

function text(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function registerCompanyTools(server: McpServer): void {
  server.registerTool(
    'get_company_profile',
    {
      description: 'Get Tambala Technologies company information from the database.',
      inputSchema: {
        topic: z.string().optional().describe('Optional topic such as company, location, focus, or contact.'),
      },
    },
    async ({ topic }) => text(await getCompanyProfile(topic)),
  );
}
