import { insertRow, supabaseSelect, updateRow } from '../lib/database.js';
import { rankLeads } from '../services/lead-intelligence.js';
import { buildDailyReport } from '../services/daily-report.js';
import type { AutomationMode, AutomationRunResult } from './types.js';

type Row = Record<string, unknown>;

export async function runAutomation(mode: AutomationMode = 'prepare_only'): Promise<AutomationRunResult> {
  const started = new Date();
  const runKey = `${started.toISOString().slice(0, 10)}:${mode}`;
  const existing = await supabaseSelect<Row>('automation_runs', { run_key: `eq.${runKey}`, limit: '1' });

  if (existing[0]?.status === 'completed') {
    const row = existing[0];
    return {
      run_id: String(row.id), mode,
      started_at: String(row.started_at), completed_at: String(row.completed_at ?? row.started_at),
      followups_prepared: Number(row.followups_prepared ?? 0),
      reports_sent: Number(row.reports_sent ?? 0),
      tasks_flagged: Number(row.tasks_flagged ?? 0),
      warnings: ['This cycle was already completed; duplicate preparation was skipped.'],
    };
  }

  const run = existing[0] ?? await insertRow<Row>('automation_runs', {
    run_key: runKey, mode, status: 'running', started_at: started.toISOString(),
  });
  const runId = String(run.id);

  try {
    const [leads, report] = await Promise.all([rankLeads(10), buildDailyReport()]);
    const actionable = leads.filter((lead) => Number(lead.score) >= 35);
    const overdueTasks = report.open_tasks.filter((task: Row) => {
      const due = task.due_at ?? task.due_date;
      return due ? new Date(String(due)).getTime() < Date.now() : false;
    });

    for (const lead of actionable) {
      const actionKey = `followup:${String(lead.id)}`;
      const found = await supabaseSelect<Row>('automation_actions', {
        run_id: `eq.${runId}`, action_key: `eq.${actionKey}`, limit: '1',
      });
      if (found.length) continue;
      await insertRow<Row>('automation_actions', {
        run_id: runId, action_key: actionKey, action_type: 'prepare_followup',
        lead_id: lead.id, status: 'prepared',
        payload: { score: lead.score, reasons: lead.reasons, next_action: lead.next_action },
      });
    }

    const completed = new Date();
    const result: AutomationRunResult = {
      run_id: runId, mode, started_at: started.toISOString(), completed_at: completed.toISOString(),
      followups_prepared: actionable.length, reports_sent: 0, tasks_flagged: overdueTasks.length, warnings: [],
    };
    await updateRow<Row>('automation_runs', runId, {
      status: 'completed', completed_at: completed.toISOString(),
      followups_prepared: result.followups_prepared, reports_sent: 0,
      tasks_flagged: result.tasks_flagged, warnings: [],
    });
    return result;
  } catch (error) {
    await updateRow<Row>('automation_runs', runId, {
      status: 'failed', completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}
