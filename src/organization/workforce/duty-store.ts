import { randomUUID } from 'node:crypto';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../../lib/supabase.js';

export type DutyRunStatus = 'running' | 'completed' | 'awaiting_approval' | 'skipped' | 'failed';

export interface DutyRun {
  id: string;
  duty_id: string;
  period_key: string;
  role_id: string;
  task_id: string | null;
  status: DutyRunStatus;
  attempts: number;
  summary: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface DutyStore {
  find(dutyId: string, periodKey: string): Promise<DutyRun | null>;
  /** Insert a claim. Returns null when another worker already claimed this duty and period. */
  claim(run: Omit<DutyRun, 'id'>): Promise<DutyRun | null>;
  update(id: string, patch: Partial<DutyRun>): Promise<void>;
  recent(sinceIso: string): Promise<DutyRun[]>;
}

export class SupabaseDutyStore implements DutyStore {
  async find(dutyId: string, periodKey: string): Promise<DutyRun | null> {
    const rows = await supabaseSelect<DutyRun>('organization_duty_runs',
      `select=*&duty_id=eq.${encodeURIComponent(dutyId)}&period_key=eq.${encodeURIComponent(periodKey)}&limit=1`);
    return rows[0] ?? null;
  }
  async claim(run: Omit<DutyRun, 'id'>): Promise<DutyRun | null> {
    try {
      return await supabaseInsert<DutyRun>('organization_duty_runs', run as unknown as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/409|23505|duplicate/i.test(message)) return null;
      throw error;
    }
  }
  async update(id: string, patch: Partial<DutyRun>): Promise<void> {
    await supabaseUpdate('organization_duty_runs', patch as Record<string, unknown>, `id=eq.${encodeURIComponent(id)}`);
  }
  async recent(sinceIso: string): Promise<DutyRun[]> {
    return supabaseSelect<DutyRun>('organization_duty_runs',
      `select=*&started_at=gte.${encodeURIComponent(sinceIso)}&order=started_at.desc&limit=500`);
  }
}

/** Used by tests and by local development without a database. */
export class InMemoryDutyStore implements DutyStore {
  readonly rows: DutyRun[] = [];
  async find(dutyId: string, periodKey: string) { return this.rows.find((r) => r.duty_id === dutyId && r.period_key === periodKey) ?? null; }
  async claim(run: Omit<DutyRun, 'id'>) {
    if (this.rows.some((r) => r.duty_id === run.duty_id && r.period_key === run.period_key)) return null;
    const row = { ...run, id: randomUUID() }; this.rows.push(row); return row;
  }
  async update(id: string, patch: Partial<DutyRun>) { const row = this.rows.find((r) => r.id === id); if (row) Object.assign(row, patch); }
  async recent(sinceIso: string) { return this.rows.filter((r) => r.started_at >= sinceIso); }
}
