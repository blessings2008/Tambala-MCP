import test from 'node:test';
import assert from 'node:assert/strict';
import { runDuty, type DutyDeps } from '../src/organization/workforce/duty-runner.ts';
import { InMemoryDutyStore } from '../src/organization/workforce/duty-store.ts';
import type { StandingDuty } from '../src/organization/workforce/duties.ts';

const duty: StandingDuty = {
  id: 'employee-history-test', agent: 'operations', title: 'History context test',
  cadence: { kind: 'daily' }, time: '06:00', contexts: ['organization'],
  job: 'Review the supplied recent employee outcomes and current work.',
  deliverable: 'A short report that avoids repeating completed work.',
};

test('standing duties receive recent employee outcome history in their working context', async () => {
  const store = new InMemoryDutyStore();
  let received: Record<string, unknown> | null = null;
  const deps: DutyDeps = {
    store,
    now: () => new Date('2026-11-15T08:00:00.000Z'),
    duties: async () => [duty],
    employee: async () => ({ employeeNumber: 'TT-005', title: 'Operations Manager' }),
    sign: async () => ({ block: 'SIGNED TT-005' }),
    actions: { run: async () => '' },
    handoffs: { queue: async () => undefined },
    unavailableReason: async () => null,
    buildContext: async () => ({ organization: { status: 'available' } }),
    employeeOutcomeHistory: async () => [{ dutyId: 'task-board-hygiene', status: 'completed', at: '2026-11-14T08:00:00.000Z', summary: 'Reviewed two overdue tasks.', error: null }],
    ask: async (_duty, _prompt, context) => { received = context; return 'Reviewed the current task board without repeating yesterday’s review.'; },
    tasks: {
      begin: async () => ({ taskId: 'task-history-test', tracking: 'recorded' }),
      advance: async () => undefined,
      fail: async () => undefined,
    },
    approvals: { create: async () => undefined },
    reports: { save: async () => undefined },
  };

  const outcome = await runDuty(deps, duty);
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(received?.employee_outcome_history, [
    { dutyId: 'task-board-hygiene', status: 'completed', at: '2026-11-14T08:00:00.000Z', summary: 'Reviewed two overdue tasks.', error: null },
  ]);
});
