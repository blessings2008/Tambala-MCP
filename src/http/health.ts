import type { ServerResponse } from 'node:http';

export function handleHealth(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'tambala-mcp' }));
}

export function handleNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}
