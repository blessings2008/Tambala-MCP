import {
  createOrganizationTask,
  type OrganizationTask,
  type TaskStatus,
  transitionTask,
} from './task-engine.js';

const tasks = new Map<string, OrganizationTask>();

export function startOrganizationTask(objective: string): OrganizationTask {
  const task = createOrganizationTask(objective);
  tasks.set(task.id, task);
  return task;
}

export function getOrganizationTask(taskId: string): OrganizationTask | undefined {
  return tasks.get(taskId);
}

export function updateOrganizationTask(
  taskId: string,
  status: TaskStatus,
  actor: string,
  message: string,
  recipient?: string,
  metadata?: Record<string, unknown>,
): OrganizationTask {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Organization task not found: ${taskId}`);
  transitionTask(task, status, actor, message, recipient, metadata);
  return task;
}

export function listOrganizationTasks(): OrganizationTask[] {
  return [...tasks.values()].map((task) => structuredClone(task));
}

export function snapshotOrganizationTask(taskId: string): OrganizationTask {
  const task = getOrganizationTask(taskId);
  if (!task) throw new Error(`Organization task not found: ${taskId}`);
  return structuredClone(task);
}
