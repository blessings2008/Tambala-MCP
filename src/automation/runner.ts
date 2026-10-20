import crypto from 'node:crypto';
import { rankLeads } from '../services/lead-intelligence.js';
import { buildDailyReport } from '../services/daily-report.js';
import type { AutomationMode, AutomationRunResult } from './types.js';

/**
 * Safe first-stage automation runner.
 * It prepares work but never sends prospect messages.
 * A future sender may be enabled explicitly with mode='send'.
 */
export async function runAutomation(mode: AutomationMode = 'prepare_only'): Promise<AutomationRunResult> {
  const started = new Date();
  const run_id = crypto.randomUUID();
  const warnings: string[] = [];

  const [leads, report] = await Promise.all([
    rankLeads(10),
    buildDailyReport(),
  ]);

  // Deliberately do not mutate CRM records in the first automation stage.
  // Draft persistence and channel sending will be added behind approval.
  if (mode === 'send') {
    warnings.push('Send mode is not enabled yet; no prospect messages were sent.');
  }

  const completed = new Date();
  return {
    run_id,
    mode,
    started_at: started.toISOString(),
    completed_at: completed.toISOString(),
    followups_prepared: leads.filter((lead) => Number(lead.score) >= 35).length,
    reports_sent: 0,
    tasks_flagged: report.open_tasks.filter((task: Record<string, unknown>) => {
      const due = task.due_at ?? task.due_date;
      return due ? new Date(String(due)).getTime() < Date.now() : false;
    }).length,
    warnings,
  };
}
