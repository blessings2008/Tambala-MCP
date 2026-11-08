import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDING_DUTIES } from '../src/organization/workforce/duties.ts';
import { resolveDuties, validateCustomDuty, validateOverride, DutyConfigError, saveCustomDuty, InMemoryDutyConfigStore } from '../src/organization/workforce/duty-config.ts';
import { extractHandoffs, queueHandoff, processHandoffs, InMemoryHandoffStore, HandoffError, colleagueList, isFounderClarificationRequest, resumeFounderHandoff, type HandoffDeps } from '../src/organization/workforce/handoffs.ts';
import { buildDutyPrompt, runDuty, type DutyDeps } from '../src/organization/workforce/duty-runner.ts';
import { InMemoryDutyStore } from '../src/organization/workforce/duty-store.ts';
import { EMPLOYEE_NUMBERS, getEmployeeProfiles } from '../src/organization/workforce/profiles.ts';
import { deterministicBriefing } from '../src/organization/workforce/briefing.ts';
import { localTime } from '../src/organization/workforce/schedule.ts';
import { STANDARD_WRITE_TOOLS } from '../src/organization/write-guard.ts';
import { registerAllTools } from '../src/tools/registry.ts';

const at = (iso: string) => new Date(iso);
const duty = (id: string) => resolveDuties([], []).find((d) => d.id === id)!;

test('employee numbers are frozen, unique and complete', () => {
  const numbers = Object.values(EMPLOYEE_NUMBERS);
  assert.equal(new Set(numbers).size, numbers.length);
  for (const n of numbers) assert.match(n, /^TT-\d{3}$/);
  assert.equal(EMPLOYEE_NUMBERS.orchestrator, 'TT-001');
  assert.equal(EMPLOYEE_NUMBERS.outreach, 'TT-002');
  assert.equal(EMPLOYEE_NUMBERS.governance, 'TT-019');
  assert.equal(getEmployeeProfiles().length, numbers.length);
  assert.ok(!numbers.includes('TT-000')); // reserved for the Founder
});

test('handoff parsing keeps valid requests, drops bad ones, strips the block', () => {
  const body = `Pipeline looks thin.\n\nHANDOFFS:\n- to: marketing | task: Prepare a one-page overview of our web services for lodge owners\n- to: marketing | task: Prepare a one-page overview of our web services for lodge owners\n- to: nobody | task: Do something that does not exist at all\n- to: outreach | task: Ping the pipeline again for me please\n- to: orchestrator | task: Tell the CEO something quite important\n- to: finance | task: short\n- to: security | task: Check whether the lodge domains look legitimate before outreach\n- to: legal | task: Review wording of our outreach for compliance concerns`;
  const r = extractHandoffs(body, 'outreach');
  assert.equal(r.body, 'Pipeline looks thin.');
  assert.deepEqual(r.handoffs.map((h) => h.toAgent), ['marketing', 'security']); // dupes, self, CEO, unknown, too short dropped; capped at 2
  assert.equal(extractHandoffs('No block here', 'outreach').handoffs.length, 0);
  assert.ok(!colleagueList('outreach').includes('outreach ('));
});

test('duty prompts introduce the employee and allow handoffs, but not for the CEO briefing', () => {
  const lt = localTime(at('2026-11-09T07:00:00Z'));
  const sales = buildDutyPrompt(duty('sales-pipeline-review'), lt, { employeeNumber: 'TT-002', title: 'Head of Sales' });
  assert.match(sales, /You are employee TT-002, Head of Sales/); assert.match(sales, /Do not sign/); assert.match(sales, /HANDOFFS:/); assert.match(sales, /never claim a message was sent/i);
  assert.doesNotMatch(buildDutyPrompt(duty('ceo-daily-briefing'), localTime(at('2026-11-09T14:45:00Z'))), /HANDOFFS:/);
});

