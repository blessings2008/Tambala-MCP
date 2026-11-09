import { AGENT_DIRECTORY } from '../../services/ai/models.js';
import type { ContextKind, StandingDuty } from './duties.js';
import { actionHelp, parseActions, type Action } from './actions.js';
import { colleagueList, extractHandoffs, MAX_HANDOFFS_PER_DUTY } from './handoffs.js';
import { roleIdFor } from './profiles.js';
import { localTime, OFFICE_TZ, periodKey, runsToday, timeReached, type LocalTime } from './schedule.js';
import type { DutyRun, DutyStore } from './duty-store.js';
import type { OrganizationTaskTransition } from '../task-lifecycle.js';

export type DutyOutcomeStatus = 'completed' | 'awaiting_approval' | 'skipped' | 'failed' | 'not_due' | 'already_running';
export interface DutyOutcome { dutyId: string; status: DutyOutcomeStatus; reason?: string; taskId?: string; runId?: string; handoffs?: number }

export interface DutyDeps {
  store: DutyStore;
  now: () => Date;
  /** Built-in duties with the Founder's overrides and custom duties applied. */
  duties(): Promise<StandingDuty[]>;
  employee(agent: StandingDuty['agent']): Promise<{ employeeNumber: string; title: string }>;
  /** Sign finished work as this worker. Always returns a block: a real signature or an explicit UNSIGNED marker. */
  sign(input: { roleId: string; kind: 'duty_result' | 'briefing'; subjectId: string; content: string }): Promise<{ block: string }>;
  /** Carry out the real-world actions an employee requested; returns a readable summary to attach to their work. */
  actions: { run(ctx: { agent: StandingDuty['agent']; roleId: string; taskId: string }, actions: Action[], rejected: string[]): Promise<string> };
  handoffs: { queue(input: { toAgent: StandingDuty['agent']; request: string; fromRoleId: string; contextSummary: string; sourceTaskId: string; sourceDutyId: string }): Promise<void> };
  /** Why this employee cannot work right now, or null when they can. */
  unavailableReason(duty: StandingDuty): Promise<string | null>;
  buildContext(kinds: ContextKind[], now: Date): Promise<Record<string, unknown>>;
  ask(duty: StandingDuty, prompt: string, context: Record<string, unknown>): Promise<string>;
  /** Used when the output is a report and no model is available, so the Founder still gets a briefing. */
  fallbackBody?(duty: StandingDuty, context: Record<string, unknown>): string | null;
  tasks: {
    begin(objective: string): Promise<{ taskId: string; tracking: 'recorded' | 'unavailable' }>;
    advance(taskId: string, transitions: OrganizationTaskTransition[]): Promise<unknown>;
    fail(taskId: string, message: string): Promise<void>;
  };
  approvals: { create(input: { actionType: string; summary: string; requestedByRoleId: string; riskLevel: 'low' | 'medium'; taskId: string; content: string }): Promise<void> };
  reports: { save(input: { kind: 'daily_briefing'; periodKey: string; title: string; body: string; taskId: string }): Promise<void> };
}

const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MS = 15 * 60_000;
const RULES = 'Use ONLY the supplied data. If a source is empty or unavailable, say so plainly and list what you could not check. Never invent leads, clients, amounts, dates or results. Do not sign or add a sign-off: the system signs your work with your employee number. Customer-facing messages are drafts for Founder approval except first-contact WhatsApp outreach by the Sales & Business Development director, which may be sent autonomously only when the shared outbox verifies a CRM lead and applies the configured cap, cooldown and opt-out rules. Never claim a message was sent unless the outbox confirms it.';

