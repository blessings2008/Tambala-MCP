import { supabaseSelect } from '../lib/supabase.js';
import { getOrganizationSnapshot } from '../organization/service.js';
import { enforcementEnabled } from '../organization/write-guard.js';
import { AGENT_DIRECTORY } from '../services/ai/models.js';
import { channelStatus } from '../channels/service.js';
import { messageStore } from '../channels/message-store.js';
import { documentStore } from '../documents/store.js';
import { invoiceStore } from '../payments/invoices.js';
import { payHealthCached } from '../payments/tambala-pay.js';
import { evolutionConfigured } from '../channels/evolution.js';
import { signatureStore } from '../organization/workforce/sign-work.js';
import { signingAvailable } from '../organization/workforce/signing.js';
import { buildWorkforce } from '../organization/workforce/duty-service.js';
import { getAgentOperationalInfo, type AgentName } from '../services/ai.js';
import { getDutyHeartbeat } from '../organization/workforce/heartbeat.js';
import { getRuntimeControl } from '../organization/runtime-control.js';
import { getDailyAIUsage } from '../services/ai/spend.js';
import { getEmployeeTrust } from '../organization/workforce/trust-ledger.js';

export type Section<T> = { ok: true; data: T } | { ok: false; error: string };
type Row = Record<string, unknown>;

/** One failing source must not blank the whole dashboard: each section reports its own state. */
export async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : 'Unavailable.' };
  }
}

const OPEN_STATUSES = new Set(['created', 'ceo_analyzing', 'delegated', 'executing', 'waiting_for_tool', 'department_review', 'returned_to_ceo', 'needs_more_work']);

/** Merge task-stage events with actual duty-run records for the dashboard activity feed. */
export function mergeRecentActivity(taskEvents: Row[], dutyRuns: Row[]): Row[] {
  const duties = dutyRuns.map((run) => ({
    event_type: `duty_${String(run.status ?? 'unknown')}`,
    stage: 'duty',
    department_id: null,
    created_at: run.completed_at ?? run.started_at,
    summary: run.summary ?? null,
    error: run.error ?? null,
    role_id: run.role_id ?? null,
    duty_id: run.duty_id ?? null,
    attempts: run.attempts ?? null,
    source: 'duty_run',
  }));
  return [...taskEvents, ...duties]
    .sort((a, b) => Date.parse(String(b.created_at ?? '')) - Date.parse(String(a.created_at ?? '')))
    .slice(0, 40);
}

export function summarizeTasks(tasks: Row[]) {
  const byStatus: Record<string, number> = {};
  const byDepartment: Record<string, number> = {};
  const durations: number[] = [];
  let open = 0;
  for (const task of tasks) {
    const status = String(task.status ?? 'unknown');
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (OPEN_STATUSES.has(status)) open += 1;
    const dept = task.assigned_department_id ? String(task.assigned_department_id) : 'unassigned';
    byDepartment[dept] = (byDepartment[dept] ?? 0) + 1;
    if (status === 'completed' && task.completed_at && task.created_at) {
      const ms = Date.parse(String(task.completed_at)) - Date.parse(String(task.created_at));
      if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
    }
  }
  const completed = byStatus.completed ?? 0;
  const failed = byStatus.failed ?? 0;
  const finished = completed + failed;
  return {
    total: tasks.length,
    open,
    completed,
    failed,
    byStatus,
    byDepartment,
    successRate: finished ? Math.round((completed / finished) * 100) : null,
    avgCompletionMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 600) / 100 : null,
  };
}

