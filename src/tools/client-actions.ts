import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { getById, updateRow } from '../lib/database.js';

const uuid = z.string().uuid();
type ToolText = { content: Array<{ type: 'text'; text: string }> };
function text(value: unknown): ToolText { return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }; }

export function registerClientActionTools(server: McpServer): void {
  server.registerTool('archive_client', {
    description: 'Archive one Tambala client by UUID. This does not permanently delete data and requires explicit confirmation.',
    inputSchema: { id: uuid.describe('Client UUID'), confirm: z.literal(true).describe('Must be true to confirm archiving.') },
  }, async ({ id, confirm }) => {
    if (confirm !== true) return text({ archived: false, error: 'Archiving requires confirm=true.' });
    const client = await getById<Record<string, unknown>>('clients', id);
    if (!client) return text({ archived: false, error: `No client found with id ${id}` });
    const updated = await updateRow<Record<string, unknown>>('clients', id, { status: 'archived' });
    return text({ archived: true, client_id: id, status: updated.status, message: 'Client archived and preserved for recovery.' });
  });
}