export function buildDutyPrompt(duty: StandingDuty, lt: LocalTime, who?: { employeeNumber: string; title: string }): string {
  const parts = [
    `STANDING DUTY: ${duty.title}`,
    who ? `You are employee ${who.employeeNumber}, ${who.title} at Tambala Technologies.` : '',
    `Today is ${lt.date} (office time, ${OFFICE_TZ}). This is your recurring job, not a Founder request.`,
    RULES,
    `JOB: ${duty.job}`,
    `DELIVERABLE: ${duty.deliverable}`,
    'Keep it under 350 words, plain and scannable.',
  ];
  if (duty.id === 'morning-board-minutes') {
    parts.push('BOARD MINUTES CONTROL: The supplied context.boardMeeting object is the authoritative attendance and department-report matrix. Include all four departmentUpdates. Use its status exactly: mark the minutes COMPLETE only when boardMeeting.status is COMPLETE; otherwise mark PARTIAL and name every entry in missingDepartments. Quote findings only from each departmentUpdates.report. Do not infer a missing report from another department’s summary.');
  }
  if (!duty.report) {
    parts.push(actionHelp(duty.agent));
    parts.push(`If part of this work genuinely belongs to a colleague, end your answer with a block exactly like:\nHANDOFFS:\n- to: <colleague key> | task: <one clear sentence of what you need from them>\nColleagues: ${colleagueList(duty.agent)}.\nUse at most ${MAX_HANDOFFS_PER_DUTY}. If nothing needs handing off, omit the block entirely.`);
  }
  return parts.filter(Boolean).join('\n\n');
}

function dueNow(duty: StandingDuty, lt: LocalTime, existing: DutyRun | null, nowMs: number): boolean {
  if (!runsToday(duty.cadence, lt) || !timeReached(duty.time, lt)) return false;
  if (!existing) return true;
  if (existing.status === 'skipped') return true;
  if (existing.status === 'failed') return existing.attempts < MAX_ATTEMPTS;
  if (existing.status === 'running') return nowMs - Date.parse(existing.started_at) > STALE_RUNNING_MS && existing.attempts < MAX_ATTEMPTS;
  return false;
}

