import { supabaseInsert } from '../lib/supabase.js';

/** Best-effort audit trail write. Never throws: auditing must not break the action it records. */
export async function recordAudit(input: {
  actorRoleId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: 'success' | 'denied' | 'failed';
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await supabaseInsert('organization_audit_events', {
      actor_role_id: input.actorRoleId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      outcome: input.outcome,
      reason: input.reason,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.error('Audit write failed:', error instanceof Error ? error.message : error);
  }
}