function dutyDeps(answer: string, nowIso = '2026-11-09T07:00:00Z', list = resolveDuties([], [])) {
  const queued: any[] = []; const reports: any[] = [];
  const deps: DutyDeps = {
    store: new InMemoryDutyStore(), now: () => at(nowIso), duties: async () => list,
    employee: async () => ({ employeeNumber: 'TT-002', title: 'Head of Sales' }), sign: async () => ({ block: '— TT-002\n  ✍ TEST' }), actions: { run: async () => '' }, handoffs: { queue: async (i) => { queued.push(i); } },
    unavailableReason: async () => null, buildContext: async () => ({}), ask: async () => answer,
    tasks: { begin: async () => ({ taskId: 't1', tracking: 'unavailable' }), advance: async () => {}, fail: async () => {} },
    approvals: { create: async () => {} }, reports: { save: async (r) => { reports.push(r); } },
  };
  return { deps, queued, reports };
}

test('a duty that asks a colleague for help queues the handoff and keeps the summary clean', async () => {
  const { deps, queued } = dutyDeps('Two warm leads.\nHANDOFFS:\n- to: marketing | task: Prepare a one-page overview of web services for lodge owners');
  const out = await runDuty(deps, duty('task-board-hygiene'));
  assert.equal(out.handoffs, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].toAgent, 'marketing');
  assert.equal(queued[0].contextSummary, 'Two warm leads.');
  assert.equal(queued[0].fromRoleId, 'director-operations-administration');
  const ceo = dutyDeps('Briefing.\nHANDOFFS:\n- to: finance | task: This must be ignored for reports entirely', '2026-11-09T14:45:00Z');
  await runDuty(ceo.deps, duty('ceo-daily-briefing'));
  assert.equal(ceo.queued.length, 0);
});

test('a duty the Founder switched off does not run; Run now still can', async () => {
  const list = resolveDuties([{ duty_id: 'task-board-hygiene', enabled: false, time: null, job: null, deliverable: null }], []);
  const { deps } = dutyDeps('ok', '2026-11-09T07:00:00Z', list);
  const off = list.find((d) => d.id === 'task-board-hygiene')!;
  assert.equal((await runDuty(deps, off)).status, 'not_due');
  assert.equal((await runDuty(deps, off, { force: true })).status, 'completed');
});

function handoffDeps(over: Partial<HandoffDeps> = {}) {
  const store = new InMemoryHandoffStore(); const asked: string[] = [];
  const deps: HandoffDeps = {
    store, now: () => at('2026-11-09T07:00:00Z'), agentUnavailableReason: async () => null,
    senderLabel: async (r) => (r === 'founder' ? 'The Founder' : r), recipientLabel: async () => 'employee TT-005, Head of Marketing', actions: { run: async () => '' }, sign: async () => ({ block: '— TT-005\n  ✍ TEST-SIG' }),
    buildContext: async () => ({}), askAgent: async (agent, prompt) => { asked.push(prompt); return agent === 'orchestrator' ? 'DECISION: ACCEPT\\nThe deliverable meets the request.' : 'Here is the overview.'; },
    tasks: { begin: async () => ({ taskId: 't' }), advance: async () => {}, fail: async () => {} }, ...over,
  };
  return { deps, store, asked };
}

test('the Founder assigns work and the employee completes it', async () => {
  const { deps, store, asked } = handoffDeps();
  const h = await queueHandoff(store, { fromRoleId: 'founder', toAgent: 'marketing', request: 'Draft a one-page overview of our web services' });
  assert.equal(h.to_role_id, 'director-marketing-brand');
  const out = await processHandoffs(deps);
  assert.equal(out[0].status, 'completed');
  assert.equal(store.rows[0].status, 'completed');
  assert.equal(store.rows[0].result, 'Here is the overview.\n\n— TT-005\n  ✍ TEST-SIG');
  assert.match(asked[0], /The Founder has assigned this work to your room/); assert.match(asked[0], /Do not hand work on/);
  assert.equal((await processHandoffs(deps)).length, 0); // nothing left in the inbox
});

