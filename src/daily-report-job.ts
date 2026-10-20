import { buildDailyReport, renderDailyReportHtml } from './services/daily-report.js';
import { sendEmail } from './services/email-service.js';

async function main(): Promise<void> {
  if (process.env.TAMBALA_DAILY_REPORT_ENABLED !== 'true') {
    console.log('Daily report job disabled. Set TAMBALA_DAILY_REPORT_ENABLED=true to enable sending.');
    return;
  }

  const to = process.env.TAMBALA_REPORT_TO;
  const from = process.env.TAMBALA_REPORT_FROM;
  if (!to || !from) throw new Error('TAMBALA_REPORT_TO and TAMBALA_REPORT_FROM must be configured');

  const report = await buildDailyReport(5);
  const result = await sendEmail({
    to,
    from,
    subject: `Tambala — Daily Business Brief (${new Date().toISOString().slice(0, 10)})`,
    html: renderDailyReportHtml(report),
  });

  console.log(JSON.stringify({ sent: true, message_id: result.id, to, generated_at: report.generated_at }));
}

main().catch((error) => {
  console.error('Daily report job failed:', error);
  process.exitCode = 1;
});
