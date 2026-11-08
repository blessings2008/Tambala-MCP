import { supabaseSelect } from '../lib/supabase.js';
import { getBusinessSummary, getVerifiedCompanyContext, isExcluded } from '../services/ai/context.js';
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
    focus: 'Lead and prospect pipeline, outreach activity, recent wins/losses only where recorded, follow-up dates, and blockers.',
  },
  {
    agent: 'followup',
    department: 'Customer Relations & Support',
    focus: 'Active client records, client projects, outstanding tasks, due dates, relationship follow-ups, and support blockers.',
  },
];

export function isCompanyStatusRequest(value: string): boolean {
  const text = value.toLowerCase();
  return /\b(status report|current status|company status|business status|operational status|overall status)\b/.test(text)
    || (/\b(report|overview|update)\b/.test(text)
      && /\b(company|business|organisation|organization|tambala technologies)\b/.test(text));
}

async function loadStatusData(): Promise<{ context: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];
  const context: Record<string, unknown> = { generated_at: new Date().toISOString() };
  try {
    const [summary, company] = await Promise.all([getBusinessSummary(), getVerifiedCompanyContext()]);
    context.crm_summary = summary;
    context.company = company;
    const [leads, clients, projects, tasks] = await Promise.all([
      supabaseSelect<Row>('leads', 'select=id,name,business_name,status,next_follow_up_at,created_at&order=created_at.desc&limit=100'),
      supabaseSelect<Row>('clients', 'select=id,name,business_name,status,created_at&order=created_at.desc&limit=100'),
      supabaseSelect<Row>('projects', 'select=id,name,status,client_id,due_date,created_at&order=created_at.desc&limit=100'),
      supabaseSelect<Row>('tasks', 'select=id,title,status,due_at,client_id,project_id,created_at&order=created_at.desc&limit=150'),
    ]);
    context.records = {
      leads: leads.filter((row) => !isExcluded(row)),
      clients: clients.filter((row) => !isExcluded(row)),
      projects,
      tasks,
    };
  } catch (error) {
    warnings.push(`Live CRM/company data could not be fully loaded: ${error instanceof Error ? error.message : 'database unavailable'}`);
    context.data_availability = 'Live company and CRM data is unavailable for this run. Do not infer counts or pipeline values.';
  }
  try {
    const snapshot = await getOrganizationSnapshot();
    context.organization = {
      source: snapshot.source,
      units: snapshot.organization.units.map((unit) => ({ name: unit.name, kind: unit.kind, status: unit.status })),
      roles: snapshot.organization.roles.map((role) => ({ title: role.title, activation: role.activation })),
      validation: snapshot.validation,
    };
  } catch (error) {
    warnings.push(`Organization chart could not be loaded: ${error instanceof Error ? error.message : 'unavailable'}`);
  }
  return { context, warnings };
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

  const { context, warnings } = await loadStatusData();
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
        { status: 'executing', stage: 'department', eventType: 'department_report_work_started', departmentId: item.agent, roleId: item.roleId },
      ]);
      const result = await askTambalaAI(
        item.agent,
        [
          `You are reporting to the CEO of Tambala Technologies. This is a real internal department assignment for a Founder-requested company status report.`,
          `Department: ${item.department}`,
          `Your scope: ${item.focus}`,
          'Prepare your section now from the supplied company records. Do not ask the Founder to approve the report or propose future hand-offs. Do not invent names, counts, revenue, outcomes, dates, support tickets, or activity. Separate verified facts from gaps. If the records do not contain a metric, state that it is not recorded or unavailable. Keep the response concise but substantive.',
          `Original Founder objective: ${objective}`,
          `Company records (source of truth): ${JSON.stringify(context)}`,
        ].join('\n\n'),
        { communicationType: 'CEO department assignment', sender: 'Chief Executive Officer', recipient: item.roleTitle, parentTaskId: parent.taskId, department: item.department },
      );
      await advanceTrackedTask(child.taskId, [
        { status: 'department_review', stage: 'review', eventType: 'department_report_returned_for_review', departmentId: item.agent, roleId: item.roleId, result: { parentTaskId: parent.taskId, response: result.slice(0, 7000) } },
        { status: 'returned_to_ceo', stage: 'review', eventType: 'department_report_accepted_by_ceo', departmentId: item.agent, roleId: item.roleId },
        { status: 'completed', stage: 'complete', eventType: 'department_report_assignment_completed', departmentId: item.agent, roleId: item.roleId, completedAt: new Date().toISOString() },
      ]);
      results.push({ department: item.department, agent: item.agent, taskId: child.taskId, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Department assignment failed.';
      await failTrackedTask(child.taskId, message);
      blocked.push({ ...item, blocker: message });
    }
  }

  const report = await askTambalaAI(
    'orchestrator',
    [
      'You are the CEO of Tambala Technologies. Deliver the Founder’s requested current company status report now; do not ask for scope confirmation.',
      `Founder objective: ${objective}`,
      `Verified company, CRM and organization snapshot: ${JSON.stringify(context)}`,
      `Department reports returned: ${JSON.stringify(results.map(({ department, agent, result }) => ({ department, agent, result }))) || 'None'}`,
      `Departments not able to contribute: ${JSON.stringify(blocked.map(({ department, blocker }) => ({ department, blocker })))}`,
      `Data loading warnings: ${JSON.stringify(warnings)}`,
      'Produce a clear executive summary, verified operating figures, sales pipeline, customer/project position, operational risks and immediate priorities. Use only supplied evidence. Explicitly mark missing metrics as unavailable/not recorded; never convert missing data into zero. Distinguish completed department work from unavailable work. Do not promise deadlines or claim actions were taken unless the task records confirm them.',
    ].join('\n\n'),
    { communicationType: 'CEO consolidated status report', sender: 'CEO workflow', recipient: 'Founder / Bless', messageId: envelope.message_id, parentTaskId: parent.taskId },
  );

  if (results.length) {
    await advanceTrackedTask(parent.taskId, [
      { status: 'department_review', stage: 'review', eventType: 'ceo_department_reports_reviewed', roleId: 'ceo', result: { departmentsCompleted: results.map((item) => item.department), departmentsBlocked: blocked.map((item) => item.department) } },
      { status: 'returned_to_ceo', stage: 'review', eventType: 'ceo_report_consolidation_completed', roleId: 'ceo' },
      { status: 'completed', stage: 'complete', eventType: 'founder_status_report_completed', roleId: 'ceo', result: { report: report.slice(0, 10000), departmentsCompleted: results.map((item) => item.department), departmentsBlocked: blocked.map((item) => item.department) }, completedAt: new Date().toISOString() },
    ]);
  } else {
    await advanceTrackedTask(parent.taskId, [{
      status: 'needs_more_work',
      stage: 'ceo',
      eventType: 'founder_status_report_partially_completed',
      roleId: 'ceo',
      result: { report: report.slice(0, 10000), departmentsBlocked: blocked.map((item) => item.department) },
    }]);
  }

  const assignmentSummary = [
    `Department assignments completed: ${results.length ? results.map((item) => item.department).join(', ') : 'None'}.`,
    blocked.length ? `Unavailable departments: ${blocked.map((item) => `${item.department} — ${item.blocker}`).join('; ')}.` : '',
    parent.tracking === 'recorded' ? `Parent task recorded: ${parent.taskId}.` : 'Task tracking is unavailable; report was generated without a durable task record.',
  ].filter(Boolean).join('\n');
  return `${report}\n\n---\n${assignmentSummary}`;
}
