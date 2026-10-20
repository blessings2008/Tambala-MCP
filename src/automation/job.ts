import { buildDailyReport, renderDailyReportHtml } from '../services/daily-report.js';
import { sendEmail } from '../services/email-service.js';
import { runAutomation } from './runner.js';

async function main(): Promise<void> {
  if (process.env.TAMBALA_AUTOMATION_ENABLED !== 'true') {
    console.error('Tambala automation disabled. Set TAMBALA_AUTOMATION_ENABLED=true to enable the cron job.');
    return;
  }

  const result = await runAutomation('prepare_only');
  const report = await buildDailyReport(5);

  const to = process.env.TAMBALA_REPORT_TO;
  const from = process.env.TAMBALA_REPORT_FROM;
  if (!to || !from) throw new Error('TAMBALA_REPORT_TO and TAMBALA_REPORT_FROM must be configured');

  const email = await sendEmail({
    to,
    from,
    subject: `Tambala — Automation Brief (${new Date().toISOString().slice(0, 10)})`,
    html: renderDailyReportHtml(report),
  });

  console.log(JSON.stringify({
    automation: result,
    report_email_id: email.id,
    report_to: to,
  }));
}

main().catch((error) => {
  console.error('Tambala automation job failed:', error);
  process.exitCode = 1;
});
