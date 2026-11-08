import { supabaseSelect } from '../lib/supabase.js';
import { isExcluded } from '../services/ai/context.js';
import { askTambalaAI, getAgentOperationalInfo, type AgentName } from '../services/ai.js';
import { getOrganizationSnapshot } from '../organization/service.js';
import { advanceTrackedTask, beginTrackedTask, failTrackedTask } from '../organization/task-tracking.js';
import { roleIdFor } from '../organization/workforce/profiles.js';
import { AGENT_DIRECTORY } from '../services/ai/models.js';
import type { FounderMessageEnvelope } from './inbound.js';

type Row = Record<string, unknown>;

const STATUS_WORKSTREAMS: {
  agent: AgentName;
  department: string;
  focus: string;
}[] = [
  {
    agent: 'outreach',
    department: 'Sales & Business Development',
    focus: 'Qualified prospect pipeline, prospect categories, outreach activity, meetings, proposals, follow-up dates, sales blockers and opportunities.',
  },
  {
    agent: 'operations',
    department: 'Operations & Administration',
    focus: 'Internal workflow efficiency, completed process changes, outstanding operational tasks, administrative controls and recorded operational risks.',
  },
  {
    agent: 'engineering',
    department: 'Technology & Engineering',
    focus: 'System and service health, deployments, completed technical changes, incidents, infrastructure capacity and recorded technology risks.',
  },
  {
    agent: 'finance',
    department: 'Finance & Accounting',
    focus: 'Recorded revenue and targets, expense categories and variances, cash position, upcoming obligations and accounting issues.',
  },
];

export const STATUS_REPORT_DEPARTMENTS = STATUS_WORKSTREAMS.map((item) => item.department);

