import type { ServerResponse } from 'node:http';
import { supabaseSelect } from '../lib/supabase.js';
import { dbConfigured } from '../organization/workforce/db-util.js';
import { connectionState, evolutionConfigured } from '../channels/evolution.js';

const startedAt = Date.now();

export function handleHealth(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'tambala-mcp',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  }));
}

/** Readiness is separate from liveness: Render can restart a live process only when it is truly unhealthy. */
export async function handleReadiness(res: ServerResponse): Promise<void> {
  const checks: Record<string, { status: string; detail?: string }> = {};
  if (!dbConfigured()) checks.database = { status: 'unavailable', detail: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' };
  else {
    try {
      await supabaseSelect('organization_roles', 'select=id&limit=1');
      checks.database = { status: 'ok' };
    } catch (error) {
      checks.database = { status: 'unavailable', detail: error instanceof Error ? error.message.slice(0, 180) : 'Database check failed.' };
    }
  }

  if (!evolutionConfigured()) checks.whatsapp = { status: 'not_configured' };
  else {
    try {
      const state = (await connectionState()).state;
      checks.whatsapp = { status: ['open', 'connected'].includes(state.toLowerCase()) ? 'ok' : 'disconnected', detail: state };
    } catch (error) {
      checks.whatsapp = { status: 'unavailable', detail: error instanceof Error ? error.message.slice(0, 180) : 'Evolution check failed.' };
    }
  }

  const ready = checks.database.status === 'ok';
  res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({
    status: ready ? 'ready' : 'degraded',
    service: 'tambala-mcp',
    checks,
    timestamp: new Date().toISOString(),
  }));
}

export function handleNotFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}
