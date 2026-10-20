import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseSelect } from '../lib/database.js';
import { approveAction, markActionSent } from '../automation/action-processor.js';

type Row = Record<string, unknown>;

export function registerAutomationActionTools(server: McpServer): void {
  server.registerTool('list_pending_automation_actions', {
    description: 'List automation actions waiting for Bless to review. Read-only.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).default(20),
    },
  }, async ({ limit }) => {
    const actions = await supabaseSelect<Row>('automation_actions', {
      status: 'eq.prepared',
      limit: String(limit),
      order: 'created_at.desc',
    });
    return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] };
  });

  server.registerTool('approve_automation_action', {
    description: 'Explicitly approve one prepared automation action. Approval does not send a prospect message.',
    inputSchema: { action_id: z.string().min(1) },
  }, async ({ action_id }) => {
    const action = await approveAction(action_id);
    return { content: [{ type: 'text', text: JSON.stringify({ action, approved: true, requires_channel_execution: true }, null, 2) }] };
  });

  server.registerTool('mark_automation_action_sent', {
    description: 'Mark an approved automation action as sent after an external channel adapter has successfully delivered it.',
    inputSchema: {
      action_id: z.string().min(1),
      provider_result: z.record(z.string(), z.unknown()).default({}),
    },
  }, async ({ action_id, provider_result }) => {
    const action = await markActionSent(action_id, provider_result);
    return { content: [{ type: 'text', text: JSON.stringify({ action, sent: true }, null, 2) }] };
  });
}