function host(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

const flag = (name: string) => Boolean(process.env[name]);

export async function buildDashboard() {
  const dbConfigured = flag('SUPABASE_SERVICE_ROLE_KEY');
  const db = async <T>(path: string, query: string) => {
    if (!dbConfigured) throw new Error('Database not configured (SUPABASE_SERVICE_ROLE_KEY).');
    return supabaseSelect<T>(path, query);
  };

  const [organization, tasks, events, approvals, decisions, audit, bindings, runs, actions, workforce, signatures, channel, messages, documents, prices, invoices, payments, rooms, roomEvents, goals, trust, aiSpend, runtime] = await Promise.all([
    section(async () => {
      const snap = await getOrganizationSnapshot();
      return {
        source: snap.source,
        valid: snap.validation.valid,
        errors: snap.validation.errors,
        units: snap.organization.units.map((u) => ({ id: u.id, name: u.name, kind: u.kind, parentId: u.parentId, status: u.status, purpose: u.purpose })),
        roles: snap.organization.roles.map((r) => ({ id: r.id, title: r.title, kind: r.kind, unitId: r.unitId, reportsToRoleId: r.reportsToRoleId, activation: r.activation })),
      };
    }),
    section(() => db<Row>('organization_tasks', 'select=id,objective,status,current_stage,assigned_department_id,assigned_role_id,error_message,created_at,updated_at,completed_at&order=created_at.desc&limit=100')),
    section(async () => { const [taskEvents, dutyRuns] = await Promise.all([db<Row>('organization_task_events', 'select=id,task_id,event_type,stage,actor_role_id,department_id,created_at&order=created_at.desc&limit=40'), db<Row>('organization_duty_runs', 'select=id,duty_id,role_id,status,attempts,summary,error,started_at,completed_at&order=started_at.desc&limit=40')]); return mergeRecentActivity(taskEvents, dutyRuns); }),
    section(() => db<Row>('organization_approval_requests', 'select=id,action_type,summary,requested_by_role_id,required_authority,status,risk_level,task_id,content,created_at&status=eq.pending&order=created_at.asc&limit=50')),
    section(() => db<Row>('organization_decisions', 'select=id,title,status,required_authority,proposed_by_role_id,created_at,decided_at&order=created_at.desc&limit=15')),
    section(() => db<Row>('organization_audit_events', 'select=id,actor_role_id,action,target_type,target_id,outcome,reason,created_at&order=created_at.desc&limit=40')),
    section(async () => (await db<Row>('organization_actor_bindings', 'select=principal_id,role_id,active,note,created_at&active=eq.true&order=created_at.desc&limit=50'))
      .map((b) => ({ ...b, principal_id: `${String(b.principal_id).slice(0, 8)}…` }))),
    section(() => db<Row>('automation_runs', 'select=id,run_key,mode,status,started_at,completed_at,followups_prepared,reports_sent,tasks_flagged,warnings,error&order=started_at.desc&limit=10')),
    section(() => db<Row>('automation_actions', 'select=id,action_type,status,created_at&status=in.(prepared,approved)&order=created_at.desc&limit=50')),
    section(() => buildWorkforce()),
    section(() => signatureStore().recent(60)),
    section(() => channelStatus()),
    section(async () => (await messageStore().recent(60)).map((m) => ({ ...m, text: m.text.slice(0, 600) }))),
    section(() => documentStore().list(40)),
    section(() => documentStore().prices()),
    section(() => invoiceStore().recent(30)),
    section(() => payHealthCached()),
    section(() => db<Row>('organization_task_rooms', 'select=id,handoff_id,parent_task_id,owner_role_id,owner_agent,opened_by_role_id,objective,status,deliverable,blocker,opened_at,updated_at,closed_at&order=updated_at.desc&limit=100')),
    section(() => db<Row>('organization_task_room_events', 'select=id,room_id,event_type,actor_role_id,payload,created_at&order=created_at.desc&limit=100')),
    section(async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [prospects, quotes, invoicesRows, messagesRows] = await Promise.all([
        db<Row>('lead_discovery_queue', 'select=id,processing_status,created_at&order=created_at.desc&limit=5000'),
        db<Row>('organization_documents', `select=id,status,total_minor,currency,created_by_role_id,created_at&kind=eq.quotation&created_at=gte.${encodeURIComponent(since)}&limit=2000`),
        db<Row>('organization_invoices', `select=id,status,amount_minor,currency,created_by_role_id,created_at&created_at=gte.${encodeURIComponent(since)}&limit=2000`),
        db<Row>('organization_messages', `select=id,direction,status,audience,from_role_id,number,created_at,sent_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=3000`),
      ]);
      const statusCount = (rows: Row[], field: string) => rows.reduce<Record<string, number>>((out, row) => {
        const key = String(row[field] ?? 'unknown'); out[key] = (out[key] ?? 0) + 1; return out;
      }, {});
      const paidInvoices = invoicesRows.filter((row) => String(row.status).toLowerCase() === 'paid');
      const revenueMinor = paidInvoices.reduce((sum, row) => sum + Number(row.amount_minor ?? 0), 0);
      const byEmployee: Record<string, { quotations: number; invoices: number; paidInvoices: number; revenueMinor: number; customerMessagesSent: number }> = {};
      const employee = (role: unknown) => String(role ?? 'unattributed');
      const bucket = (role: unknown) => byEmployee[employee(role)] ??= { quotations: 0, invoices: 0, paidInvoices: 0, revenueMinor: 0, customerMessagesSent: 0 };
      for (const row of quotes) bucket(row.created_by_role_id).quotations++;
      for (const row of invoicesRows) {
        const item = bucket(row.created_by_role_id); item.invoices++;
        if (String(row.status).toLowerCase() === 'paid') { item.paidInvoices++; item.revenueMinor += Number(row.amount_minor ?? 0); }
      }
      for (const row of messagesRows.filter((item) => item.direction === 'out' && item.audience === 'client' && item.status === 'sent')) bucket(row.from_role_id).customerMessagesSent++;
      const inboundReplies = messagesRows.filter((row) => row.direction === 'in' && row.audience === 'client').length;
      const quotesSent = quotes.filter((row) => row.status === 'sent').length;
      return {
        windowDays: 30,
        prospects: { total: prospects.length, byStatus: statusCount(prospects, 'processing_status') },
        quotations: { created: quotes.length, sent: quotesSent, accepted: null, acceptanceRate: null, acceptanceNote: 'Quotation acceptance is not currently captured as a structured event; this metric is unavailable, not zero.' },
        invoices: { created: invoicesRows.length, paid: paidInvoices.length, unpaid: invoicesRows.length - paidInvoices.length, paidRevenueMinor: revenueMinor, currency: 'MWK' },
        customerCommunication: { sent: messagesRows.filter((row) => row.direction === 'out' && row.audience === 'client' && row.status === 'sent').length, replies: inboundReplies, replyRate: null, replyRateNote: 'Replies are counted from inbound client messages; reliable message-to-message attribution is not yet stored, so a reply rate is unavailable.' },
        byEmployee,
        source: 'Supabase CRM discovery queue, quotation documents, invoice ledger and WhatsApp message ledger; rolling 30-day window.',
      };
    }),
    section(async () => ({
      threshold: 20,
      eligibleActionTypes: ['prepared_followups', 'prepared_work', 'prepared_content', 'prepared_internal_task'],
      employees: await getEmployeeTrust(),
      note: 'Standing approval status is a trust signal only. It does not alter roles or grant permissions. Rejections, edited approvals, customer complaints and STOP requests demote trust.',
    })),
    section(async () => {
      const rows = await getDailyAIUsage();
      const byEmployee: Record<string, { requests: number; promptTokens: number; completionTokens: number; pricedCostUsd: number; unpricedRequests: number }> = {};
      for (const row of rows) {
        const item = byEmployee[row.employee_number] ??= { requests: 0, promptTokens: 0, completionTokens: 0, pricedCostUsd: 0, unpricedRequests: 0 };
        item.requests++;
        item.promptTokens += Number(row.prompt_tokens ?? 0);
        item.completionTokens += Number(row.completion_tokens ?? 0);
        if (row.cost_usd === null || row.cost_status !== 'priced') item.unpricedRequests++;
        else item.pricedCostUsd += Number(row.cost_usd);
      }
      const pricedCostUsd = rows.reduce((sum, row) => sum + (row.cost_status === 'priced' && row.cost_usd !== null ? Number(row.cost_usd) : 0), 0);
      return {
        window: 'UTC calendar day',
        requests: rows.length,
        promptTokens: rows.reduce((sum, row) => sum + Number(row.prompt_tokens ?? 0), 0),
        completionTokens: rows.reduce((sum, row) => sum + Number(row.completion_tokens ?? 0), 0),
        pricedCostUsd: Number(pricedCostUsd.toFixed(8)),
        unpricedRequests: rows.filter((row) => row.cost_status !== 'priced' || row.cost_usd === null).length,
        byEmployee,
        caps: { enforcement: 'not_enabled', note: 'Founder-approved per-employee and organization-wide USD caps and authoritative model pricing are still required before enforcement.' },
      };
    }),
    section(async () => {
      const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const [control, heartbeat, dutyRuns] = await Promise.all([
        getRuntimeControl(), getDutyHeartbeat(), db<Row>('organization_duty_runs', `select=id,status,started_at,completed_at&started_at=gte.${encodeURIComponent(since)}&order=started_at.desc&limit=500`),
      ]);
      const completed = dutyRuns.filter((run) => run.status === 'completed' || run.status === 'awaiting_approval').length;
      const failed = dutyRuns.filter((run) => run.status === 'failed').length;
      const observed = completed + failed;
      const failureRatePercent = observed ? Math.round((failed / observed) * 10000) / 100 : null;
      const target = Math.min(99.9, Math.max(50, Number(process.env.TAMBALA_DUTY_SUCCESS_TARGET_PERCENT) || 95));
      const allowedFailureRate = 100 - target;
      return {
        control,
        heartbeat,
        errorBudget: {
          windowHours: 24, targetSuccessPercent: target, completed, failed, observed,
          failureRatePercent,
          remainingPercent: failureRatePercent === null ? null : Math.max(0, Math.round(((allowedFailureRate - failureRatePercent) / allowedFailureRate) * 10000) / 100),
          note: 'Based only on recorded duty runs in the last 24 hours. It is unavailable when no completed or failed duty runs are recorded.',
        },
      };
    }),
  ]);

  const agents = (Object.keys(AGENT_DIRECTORY) as AgentName[]).map((name) => {
    const info = getAgentOperationalInfo(name);
    return {
      agent: name, title: info.title, unitId: info.unitId, unitName: info.unitName, reportsTo: info.reportsTo,
      ready: info.ready, apiKeyConfigured: info.apiKeyConfigured, model: info.model, providerHost: host(info.baseURL),
      requestsPerMinute: info.limits.requestsPerMinute, concurrency: info.limits.concurrency,
    };
  });

  const taskSummary = tasks.ok ? summarizeTasks(tasks.data) : null;
  const deniedRecent = audit.ok ? audit.data.filter((e) => e.outcome === 'denied').length : null;

  return {
    generatedAt: new Date().toISOString(),
    headline: {
      units: organization.ok ? organization.data.units.length : null,
      activeRoles: organization.ok ? organization.data.roles.filter((r) => r.activation === 'active').length : null,
      totalRoles: organization.ok ? organization.data.roles.length : null,
      readyAgents: agents.filter((a) => a.ready).length,
      totalAgents: agents.length,
      openTasks: taskSummary?.open ?? null,
      pendingApprovals: approvals.ok ? approvals.data.length : null,
      deniedRecent,
    },
    organization, tasks, taskSummary: taskSummary ? { ok: true as const, data: taskSummary } : { ok: false as const, error: tasks.ok ? '' : tasks.error },
    events, approvals, decisions, audit, bindings, workforce, signatures, channel, messages, documents, prices, invoices, payments, rooms, roomEvents, goals, trust, aiSpend, runtime, automation: { runs, pendingActions: actions }, agents,
    config: {
      database: dbConfigured,
      oauth: flag('TAMBALA_OAUTH_SECRET') && flag('TAMBALA_OAUTH_APPROVAL_CODE'),
      legacyToken: flag('TAMBALA_MCP_TOKEN'),
      webResearch: flag('TAMBALA_WEB_SEARCH_API_KEY'),
      tambalaPay: Boolean(process.env.TAMBALA_PAY_API_TOKEN && process.env.TAMBALA_PAY_API_TOKEN.length >= 32),
      signing: signingAvailable(),
      whatsapp: evolutionConfigured(),
      dutyScheduler: process.env.TAMBALA_DUTY_SCHEDULER === 'true',
      email: flag('RESEND_API_KEY') && flag('TAMBALA_REPORT_TO') && flag('TAMBALA_REPORT_FROM'),
      founderWhatsapp: Boolean(process.env.TAMBALA_FOUNDER_WHATSAPP),
      roleEnforcement: enforcementEnabled(),
      devActiveRoles: process.env.TAMBALA_DEV_ACTIVE_ROLES === 'true',
      orgSource: organization.ok ? organization.data.source : null,
    },
  };
}
