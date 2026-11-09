import { supabaseInsert, supabaseSelect } from '../../lib/supabase.js';
import { getBusinessSummary, getVerifiedCompanyContext } from '../../services/ai/context.js';
import { askTambalaAI, askTambalaAIWithWebResearch, getAgentOperationalInfo } from '../../services/ai.js';
import { getOrganizationSnapshot } from '../service.js';
import { advanceTrackedTask, beginTrackedTask, failTrackedTask } from '../task-tracking.js';
import { deterministicBriefing } from './briefing.js';
import { createApprovalRequest } from './approvals-service.js';
import type { AgentName } from '../../services/ai/models.js';
import { type ContextKind, type StandingDuty } from './duties.js';
import { dbConfigured as dbOn } from './db-util.js';
import { loadDuties, requireConfigStore, saveBuiltinOverride, saveCustomDuty, SupabaseDutyConfigStore, type DutyConfigStore } from './duty-config.js';
import { InMemoryHandoffStore, SupabaseHandoffStore, processHandoffs, queueHandoff, resumeFounderTaskRoom, type Handoff, type HandoffDeps, type HandoffOutcome, type HandoffStore } from './handoffs.js';
import { identityMark, signingAvailable } from './signing.js';
import { signWork, signatureStore } from './sign-work.js';
import { describeResults, executeActions, type ActionExecDeps } from './actions-exec.js';
import type { Action } from './actions.js';
import { founderNumber, productionOutboxDeps, runOutbox } from '../../channels/service.js';
import type { SendOutcome } from '../../channels/outbox.js';
import { createDocument } from '../../documents/service.js';
import { documentStore } from '../../documents/store.js';
import { createClientInvoice, invoiceStore, refreshOpenInvoices } from '../../payments/invoices.js';
import { InMemoryDutyStore, SupabaseDutyStore, type DutyRun, type DutyStore } from './duty-store.js';
import { runDueDuties, type DutyDeps, type DutyOutcome } from './duty-runner.js';
import { getEmployeeProfiles, identityForRole, labelForRole, roleIdFor } from './profiles.js';
import { cadenceLabel, isWorkingHours, localTime, periodKey, runsToday, timeReached } from './schedule.js';

type Row = Record<string, unknown>;
const dbConfigured = dbOn;

let memoryStore: InMemoryDutyStore | null = null;
let memoryBriefing: { period_key: string; title: string; body: string; created_at: string } | null = null;
export function dutyStore(): DutyStore {
  if (dbConfigured()) return new SupabaseDutyStore();
  return (memoryStore ??= new InMemoryDutyStore());
}

async function recentRows(table: string, query: string): Promise<Row[]> {
  return supabaseSelect<Row>(table, query);
}

async function briefingContext(store: DutyStore, now: Date): Promise<Row> {
  const lt = localTime(now);
  const since = new Date(now.getTime() - 20 * 3_600_000).toISOString();
  const runs = await store.recent(since);
  const todays = runs.filter((r) => r.period_key.startsWith(lt.date) || r.period_key.startsWith(lt.isoWeek));
  const owner = (r: DutyRun) => labelForRole(r.role_id);
  const dutyList = await loadDuties(configStore()).catch(() => [] as StandingDuty[]);
  const title = (r: DutyRun) => dutyList.find((d) => d.id === r.duty_id)?.title ?? r.duty_id;
  let pendingApprovals: Row[] = []; let failedTasks: Row[] = [];
  if (dbConfigured()) {
    pendingApprovals = await recentRows('organization_approval_requests', 'select=summary,requested_by_role_id,risk_level&status=eq.pending&order=created_at.asc&limit=20');
    failedTasks = await recentRows('organization_tasks', `select=objective,error_message&status=eq.failed&created_at=gte.${encodeURIComponent(since)}&limit=10`);
  }
  const handoffRows = await handoffStore().recent(since).catch(() => [] as Handoff[]);
  const label = (roleId: string) => labelForRole(roleId);
  return {
    date: lt.date,
    handoffs: handoffRows.map((h) => ({ from: label(h.from_role_id), to: label(h.to_role_id), request: h.request, status: h.status, result: h.result ? h.result.slice(0, 220) : null })),
    duties: todays.filter((r) => r.duty_id !== 'ceo-daily-briefing').map((r) => ({ title: title(r), owner: owner(r), status: r.status, summary: r.summary, error: r.error })),
    pendingApprovals: pendingApprovals.map((a) => ({ summary: String(a.summary), requestedBy: String(a.requested_by_role_id), risk: String(a.risk_level) })),
    failedTasks: failedTasks.map((t) => ({ objective: String(t.objective), error: t.error_message ? String(t.error_message) : null })),
  };
}

