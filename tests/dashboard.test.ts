import test from 'node:test';
import assert from 'node:assert/strict';
import { section, summarizeTasks, buildDashboard } from '../src/http/dashboard-api.ts';

test('summarizeTasks counts open/completed/failed and success rate', () => {
  const s = summarizeTasks([
    { status: 'completed', created_at: '2026-11-06T10:00:00Z', completed_at: '2026-11-06T10:06:00Z', assigned_department_id: 'sales-business-development' },
    { status: 'failed', assigned_department_id: 'sales-business-development' },
    { status: 'executing' },
    { status: 'delegated', assigned_department_id: 'finance-accounting' },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.open, 2);
  assert.equal(s.completed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.successRate, 50);
  assert.equal(s.avgCompletionMinutes, 6);
  assert.equal(s.byDepartment['sales-business-development'], 2);
  assert.equal(s.byDepartment.unassigned, 1);
});

test('summarizeTasks has no rate or average when nothing finished', () => {
  const s = summarizeTasks([{ status: 'executing' }]);
  assert.equal(s.successRate, null);
  assert.equal(s.avgCompletionMinutes, null);
});

test('a failing section reports its own error instead of throwing', async () => {
  const r = await section(async () => { throw new Error('boom'); });
  assert.deepEqual(r, { ok: false, error: 'boom' });
});

test('dashboard without a database degrades per section and never leaks secrets', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.TAMBALA_ORCHESTRATOR_API_KEY = 'sk-secret-value';
  const d = await buildDashboard();
  assert.equal(d.config.database, false);
  assert.equal(d.tasks.ok, false);
  assert.equal(d.headline.openTasks, null);
  assert.equal(d.organization.ok, true);
  assert.ok(d.headline.totalAgents > 0);
  assert.equal(JSON.stringify(d).includes('sk-secret-value'), false);
});
