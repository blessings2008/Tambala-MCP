import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardMeetingSnapshot } from '../src/organization/workforce/duty-service.ts';
import type { DutyRun } from '../src/organization/workforce/duty-store.ts';
import type { StandingDuty } from '../src/organization/workforce/duties.ts';

const ids = ['sales-board-update', 'operations-board-update', 'technology-board-update', 'finance-board-update'];
const duties = ids.map((id) => ({ id, agent: 'outreach', title: id }) as unknown as StandingDuty);
const run = (duty_id: string, summary: string | null, status: DutyRun['status'] = 'completed') => ({
  id: duty_id, duty_id, period_key: '2026-11-09', role_id: 'director-sales-business-development',
  task_id: null, status, attempts: 1, summary, error: null,
  started_at: '2026-11-09T06:00:00Z', completed_at: '2026-11-09T06:01:00Z',
}) as DutyRun;

test('CEO board snapshot explicitly lists all four department reports and missing departments', () => {
  const snapshot = buildBoardMeetingSnapshot([
    run('sales-board-update', 'Sales report'),
    run('technology-board-update', 'Technology report'),
    run('finance-board-update', 'Finance report'),
  ], duties);
  assert.equal(snapshot.status, 'PARTIAL');
  assert.equal(snapshot.expectedDepartmentReports, 4);
  assert.equal(snapshot.receivedDepartmentReports, 3);
  assert.deepEqual(snapshot.missingDepartments, ['operations-board-update']);
  assert.equal(snapshot.departmentUpdates.find((x) => x.dutyId === 'operations-board-update')?.status, 'missing');
});

test('CEO board snapshot is complete only when all four reports have completed with saved summaries', () => {
  const snapshot = buildBoardMeetingSnapshot(ids.map((id) => run(id, `Report for ${id}`)), duties);
  assert.equal(snapshot.status, 'COMPLETE');
  assert.equal(snapshot.receivedDepartmentReports, 4);
  assert.deepEqual(snapshot.missingDepartments, []);
});
