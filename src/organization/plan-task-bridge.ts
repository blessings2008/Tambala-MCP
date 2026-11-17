import { coordinatePlan, type StepProgressRecord, type PlanCoordinationSnapshot } from './plan-coordinator.js';
import type { OrganizationalPlan, OrganizationalPlanStep } from './runtime-contracts.js';

/**
 * Adapter boundary between the new planner and Tambala's existing durable
 * organization_tasks / organization_task_events / organization_handoffs model.
 *
 * This module is pure. It does not write records, create handoffs, or authorize
 * actions. A future dispatcher must persist the plan event first, then use the
 * existing handoff/task-room workflow and its approval checks.
 */

export interface PlanEmployeeRoute {
  agent: string;
  roleId: string;
  active: boolean;
  runtimeReady: boolean;
}

export interface PlanStepDispatch {
  stepId: string;
  step: OrganizationalPlanStep;
  roleId: string;
  agent: string;
  /** Stable correlation key; storage must enforce uniqueness before retries are safe. */
  idempotencyKey: string;
}

export interface PlanStepRouteBlocker {
  stepId: string;
  roleId: string | null;
  reason: string;
}

export interface PlanDispatchPreparation {
  coordination: PlanCoordinationSnapshot;
  dispatches: PlanStepDispatch[];
  blockers: PlanStepRouteBlocker[];
  requiresReplanning: boolean;
}

export interface PlanProposalEvent {
  taskId: string;
  eventType: 'organizational_plan_proposed';
  stage: 'ceo';
  actorRoleId: string;
  payload: {
    schema: 'tambala.organizational-plan';
    schemaVersion: 1;
    planId: string;
    objectiveId: string;
    revision: number;
    plan: OrganizationalPlan;
  };
}

/** Store the validated plan as an append-only event on the existing parent task. */
export function buildPlanProposalEvent(taskId: string, plan: OrganizationalPlan): PlanProposalEvent {
  if (!taskId.trim()) throw new Error('A parent organization task id is required.');
  if (!plan.id.trim() || !plan.objectiveId.trim()) throw new Error('Plan and objective identifiers are required.');
  return {
    taskId,
    eventType: 'organizational_plan_proposed',
    stage: 'ceo',
    actorRoleId: plan.proposedByRoleId,
    payload: {
      schema: 'tambala.organizational-plan',
      schemaVersion: 1,
      planId: plan.id,
      objectiveId: plan.objectiveId,
      revision: plan.revision,
      plan,
    },
  };
}

/**
 * Project ready plan steps onto existing employee handoff routes.
 * A role must resolve to exactly one employee profile, and that employee must
 * be active and runtime-ready. Ambiguous or unavailable owners fail closed.
 */
export function preparePlanStepDispatches(
  plan: OrganizationalPlan,
  progress: Record<string, StepProgressRecord>,
  activeRoleIds: ReadonlySet<string>,
  employeeRoutes: readonly PlanEmployeeRoute[],
): PlanDispatchPreparation {
  const coordination = coordinatePlan(plan, progress, activeRoleIds);
  const dispatches: PlanStepDispatch[] = [];
  const blockers: PlanStepRouteBlocker[] = [];

  for (const stepId of coordination.readyStepIds) {
    const step = plan.steps.find((candidate) => candidate.id === stepId);
    if (!step) continue;
    const roleId = step.accountableRoleId;
    if (!roleId) {
      blockers.push({ stepId, roleId: null, reason: 'The step has no accountable role.' });
      continue;
    }

    const matches = employeeRoutes.filter((route) => route.roleId === roleId);
    if (matches.length === 0) {
      blockers.push({ stepId, roleId, reason: 'No employee profile is mapped to the accountable role.' });
      continue;
    }
    if (matches.length > 1) {
      blockers.push({ stepId, roleId, reason: 'More than one employee profile maps to this role; an explicit owner is required.' });
      continue;
    }

    const owner = matches[0];
    if (!owner) {
      blockers.push({ stepId, roleId, reason: 'The accountable employee route could not be resolved.' });
      continue;
    }
    if (!owner.active) {
      blockers.push({ stepId, roleId, reason: 'The mapped employee is not active.' });
      continue;
    }
    if (!owner.runtimeReady) {
      blockers.push({ stepId, roleId, reason: 'The mapped employee runtime is not ready.' });
      continue;
    }

    dispatches.push({
      stepId,
      step,
      roleId,
      agent: owner.agent,
      idempotencyKey: `plan:${plan.id}:revision:${plan.revision}:step:${step.id}`,
    });
  }

  return {
    coordination,
    dispatches,
    blockers,
    requiresReplanning: coordination.requiresReplanning || blockers.length > 0,
  };
}
