import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../lib/supabase.js';

export type OrganizationTaskStatus =
  | 'created'
  | 'ceo_analyzing'
  | 'delegated'
  | 'executing'
  | 'waiting_for_tool'
  | 'department_review'
  | 'returned_to_ceo'
  | 'needs_more_work'
  | 'completed'
  | 'failed';

export type OrganizationTaskStage = 'founder' | 'ceo' | 'department' | 'review' | 'complete' | 'failed';

export type OrganizationTask = {
  id: string;
  objective: string;
  status: OrganizationTaskStatus;
  current_stage: OrganizationTaskStage;
  assigned_department_id: string | null;
  assigned_role_id: string | null;
  research_query: string | null;
  result: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function createOrganizationTask(input: {
  id: string;
  objective: string;
}): Promise<OrganizationTask> {
  return supabaseInsert<OrganizationTask>('organization_tasks', {
    id: input.id,
    objective: input.objective,
    status: 'created',
    current_stage: 'founder',
  });
}

export async function updateOrganizationTask(
  id: string,
  patch: Partial<Pick<OrganizationTask,
    'status' | 'current_stage' | 'assigned_department_id' | 'assigned_role_id' |
    'research_query' | 'result' | 'error_message' | 'completed_at'>>,
): Promise<OrganizationTask> {
  return supabaseUpdate<OrganizationTask>(
    'organization_tasks',
    { ...patch, updated_at: new Date().toISOString() },
    `id=eq.${encodeURIComponent(id)}`,
  );
}

export async function getOrganizationTask(id: string): Promise<OrganizationTask | null> {
  const rows = await supabaseSelect<OrganizationTask>(
    'organization_tasks',
    `select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function recordOrganizationTaskEvent(input: {
  taskId: string;
  eventType: string;
  stage: OrganizationTaskStage;
  actorRoleId?: string | null;
  departmentId?: string | null;
  payload?: unknown;
}): Promise<void> {
  await supabaseInsert('organization_task_events', {
    task_id: input.taskId,
    event_type: input.eventType,
    stage: input.stage,
    actor_role_id: input.actorRoleId ?? null,
    department_id: input.departmentId ?? null,
    payload: input.payload ?? null,
  });
}