test('task rooms pause on clarification and retain their history instead of completing', async () => {
  assert.equal(isFounderClarificationRequest('Clarification Required — do you mean Malabi Exclusive Lodges or the dessert?'), true);
  assert.equal(isFounderClarificationRequest('The lodge is in Lilongwe. Would you like a summary?'), false);
  const { deps, store } = handoffDeps({ askAgent: async () => '## Clarification Required\\nDo you mean Malabi Exclusive Lodges in Lilongwe or the dessert?' });
  const h = await queueHandoff(store, { fromRoleId: 'founder', toAgent: 'research', request: 'Research Malabi and verify the correct entity' });
  assert.ok(h.room_id);
  const out = await processHandoffs(deps);
  assert.equal(out[0].status, 'waiting');
  assert.equal(store.rows[0].status, 'awaiting_founder');
  assert.equal(store.rooms[0].status, 'awaiting_founder');
  assert.equal(store.rooms[0].closed_at, null);
  assert.ok(store.roomEvents.some((event) => event.event_type === 'clarification_requested'));
  assert.equal((await processHandoffs(deps)).length, 0);
});
test('Founder clarification reopens the same room and resumes its original task', async () => {
  let answer = 'Clarification Required: which Malabi do you mean?';
  let starts = 0;
  const { deps, store } = handoffDeps({
    askAgent: async (agent) => agent === 'orchestrator' ? 'DECISION: ACCEPT\\nThe deliverable meets the request.' : answer,
    tasks: { begin: async () => { starts += 1; return { taskId: 'same-task' }; }, advance: async () => {}, fail: async () => {} },
  });
  const handoff = await queueHandoff(store, { fromRoleId: 'founder', toAgent: 'research', request: 'Research Malabi and verify the correct entity' });
  await processHandoffs(deps);
  const roomId = store.rows[0].room_id;
  await resumeFounderHandoff(store, handoff.id, 'I mean Malabi Exclusive Lodges in Lilongwe.');
  answer = 'Verified findings and source links are ready.';
  await processHandoffs(deps);
  assert.equal(starts, 1);
  assert.equal(store.rows[0].status, 'completed');
  assert.equal(store.rows[0].room_id, roomId);
  assert.equal(store.rows[0].task_id, 'same-task');
  assert.equal(store.rooms[0].status, 'archived');
  assert.ok(store.roomEvents.some((event) => event.event_type === 'founder_clarification_received'));
});
test('an unavailable colleague leaves the work waiting without rewriting it every tick', async () => {
  const { deps, store } = handoffDeps({ agentUnavailableReason: async () => 'Role is not active.' });
  await queueHandoff(store, { fromRoleId: 'founder', toAgent: 'marketing', request: 'Draft a one-page overview of our web services' });
  assert.equal((await processHandoffs(deps))[0].status, 'waiting');
  assert.equal(store.rows[0].status, 'queued'); assert.match(store.rows[0].error!, /Waiting/);
  assert.equal((await processHandoffs(deps))[0].status, 'waiting');
});

test('failed handoffs retry three times then stop', async () => {
  const { deps, store } = handoffDeps({ askAgent: async () => { throw new Error('model down'); } });
  await queueHandoff(store, { fromRoleId: 'founder', toAgent: 'marketing', request: 'Draft a one-page overview of our web services' });
  const statuses: string[] = [];
  for (let i = 0; i < 5; i += 1) for (const o of await processHandoffs(deps)) statuses.push(o.status);
  assert.deepEqual(statuses, ['retry', 'retry', 'failed']);
  assert.equal(store.rows[0].status, 'failed');
});

test('handoff requests are validated and cannot target the CEO', async () => {
  const store = new InMemoryHandoffStore();
  await assert.rejects(queueHandoff(store, { fromRoleId: 'founder', toAgent: 'orchestrator', request: 'Do the thing please now' }), HandoffError);
  await assert.rejects(queueHandoff(store, { fromRoleId: 'founder', toAgent: 'marketing', request: 'hi' }), HandoffError);
  await assert.rejects(queueHandoff(store, { fromRoleId: 'founder', toAgent: 'nope' as never, request: 'Do the thing please now' }), HandoffError);
});

