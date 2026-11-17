import type { OrganizationalPlan, OrganizationalPlanStep } from './runtime-contracts.js';

export type StepExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface StepProgressRecord {
  executionStatus: StepExecutionStatus;
  approvalStatus: StepApprovalStatus;
  failureReason?: string | null;
}

export type CoordinatedStepStatus =
  | 'ready'
  | 'waiting_on_dependency'
  | 'awaiting_approval'
  | 'blocked_owner_inactive'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked_approval_rejected';

export interface CoordinatedStep {
  stepId: string;
  accountableRoleId: string | null;
  status: CoordinatedStepStatus;
  reason: string;
}

export interface PlanCoordinationSnapshot {
  steps: CoordinatedStep[];
  readyStepIds: string[];
  completedStepIds: string[];
  failedStepIds: string[];
  requiresReplanning: boolean;
  replanReasons: string[];
}

/**
 * Derive what may proceed from durable execution/approval facts.
 * This is a scheduler projection only: it does not claim or execute work.
 */
export function coordinatePlan(
  plan: OrganizationalPlan,
  progress: Record<string, StepProgressRecord>,
  activeRoleIds: ReadonlySet<string>,
): PlanCoordinationSnapshot {
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  const steps = plan.steps.map((step) => classifyStep(step, byId, progress, activeRoleIds));
  const readyStepIds = steps.filter((step) => step.status === 'ready').map((step) => step.stepId);
  const completedStepIds = steps.filter((step) => step.status === 'completed').map((step) => step.stepId);
  const failedStepIds = steps.filter((step) => step.status === 'failed').map((step) => step.stepId);
  const replanReasons = steps
    .filter((step) => step.status === 'failed' || step.status === 'blocked_owner_inactive' || step.status === 'blocked_approval_rejected')
    .map((step) => `${step.stepId}: ${step.reason}`);

  return {
    steps,
    readyStepIds,
    completedStepIds,
    failedStepIds,
    requiresReplanning: replanReasons.length > 0,
    replanReasons,
  };
}

function classifyStep(
  step: OrganizationalPlanStep,
  allSteps: Map<string, OrganizationalPlanStep>,
  progress: Record<string, StepProgressRecord>,
  activeRoleIds: ReadonlySet<string>,
): CoordinatedStep {
  const state = progress[step.id] ?? { executionStatus: 'pending', approvalStatus: step.approvalRequired ? 'pending' : 'not_required' };
  const result = (status: CoordinatedStepStatus, reason: string): CoordinatedStep => ({
    stepId: step.id,
    accountableRoleId: step.accountableRoleId,
    status,
    reason,
  });

  if (state.executionStatus === 'completed') return result('completed', 'The step has a recorded completion state.');
  if (state.executionStatus === 'cancelled') return result('cancelled', 'The step was cancelled.');
  if (state.executionStatus === 'failed') return result('failed', state.failureReason?.trim() || 'The step failed and needs review.');
  if (state.executionStatus === 'running') return result('in_progress', 'The step is already in progress.');
  if (state.approvalStatus === 'rejected') return result('blocked_approval_rejected', 'The required approval was rejected.');
  if (step.approvalRequired && state.approvalStatus !== 'approved') {
    return result('awaiting_approval', 'The step cannot start until its required approval is recorded.');
  }
  if (!step.accountableRoleId || !activeRoleIds.has(step.accountableRoleId)) {
    return result('blocked_owner_inactive', 'The accountable role is missing or not active; ownership must be reassigned through an approved plan revision.');
  }
  const dependencies = step.dependsOn.map((id) => allSteps.get(id));
  const incomplete = step.dependsOn.filter((id, index) => !dependencies[index] || progress[id]?.executionStatus !== 'completed');
  if (incomplete.length) {
    return result('waiting_on_dependency', `Waiting for completed dependencies: ${incomplete.join(', ')}.`);
  }
  return result('ready', 'Dependencies, accountable role and approval requirements are satisfied.');
}
