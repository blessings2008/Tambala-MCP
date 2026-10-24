import type { OrganizationTaskEvent } from './task-engine.js';

export interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
  status?: string;
  actor: string;
  recipient?: string;
  message?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

type Listener = (event: TaskEvent) => void;

/** In-process fan-out for lifecycle events. Persistence can be attached later. */
class TaskEventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); }
      catch (error) { console.error('Task event listener failed:', error); }
    }
  }
}

export const taskEventBus = new TaskEventBus();
/** Compatibility alias for the SSE layer. */
export const taskEvents = taskEventBus;

export function publishOrganizationTaskEvent(event: OrganizationTaskEvent): TaskEvent {
  const published: TaskEvent = {
    id: event.id,
    taskId: event.taskId,
    type: event.type,
    status: event.status,
    actor: event.actor,
    recipient: event.recipient,
    message: event.message,
    timestamp: event.timestamp,
    metadata: event.metadata,
  };
  taskEventBus.publish(published);
  return published;
}

export function emitTaskEvent(
  taskId: string,
  type: string,
  actor: string,
  message?: string,
  options?: { status?: string; recipient?: string; metadata?: Record<string, unknown> },
): TaskEvent {
  const event: TaskEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    type,
    actor,
    recipient: options?.recipient,
    message,
    status: options?.status,
    metadata: options?.metadata,
    timestamp: new Date().toISOString(),
  };
  taskEventBus.publish(event);
  return event;
}
