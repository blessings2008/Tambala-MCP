import { insertRow, supabaseSelect, updateRow } from '../lib/database.js';

type AutomationRun = Record<string, unknown> & { id: string; status: string };

export async function findCompletedRun(runKey: string): Promise<AutomationRun | null> {
  const rows = await supabaseSelect<AutomationRun>('automation_runs', {
    run_key: `eq.${encodeURIComponent(runKey)}`,
    status: 'eq.completed',
    limit: '1',
  });
  return rows[0] ?? null;
}

export async function createAutomationRun(runKey: string, mode: string, startedAt: string): Promise<AutomationRun> {
  return insertRow<AutomationRun>('automation_runs', {
    run_key: runKey,
    mode,
    status: 'running',
    started_at: startedAt,
  });
}

export async function recordAutomationAction(input: {
  runId: string;
  actionKey: string;
  actionType: string;
  leadId?: string | null;
  taskId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await insertRow('automation_actions', {
      run_id: input.runId,
      action_key: input.actionKey,
      action_type: input.actionType,
      lead_id: input.leadId ?? null,
      task_id: input.taskId ?? null,
      status: 'prepared',
      payload: input.payload ?? {},
    });
  } catch (error) {
    // Unique action keys make retries safe. A duplicate is already prepared.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('duplicate') && !message.includes('23505')) throw error;
  }
}

export async function completeAutomationRun(
  runId: string,
  result: {
    completedAt: string;
    followupsPrepared: number;
    reportsSent: number;
    tasksFlagged: number;
    warnings: string[];
  },
): Promise<void> {
  await updateRow('automation_runs', runId, {
    status: 'completed',
    completed_at: result.completedAt,
    followups_prepared: result.followupsPrepared,
    reports_sent: result.reportsSent,
    tasks_flagged: result.tasksFlagged,
    warnings: result.warnings,
    error: null,
  });
}

export async function failAutomationRun(runId: string, error: unknown): Promise<void> {
  await updateRow('automation_runs', runId, {
    status: 'failed',
    completed_at: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  });
}
