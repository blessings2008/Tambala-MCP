/**
 * Structured employee contracts.
 *
 * An employee prompt is generated from this contract and task context. The
 * contract is authoritative metadata; it does not itself activate an agent or
 * grant runtime permissions. Authorization must be enforced by the policy layer.
 */

export type EmployeeLifecycle = 'planned' | 'active' | 'paused' | 'suspended' | 'retired';
export type DecisionScope =
  | 'analyze'
  | 'research'
  | 'draft'
  | 'internal_coordination'
  | 'internal_record_update'
  | 'external_communication'
  | 'financial_action'
  | 'security_change'
  | 'legal_commitment';

export interface EmployeeExpertise {
  domain: string;
  description: string;
  proficiency: 'developing' | 'competent' | 'advanced' | 'specialist';
}

export interface EmployeeAuthority {
  /** Allowed decision categories. This is a ceiling, not a permission bypass. */
  decisionScopes: DecisionScope[];
  /** Sensitive action types that always remain approval-gated by policy. */
  approvalRequiredFor: DecisionScope[];
  /** Explicit data scopes granted to this role/employee. */
  dataScopes: string[];
}

export interface EmployeeOperatingLimits {
  maxConcurrentTasks: number;
  maxStepsPerTask: number;
  maxProviderRequestsPerHour: number;
  maxInputCharacters: number;
  mayCreateTemporaryTeams: boolean;
}

export interface EmployeeContract {
  id: string;
  displayName: string;
  roleId: string;
  departmentId: string | null;
  reportsToRoleId: string | null;
  lifecycle: EmployeeLifecycle;
  purpose: string;
  responsibilities: string[];
  exclusions: string[];
  expertise: EmployeeExpertise[];
  capabilityIds: string[];
  authority: EmployeeAuthority;
  operatingLimits: EmployeeOperatingLimits;
  /** Provider profile identifier only; never store provider secrets here. */
  runtimeProfileId: string | null;
  contractVersion: number;
  effectiveFrom: string;
  reviewAt: string | null;
}

export interface EmployeeContractIssue {
  code:
    | 'MISSING_IDENTITY'
    | 'MISSING_PURPOSE'
    | 'MISSING_RESPONSIBILITIES'
    | 'DUPLICATE_CAPABILITY'
    | 'INVALID_CONCURRENCY'
    | 'INVALID_STEP_LIMIT'
    | 'INVALID_REQUEST_BUDGET'
    | 'INVALID_INPUT_LIMIT'
    | 'ACTIVE_WITHOUT_RUNTIME_PROFILE'
    | 'UNSAFE_AUTHORITY_SCOPE';
  message: string;
}

/**
 * Validates the employee definition, not the live execution environment.
 * Runtime readiness, actor identity and permissions must be checked separately.
 */
export function validateEmployeeContract(contract: EmployeeContract): EmployeeContractIssue[] {
  const issues: EmployeeContractIssue[] = [];
  if (!contract.id.trim() || !contract.roleId.trim() || !contract.displayName.trim()) {
    issues.push({ code: 'MISSING_IDENTITY', message: 'Employee id, role id and display name are required.' });
  }
  if (!contract.purpose.trim()) {
    issues.push({ code: 'MISSING_PURPOSE', message: 'Employee purpose must be defined.' });
  }
  if (contract.responsibilities.length === 0 || contract.responsibilities.every((item) => !item.trim())) {
    issues.push({ code: 'MISSING_RESPONSIBILITIES', message: 'At least one responsibility must be defined.' });
  }

  const uniqueCapabilities = new Set(contract.capabilityIds);
  if (uniqueCapabilities.size !== contract.capabilityIds.length) {
    issues.push({ code: 'DUPLICATE_CAPABILITY', message: 'Capability identifiers must be unique within an employee contract.' });
  }

  if (!Number.isInteger(contract.operatingLimits.maxConcurrentTasks) || contract.operatingLimits.maxConcurrentTasks < 1) {
    issues.push({ code: 'INVALID_CONCURRENCY', message: 'Maximum concurrent tasks must be a positive integer.' });
  }
  if (!Number.isInteger(contract.operatingLimits.maxStepsPerTask) || contract.operatingLimits.maxStepsPerTask < 1) {
    issues.push({ code: 'INVALID_STEP_LIMIT', message: 'Maximum steps per task must be a positive integer.' });
  }
  if (!Number.isInteger(contract.operatingLimits.maxProviderRequestsPerHour) || contract.operatingLimits.maxProviderRequestsPerHour < 1) {
    issues.push({ code: 'INVALID_REQUEST_BUDGET', message: 'Provider request budget must be a positive integer.' });
  }
  if (!Number.isInteger(contract.operatingLimits.maxInputCharacters) || contract.operatingLimits.maxInputCharacters < 1) {
    issues.push({ code: 'INVALID_INPUT_LIMIT', message: 'Maximum input characters must be a positive integer.' });
  }
  if (contract.lifecycle === 'active' && !contract.runtimeProfileId?.trim()) {
    issues.push({ code: 'ACTIVE_WITHOUT_RUNTIME_PROFILE', message: 'An active employee must reference a configured runtime profile.' });
  }

  const forbiddenSelfApprovalScopes: DecisionScope[] = [
    'external_communication',
    'financial_action',
    'security_change',
    'legal_commitment',
  ];
  for (const scope of forbiddenSelfApprovalScopes) {
    if (contract.authority.decisionScopes.includes(scope) && !contract.authority.approvalRequiredFor.includes(scope)) {
      issues.push({
        code: 'UNSAFE_AUTHORITY_SCOPE',
        message: `The ${scope} scope must remain approval-gated in the employee contract.`,
      });
    }
  }

  return issues;
}
