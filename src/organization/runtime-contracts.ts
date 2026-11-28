/**
 * Typed contracts for adaptive organisational planning.
 *
 * This module is deliberately pure: it does not call an AI provider, access
 * Supabase, execute tools, or grant permissions. It defines and validates the
 * plans that a future deliberation/runtime layer may propose.
 */

export type WorkRisk = 'low' | 'medium' | 'high' | 'critical';
export type WorkActionKind =
  | 'read'
  | 'research'
  | 'draft'
  | 'internal_write'
  | 'external_communication'
  | 'financial'
  | 'sensitive_data'
  | 'security_change'
  | 'legal_commitment';

export type ObjectiveOrigin =
  | 'founder_request'
  | 'executive_direction'
  | 'department_initiative'
  | 'operational_signal'
  | 'customer_request'
  | 'scheduled_review';

export interface OrganizationalObjective {
  id: string;
  statement: string;
  desiredOutcome: string;
  origin: ObjectiveOrigin;
  requestedByRoleId: string | null;
  ownerRoleId: string | null;
  constraints: string[];
  deadline: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  createdAt: string;
  correlationId: string;
}

export interface PlanCapabilityRequirement {
  capabilityId: string;
  purpose: string;
  actionKind: WorkActionKind;
  requiredDataScopes: string[];
  expectedEvidence: string[];
}

export interface OrganizationalPlanStep {
  id: string;
  title: string;
  objective: string;
  accountableRoleId: string | null;
  supportingRoleIds: string[];
  dependsOn: string[];
  capabilityRequirements: PlanCapabilityRequirement[];
  expectedDeliverable: string;
  acceptanceCriteria: string[];
  risk: WorkRisk;
  approvalRequired: boolean;
  reversible: boolean;
}

export interface OrganizationalPlan {
  id: string;
  objectiveId: string;
  rationale: string;
  assumptions: string[];
  unresolvedQuestions: string[];
  steps: OrganizationalPlanStep[];
  proposedByRoleId: string;
  createdAt: string;
  revision: number;
}

export interface PlanValidationIssue {
  code:
    | 'EMPTY_OBJECTIVE'
    | 'EMPTY_PLAN'
    | 'DUPLICATE_STEP_ID'
    | 'UNKNOWN_DEPENDENCY'
    | 'SELF_DEPENDENCY'
    | 'DEPENDENCY_CYCLE'
    | 'MISSING_DELIVERABLE'
    | 'MISSING_ACCEPTANCE_CRITERIA'
    | 'HIGH_RISK_WITHOUT_APPROVAL'
    | 'SENSITIVE_ACTION_WITHOUT_APPROVAL'
    | 'NON_REVERSIBLE_ACTION_WITHOUT_APPROVAL';
  message: string;
  stepId?: string;
}

const APPROVAL_GATED_ACTIONS = new Set<WorkActionKind>([
  'external_communication',
  'financial',
  'sensitive_data',
  'security_change',
  'legal_commitment',
]);

/**
 * Validate structural plan quality only.
 *
 * This function is not authorization. A valid plan still requires a separate
 * deterministic policy check against the actor, role contract, tool contract,
 * data scopes and current approval state before any action can run.
 */
export function validateOrganizationalPlan(
  objective: OrganizationalObjective,
  plan: OrganizationalPlan,
): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const trimmedObjective = objective.statement.trim() || objective.desiredOutcome.trim();

  if (!trimmedObjective) {
    issues.push({ code: 'EMPTY_OBJECTIVE', message: 'The objective must describe an outcome.' });
  }
  if (plan.steps.length === 0) {
    issues.push({ code: 'EMPTY_PLAN', message: 'The plan must contain at least one actionable step.' });
    return issues;
  }

  const stepIds = new Set<string>();
  for (const step of plan.steps) {
    if (stepIds.has(step.id)) {
      issues.push({ code: 'DUPLICATE_STEP_ID', stepId: step.id, message: `Duplicate plan step id: ${step.id}` });
    }
    stepIds.add(step.id);
  }

  for (const step of plan.steps) {
    if (!step.expectedDeliverable.trim()) {
      issues.push({ code: 'MISSING_DELIVERABLE', stepId: step.id, message: `Step ${step.id} has no expected deliverable.` });
    }
    if (step.acceptanceCriteria.length === 0 || step.acceptanceCriteria.every((item) => !item.trim())) {
      issues.push({ code: 'MISSING_ACCEPTANCE_CRITERIA', stepId: step.id, message: `Step ${step.id} has no acceptance criteria.` });
    }
    if ((step.risk === 'high' || step.risk === 'critical') && !step.approvalRequired) {
      issues.push({ code: 'HIGH_RISK_WITHOUT_APPROVAL', stepId: step.id, message: `High-risk step ${step.id} must require approval.` });
    }
    if (step.capabilityRequirements.some((requirement) => APPROVAL_GATED_ACTIONS.has(requirement.actionKind)) && !step.approvalRequired) {
      issues.push({ code: 'SENSITIVE_ACTION_WITHOUT_APPROVAL', stepId: step.id, message: `Step ${step.id} includes an approval-gated action.` });
    }
    if (step.capabilityRequirements.length > 0 && !step.reversible && !step.approvalRequired) {
      issues.push({ code: 'NON_REVERSIBLE_ACTION_WITHOUT_APPROVAL', stepId: step.id, message: `Non-reversible step ${step.id} must require approval.` });
    }

    for (const dependencyId of step.dependsOn) {
      if (dependencyId === step.id) {
        issues.push({ code: 'SELF_DEPENDENCY', stepId: step.id, message: `Step ${step.id} cannot depend on itself.` });
      } else if (!plan.steps.some((candidate) => candidate.id === dependencyId)) {
        issues.push({ code: 'UNKNOWN_DEPENDENCY', stepId: step.id, message: `Step ${step.id} depends on unknown step ${dependencyId}.` });
      }
    }
  }

  if (hasDependencyCycle(plan.steps)) {
    issues.push({ code: 'DEPENDENCY_CYCLE', message: 'The plan contains a dependency cycle.' });
  }

  return issues;
}

function hasDependencyCycle(steps: OrganizationalPlanStep[]): boolean {
  const dependencies = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const step of steps) {
    if (visit(step.id)) return true;
  }
  return false;
}
