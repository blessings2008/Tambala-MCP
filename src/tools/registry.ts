import type { McpServer } from '@modelcontextprotocol/server';
import { registerTambalaTools } from './tambala.js';
import { registerCompanyTools } from './company.js';
import { registerPortfolioTools } from './portfolio.js';
import { registerActivityTools } from './activity.js';
import { registerClientActionTools } from './client-actions.js';
import { registerAITools } from './ai-actions.js';

/** Register all MCP tool groups. Keep transport/bootstrap code out of tool modules. */
export function registerAllTools(server: McpServer): void {
  const registrars = [
    registerCompanyTools,
    registerPortfolioTools,
    registerTambalaTools,
    registerActivityTools,
    registerClientActionTools,
    registerAITools,
  ];

  for (const register of registrars) register(server);
}
