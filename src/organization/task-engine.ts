export type TaskStatus =
  | 'created'
  | 'ceo_analyzing'
  | 'delegated'
  | 'executing'
  | 'waiting_for_tool'
  | 'tool_complete'
  | 'department_review'
  | 'returned_to_ceo'
  | 'ceo_review'
  | 'needs_more_work'
  | 'completed'
  | 'failed';

export type TaskEventType =
  | 'task_created'
  | 'status_changed'
  | 'delegation_created'
  | 'tool_requested'
  | 'tool_completed'
  | 'department_submitted'
  | 'ceo_review_started'
  | 'rework_requested'
  | 'task_completed'
  | 'task_failed';

export interface OrganizationTaskEvent {
  readonly id: string;
  readonly taskId: string;
  readonly type: TaskEventType;
  readonly status: TaskStatus;
  readonly actor: string;
  readonly recipient?: string;
  readonly message: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OrganizationTask {
  readonly id: string;
  readonly objective: string;
  readonly owner: string;
  status: TaskStatus;
  currentActor: string;
  currentRecipient?: string;
  createdAt: string;
  updatedAt: string;
  events: OrganizationTaskEvent[];
}

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ['ceo_analyzing', 'failed'],
  ceo_analyzing: ['delegated', 'failed'],
  delegated: ['executing', 'failed'],
  executing: ['waiting_for_tool', 'department_review', 'failed'],
  waiting_for_tool: ['tool_complete', 'failed'],
  tool_complete: ['executing', 'failed'],
  department_review: ['returned_to_ceo', 'needs_more_work', 'failed'],
  returned_to_ceo: ['ceo_review', 'failed'],
  ceo_review: ['completed', 'needs_more_work', 'failed'],
  needs_more_work: ['executing', 'failed'],
  completed: [],
  failed: [],
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createOrganizationTask(objective: string, owner = 'Chief Executive Officer (CEO)'): OrganizationTask {
  const now = new Date().toISOString();
  const task: OrganizationTask = {
    id: makeId('task'),
    objective: objective.trim(),
    owner,
    status: 'created',
    currentActor: 'Founder / Bless',
    currentRecipient: owner,
    createdAt: now,
    updatedAt: now,
    events: [],
  };
  appendTaskEvent(task, 'task_created', 'created', 'Founder / Bless', owner, 'Founder objective received by the organization.');
  return task;
}

export function transitionTask(
  task: OrganizationTask,
  status: TaskStatus,
  actor: string,
  message: string,
  recipient?: string,
  metadata?: Record<string, unknown>,
): OrganizationTaskEvent {
  if (task.status === status) return appendTaskEvent(task, 'status_changed', status, actor, recipient, message, metadata);
  if (!transitions[task.status].includes(status)) {
    throw new Error(`Invalid task transition: ${task.status} -> ${status}`);
  }
  task.status = status;
  task.currentActor = actor;
  task.currentRecipient = recipient;
  task.updatedAt = new Date().toISOString();
  const type: TaskEventType =
    status === 'completed' ? 'task_completed' :
    status === 'failed' ? 'task_failed' :
    status === 'needs_more_work' ? 'rework_requested' :
    status === 'waiting_for_tool' ? 'tool_requested' :
    status === 'tool_complete' ? 'tool_completed' :
    status === 'returned_to_ceo' ? 'department_submitted' :
    status === 'ceo_review' ? 'ceo_review_started' :
    status === 'delegated' ? 'delegation_created' : 'status_changed';
  return appendTaskEvent(task, type, status, actor, recipient, message, metadata);
}

function appendTaskEvent(
  task: OrganizationTask,
  type: TaskEventType,
  status: TaskStatus,
  actor: string,
  recipient: string | undefined,
  message: string,
  metadata?: Record<string, unknown>,
): OrganizationTaskEvent {
  const event: OrganizationTaskEvent = {
    id: makeId('evt'),
    taskId: task.id,
    type,
    status,
    actor,
    recipient,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };
  task.events.push(event);
  task.updatedAt = event.timestamp;
  return event;
}
