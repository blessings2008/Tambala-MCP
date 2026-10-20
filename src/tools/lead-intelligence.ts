import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { rankLeads } from '../services/lead-intelligence.js';

export function registerLeadIntelligenceTools(server: McpServer): void {
  server.registerTool('rank_leads', {
    description: 'Rank active leads by evidence-based sales priority. Read-only; excludes archived, cancelled, lost, closed and test records.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
  }, async ({ limit }) => ({
    content: [{ type: 'text', text: JSON.stringify({
      leads: await rankLeads(limit),
      rules: 'Scores use CRM status, follow-up timing, recent activity and available contact/context fields. No inferred revenue, interest or conversion rates are used.',
      requires_approval: false,
    }, null, 2) }],
  }));
}
