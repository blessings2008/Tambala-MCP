import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOrganization } from '../src/organization/seed.ts';
import { AGENT_DIRECTORY } from '../src/services/ai/models.ts';
import { STANDING_DUTIES } from '../src/organization/workforce/duties.ts';
import { getEmployeeProfiles, roleIdFor } from '../src/organization/workforce/profiles.ts';
import { localTime, periodKey, runsToday, timeReached, isWorkingHours } from '../src/organization/workforce/schedule.ts';
import { runDuty, runDueDuties, buildDutyPrompt, type DutyDeps } from '../src/organization/workforce/duty-runner.ts';
import { InMemoryDutyStore } from '../src/organization/workforce/duty-store.ts';
import { deterministicBriefing } from '../src/organization/workforce/briefing.ts';
import { decideApproval, ApprovalError } from '../src/organization/workforce/approvals-service.ts';
import { SENSITIVE_TOOLS, STANDARD_WRITE_TOOLS } from '../src/organization/write-guard.ts';
import { resolveDuties } from '../src/organization/workforce/duty-config.ts';
import { registerAllTools } from '../src/tools/registry.ts';

// Office time is UTC+2. 2026-11-09 is a Monday.
const at = (iso: string) => new Date(iso);

test('office clock: UTC+2, weekday and ISO week', () => {
  const lt = localTime(at('2026-11-09T06:45:00Z')); // 08:45 Monday in Blantyre
  assert.equal(lt.date, '2026-11-09');
  assert.equal(lt.weekday, 1);
  assert.equal(lt.minutes, 8 * 60 + 45);
  assert.equal(lt.isoWeek, '2026-W46');
  const late = localTime(at('2026-11-09T23:30:00Z')); // already Tuesday 01:30 locally
  assert.equal(late.date, '2026-11-10');
  assert.equal(late.weekday, 2);
});

test('cadence: weekday duties skip weekends, weekly duties fire on their day, periods differ', () => {
  const sat = localTime(at('2026-11-07T08:00:00Z'));
  const mon = localTime(at('2026-11-09T08:00:00Z'));
  assert.equal(runsToday({ kind: 'weekdays' }, sat), false);\n  assert.equal(runsToday({ kind: 'daily' }, sat), true);\n  assert.equal(periodKey({ kind: 'daily' }, sat), '2026-11-07');
  assert.equal(runsToday({ kind: 'weekdays' }, mon), true);
  assert.equal(runsToday({ kind: 'weekly', day: 1 }, mon), true);
  assert.equal(runsToday({ kind: 'weekly', day: 5 }, mon), false);
  assert.equal(periodKey({ kind: 'weekdays' }, mon), '2026-11-09');
  assert.equal(periodKey({ kind: 'weekly', day: 1 }, mon), '2026-W46');
  assert.equal(timeReached('08:30', localTime(at('2026-11-09T06:29:00Z'))), false);
  assert.equal(timeReached('08:30', localTime(at('2026-11-09T06:30:00Z'))), true);
  assert.equal(isWorkingHours(sat), false);
  assert.equal(isWorkingHours(mon), true);
});

test('every duty belongs to a real agent whose role and unit exist in the organization', () => {
  const ids = new Set<string>();
  for (const duty of STANDING_DUTIES) {
    assert.ok(!ids.has(duty.id), `duplicate ${duty.id}`); ids.add(duty.id);
    const role = initialOrganization.roles.find((r) => r.id === roleIdFor(duty.agent));
    assert.ok(role, `${duty.id}: role ${roleIdFor(duty.agent)} missing`);
    if (duty.agent !== 'orchestrator') assert.equal(role.unitId, AGENT_DIRECTORY[duty.agent].unitId);
    assert.match(duty.time, /^\d\d:\d\d$/);
  }
  for (const p of getEmployeeProfiles()) assert.ok(initialOrganization.roles.some((r) => r.id === p.roleId), `${p.agent} role`);
  assert.equal(new Set(getEmployeeProfiles().map((p) => p.employeeNumber)).size, getEmployeeProfiles().length);
});

function fakeDeps(input: Partial<DutyDeps> & { now?: string } = {}) {
  const { now: nowIso, ...over } = input;
  const store = new InMemoryDutyStore();
  const calls = { handoffs: [] as unknown[], ask: 0, approvals: [] as unknown[], reports: [] as unknown[], failed: [] as string[], advanced: [] as string[] };
  const deps: DutyDeps = {
    store, now: () => at(nowIso ?? '2026-11-09T07:00:00Z'), // Monday 09:00 office time
    duties: async () => resolveDuties([], []),
    employee: async () => ({ employeeNumber: 'TT-002', title: 'Head of Sales' }),
    sign: async () => ({ block: '— TT-002 · Head of Sales\n  ✍ TEST' }),
    actions: { run: async () => '' },
    handoffs: { queue: async (input) => { calls.handoffs.push(input); } },
    unavailableReason: async () => null,
    buildContext: async () => ({ crm: { leads_total: 3 }, briefing: { date: '2026-11-09', duties: [], pendingApprovals: [], failedTasks: [] } }),
    ask: async () => { calls.ask += 1; return 'Work product'; },
    tasks: {
      begin: async () => ({ taskId: `t-${Math.random()}`, tracking: 'unavailable' }),
      advance: async (_id, transitions) => { calls.advanced.push(...transitions.map((t) => t.status)); },
      fail: async (_id, message) => { calls.failed.push(message); },
    },
    approvals: { create: async (input) => { calls.approvals.push(input); } },
    reports: { save: async (input) => { calls.reports.push(input); } },
    ...over,
  };
  return { deps, store, calls };
}
const duty = (id: string) => STANDING_DUTIES.find((d) => d.id === id)!;