export async function runDuty(deps: DutyDeps, duty: StandingDuty, opts: { force?: boolean } = {}): Promise<DutyOutcome> {
  const now = deps.now();
  const lt = localTime(now);
  const basePeriod = periodKey(duty.cadence, lt);
  const period = opts.force ? `${basePeriod}#manual-${now.toISOString()}` : basePeriod;
  const existing = opts.force ? null : await deps.store.find(duty.id, period);
  if (duty.enabled === false && !opts.force) return { dutyId: duty.id, status: 'not_due', reason: 'Switched off by the Founder.' };
  if (!opts.force && !dueNow(duty, lt, existing, now.getTime())) return { dutyId: duty.id, status: 'not_due', runId: existing?.id };

  const roleId = roleIdFor(duty.agent);
  const blocked = await deps.unavailableReason(duty);
  const fallbackOk = Boolean(duty.report && deps.fallbackBody);
  if (blocked && !fallbackOk) {
    // Record the skip once; do not rewrite the same reason on every scheduler tick.
    if (existing?.status === 'skipped' && existing.error === blocked) return { dutyId: duty.id, status: 'skipped', reason: blocked, runId: existing.id };
    if (existing) await deps.store.update(existing.id, { status: 'skipped', error: blocked });
    else await deps.store.claim({ duty_id: duty.id, period_key: period, role_id: roleId, task_id: null, status: 'skipped', attempts: 0, summary: null, error: blocked, started_at: now.toISOString(), completed_at: null });
    return { dutyId: duty.id, status: 'skipped', reason: blocked };
  }

  let run: DutyRun | null;
  if (existing) {
    await deps.store.update(existing.id, { status: 'running', attempts: existing.attempts + 1, error: null, started_at: now.toISOString() });
    run = { ...existing, status: 'running', attempts: existing.attempts + 1 };
  } else {
    run = await deps.store.claim({ duty_id: duty.id, period_key: period, role_id: roleId, task_id: null, status: 'running', attempts: 1, summary: null, error: null, started_at: now.toISOString(), completed_at: null });
  }
  if (!run) return { dutyId: duty.id, status: 'already_running', reason: 'Another worker already claimed this duty for the period.' };

  const begun = await deps.tasks.begin(`[Standing duty] ${duty.title}`);
  const taskId = begun.taskId;
  try {
    await deps.store.update(run.id, { task_id: taskId });
    await deps.tasks.advance(taskId, [
      { status: 'ceo_analyzing', stage: 'ceo', eventType: 'standing_duty_started', payload: { dutyId: duty.id, period } },
      { status: 'delegated', stage: 'ceo', eventType: 'standing_duty_assigned', departmentId: agentUnit(duty), roleId },
      { status: 'executing', stage: 'department', eventType: 'department_execution_started', roleId },
    ]);
    const context = await deps.buildContext(duty.contexts, now);
    let body: string;
    let compiledWithoutModel = false;
    let pendingHandoffs: { toAgent: StandingDuty['agent']; request: string }[] = [];
    let actionsText = '';
    if (blocked) {
      const fallback = deps.fallbackBody?.(duty, context);
      if (!fallback) throw new Error(blocked);
      body = fallback; compiledWithoutModel = true;
    } else {
      const who = await deps.employee(duty.agent);
      body = (await deps.ask(duty, buildDutyPrompt(duty, lt, who), context)).trim();
      if (!body) throw new Error('The employee returned no work product.');
      if (!duty.report) {
        const parsed = extractHandoffs(body, duty.agent);
        const acted = parseActions(body);
        body = acted.clean;
        pendingHandoffs = parsed.handoffs;
        actionsText = await deps.actions.run({ agent: duty.agent, roleId, taskId }, acted.actions, acted.rejected);
      }
    }
    const stamp = await deps.sign({ roleId, kind: duty.report ? 'briefing' : 'duty_result', subjectId: run.id, content: body });
    const stamped = `${body}${actionsText ? `\n\n${actionsText}` : ''}\n\n${stamp.block}`;
    await deps.tasks.advance(taskId, [
      { status: 'returned_to_ceo', stage: 'review', eventType: 'department_work_returned', roleId, result: { dutyId: duty.id, summary: stamped.slice(0, 8000), compiledWithoutModel } },
      { status: 'completed', stage: 'complete', eventType: 'standing_duty_completed', roleId, completedAt: new Date().toISOString() },
    ]);
    if (duty.report) await deps.reports.save({ kind: duty.report, periodKey: lt.date, title: `${duty.title} — ${lt.date}`, body: stamped, taskId });
    let status: DutyOutcomeStatus = 'completed';
    if (duty.approval) {
      await deps.approvals.create({ actionType: duty.approval.actionType, summary: `${duty.title}: ${duty.approval.summary}`, requestedByRoleId: roleId, riskLevel: duty.approval.riskLevel, taskId, content: stamped.slice(0, 8000) });
      status = 'awaiting_approval';
    }
    for (const h of pendingHandoffs) await deps.handoffs.queue({ toAgent: h.toAgent, request: h.request, fromRoleId: roleId, contextSummary: body, sourceTaskId: taskId, sourceDutyId: duty.id });
    await deps.store.update(run.id, { status, summary: `${body.length > 1300 ? `${body.slice(0, 1300)}…` : body}${actionsText ? `\n\n${actionsText}` : ''}\n\n${stamp.block}`, completed_at: new Date().toISOString(), error: compiledWithoutModel ? 'Compiled without a model (employee unavailable).' : null });
    return { dutyId: duty.id, status, taskId, runId: run.id, handoffs: pendingHandoffs.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Duty failed.';
    await deps.tasks.fail(taskId, message);
    await deps.store.update(run.id, { status: 'failed', error: message.slice(0, 500), completed_at: new Date().toISOString() });
    return { dutyId: duty.id, status: 'failed', reason: message, taskId, runId: run.id };
  }
}

function agentUnit(duty: StandingDuty): string { return AGENT_DIRECTORY[duty.agent].unitId; }

/** Run every duty that is due now, in schedule order, one at a time. */
export async function runDueDuties(deps: DutyDeps, opts: { dutyId?: string; force?: boolean } = {}): Promise<DutyOutcome[]> {
  const all = await deps.duties();
  if (opts.dutyId) {
    const duty = all.find((d) => d.id === opts.dutyId);
    if (!duty) throw new Error(`Unknown duty: ${opts.dutyId}`);
    return [await runDuty(deps, duty, { force: opts.force })];
  }
  const ordered = [...all].sort((a, b) => a.time.localeCompare(b.time));
  const outcomes: DutyOutcome[] = [];
  for (const duty of ordered) {
    let outcome: DutyOutcome;
    try { outcome = await runDuty(deps, duty); }
    catch (error) { outcome = { dutyId: duty.id, status: 'failed', reason: error instanceof Error ? error.message : 'Duty failed.' }; }
    if (outcome.status !== 'not_due') outcomes.push(outcome);
  }
  return outcomes;
}
