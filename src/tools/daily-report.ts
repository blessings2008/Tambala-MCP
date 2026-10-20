import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { buildDailyReport, renderDailyReportHtml } from '../services/daily-report.js';

export function registerDailyReportTools(server: McpServer): void {
  server.registerTool('preview_daily_report', {
    description: 'Build a grounded daily Tambala business report from the CRM. Read-only; does not send email or modify records.',
    inputSchema: { limit: z.number().int().min(1).max(10).default(5) },
  }, async ({ limit }) => {
    const report = await buildDailyReport(limit);
    return {
      content: [{ type: 'text', text: JSON.stringify({ report, html: renderDailyReportHtml(report), requires_approval: false }, null, 2) }],
    };
  });
}
