import { insertRow, supabaseSelect, updateRow } from '../lib/database.js';

type Row = Record<string, unknown>;

export interface ProcessPreparedActionsResult {
  processed: number;
  skipped: number;
  failed: number;
  warnings: string[];
}

/**
 * Processes prepared automation actions without contacting prospects.
 * This is intentionally approval-gated: only actions explicitly marked
 * `approved` are eligible for execution in a future channel adapter.
 */
export async function processPreparedActions(runId: string): Promise<ProcessPreparedActionsResult> {
  const actions = await supabaseSelect<Row>('automation_actions', {
    run_id: `eq.${runId}`,
    status: 'eq.prepared',
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const warnings: string[] = [];

  for (const action of actions) {
    if (action.status !== 'prepared') {
      skipped += 1;
      continue;
    }

    // Prepare-only stage: never send or mutate prospect communication.
    await updateRow<Row>('automation_actions', String(action.id), {
      status: 'prepared',
    });
    processed += 1;
  }

  if (actions.length === 0) {
    warnings.push('No prepared automation actions were found for this run.');
  }

  return { processed, skipped, failed, warnings };
}

/** Create a durable approval request without sending anything. */
export async function approveAction(actionId: string): Promise<Row> {
  const rows = await supabaseSelect<Row>('automation_actions', {
    id: `eq.${actionId}`,
    limit: '1',
  });
  const action = rows[0];
  if (!action) throw new Error('Automation action not found');
  if (action.status !== 'prepared') throw new Error(`Action cannot be approved from status: ${String(action.status)}`);

  return updateRow<Row>('automation_actions', actionId, {
    status: 'approved',
  });
}

/** Record a completed execution after a real channel adapter succeeds. */
export async function markActionSent(actionId: string, providerResult: Row = {}): Promise<Row> {
  const rows = await supabaseSelect<Row>('automation_actions', { id: `eq.${actionId}`, limit: '1' });
  const action = rows[0];
  if (!action) throw new Error('Automation action not found');
  if (action.status !== 'approved') throw new Error(`Action must be approved before sending; current status: ${String(action.status)}`);

  return updateRow<Row>('automation_actions', actionId, {
    status: 'sent',
    payload: { ...(typeof action.payload === 'object' && action.payload ? action.payload : {}), provider_result: providerResult },
  });
}
