import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { runAutomation } from '../automation/runner.js';

export function registerAutomationTools(server: McpServer): void {
  server.registerTool('run_tambala_automation', {
    description: 'Run the Tambala business automation cycle in safe prepare-only mode. It reads the live CRM, ranks leads and prepares the daily operational result; it does not contact prospects.',
    inputSchema: {
      mode: z.enum(['prepare_only', 'send']).default('prepare_only'),
    },
  }, async ({ mode }) => ({
    content: [{ type: 'text', text: JSON.stringify({
      ...(await runAutomation(mode)),
      requires_approval: true,
      note: 'Prospect messaging is not enabled by this automation action.',
    }, null, 2) }],
  }));
}
