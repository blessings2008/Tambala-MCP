import type { ServerResponse } from 'node:http';
import { taskEventBus, type TaskEvent } from './task-events.js';

export function openTaskEventStream(
  res: ServerResponse,
  taskId: string,
  initialEvents: TaskEvent[] = [],
): () => void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store, must-revalidate',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
  });

  const write = (event: TaskEvent): void => {
    if (event.taskId !== taskId || res.destroyed || res.writableEnded) return;
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  res.write(': connected\n\n');
  // Subscribe before replaying the snapshot so events are not lost between replay and subscription.
  const unsubscribe = taskEventBus.subscribe(write);
  for (const event of initialEvents) write(event);
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  res.on('close', cleanup);
  return cleanup;
}
