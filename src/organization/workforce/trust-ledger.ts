import { supabaseRpc, supabaseSelect } from '../../lib/supabase.js';
import { identityForRole } from './profiles.js';

export const TRUST_APPROVAL_THRESHOLD = 20;

export function earnsStandingApproval(consecutiveApprovals: number, actionType: string, approved: boolean, unedited: boolean, riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low', customerFacing = false): boolean {
  return approved && unedited && riskLevel === 'low' && !customerFacing
    && TRUST_ELIGIBLE_ACTIONS.has(actionType) && consecutiveApprovals >= TRUST_APPROVAL_THRESHOLD;
}

export const STANDING_APPROVAL_DAILY_CAPS: Readonly<Record<string, number>> = Object.freeze({
  prepared_work: 5,
  prepared_content: 3,
  prepared_internal_task: 5,
});

export function mayUseStandingApproval(input: {
  standingApproval: boolean;
  actionType: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  customerFacing: boolean;
  reservedAuthority: boolean;
  usedToday: number;
}): { allowed: boolean; reason: string } {
  if (!input.standingApproval) return { allowed: false, reason: 'No standing approval has been earned for this employee and action type.' };
  if (!TRUST_ELIGIBLE_ACTIONS.has(input.actionType)) return { allowed: false, reason: 'This action type is not eligible for standing approval.' };
  if (input.riskLevel !== 'low') return { allowed: false, reason: 'Only low-risk actions may use standing approval.' };
  if (input.customerFacing) return { allowed: false, reason: 'Customer-facing actions always require Founder approval.' };
  if (input.reservedAuthority) return { allowed: false, reason: 'This action is reserved to the Founder.' };
  const cap = STANDING_APPROVAL_DAILY_CAPS[input.actionType] ?? 0;
  if (cap < 1 || input.usedToday >= cap) return { allowed: false, reason: 'The standing-approval daily cap has been reached or is not configured.' };
  return { allowed: true, reason: 'Within the earned low-risk standing-approval limit.' };
}

export const TRUST_ELIGIBLE_ACTIONS = new Set([
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
  unedited: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  now?: Date;
}): Promise<EmployeeTrust | null> {
  const identity = identityForRole(input.requestedByRoleId);
  if (!identity || identity.employeeNumber === 'TT-000') return null;
  const eligible = TRUST_ELIGIBLE_ACTIONS.has(input.actionType) && input.riskLevel === 'low';
  const rows = await supabaseRpc<EmployeeTrust>('record_employee_trust_outcome', {
    p_employee_number: identity.employeeNumber,
    p_action_type: input.actionType,
    p_approved: input.approved,
    p_unedited: input.unedited,
    p_eligible: eligible,
    p_risk_level: input.riskLevel,
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
