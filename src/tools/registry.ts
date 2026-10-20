import type { McpServer } from '@modelcontextprotocol/server';
import { registerTambalaTools } from './tambala.js';
import { registerCompanyTools } from './company.js';
import { registerPortfolioTools } from './portfolio.js';
import { registerActivityTools } from './activity.js';
import { registerClientActionTools } from './client-actions.js';
import { registerAITools } from './ai-actions.js';
import { registerLeadIntelligenceTools } from './lead-intelligence.js';
import { registerDailyReportTools } from './daily-report.js';

/** Register all MCP tool groups. Keep transport/bootstrap code out of tool modules. */
export function registerAllTools(server: McpServer): void {
  const registrars = [
    registerCompanyTools,
    registerPortfolioTools,
    registerLeadIntelligenceTools,
    registerDailyReportTools,
    registerTambalaTools,
    registerActivityTools,
    registerClientActionTools,
    registerAITools,
  ];

  for (const register of registrars) register(server);
}