async function catalogContext(): Promise<Row> {
  const prices = (await documentStore().prices()).filter((p) => p.active);
  return {
    note: 'Price list. Reference items by sku. Prices are in MWK. If an item you need is not here, say so instead of inventing a price.',
    items: prices.map((p) => ({ sku: p.sku, name: p.name, unit: p.unit, unit_price_mwk: p.unit_price_minor / 100 })),
  };
}

async function invoicesContext(now: Date): Promise<Row> {
  const store = invoiceStore();
  await refreshOpenInvoices(store, now).catch(() => 0);
  const open = await store.open(new Date(now.getTime() - 90 * 86_400_000).toISOString(), 60);
  return {
    note: 'Unpaid invoices from Tambala Pay with their payment links. Status is what Tambala Pay last reported.',
    invoices: open.map((i) => ({ client: i.client_name, phone: i.client_phone, description: i.description, amount_mwk: i.amount_minor / 100, link: i.link, status: i.status, days_old: Math.floor((now.getTime() - Date.parse(i.created_at)) / 86_400_000) })),
  };
}

async function organizationContext(store: DutyStore, now: Date): Promise<Row> {
  const day = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const week = new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString();
  const [audit, tasks, bindings, runs] = await Promise.all([
    recentRows('organization_audit_events', `select=action,outcome,reason,created_at&created_at=gte.${encodeURIComponent(day)}&order=created_at.desc&limit=100`),
    recentRows('organization_tasks', `select=objective,status,assigned_role_id,error_message,created_at&created_at=gte.${encodeURIComponent(week)}&order=created_at.desc&limit=100`),
    recentRows('organization_actor_bindings', 'select=role_id,active&active=eq.true'),
    store.recent(week),
  ]);
  return {
    audit_last_24h: audit, tasks_last_7d: tasks, active_role_bindings: bindings.length,
    duty_runs_last_7d: runs.map((r) => ({ duty: r.duty_id, role: r.role_id, status: r.status, attempts: r.attempts, error: r.error, when: r.started_at })),
    office_hours_note: 'Office hours are Mon-Fri 08:00-17:00 Africa/Blantyre. Activity outside them is unusual.',
  };
}

let memoryHandoffs: InMemoryHandoffStore | null = null;
export function handoffStore(): HandoffStore {
  if (dbConfigured()) return new SupabaseHandoffStore();
  return (memoryHandoffs ??= new InMemoryHandoffStore());
}
/** Built-in duties only when there is no database: nothing can be saved, so nothing is pretended. */
export function configStore(): DutyConfigStore | null { return dbConfigured() ? new SupabaseDutyConfigStore() : null; }

async function agentUnavailable(agent: AgentName, needs: { web?: boolean; db?: boolean } = {}): Promise<string | null> {
  const info = getAgentOperationalInfo(agent);
  if (!info.ready) return `${info.title} has no working model configured.`;
  const snapshot = await getOrganizationSnapshot();
  const role = snapshot.organization.roles.find((r) => r.id === roleIdFor(agent));
  if (!role) return `Role ${roleIdFor(agent)} does not exist in the organization.`;
  if (role.activation !== 'active') return `${role.title} is not active. Activate the role to start their work.`;
  if (needs.web && !process.env.TAMBALA_WEB_SEARCH_API_KEY) return 'Web research is not configured (TAMBALA_WEB_SEARCH_API_KEY).';
  if (needs.db && !dbConfigured()) return 'The database is not configured, so there is no real data to work from.';
  return null;
}

