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
  /** Must come from a separately persisted and validated approval record. */
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

const ACTION_CAPABILITY: Record<OrganizationalAction, string | null> = {
  read_organization: 'organization.view_all',
  read_operational_records: 'organization.view_operational',
  coordinate_work: 'work.coordinate',
  delegate_work: 'work.delegate',
  create_report: 'reports.create',
  advise_on_decision: 'decisions.advise',
  review_strategy: 'strategy.review',
  resolve_founder_approval: 'approvals.resolve_founder',
  resolve_board_approval: 'approvals.resolve_board',
  launch_major_venture: 'ventures.launch',
  commit_material_funds: 'finance.commit_material',
  change_mission: 'organization.mission.change',
  close_major_business_unit: 'business_unit.close',
  send_sensitive_external_communication: 'communications.send_sensitive',
  execute_financial_transaction: 'finance.transaction.execute',
  manage_department_workflow: 'department.workflow.manage',
};

const RESTRICTED_ACTIONS: Partial<Record<OrganizationalAction, ApprovalAuthority>> = {
  launch_major_venture: 'founder',
  commit_material_funds: 'founder',
  change_mission: 'founder',
  close_major_business_unit: 'founder',
  send_sensitive_external_communication: 'founder',
  execute_financial_transaction: 'founder',
};

/**
 * Deterministic policy evaluation only. The caller must resolve actorRole and
 * approval from trusted storage and must not execute an action unless allowed.
 * AI-generated claims of approval are not approval records.
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

  const requiredCapability = ACTION_CAPABILITY[action];
  if (requiredCapability && !actorRole.capabilities.includes(requiredCapability)) {
    return {
      allowed: false,
      requiresApproval: false,
      requiredAuthority: null,
      reason: `Denied: role ${actorRole.id} lacks capability ${requiredCapability}.`,
    };
  }

  if (action === 'resolve_founder_approval' && actorRole.id !== 'founder') {
    return {
      allowed: false,
      requiresApproval: false,
      requiredAuthority: null,
      reason: 'Denied: only the Founder role may resolve Founder approval requests.',
    };
  }

  if (action === 'resolve_board_approval' && actorRole.id !== 'board') {
    return {
      allowed: false,
      requiresApproval: false,
      requiredAuthority: null,
      reason: 'Denied: only the Board role may resolve Board approval requests.',
    };
  }

  const requiredAuthority = RESTRICTED_ACTIONS[action];
  if (requiredAuthority && actorRole.id !== requiredAuthority) {
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

  return {
    allowed: true,
    requiresApproval: false,
    requiredAuthority: null,
    reason: 'Allowed by the current deterministic policy.',
  };
}
