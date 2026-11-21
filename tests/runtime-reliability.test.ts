import test from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { handleHealth, handleReadiness } from '../src/http/health.ts';
import { assertRuntimeActive, getRuntimeControl, RuntimePausedError } from '../src/organization/runtime-control.ts';

function responseHarness() {
  let status = 0;
  let body = '';
  const res = {
    writeHead(code: number) { status = code; return this; },
    end(value?: string) { body = value ?? ''; },
  } as unknown as ServerResponse;
  return { res, get status() { return status; }, get body() { return body; } };
}

test('health endpoint is liveness-only and reports process uptime', () => {
  const h = responseHarness();
  handleHealth(h.res);
  const body = JSON.parse(h.body);
  assert.equal(h.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'tambala-mcp');
  assert.ok(body.uptimeSeconds >= 0);
});

test('readiness endpoint reports missing database instead of pretending all dependencies are healthy', async () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const h = responseHarness();
    await handleReadiness(h.res);
    const body = JSON.parse(h.body);
    assert.equal(h.status, 503);
    assert.equal(body.status, 'degraded');
    assert.equal(body.checks.database.status, 'unavailable');
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
  }
});

test('environment pause switch blocks runtime work and exposes its reason', async () => {
  const previousPause = process.env.TAMBALA_PAUSE_ALL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.TAMBALA_PAUSE_ALL = 'true';
  try {
    const state = await getRuntimeControl();
    assert.equal(state.paused, true);
    await assert.rejects(assertRuntimeActive(), (error: unknown) => error instanceof RuntimePausedError && /paused/i.test(error.message));
  } finally {
    if (previousPause === undefined) delete process.env.TAMBALA_PAUSE_ALL;
    else process.env.TAMBALA_PAUSE_ALL = previousPause;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('runtime is active by default in local development when no database pause is configured', async () => {
  const previousPause = process.env.TAMBALA_PAUSE_ALL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.TAMBALA_PAUSE_ALL;
  try {
    const state = await getRuntimeControl();
    assert.equal(state.paused, false);
    await assertRuntimeActive();
  } finally {
    if (previousPause !== undefined) process.env.TAMBALA_PAUSE_ALL = previousPause;
    if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