async function personFor(agent: AgentName): Promise<{ employeeNumber: string; title: string }> {
  const p = getEmployeeProfiles().find((x) => x.agent === agent)!;
  return { employeeNumber: p.employeeNumber, title: p.title };
}

const actionDeps = (): ActionExecDeps => ({
  outbox: productionOutboxDeps(), founderNumber,
  createDocument: (input, roleId) => createDocument(input, roleId),
  createInvoice: (input) => createClientInvoice(input),
});

async function runActions(ctx: { agent: AgentName; roleId: string; taskId: string | null }, actions: Action[], rejected: string[]): Promise<string> {
  if (!actions.length && !rejected.length) return '';
  const results = await executeActions(actionDeps(), ctx, actions);
  await runOutbox().catch(() => undefined); // messages to the Founder go out straight away
  return describeResults(results, rejected);
}

export function productionHandoffDeps(store: HandoffStore = handoffStore(), now: () => Date = () => new Date()): HandoffDeps {
  return {
    store, now,
    agentUnavailableReason: (agent) => agentUnavailable(agent),
    async senderLabel(roleId) { return roleId === 'founder' ? 'The Founder' : labelForRole(roleId); },
    async recipientLabel(agent) { const p = await personFor(agent); return `employee ${p.employeeNumber}, ${p.title} at Tambala Technologies`; },
    sign: (input) => signWork(input),
    actions: { run: runActions },
    async buildContext() {
      if (!dbConfigured()) return {};
      try { return { crm: await getBusinessSummary(), company: await getVerifiedCompanyContext(), catalog: await catalogContext() }; } catch { return {}; }
    },
    async askAgent(agent, prompt, context) {
      const info = getAgentOperationalInfo(agent);
      return askTambalaAI(agent, prompt, { communicationType: 'Handoff', sender: 'Colleague or Founder', recipient: info.title, ...context });
    },
    tasks: {
      begin: async (objective) => ({ taskId: (await beginTrackedTask(objective)).taskId }),
      advance: (taskId, transitions) => advanceTrackedTask(taskId, transitions),
      fail: (taskId, message) => failTrackedTask(taskId, message),
    },
  };
}

export function productionDeps(store: DutyStore = dutyStore(), now: () => Date = () => new Date()): DutyDeps {
  return {
    store, now,
    duties: () => loadDuties(configStore()),
    employee: (agent) => personFor(agent),
    sign: (input) => signWork(input),
    actions: { run: runActions },
    handoffs: {
      async queue(input) { await queueHandoff(handoffStore(), { ...input, sign: signWork }); },
    },
    unavailableReason: (duty: StandingDuty) => agentUnavailable(duty.agent, { web: duty.needsWeb, db: duty.contexts.some((c) => c !== 'briefing') }),
    async buildContext(kinds: ContextKind[], at: Date) {
      const out: Row = {};
      for (const kind of kinds) {
        if (kind === 'crm') out.crm = await getBusinessSummary();
        if (kind === 'company') out.company = await getVerifiedCompanyContext();
        if (kind === 'organization') out.organization = await organizationContext(store, at);
        if (kind === 'briefing') out.briefing = await briefingContext(store, at);
        if (kind === 'catalog') out.catalog = await catalogContext();
        if (kind === 'invoices') out.invoices = await invoicesContext(at);
      }
      return out;
    },
    async ask(duty, prompt, context) {
      const info = getAgentOperationalInfo(duty.agent);
      const ctx = { communicationType: 'Standing duty', sender: 'Organization calendar', recipient: info.title, duty: duty.id, ...context };
      if (duty.needsWeb) return (await askTambalaAIWithWebResearch(duty.agent, prompt, ctx, duty.researchQuery)).response;
      return askTambalaAI(duty.agent, prompt, ctx);
    },
    fallbackBody: (duty, context) => (duty.report ? deterministicBriefing(context) : null),
    tasks: {
      begin: (objective) => beginTrackedTask(objective),
      advance: (taskId, transitions) => advanceTrackedTask(taskId, transitions),
      fail: (taskId, message) => failTrackedTask(taskId, message),
    },
    approvals: { create: async (input) => { await createApprovalRequest(input); } },
    reports: {
      async save(input) {
        const created_at = new Date().toISOString();
        memoryBriefing = { period_key: input.periodKey, title: input.title, body: input.body, created_at };
        if (!dbConfigured()) return;
        await supabaseInsert('organization_reports', { kind: input.kind, period_key: input.periodKey, title: input.title, body: input.body, task_id: input.taskId });
      },
    },
  };
}