/** Validate ownership and completeness, not the amount of data available to a department. */
export function isUsableDepartmentReport(department: string, value: string): boolean {
  const report = value.trim();
  if (report.length < 35) return false;
  if (/(?:report\s+truncated|further details not provided|\[truncated\]|context truncated|\.\.\.|…)/i.test(report)) return false;

  const normalized = report.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
  const departmentKey = department.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
  const shortKey = departmentKey.startsWith('sales ') ? 'sales'
    : departmentKey.startsWith('operations ') ? 'operations'
      : departmentKey.startsWith('technology ') ? 'technology'
        : departmentKey.startsWith('finance ') ? 'finance' : departmentKey;

  const opening = report.slice(0, 180).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ');
  if (!opening.includes(shortKey)) return false;
  if (!/[.!?]["')\]]?\s*$/.test(report)) return false;

  if (normalized.includes('no ' + departmentKey + ' report was supplied')
    || normalized.includes('no ' + departmentKey + ' report supplied')
    || normalized.includes('no ' + shortKey + ' report was supplied')
    || normalized.includes('no ' + shortKey + ' report supplied')) return false;

  // Catch wording variants that describe a missing submission rather than
  // a department reporting that its underlying records are empty.
  if (shortKey === 'operations'
    && /\bno operational report (?:was )?(?:supplied|provided|submitted)\b/.test(normalized)) return false;


  const otherDepartments = [
    'Sales & Business Development',
    'Operations & Administration',
    'Technology & Engineering',
    'Finance & Accounting',
  ].filter((name) => name !== department);
  const markdownHeadings = report.split(String.fromCharCode(10)).map((line) => line.trim().replace(/^#+\s*/, '').toLowerCase());
  for (const other of otherDepartments) {
    const shortOther = other.startsWith('Sales ') ? 'sales'
      : other.startsWith('Operations ') ? 'operations'
        : other.startsWith('Technology ') ? 'technology' : 'finance';
    if (markdownHeadings.some((heading) => heading === shortOther || heading.startsWith(shortOther + ' '))) return false;
  }
  return true;
}

/** Ensure the CEO's generated text actually contains every required section. */
export function hasCompleteConsolidatedReport(report: string): boolean {
  const headings = report.split(String.fromCharCode(10))
    .map((line) => line.trim().replace(/^#{1,6}\\s*/, '').replace(/\\*\\*/g, '').toLowerCase().replace(/&amp;/g, 'and').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim());
  const required = STATUS_REPORT_DEPARTMENTS.map((department) => department.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim());
  return !/(?:^|\\n)#{1,6}\\s*(?:\\n|$)/m.test(report)
    && required.every((department) => headings.some((heading) => heading === department || heading.startsWith(department + ' ')));
}

export function canFinalizeStatusReport(completedDepartments: string[], outstandingDepartments: string[]): boolean {
  return outstandingDepartments.length === 0
    && STATUS_REPORT_DEPARTMENTS.every((department) => completedDepartments.includes(department));
}

export function isCompanyStatusRequest(value: string): boolean {
  const text = value.toLowerCase();
  // Include adjective forms such as "organizational status report" and
  // "organisational status update"; these must never fall through to the
  // generic single-specialist CEO workflow.
  return /\b(organizational|organisational)\s+(status|overview|report|update)\b/.test(text)
    || /\b(status report|current status|company status|business status|operational status|overall status)\b/.test(text)
    || (/\b(report|overview|update)\b/.test(text)
      && /\b(company|business|organisation|organization|tambala technologies)\b/.test(text));
}

function compactRows(rows: Row[], fields: string[], limit: number): Row[] {
  return rows.filter((row) => !isExcluded(row)).slice(0, limit).map((row) => {
    const compact: Row = {};
    for (const field of fields) {
      const value = row[field];
      if (value !== undefined && value !== null && value !== '') compact[field] = value;
    }
    return compact;
  });
}

function countByStatus(rows: Row[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const status = String(row.status ?? 'unspecified');
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

async function loadStatusData(): Promise<{ context: Record<string, unknown>; sales: Record<string, unknown>; customers: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];
  const context: Record<string, unknown> = { generated_at: new Date().toISOString() };
  const sales: Record<string, unknown> = {};
  const customers: Record<string, unknown> = {};
  try {
    const [leads, clients, projects, tasks] = await Promise.all([
      supabaseSelect<Row>('leads', 'select=id,name,business_name,status,next_follow_up_at,created_at&order=created_at.desc&limit=100'),
      supabaseSelect<Row>('clients', 'select=id,name,business_name,status,created_at&order=created_at.desc&limit=100'),
      supabaseSelect<Row>('projects', 'select=id,name,status,client_id,due_date,created_at&order=created_at.desc&limit=100'),
      supabaseSelect<Row>('tasks', 'select=id,title,status,due_at,client_id,project_id,created_at&order=created_at.desc&limit=150'),
    ]);
    const validLeads = leads.filter((row) => !isExcluded(row));
    const validClients = clients.filter((row) => !isExcluded(row));
    const validProjects = projects.filter((row) => !isExcluded(row));
    const validTasks = tasks.filter((row) => !isExcluded(row));
    context.record_counts = {
      leads: validLeads.length, leads_by_status: countByStatus(validLeads),
      clients: validClients.length, clients_by_status: countByStatus(validClients),
      projects: validProjects.length, projects_by_status: countByStatus(validProjects),
      tasks: validTasks.length, tasks_by_status: countByStatus(validTasks),
    };
    sales.leads = compactRows(validLeads, ['id', 'name', 'business_name', 'status', 'next_follow_up_at', 'created_at'], 20);
    sales.total_leads = validLeads.length;
    sales.leads_by_status = countByStatus(validLeads);
    const latestLeadRecordCreatedAt = validLeads
      .map((row) => typeof row.created_at === 'string' ? row.created_at : '')
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    sales.data_freshness = {
      latest_lead_record_created_at: latestLeadRecordCreatedAt,
      report_generated_at: context.generated_at,
      timestamp_note: 'created_at is when a lead record was created; it is not evidence of the latest outreach action or status update.',
    };
    customers.clients = compactRows(validClients, ['id', 'name', 'business_name', 'status', 'created_at'], 15);
    customers.projects = compactRows(validProjects, ['id', 'name', 'status', 'client_id', 'due_date', 'created_at'], 15);
    customers.tasks = compactRows(validTasks, ['id', 'title', 'status', 'due_at', 'client_id', 'project_id', 'created_at'], 20);
    customers.totals = { clients: validClients.length, projects: validProjects.length, tasks: validTasks.length };
    customers.statuses = { clients: countByStatus(validClients), projects: countByStatus(validProjects), tasks: countByStatus(validTasks) };
  } catch (error) {
    warnings.push(`Live CRM records could not be fully loaded: ${error instanceof Error ? error.message : 'database unavailable'}`);
    context.data_availability = 'Live CRM data unavailable. Do not infer counts or pipeline values.';
  }
  try {
    const snapshot = await getOrganizationSnapshot();
    context.organization = {
      source: snapshot.source,
      units: snapshot.organization.units.map((unit) => ({ name: unit.name, kind: unit.kind, status: unit.status })),
      roles: snapshot.organization.roles.map((role) => ({ title: role.title, activation: role.activation })),
    };
  } catch (error) {
    warnings.push(`Organization chart could not be loaded: ${error instanceof Error ? error.message : 'unavailable'}`);
  }
  return { context, sales, customers, warnings };
}

export async function runCompanyStatusReport(envelope: FounderMessageEnvelope): Promise<string> {
  const objective = envelope.content.text.trim();
  const parent = await beginTrackedTask(objective);
  await advanceTrackedTask(parent.taskId, [{
    status: 'ceo_analyzing',
    stage: 'ceo',
    eventType: 'ceo_status_report_analysis_started',
    roleId: 'ceo',
  }]);

  const { context, sales, customers } = await loadStatusData();
  const snapshot = await getOrganizationSnapshot().catch(() => null);
  const assignments = STATUS_WORKSTREAMS.map((workstream) => {
    const roleId = roleIdFor(workstream.agent);
    const role = snapshot?.organization.roles.find((candidate) => candidate.id === roleId);
    const runtime = getAgentOperationalInfo(workstream.agent);
    let blocker: string | null = null;
    if (!role) blocker = `The mapped organizational role (${roleId}) is missing.`;
    else if (role.activation !== 'active') blocker = `${role.title} is not active.`;
    else if (!runtime.ready) blocker = `${runtime.title} runtime is not configured.`;
    return { ...workstream, roleId, roleTitle: role?.title ?? workstream.department, blocker };
  });

  const ready = assignments.filter((item) => !item.blocker);
  const blocked = assignments.filter((item) => item.blocker);
  if (ready.length) {
    await advanceTrackedTask(parent.taskId, [
      { status: 'delegated', stage: 'ceo', eventType: 'ceo_status_report_departments_assigned', roleId: 'ceo', payload: { departments: ready.map((item) => item.department) } },
      { status: 'executing', stage: 'department', eventType: 'department_status_report_execution_started', roleId: 'ceo' },
    ]);
  }

  const results: { department: string; agent: AgentName; taskId: string; result: string }[] = [];
  for (const item of ready) {
    const child = await beginTrackedTask(`CEO status-report assignment — ${item.department}: ${item.focus}`);
    try {
      await advanceTrackedTask(child.taskId, [
        { status: 'ceo_analyzing', stage: 'ceo', eventType: 'ceo_department_assignment_created', roleId: 'ceo' },
        { status: 'delegated', stage: 'ceo', eventType: 'department_assignment_issued', departmentId: AGENT_DIRECTORY[item.agent].unitId, roleId: item.roleId, payload: { parentTaskId: parent.taskId, department: item.department } },
        { status: 'executing', stage: 'department', eventType: 'department_report_work_started', departmentId: AGENT_DIRECTORY[item.agent].unitId, roleId: item.roleId },
      ]);
      const result = await askTambalaAI(
        item.agent,
        [
          `You are the department head for ${item.department}, reporting to the CEO of Tambala Technologies.`,
          `STRICT OWNERSHIP: Produce ONLY the ${item.department} section. Do not write, summarize, estimate, or make claims about Sales, Operations, Technology, Finance, or any other department outside your own assigned scope.`,
          `Your exclusive scope: ${item.focus}`,
          'Begin with the exact department name as your heading. Use only the supplied records for your department. Do not report for other departments. Do not invent names, counts, revenue, outcomes, dates, incidents, or activity. Separate verified facts from gaps. ZERO DATA IS A VALID, COMPLETE DEPARTMENT REPORT: if no records exist, explicitly say that no records are currently available and identify which measures cannot be verified; do not imply that no activity occurred. Acknowledge partial data honestly. Do not use web research to fill gaps in internal company records. End with a complete sentence. Return only your own department section, at most 150 words.',
          'Sales data freshness: when source records include data_freshness, state the latest_lead_record_created_at date as the latest available lead-record date and distinguish it from the report generation date. Do not describe that date as the latest outreach activity or status update, and do not present an older CRM snapshot as current without flagging its age.',
          'Finance reporting: when accounting records are unavailable, clearly state that the Finance & Accounting report is complete based on the records supplied, but financial performance cannot be assessed. Do not call the section or report incomplete, and do not say the report is pending documents; describe unavailable documents as a data limitation, not an unfinished submission.',
          `Parent Founder objective (context only; not an expansion of your authority): ${objective}`,
          `Department source records (source of truth): ${JSON.stringify(item.agent === 'outreach' ? sales : item.agent === 'operations' ? { organization: context.organization ?? null, record_counts: context.record_counts ?? null, projects: customers.projects, tasks: customers.tasks, totals: customers.totals, source_availability: 'CRM project and task records are available; no formal process-change log or risk register was supplied.' } : item.agent === 'engineering' ? { organization: context.organization ?? null, source_availability: 'No deployment inventory, monitoring feed, incident log, or infrastructure report was supplied.' } : { source_availability: 'No accounting ledger, revenue report, expense report, budget target, or cash-position statement was supplied.' })}`,
        ].join('\n\n'),
        { communicationType: 'CEO department assignment', sender: 'Chief Executive Officer', recipient: item.roleTitle, parentTaskId: parent.taskId, department: item.department },
      );
      if (!isUsableDepartmentReport(item.department, result)) {
        throw new Error(`The ${item.department} agent returned an empty, placeholder, or truncated report. Its assignment remains outstanding.`);
      }
      await advanceTrackedTask(child.taskId, [
        { status: 'department_review', stage: 'review', eventType: 'department_report_returned_for_review', departmentId: AGENT_DIRECTORY[item.agent].unitId, roleId: item.roleId, result: { parentTaskId: parent.taskId, response: result.slice(0, 1800) } },
        { status: 'returned_to_ceo', stage: 'review', eventType: 'department_report_accepted_by_ceo', departmentId: AGENT_DIRECTORY[item.agent].unitId, roleId: item.roleId },
        { status: 'completed', stage: 'complete', eventType: 'department_report_assignment_completed', departmentId: AGENT_DIRECTORY[item.agent].unitId, roleId: item.roleId, completedAt: new Date().toISOString() },
      ]);
      results.push({ department: item.department, agent: item.agent, taskId: child.taskId, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Department assignment failed.';
      await failTrackedTask(child.taskId, message);
      blocked.push({ ...item, blocker: message });
    }
  }

  // The CEO may synthesize only after every required department has returned
  // and its child task has been marked complete. Partial results are not a final report.
  const allDepartmentsCompleted = canFinalizeStatusReport(results.map((item) => item.department), blocked.map((item) => item.department));
  if (!allDepartmentsCompleted) {
    if (ready.length) {
      await advanceTrackedTask(parent.taskId, [
        { status: 'department_review', stage: 'review', eventType: 'ceo_partial_department_reports_reviewed', roleId: 'ceo', result: { departmentsCompleted: results.map((item) => item.department), departmentsOutstanding: blocked.map((item) => item.department) } },
        { status: 'needs_more_work', stage: 'ceo', eventType: 'founder_status_report_waiting_for_departments', roleId: 'ceo', result: { departmentsCompleted: results.map((item) => item.department), departmentsOutstanding: blocked.map((item) => item.department) } },
      ]);
    } else {
      await advanceTrackedTask(parent.taskId, [{
        status: 'needs_more_work',
        stage: 'ceo',
        eventType: 'founder_status_report_waiting_for_departments',
        roleId: 'ceo',
        result: { departmentsCompleted: results.map((item) => item.department), departmentsOutstanding: blocked.map((item) => item.department) },
      }]);
    }

    const completedSections = results.map((item) => `## ${item.department} — completed\n${item.result}`).join('\n\n');
    const pendingSections = blocked.map((item) => `- ${item.department}: ${item.blocker}`).join('\n');
    const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Africa/Blantyre' }).format(new Date());
    return [
      `**Organizational status report — ${date}**`,
      'The CEO has not issued a final consolidated report because not all required department reports have completed.',
      completedSections,
      pendingSections ? `**Departments still outstanding**\n${pendingSections}` : '',
      'The report will be consolidated only after all four department heads return their own completed sections.',
      parent.tracking === 'recorded' ? `Parent task: ${parent.taskId} (waiting for department work).` : 'Task tracking is unavailable; this progress update has no durable task record.',
    ].filter(Boolean).join('\n\n');
  }

  let report: string;
  try {
    report = await askTambalaAI(
    'orchestrator',
    [
      'You are the CEO of Tambala Technologies. All four required department heads have returned completed reports. Synthesize those four reports now.',
      'Use exactly the four department sections supplied. Do not create additional departmental findings or fill evidence gaps.',
      `Founder objective: ${objective}`,
      `Verified organization snapshot: ${JSON.stringify(context)}`,
      `Department findings: ${JSON.stringify(results.map(({ department, result }) => ({ department, result: result.slice(0, 1200) }))) }`,
      'Write a concise executive report (maximum 350 words) with a short executive summary followed by Sales, Operations, Technology and Finance. Preserve each department head’s evidence limits. Mark missing metrics unavailable, never zero. Do not claim work was done unless a department report confirms it. Do not include a date; the server will add the authoritative date.',
    ].join('\n\n'),
    { communicationType: 'CEO consolidated status report', sender: 'CEO workflow', recipient: 'Founder / Bless', messageId: envelope.message_id, parentTaskId: parent.taskId },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CEO report synthesis failed.';
    await failTrackedTask(parent.taskId, message);
    throw error;
  }
  // Never mark a consolidated report complete if the synthesis model omitted a department.
  // Preserve the four accepted source reports verbatim in a deterministic fallback.
  if (!hasCompleteConsolidatedReport(report)) {
    const sections = results.map(({ department, result }) => {
      const body = result.trim().replace(/^#{1,6}\\s*[^\\n]+\\n?/, '').trim();
      return `### ${department}\\n${body}`;
    });
    report = [
      '**Executive Summary**',
      'All four department heads submitted reports. The sections below preserve their verified findings and stated data limitations.',
      ...sections,
    ].join('\\n\\n');
  }

  const reportDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Africa/Blantyre' }).format(new Date());
  report = `**Prepared for Founder / Bless — ${reportDate}**\n\n${report}`;

  await advanceTrackedTask(parent.taskId, [
    { status: 'department_review', stage: 'review', eventType: 'ceo_department_reports_reviewed', roleId: 'ceo', result: { departmentsCompleted: results.map((item) => item.department) } },
    { status: 'returned_to_ceo', stage: 'review', eventType: 'ceo_report_consolidation_completed', roleId: 'ceo' },
    { status: 'completed', stage: 'complete', eventType: 'founder_status_report_completed', roleId: 'ceo', result: { report: report.slice(0, 10000), departmentsCompleted: results.map((item) => item.department) }, completedAt: new Date().toISOString() },
  ]);

  const assignmentSummary = [
    `Department reports completed: ${results.map((item) => item.department).join(', ')}.`,
    parent.tracking === 'recorded' ? `Parent task recorded: ${parent.taskId}.` : 'Task tracking is unavailable; report was generated without a durable task record.',
  ].filter(Boolean).join('\n');
  return `${report}\n\n---\n${assignmentSummary}`;
}
