import { supabaseRpc, supabaseSelect, supabaseUpdate } from '../../lib/supabase.js';

export interface DutyHeartbeat {
  id: 'duty-cycle';
  last_started_at: string | null;
  last_completed_at: string | null;
  last_error: string | null;
  alert_sent_at: string | null;
  updated_at: string;
}

export async function getDutyHeartbeat(): Promise<DutyHeartbeat | null> {
  const rows = await supabaseSelect<DutyHeartbeat>('organization_runtime_heartbeat', 'select=*&id=eq.duty-cycle&limit=1');
  return rows[0] ?? null;
}

export async function markDutyCycleStarted(now = new Date()): Promise<void> {
  await supabaseUpdate('organization_runtime_heartbeat', {
    last_started_at: now.toISOString(),
    last_error: null,
    updated_at: now.toISOString(),
  }, 'id=eq.duty-cycle');
}

export async function markDutyCycleCompleted(now = new Date()): Promise<void> {
  await supabaseUpdate('organization_runtime_heartbeat', {
    last_completed_at: now.toISOString(),
    last_error: null,
    updated_at: now.toISOString(),
  }, 'id=eq.duty-cycle');
}

export async function markDutyCycleFailed(error: unknown, now = new Date()): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 700);
  await supabaseUpdate('organization_runtime_heartbeat', {
    last_error: message,
    updated_at: now.toISOString(),
  }, 'id=eq.duty-cycle');
}

export async function claimStaleDutyAlert(now = new Date()): Promise<DutyHeartbeat | null> {
  const maxMinutes = Math.max(5, Number(process.env.TAMBALA_HEARTBEAT_MAX_MINUTES) || 30);
  const cooldownMinutes = Math.max(15, Number(process.env.TAMBALA_HEARTBEAT_ALERT_COOLDOWN_MINUTES) || 60);
  const staleBefore = new Date(now.getTime() - maxMinutes * 60_000).toISOString();
  const rows = await supabaseRpc<DutyHeartbeat>('claim_duty_heartbeat_alert', {
    p_now: now.toISOString(),
    p_stale_before: staleBefore,
    p_cooldown_seconds: cooldownMinutes * 60,
  });
  return rows[0] ?? null;
}