let running = false;
/** One duty cycle at a time per process; the database claim protects across processes. */
export async function runDutiesOnce(opts: { dutyId?: string; force?: boolean; handoffsOnly?: boolean } = {}): Promise<{ outcomes: DutyOutcome[]; handoffs: HandoffOutcome[]; messages: SendOutcome[] }> {
  if (running) throw new Error('A duty cycle is already running.');
  running = true;
  try {
    const outcomes = opts.handoffsOnly ? [] : await runDueDuties(productionDeps(), opts);
    const handoffs = await processHandoffs(productionHandoffDeps());
    const messages = await runOutbox().catch(() => [] as SendOutcome[]);
    return { outcomes, handoffs, messages };
  } finally { running = false; }
}

/** The Founder assigns work directly to an employee; it lands in their inbox. */
export async function clarifyTaskRoom(roomId: string, clarification: string): Promise<Handoff> {
  const store = handoffStore();
  const resumed = await resumeFounderTaskRoom(store, roomId, clarification);
  await processHandoffs(productionHandoffDeps(store));
  return (await store.get(resumed.id)) ?? resumed;
}
export async function assignWork(agent: AgentName, request: string): Promise<Handoff> {
  return queueHandoff(handoffStore(), { fromRoleId: 'founder', toAgent: agent, request, sign: signWork });
}

export async function saveDutyConfig(input: { dutyId?: string; override?: unknown; custom?: unknown; customId?: string }): Promise<void> {
  const store = requireConfigStore();
  if (input.custom !== undefined) { await saveCustomDuty(store, input.custom, input.customId); return; }
  if (input.dutyId) { await saveBuiltinOverride(store, input.dutyId, input.override); return; }
  throw new Error('Nothing to save.');
}

export async function deleteCustomDutyById(id: string): Promise<void> {
  const store = requireConfigStore();
  if (!(await store.customs()).some((c) => c.id === id)) throw new Error('Only custom duties can be deleted. Switch built-in duties off instead.');
  await store.deleteCustom(id);
}

export async function getLatestBriefing(): Promise<{ period_key: string; title: string; body: string; created_at: string } | null> {
  if (dbConfigured()) {
    const rows = await supabaseSelect<{ period_key: string; title: string; body: string; created_at: string }>('organization_reports', 'select=period_key,title,body,created_at&kind=eq.daily_briefing&order=created_at.desc&limit=1');
    return rows[0] ?? null;
  }
  return memoryBriefing;
}

const STATE_LABEL: Record<string, string> = { completed: 'done', awaiting_approval: 'awaiting_approval', running: 'running', skipped: 'skipped', failed: 'failed' };

