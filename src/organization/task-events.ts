export type TaskEventType =
  | 'task.created'
  | 'task.status_changed'
  | 'task.message'
  | 'task.completed'
  | 'task.failed';

export interface TaskEvent {
  taskId: string;
  type: TaskEventType;
  status?: string;
  actor: string;
  recipient?: string;
  message?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

type Listener = (event: TaskEvent) => void;

/**
 * In-process event bus for live task execution.
 * It intentionally has no persistence yet; the database/event store will be
 * attached once the live execution flow is stable.
 */
class TaskEventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Task event listener failed:', error);
      }
    }
  }
}

export const taskEventBus = new TaskEventBus();

export function emitTaskEvent(
  taskId: string,
  type: TaskEventType,
  actor: string,
  message?: string,
  options?: {
    status?: string;
    recipient?: string;
    metadata?: Record<string, unknown>;
  },
): TaskEvent {
  const event: TaskEvent = {
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
