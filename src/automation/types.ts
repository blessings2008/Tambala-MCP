export type AutomationMode = 'prepare_only' | 'send';

export interface AutomationRunResult {
  run_id: string;
  mode: AutomationMode;
  started_at: string;
  completed_at: string;
  followups_prepared: number;
  reports_sent: number;
  tasks_flagged: number;
  warnings: string[];
}
