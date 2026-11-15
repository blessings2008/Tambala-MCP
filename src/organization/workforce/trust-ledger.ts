import { supabaseRpc, supabaseSelect } from '../../lib/supabase.js';
import { identityForRole } from './profiles.js';

export const TRUST_APPROVAL_THRESHOLD = 20;

export function earnsStandingApproval(consecutiveApprovals: number, actionType: string, approved: boolean, unedited: boolean): boolean {
  return approved && unedited && TRUST_ELIGIBLE_ACTIONS.has(actionType) && consecutiveApprovals >= TRUST_APPROVAL_THRESHOLD;
}

export const TRUST_ELIGIBLE_ACTIONS = new Set([
  'prepared_followups',
  'prepared_work',
  'prepared_content',
  'prepared_internal_task',
]);

export interface EmployeeTrust {
  employee_number: string;
  action_type: string;
  consecutive_approvals: number;
  standing_approval: boolean;
  demoted_reason: string | null;
  updated_at: string;
}

export async function recordTrustOutcome(input: {
  requestedByRoleId: string;
  actionType: string;
  approved: boolean;
  note?: string;
  now?: Date;
}): Promise<EmployeeTrust | null> {
  const identity = identityForRole(input.requestedByRoleId);
  if (!identity || identity.employeeNumber === 'TT-000') return null;
  const eligible = TRUST_ELIGIBLE_ACTIONS.has(input.actionType);
  const rows = await supabaseRpc<EmployeeTrust>('record_employee_trust_outcome', {
    p_employee_number: identity.employeeNumber,
    p_action_type: input.actionType,
    p_approved: input.approved,
    p_unedited: !Boolean(input.note?.trim()),
    p_eligible: eligible,
    p_now: (input.now ?? new Date()).toISOString(),
  });
  return rows[0] ?? null;
}

export async function demoteEmployeeTrust(employeeNumber: string, reason: string, now = new Date()): Promise<number> {
  if (!/^TT-(?:00[1-9]|0[1-1][0-9])$/.test(employeeNumber)) return 0;
  const rows = await supabaseRpc<number>('demote_employee_trust', {
    p_employee_number: employeeNumber,
    p_reason: reason.slice(0, 240),
    p_now: now.toISOString(),
  });
  return Number(rows[0] ?? 0);
}

export async function getEmployeeTrust(employeeNumber?: string): Promise<EmployeeTrust[]> {
  const filter = employeeNumber ? `&employee_number=eq.${encodeURIComponent(employeeNumber)}` : '';
  return supabaseSelect<EmployeeTrust>('organization_employee_trust', `select=*&order=employee_number.asc,action_type.asc${filter}&limit=500`);
}
