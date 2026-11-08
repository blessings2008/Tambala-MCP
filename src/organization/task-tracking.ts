import { randomUUID } from 'node:crypto';
import {
  failPersistentOrganizationTask,
  startPersistentOrganizationTask,
  transitionPersistentOrganizationTask,
  type OrganizationTaskTransition,
} from './task-lifecycle.js';
import { getOrganizationTask } from './task-store.js';
import { isAllowedOrganizationTaskTransition } from './task-transition-rules.js';

/**
 * Best-effort durable tracking for organization runs.
 *
 * Tracking never blocks the work itself: when Supabase is not configured (local
 * development) or a write fails, the run continues and the response says
 * tracking was unavailable, so a run is never silently presented as audited.
 */
export function trackingConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export type TrackingState = 'recorded' | 'unavailable';

export async function beginTrackedTask(objective: string): Promise<{ taskId: string; tracking: TrackingState }> {
  const taskId = randomUUID();
  if (!trackingConfigured()) return { taskId, tracking: 'unavailable' };
  try {
    await startPersistentOrganizationTask({ id: taskId, objective });
    return { taskId, tracking: 'recorded' };
  } catch (error) {
    console.error('Task tracking could not start:', error instanceof Error ? error.message : error);
    return { taskId, tracking: 'unavailable' };
  }
}

/** Move a tracked task forward, stepping through required intermediate states. */
export async function advanceTrackedTask(
  taskId: unknown,
  transitions: OrganizationTaskTransition[],
): Promise<TrackingState> {
  if (!trackingConfigured() || typeof taskId !== 'string' || !taskId) return 'unavailable';
  try {
    for (const transition of transitions) {
      const current = await getOrganizationTask(taskId);
      if (!current) return 'unavailable';
      if (current.status === transition.status) continue;
      if (!isAllowedOrganizationTaskTransition(current.status, transition.status)) {
        console.warn(`Skipping invalid tracked transition ${current.status} -> ${transition.status} for ${taskId}`);
        return 'unavailable';
      }
      await transitionPersistentOrganizationTask(taskId, transition);
    }
    return 'recorded';
  } catch (error) {
    console.error('Task tracking transition failed:', error instanceof Error ? error.message : error);
    return 'unavailable';
  }
}

export async function failTrackedTask(taskId: unknown, message: string): Promise<void> {
  if (!trackingConfigured() || typeof taskId !== 'string' || !taskId) return;
  try {
    const current = await getOrganizationTask(taskId);
    if (!current || current.status === 'completed' || current.status === 'failed') return;
    await failPersistentOrganizationTask(taskId, message.slice(0, 2000));
  } catch (error) {
    console.error('Task tracking could not record failure:', error instanceof Error ? error.message : error);
  }
}