test('custom duties validate, get unique ids, and run through the same engine', async () => {
  const ok = { title: 'Weekly lodge lead list', agent: 'outreach', cadence: { kind: 'weekly', day: 3 }, time: '10:15', contexts: ['crm'], job: 'List ten lodges worth contacting this week.', deliverable: 'A ranked list with reasons.', requiresApproval: true };
  const store = new InMemoryDutyConfigStore();
  const first = await saveCustomDuty(store, ok); const second = await saveCustomDuty(store, ok);
  assert.equal(first.id, 'weekly-lodge-lead-list'); assert.equal(second.id, 'weekly-lodge-lead-list-2');
  const list = resolveDuties([], await store.customs());
  const custom = list.find((d) => d.id === first.id)!;
  assert.equal(custom.custom, true); assert.equal(custom.cadence.kind, 'weekly'); assert.ok(custom.approval);
  const { deps } = dutyDeps('Ten lodges.', '2026-11-11T09:00:00Z', list); // Wednesday 11:00 office
  assert.equal((await runDuty(deps, custom)).status, 'awaiting_approval');
  const ceoMinutes = validateCustomDuty({ ...ok, title: 'Morning board minutes', agent: 'orchestrator', cadence: { kind: 'weekdays' }, time: '08:25', contexts: ['briefing', 'organization'], requiresApproval: false }, new Set());
  assert.deepEqual(ceoMinutes.contexts, ['briefing', 'organization']);
  for (const bad of [{ ...ok, title: 'x' }, { ...ok, agent: 'ghost' }, { ...ok, time: '25:00' }, { ...ok, time: '03:00' }, { ...ok, cadence: { kind: 'weekly', day: 9 } }, { ...ok, contexts: ['briefing'] }, { ...ok, job: 'short' }]) {
    assert.throws(() => validateCustomDuty(bad, new Set()), DutyConfigError);
  }
});

test('built-in duty overrides validate and apply', () => {
  assert.throws(() => validateOverride('nope', {}), DutyConfigError);
  assert.throws(() => validateOverride('task-board-hygiene', { time: '8am' }), DutyConfigError);
  const o = validateOverride('task-board-hygiene', { enabled: true, time: '07:45', job: 'Check only overdue items today.', deliverable: '' });
  const d = resolveDuties([o], []).find((x) => x.id === 'task-board-hygiene')!;
  assert.equal(d.time, '07:45'); assert.equal(d.job, 'Check only overdue items today.'); assert.equal(d.deliverable, STANDING_DUTIES.find((x) => x.id === 'task-board-hygiene')!.deliverable); assert.equal(d.edited, true);
  assert.equal(resolveDuties([validateOverride('task-board-hygiene', { enabled: true, time: '', job: '', deliverable: '' })], []).find((x) => x.id === 'task-board-hygiene')!.edited, false);
});

test('the briefing lists work handed between staff', () => {
  const body = deterministicBriefing({ briefing: { date: '2026-11-09', handoffs: [{ from: 'TT-002 Head of Sales', to: 'TT-005 Head of Marketing', request: 'Prepare a one-page overview', status: 'completed', result: 'Overview ready' }], duties: [], pendingApprovals: [], failedTasks: [] } })!;
  assert.match(body, /Work handed between staff/); assert.match(body, /TT-002.*→.*TT-005/); assert.match(body, /Overview ready/);
});

test('assignment is a guarded write tool and registered; migration creates the tables', async () => {
  const names: string[] = [];
  registerAllTools({ registerTool: (n: string) => { names.push(n); } } as never);
  assert.ok(names.includes('assign_work_to_employee')); assert.ok(STANDARD_WRITE_TOOLS.has('assign_work_to_employee'));
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../supabase/migrations/20261030_organization_staff_handoffs_duties.sql', import.meta.url), 'utf8');
  for (const t of ['organization_staff_names', 'organization_handoffs', 'organization_duty_config', 'organization_custom_duties']) assert.ok(sql.includes(t), t);
});
