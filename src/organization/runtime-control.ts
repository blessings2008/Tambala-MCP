import { supabaseSelect, supabaseUpdate } from '../lib/supabase.js';
import { dbConfigured } from './workforce/db-util.js';

export interface RuntimeControl {
  id: 'global';
  paused: boolean;
  reason: string | null;
  paused_at: string | null;
  paused_by_role_id: string | null;
  updated_at: string;
}

export class RuntimePausedError extends Error {
  constructor(readonly reason: string | null) {
    super(reason ? 'Tambala organization is paused: ' + reason : 'Tambala organization is paused by the Founder.');
  }
}

export async function getRuntimeControl(): Promise<RuntimeControl> {
  if (!dbConfigured()) {
    return {
      id: 'global',
      paused: process.env.TAMBALA_PAUSE_ALL === 'true',
      reason: process.env.TAMBALA_PAUSE_ALL === 'true' ? 'Environment pause switch' : null,
      paused_at: null,
      paused_by_role_id: null,
      updated_at: new Date().toISOString(),
    };
  }
  const rows = await supabaseSelect<RuntimeControl>('organization_runtime_control', 'select=*&id=eq.global&limit=1');
  if (!rows[0]) throw new Error('Global runtime control row is missing. Apply the runtime reliability migration.');
  return rows[0];
}

export async function isRuntimePaused(): Promise<boolean> {
  try { return (await getRuntimeControl()).paused; }
  catch (error) {
    // When persistence is configured but unreachable, fail closed rather than run unsupervised.
    if (dbConfigured()) throw new RuntimePausedError('Runtime control could not be checked because the database is unavailable.');
    throw error;
  }
}

export async function assertRuntimeActive(): Promise<void> {
  if (await isRuntimePaused()) {
    const state = await getRuntimeControl();
    throw new RuntimePausedError(state.reason);
  }
}

export async function setRuntimePaused(paused: boolean, reason: string | null, roleId: string): Promise<RuntimeControl> {
  if (!dbConfigured()) throw new Error('The global pause switch requires the database and runtime reliability migration.');
  const now = new Date().toISOString();
  return supabaseUpdate<RuntimeControl>('organization_runtime_control', {
    paused,
    reason: paused ? (reason?.trim().slice(0, 500) || 'Paused by Founder') : null,
    paused_at: paused ? now : null,
    paused_by_role_id: paused ? roleId : null,
    updated_at: now,
  }, 'id=eq.global');
}
