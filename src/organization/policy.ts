import type {
  ApprovalAuthority,
  OrganizationalRole,
} from './model.js';

export type OrganizationalAction =
  | 'read_organization'
  | 'read_operational_records'
  | 'coordinate_work'
  | 'delegate_work'
  | 'create_report'
  | 'advise_on_decision'
  | 'review_strategy'
  | 'resolve_founder_approval'
  | 'resolve_board_approval'
  | 'launch_major_venture'
  | 'commit_material_funds'
  | 'change_mission'
  | 'close_major_business_unit'
  | 'send_sensitive_external_communication'
  | 'execute_financial_transaction'
  | 'manage_department_workflow';

export interface AuthorizationRequest {
  actorRole: OrganizationalRole | null;
  action: OrganizationalAction;
  /** True only when an independently recorded approval is supplied and validated. */
  approval?: {
    authority: ApprovalAuthority;
    approved: boolean;
    approvalId: string;
  } | null;
}

export interface AuthorizationResult {
  allowed: boolean;
  requiresApproval: boolean;
  requiredAuthority: ApprovalAuthority | null;
  reason: string;
}

const ACTION_CAPABILITY: Partial<Record<OrganizationalAction, string>> = {
  read_organization: 'organization.view_all',
  read_operational_records: 'organization.view_operational',
  coordinate_work: 'work.coordinate',
  delegate_work: 'work.delegate',
  create_report: 'reports.create',
  advise_on_decision: 'decisions.advise',
  review_strategy: 'strategy.review',
  resolve_founder_approval: 'approvals.resolve_founder',
  resolve_board_approval: 'approvals.resolve_board',
  manage_department_workflow: 'department.workflow.manage',
};

const RESTRICTED_ACTIONS: Partial<Record<OrganizationalAction, ApprovalAuthority>> = {
  launch_major_venture: 'founder',
  commit_material_funds: 'founder',
  change_mission: 'founder',
  close_major_business_unit: 'founder',
  send_sensitive_external_communication: 'ceo',
  execute_financial_transaction: 'founder',
};

/**
 * Pure deterministic policy decision. Callers must resolve actor roles from
 * trusted stored records; never pass an AI-generated role definition directly.
 * This function does not execute actions or validate an approval against storage.
 */
export function authorizeOrganizationalAction(
  request: AuthorizationRequest,
): AuthorizationResult {
  const { actorRole, action, approval } = request;

  if (!actorRole) {
    return {
      allowed: false,
      requiresApproval: false,
      requiredAuthority: null,
      reason: 'Denied: actor role was not resolved from trusted organizational records.',
    };
  }

  const requiredAuthority = RESTRICTED_ACTIONS[action];
  if (requiredAuthority) {
    const validApproval =
      approval?.approved === true &&
      approval.authority === requiredAuthority &&
      approval.approvalId.trim().length > 0;

    if (!validApproval) {
      return {
        allowed: false,
        requiresApproval: true,
        requiredAuthority,
        reason: `Approval from ${requiredAuthority} is required before this action can proceed.`,
      };
    }
  }

  const requiredCapability = ACTION_CAPABILITY[action];
  if (requiredCapability && !actorRole.capabilities.includes(requiredCapability)) {
    return {
      allowed: false,
      requiresApproval: Boolean(requiredAuthority),
      requiredAuthority: requiredAuthority ?? null,
      reason: `Denied: role ${actorRole.id} lacks capability ${requiredCapability}.`,
    };
  }

  if (
    action === 'resolve_founder_approval' &&
    actorRole.id !== 'founder'
  ) {
    return {
      allowed: false,
      requiresApproval: false,
      requiredAuthority: null,
      reason: 'Denied: only the Founder role may resolve Founder approval requests.',
    };
  }

  if (
    action === 'resolve_board_approval' &&
    actorRole.id !== 'board'
  ) {
    return {
      allowed: false,
      requiresApproval: false,
      requiredAuthority: null,
      reason: 'Denied: only the Board role may resolve Board approval requests.',
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    requiredAuthority: null,
    reason: 'Allowed by the current deterministic policy.',
  };
}