test('a due duty runs once per period and is idempotent', async () => {
  const { deps, calls } = fakeDeps();
  const first = await runDuty(deps, duty('task-board-hygiene')); // 08:00 weekday, now 09:00
  assert.equal(first.status, 'completed');
  assert.deepEqual(calls.advanced, ['ceo_analyzing', 'delegated', 'executing', 'returned_to_ceo', 'completed']);
  const second = await runDuty(deps, duty('task-board-hygiene'));
  assert.equal(second.status, 'not_due');
  assert.equal(calls.ask, 1);
});

test('a duty is not run before its time or on the wrong day', async () => {
  const early = fakeDeps({ now: '2026-11-09T05:00:00Z' }); // 07:00 office
  assert.equal((await runDuty(early.deps, duty('task-board-hygiene'))).status, 'not_due');
  const sunday = fakeDeps({ now: '2026-11-08T09:00:00Z' });
  assert.equal((await runDuty(sunday.deps, duty('task-board-hygiene'))).status, 'not_due');
  const notFriday = fakeDeps(); // Monday: Friday duty is not due
  assert.equal((await runDuty(notFriday.deps, duty('weekly-priorities-review'))).status, 'not_due');
});

test('sales pipeline duty completes under autonomous first-contact guardrails', async () => {
  const { deps, calls } = fakeDeps({ now: '2026-11-09T07:00:00Z' });
  const out = await runDuty(deps, duty('sales-pipeline-review'));
  assert.equal(out.status, 'completed');
  assert.equal(calls.approvals.length, 0);
  assert.match(buildDutyPrompt(duty('sales-pipeline-review'), localTime(at('2026-11-09T07:00:00Z'))), /never claim a message was sent unless the outbox confirms it/i);
});

test('an unavailable employee records a skip once, then works when available', async () => {
  let reason: string | null = 'Role is not active.';
  const { deps, store } = fakeDeps({ unavailableReason: async () => reason });
  assert.equal((await runDuty(deps, duty('task-board-hygiene'))).status, 'skipped');
  assert.equal((await runDuty(deps, duty('task-board-hygiene'))).status, 'skipped');
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].status, 'skipped');
  reason = null;
  assert.equal((await runDuty(deps, duty('task-board-hygiene'))).status, 'completed');
  assert.equal(store.rows.length, 1);
});

test('failures are recorded, retried up to three attempts, then left alone', async () => {
  let attempts = 0;
  const { deps, store, calls } = fakeDeps({ ask: async () => { attempts += 1; throw new Error('model down'); } });
  for (let i = 0; i < 5; i += 1) await runDuty(deps, duty('task-board-hygiene'));
  assert.equal(attempts, 3);
  assert.equal(store.rows[0].status, 'failed');
  assert.equal(store.rows[0].attempts, 3);
  assert.equal(calls.failed.length, 3);
});

test('daily lead discovery retries a failed research run up to five attempts', async () => {
  let attempts = 0;
  const { deps, store } = fakeDeps({ now: '2026-11-09T04:00:00Z', ask: async () => { attempts += 1; throw new Error('research timeout'); } });
  for (let i = 0; i < 7; i += 1) await runDuty(deps, duty('daily-lead-discovery'));
  assert.equal(attempts, 5);
  assert.equal(store.rows[0].attempts, 5);
  assert.equal(store.rows[0].status, 'failed');
});

test('daily prospect research runs on weekends at 06:00 Malawi time', () => {
  const sat = localTime(at('2026-11-07T04:00:00Z'));
  assert.equal(sat.minutes, 360);
  assert.equal(runsToday(duty('daily-lead-discovery').cadence, sat), true);
  assert.equal(timeReached(duty('daily-lead-discovery').time, sat), true);
});

test('two workers cannot claim the same duty and period', async () => {
  const { deps, store } = fakeDeps();
  const other = await store.claim({ duty_id: 'task-board-hygiene', period_key: '2026-11-09', role_id: 'x', task_id: null, status: 'running', attempts: 1, summary: null, error: null, started_at: at('2026-11-09T07:00:00Z').toISOString(), completed_at: null });
  assert.ok(other);
  const out = await runDuty(deps, duty('task-board-hygiene'));
  assert.equal(out.status, 'not_due'); // existing fresh 'running' claim is respected
});

