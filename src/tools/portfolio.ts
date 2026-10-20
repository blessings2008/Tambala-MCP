import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { getApprovedPortfolio } from '../services/portfolio.js';

export function registerPortfolioTools(server: McpServer): void {
  server.registerTool(
    'get_verified_portfolio',
    {
      description: 'Return only portfolio items approved for prospect-facing use. Never invent or infer portfolio links.',
      inputSchema: z.object({ category: z.string().optional() }),
    },
    async ({ category }) => ({
      content: [{ type: 'text', text: JSON.stringify(await getApprovedPortfolio(category), null, 2) }],
    }),
  );
}
