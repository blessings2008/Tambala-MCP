import type { ServerResponse } from 'node:http';
import { taskEvents, type TaskEvent } from './task-events.js';

export function openTaskEventStream(res: ServerResponse, taskId: string): () => void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store, must-revalidate',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
  });

  const write = (event: TaskEvent): void => {
    if (event.taskId !== taskId) return;
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  res.write(': connected\n\n');
  const unsubscribe = taskEvents.subscribe(write);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  res.on('close', cleanup);
  return cleanup;
}