export async function buildWorkforce(now: Date = new Date()) {
  const lt = localTime(now);
  const store = dutyStore();
  const week = new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString();
  const [runs, snapshot, duties, handoffRows] = await Promise.all([
    store.recent(week), getOrganizationSnapshot(),
    loadDuties(configStore()), handoffStore().recent(week).catch(() => [] as Handoff[]),
  ]);
  let tasks: Row[] = [];
  if (dbConfigured()) tasks = await recentRows('organization_tasks', `select=status,assigned_role_id&created_at=gte.${encodeURIComponent(week)}&limit=500`);
  const working = isWorkingHours(lt);
  const profiles = getEmployeeProfiles();
  const labelFor = (roleId: string) => roleId === 'founder' ? 'Founder' : (identityForRole(roleId)?.employeeNumber ?? roleId);
  const signing = signingAvailable();

  const employees = profiles.map((p) => {
    const role = snapshot.organization.roles.find((r) => r.id === p.roleId);
    const info = getAgentOperationalInfo(p.agent);
    const active = role?.activation === 'active';
    const status = !active ? 'inactive' : !info.ready ? 'unequipped' : working ? 'on_duty' : 'off_hours';
    const myDuties = duties.filter((d) => d.agent === p.agent).map((d) => {
      const base = periodKey(d.cadence, lt);
      const mine = runs.filter((r) => r.duty_id === d.id).sort((a, b) => b.started_at.localeCompare(a.started_at));
      const inPeriod = mine.find((r) => r.period_key === base || r.period_key.startsWith(`${base}#`));
      const state = d.enabled === false ? 'off' : !runsToday(d.cadence, lt) ? 'not_today' : inPeriod ? (STATE_LABEL[inPeriod.status] ?? inPeriod.status) : timeReached(d.time, lt) ? 'overdue' : 'scheduled';
      const last = mine[0];
      return {
        id: d.id, title: d.title, schedule: cadenceLabel(d.cadence, d.time), state, needsWeb: Boolean(d.needsWeb), approval: Boolean(d.approval),
        custom: Boolean(d.custom), enabled: d.enabled !== false, edited: Boolean(d.edited),
        edit: { time: d.time, job: d.job, deliverable: d.deliverable, cadence: d.cadence, contexts: d.contexts, requiresApproval: Boolean(d.approval) },
        lastRun: last ? { status: last.status, at: last.completed_at ?? last.started_at, summary: last.summary, error: last.error } : null,
      };
    });
    const mineRuns = runs.filter((r) => r.role_id === p.roleId);
    const inbox = handoffRows.filter((h) => h.to_role_id === p.roleId);
    return {
      ...p, status, activation: role?.activation ?? 'unknown', modelReady: info.ready, duties: myDuties,
      identity: identityMark(p.employeeNumber), signingReady: signing,
      inbox: { queued: inbox.filter((h) => h.status === 'queued' || h.status === 'running' || h.status === 'awaiting_founder').length, completed: inbox.filter((h) => h.status === 'completed').length },
      week: { completed: mineRuns.filter((r) => r.status === 'completed' || r.status === 'awaiting_approval').length, failed: mineRuns.filter((r) => r.status === 'failed').length, skipped: mineRuns.filter((r) => r.status === 'skipped').length, tasks: tasks.filter((t) => t.assigned_role_id === p.roleId).length },
    };
  });

  const all = employees.flatMap((e) => e.duties).filter((d) => d.state !== 'not_today' && d.state !== 'off');
  return {
    office: { time: `${lt.date} ${String(Math.floor(lt.minutes / 60)).padStart(2, '0')}:${String(lt.minutes % 60).padStart(2, '0')}`, workingHours: working },
    persistence: dbConfigured() ? 'database' : 'memory',
    canEdit: dbConfigured(),
    signing,
    today: { scheduled: all.length, done: all.filter((d) => d.state === 'done' || d.state === 'awaiting_approval').length, overdue: all.filter((d) => d.state === 'overdue').length, failed: all.filter((d) => d.state === 'failed').length, skipped: all.filter((d) => d.state === 'skipped').length },
    employees,
    handoffs: handoffRows.slice(0, 30).map((h) => ({ id: h.id, roomId: h.room_id, from: labelFor(h.from_role_id), to: labelFor(h.to_role_id), toAgent: h.to_agent, request: h.request, status: h.status, error: h.error, result: h.result, createdAt: h.created_at, completedAt: h.completed_at })),
    briefing: await getLatestBriefing().catch(() => null),
  };
}