test('force runs a duty again under a separate manual period', async () => {
  const { deps, store } = fakeDeps();
  await runDuty(deps, duty('task-board-hygiene'));
  const again = await runDuty(deps, duty('task-board-hygiene'), { force: true });
  assert.equal(again.status, 'completed');
  assert.equal(store.rows.length, 2);
});

test('the CEO briefing is filed as a report, and still produced without a model', async () => {
  const withModel = fakeDeps({ now: '2026-11-09T14:45:00Z' }); // 16:45 office
  assert.equal((await runDuty(withModel.deps, duty('ceo-daily-briefing'))).status, 'completed');
  assert.equal(withModel.calls.reports.length, 1);

  const noModel = fakeDeps({ now: '2026-11-09T14:45:00Z', unavailableReason: async () => 'No model.', fallbackBody: (d, c) => deterministicBriefing(c) });
  const out = await runDuty(noModel.deps, duty('ceo-daily-briefing'));
  assert.equal(out.status, 'completed');
  assert.equal(noModel.calls.ask, 0);
  assert.match(String((noModel.calls.reports[0] as { body: string }).body), /compiled without a model/);
});

test('runDueDuties runs everything due in time order and isolates failures', async () => {
  const { deps } = fakeDeps({ now: '2026-11-09T14:45:00Z' }); // Monday 16:45: all weekday + Monday duties due
  const outcomes = await runDueDuties(deps);
  const ids = outcomes.map((o) => o.dutyId);
  assert.ok(ids.includes('security-audit-review') && ids.includes('ceo-daily-briefing') && ids.includes('weekly-billing-readiness'));
  assert.ok(!ids.includes('weekly-priorities-review')); // Friday duty
  assert.equal(ids.indexOf('security-audit-review') < ids.indexOf('ceo-daily-briefing'), true);
});

test('deterministic briefing lists decisions, department updates and problems', () => {
  const body = deterministicBriefing({ briefing: { date: '2026-11-09', duties: [{ title: 'Daily pipeline review', owner: 'Head of Sales', status: 'awaiting_approval', summary: 'Five drafts ready', error: null }, { title: 'Weekly market scan', owner: 'Head of Research', status: 'skipped', summary: null, error: 'Web research is not configured' }], pendingApprovals: [{ summary: 'Outreach drafts', requestedBy: 'director-sales', risk: 'low' }], failedTasks: [{ objective: 'Fix bug', error: 'timeout' }] } })!;
  assert.match(body, /Outreach drafts/); assert.match(body, /Five drafts ready/); assert.match(body, /Web research is not configured/); assert.match(body, /timeout/);
});

test('approval decisions are validated before touching the database', async () => {
  await assert.rejects(decideApproval({ id: 'nope', decision: 'approved' }), (e: unknown) => e instanceof ApprovalError && e.status === 400);
  await assert.rejects(decideApproval({ id: '123e4567-e89b-12d3-a456-426614174000', decision: 'maybe' as never }), (e: unknown) => e instanceof ApprovalError && e.status === 400);
  await assert.rejects(decideApproval({ id: '123e4567-e89b-12d3-a456-426614174000', decision: 'rejected' }), (e: unknown) => e instanceof ApprovalError && /reason/.test(e.message));
});

test('new tools are registered; deciding approvals is Founder-only', () => {
  const names: string[] = [];
  registerAllTools({ registerTool: (n: string) => { names.push(n); } } as never);
  for (const n of ['get_workforce_status', 'run_due_organization_duties', 'get_daily_briefing', 'decide_organization_approval', 'submit_prospect_for_review', 'list_prospect_discovery_queue', 'update_prospect_review_status']) assert.ok(names.includes(n), n);
  assert.ok(SENSITIVE_TOOLS.has('decide_organization_approval'));
  assert.ok(STANDARD_WRITE_TOOLS.has('run_due_organization_duties'));\n  assert.ok(STANDARD_WRITE_TOOLS.has('submit_prospect_for_review'));\n  assert.ok(STANDARD_WRITE_TOOLS.has('update_prospect_review_status'));
});

test('the activation script puts every duty owner to work', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../supabase/manual/activate_agent_roles.sql', import.meta.url), 'utf8');
  const missing = [...new Set(STANDING_DUTIES.map((d) => roleIdFor(d.agent)))].filter((r) => !sql.includes(`'${r}'`));
  assert.deepEqual(missing, []);
});

test('the workforce migration creates the tables and columns the code relies on', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../supabase/migrations/20261029_organization_workforce.sql', import.meta.url), 'utf8');
  for (const needle of ['organization_duty_runs', 'organization_reports', 'unique (duty_id, period_key)', 'add column if not exists content', 'add column if not exists task_id']) assert.ok(sql.includes(needle), needle);
});
