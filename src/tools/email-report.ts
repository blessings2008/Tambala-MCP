import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { buildDailyReport, renderDailyReportHtml } from '../services/daily-report.js';
import { sendEmail } from '../services/email-service.js';

export function registerEmailReportTools(server: McpServer): void {
  server.registerTool('send_daily_report', {
    description: 'Send the grounded daily Tambala business report to the configured owner email. Sending requires explicit confirmation.',
    inputSchema: {
      confirm: z.boolean().default(false),
      limit: z.number().int().min(1).max(10).default(5),
    },
  }, async ({ confirm, limit }) => {
    if (!confirm) {
      return { content: [{ type: 'text', text: JSON.stringify({ requires_approval: true, message: 'Set confirm=true to send the daily report.' }, null, 2) }] };
    }

    const to = process.env.TAMBALA_REPORT_TO;
    const from = process.env.TAMBALA_REPORT_FROM;
    if (!to || !from) {
      throw new Error('TAMBALA_REPORT_TO and TAMBALA_REPORT_FROM must be configured');
    }

    const report = await buildDailyReport(limit);
    const result = await sendEmail({
      to,
      from,
      subject: `Tambala — Daily Business Brief (${new Date().toISOString().slice(0, 10)})`,
      html: renderDailyReportHtml(report),
    });

    return { content: [{ type: 'text', text: JSON.stringify({ sent: true, message_id: result.id, to, requires_approval: false }, null, 2) }] };
  });
}
