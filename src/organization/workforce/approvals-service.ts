import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../../lib/supabase.js';
import { recordAudit } from '../audit.js';
import { recordOrganizationTaskEvent } from '../task-store.js';
import { signWork } from './sign-work.js';

export type ApprovalRow = {
  id: string; action_type: string; summary: string; requested_by_role_id: string; required_authority: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; risk_level: 'low' | 'medium' | 'high' | 'critical';
  resolution_note: string | null; resolved_by_role_id: string | null; task_id: string | null; content: string | null;
  subject_type: string | null; subject_id: string | null;
  created_at: string; resolved_at: string | null;
};

export class ApprovalError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}

/** Something that must happen after a decision, e.g. sending a message once it is approved. */
type ApprovalHook = (approval: ApprovalRow, decision: 'approved' | 'rejected', note: string) => Promise<void>;
const hooks = new Map<string, ApprovalHook>();
export function registerApprovalHook(subjectType: string, hook: ApprovalHook): void { hooks.set(subjectType, hook); }

export async function createApprovalRequest(input: {
  actionType: string; summary: string; requestedByRoleId: string; riskLevel: 'low' | 'medium' | 'high' | 'critical'; taskId: string | null; content: string;
  subjectType?: string; subjectId?: string;
}): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const row = await supabaseInsert<{ id: string }>('organization_approval_requests', {
    action_type: input.actionType, summary: input.summary.slice(0, 500), requested_by_role_id: input.requestedByRoleId,
    required_authority: 'founder', status: 'pending', risk_level: input.riskLevel, task_id: input.taskId, content: input.content,
    subject_type: input.subjectType ?? null, subject_id: input.subjectId ?? null,
  });
  return row.id;
}

export async function listPendingApprovals(): Promise<ApprovalRow[]> {
  return supabaseSelect<ApprovalRow>('organization_approval_requests',
    'select=*&status=eq.pending&order=created_at.asc&limit=50');
}

/** Founder decision. The conditional update stops two decisions racing on the same request. */
export async function decideApproval(input: {
  id: string; decision: 'approved' | 'rejected'; note?: string; deciderRoleId?: string;
}): Promise<ApprovalRow & { signature: string | null }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(input.id)) throw new ApprovalError('Invalid approval id.', 400);
  if (input.decision !== 'approved' && input.decision !== 'rejected') throw new ApprovalError('Decision must be approved or rejected.', 400);
  const note = (input.note ?? '').trim().slice(0, 1000);
  if (input.decision === 'rejected' && !note) throw new ApprovalError('Add a short reason when rejecting, so the employee can improve.', 400);
  const deciderRoleId = input.deciderRoleId ?? 'founder';

  const rows = await supabaseSelect<ApprovalRow>('organization_approval_requests', `select=*&id=eq.${input.id}&limit=1`);
  const current = rows[0];
  if (!current) throw new ApprovalError('Approval request not found.', 404);
  if (current.status !== 'pending') throw new ApprovalError(`This request was already ${current.status}.`, 409);

  let updated: ApprovalRow;
  try {
    updated = await supabaseUpdate<ApprovalRow>('organization_approval_requests', {
      status: input.decision, resolution_note: note || null, resolved_by_role_id: deciderRoleId, resolved_at: new Date().toISOString(),
    }, `id=eq.${input.id}&status=eq.pending`);
  } catch (error) {
    if (error instanceof Error && /returned no record/.test(error.message)) throw new ApprovalError('This request was just resolved by someone else.', 409);
    throw error;
  }

  const stamp = await signWork({ roleId: deciderRoleId, kind: 'approval_decision', subjectId: input.id, content: `${input.decision}\n${current.summary}\n${note}` });
  await recordAudit({ actorRoleId: deciderRoleId, action: `approval:${input.decision}`, targetType: 'approval_request', targetId: input.id, outcome: 'success', reason: note || `${input.decision} without a note`, metadata: { actionType: current.action_type, requestedBy: current.requested_by_role_id, signature: stamp.fingerprint } });
  if (current.task_id) {
    try {
      await recordOrganizationTaskEvent({ taskId: current.task_id, eventType: input.decision === 'approved' ? 'founder_approved' : 'founder_rejected', stage: 'review', actorRoleId: deciderRoleId, payload: { approvalId: input.id, note: note || null, signature: stamp.fingerprint } });
    } catch (error) { console.error('Could not link decision to task:', error instanceof Error ? error.message : error); }
  }
  const hook = current.subject_type ? hooks.get(current.subject_type) : undefined;
  if (hook) {
    try { await hook(current, input.decision, note); }
    catch (error) { console.error('Approval follow-up failed:', error instanceof Error ? error.message : error); }
  }
  return { ...updated, signature: stamp.fingerprint };
}
