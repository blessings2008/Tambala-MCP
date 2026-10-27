import {
  createOrganizationTask,
  getOrganizationTask,
  recordOrganizationTaskEvent,
  updateOrganizationTask,
  type OrganizationTask,
  type OrganizationTaskStage,
  type OrganizationTaskStatus,
} from './task-store.js';
import { isAllowedOrganizationTaskTransition } from './task-transition-rules.js';

export type OrganizationTaskTransition = {
  status: OrganizationTaskStatus;
  stage: OrganizationTaskStage;
  eventType: string;
  departmentId?: string | null;
  roleId?: string | null;
  researchQuery?: string | null;
  result?: unknown;
  errorMessage?: string | null;
  completedAt?: string | null;
  payload?: unknown;
};

/** Create the durable task before the first model call and record the Founder objective. */
export async function startPersistentOrganizationTask(input: {
  id: string;
  objective: string;
}): Promise<OrganizationTask> {
  const task = await createOrganizationTask(input);
  await recordOrganizationTaskEvent({
    taskId: task.id,
    eventType: 'founder_objective_received',
    stage: 'founder',
    payload: { objective: input.objective },
  });
  return task;
}

/** Enforce the shared transition rules and append the corresponding audit event. */
export async function transitionPersistentOrganizationTask(
  taskId: string,
  transition: OrganizationTaskTransition,
): Promise<OrganizationTask> {
  const current = await getOrganizationTask(taskId);
  if (!current) throw new Error('Organization task was not found.');
  if (!isAllowedOrganizationTaskTransition(current.status, transition.status)) {
    throw new Error(`Invalid organization task transition: ${current.status} -> ${transition.status}.`);
  }

  const patch: Parameters<typeof updateOrganizationTask>[1] = {
    status: transition.status,
    current_stage: transition.stage,
  };
  if (transition.departmentId !== undefined) patch.assigned_department_id = transition.departmentId;
  if (transition.roleId !== undefined) patch.assigned_role_id = transition.roleId;
  if (transition.researchQuery !== undefined) patch.research_query = transition.researchQuery;
  if (transition.result !== undefined) patch.result = transition.result;
  if (transition.errorMessage !== undefined) patch.error_message = transition.errorMessage;
  if (transition.completedAt !== undefined) patch.completed_at = transition.completedAt;

  const updated = await updateOrganizationTask(taskId, patch);
  await recordOrganizationTaskEvent({
    taskId,
    eventType: transition.eventType,
    stage: transition.stage,
    actorRoleId: transition.roleId,
    departmentId: transition.departmentId,
    payload: transition.payload ?? null,
  });
  return updated;
}

/** Mark a task failed without misreporting it as successfully completed. */
export async function failPersistentOrganizationTask(taskId: string, message: string): Promise<OrganizationTask> {
  return transitionPersistentOrganizationTask(taskId, {
    status: 'failed',
    stage: 'failed',
    eventType: 'stage_failed',
    errorMessage: message,
    completedAt: null,
    payload: { error: message },
  });
}
