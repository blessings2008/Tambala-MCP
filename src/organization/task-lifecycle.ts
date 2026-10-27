import {
  createOrganizationTask,
  getOrganizationTask,
  recordOrganizationTaskEvent,
  updateOrganizationTask,
  type OrganizationTask,
  type OrganizationTaskStage,
  type OrganizationTaskStatus,
} from './task-store.js';

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

const ALLOWED_TRANSITIONS: Record<OrganizationTaskStatus, OrganizationTaskStatus[]> = {
  created: ['ceo_analyzing', 'failed'],
  ceo_analyzing: ['delegated', 'needs_more_work', 'failed'],
  delegated: ['executing', 'needs_more_work', 'failed'],
  executing: ['waiting_for_tool', 'department_review', 'returned_to_ceo', 'failed'],
  waiting_for_tool: ['executing', 'failed'],
  department_review: ['returned_to_ceo', 'needs_more_work', 'failed'],
  returned_to_ceo: ['completed', 'needs_more_work', 'failed'],
  needs_more_work: ['ceo_analyzing', 'delegated', 'failed'],
  completed: [],
  failed: ['ceo_analyzing'],
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

/** Enforce valid state transitions and append the corresponding audit event. */
export async function transitionPersistentOrganizationTask(
  taskId: string,
  transition: OrganizationTaskTransition,
): Promise<OrganizationTask> {
  const current = await getOrganizationTask(taskId);
  if (!current) throw new Error('Organization task was not found.');
  if (!ALLOWED_TRANSITIONS[current.status].includes(transition.status)) {
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

export async function failPersistentOrganizationTask(taskId: string, message: string): Promise<OrganizationTask> {
  return transitionPersistentOrganizationTask(taskId, {
    status: 'failed',
    stage: 'failed',
    eventType: 'stage_failed',
    errorMessage: message,
    completedAt: new Date().toISOString(),
    payload: { error: message },
  });
}
