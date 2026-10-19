import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { getById, updateRow } from '../lib/database.js';

const uuid = z.string().uuid();

type ToolText = { content: Array<{ type: 'text'; text: string }> };

function text(value: unknown): ToolText {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function registerClientActionTools(server: McpServer): void {
  server.registerTool(
    'delete_client',
    {
      description:
        'Archive one Tambala client by UUID. Requires explicit confirmation and preserves the record for audit and recovery.',
      inputSchema: {
        id: uuid.describe('Client UUID'),
        confirm: z.literal(true).describe('Must be true to confirm the removal.'),
      },
    },
    async ({ id, confirm }) => {
      if (confirm !== true) {
        return text({ removed: false, error: 'Removal requires confirm=true.' });
      }

      const client = await getById<Record<string, unknown>>('clients', id);
      if (!client) {
        return text({ removed: false, error: `No client found with id ${id}` });
      }

      const updated = await updateRow<Record<string, unknown>>('clients', id, {
        status: 'archived',
      });

      return text({
        removed: true,
        client_id: id,
        status: updated.status,
        message: 'Client removed from active records and preserved as archived.',
      });
    },
  );
}
