import { supabaseSelect } from '../lib/database.js';
import { rankLeads } from './lead-intelligence.js';

type Row = Record<string, unknown>;

function dateMs(value: unknown): number | null {
  if (!value) return null;
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isTest(row: Row): boolean {
  return /(^|\s)test(\s|[-_])/i.test(`${row.name ?? ''} ${row.title ?? ''} ${row.business_name ?? ''}`);
}

function active(row: Row): boolean {
  const status = String(row.status ?? '').toLowerCase();
  return !['archived', 'cancelled', 'canceled', 'completed', 'done', 'lost', 'closed'].includes(status) && !isTest(row);
}

export async function buildDailyReport(limit = 5) {
  const now = Date.now();
  const [leads, tasks, projects, ranked] = await Promise.all([
    supabaseSelect<Row>('leads', { select: '*' }),
    supabaseSelect<Row>('tasks', { select: '*' }),
    supabaseSelect<Row>('projects', { select: '*' }),
    rankLeads(limit),
  ]);

  const openTasks = tasks.filter((row) => active(row) && !['done', 'completed', 'cancelled', 'canceled'].includes(String(row.status ?? '').toLowerCase()));
  const dueTasks = openTasks.filter((row) => {
    const due = dateMs(row.due_at ?? row.due_date);
    return due !== null && due <= now;
  });
  const activeProjects = projects.filter(active);
  const waitingProjects = activeProjects.filter((row) => /waiting|blocked|client/i.test(`${row.status ?? ''} ${row.notes ?? ''}`));
  const dueLeads = ranked.filter((row) => {
    const due = dateMs(row.next_follow_up_at);
    return due !== null && due <= now;
  });

  return {
    generated_at: new Date(now).toISOString(),
    summary: { active_leads: leads.filter(active).length, open_tasks: openTasks.length, overdue_or_due_tasks: dueTasks.length, active_projects: activeProjects.length, waiting_projects: waitingProjects.length },
    priorities: ranked.slice(0, limit),
    due_tasks: dueTasks.slice(0, limit).map((row) => ({ id: row.id, title: row.title ?? row.name, due_at: row.due_at ?? row.due_date, status: row.status })),
    projects_needing_attention: waitingProjects.slice(0, limit).map((row) => ({ id: row.id, name: row.name ?? row.title, status: row.status, notes: row.notes })),
    due_followups: dueLeads.map((lead) => ({ id: lead.id, name: lead.name, business_name: lead.business_name, next_follow_up_at: lead.next_follow_up_at, score: lead.score, next_action: lead.next_action })),
    grounding: 'Generated from active CRM records and rule-based lead intelligence. No revenue, conversion rates, client interest, or completion claims are inferred.',
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

export function renderDailyReportHtml(report: Awaited<ReturnType<typeof buildDailyReport>>): string {
  const priorities = report.priorities.map((lead) => `<li><strong>${escapeHtml(lead.name ?? lead.business_name)}</strong> — score ${lead.score}<br>${escapeHtml(lead.next_action)}</li>`).join('');
  const tasks = report.due_tasks.map((task) => `<li>${escapeHtml(task.title)} — ${escapeHtml(task.due_at)} (${escapeHtml(task.status)})</li>`).join('');
  const projects = report.projects_needing_attention.map((project) => `<li>${escapeHtml(project.name)} — ${escapeHtml(project.status)}${project.notes ? ` — ${escapeHtml(project.notes)}` : ''}</li>`).join('');
  const followups = report.due_followups.map((lead) => `<li>${escapeHtml(lead.name ?? lead.business_name)} — ${escapeHtml(lead.next_action)}</li>`).join('');
  return `<!doctype html><html><body><h2>Tambala — Daily Business Brief</h2><p>Generated ${escapeHtml(report.generated_at)}</p><h3>Summary</h3><ul><li>Active leads: ${report.summary.active_leads}</li><li>Open tasks: ${report.summary.open_tasks}</li><li>Due/overdue tasks: ${report.summary.overdue_or_due_tasks}</li><li>Active projects: ${report.summary.active_projects}</li><li>Projects needing attention: ${report.summary.waiting_projects}</li></ul><h3>Top priorities</h3><ol>${priorities || '<li>None identified.</li>'}</ol><h3>Due or overdue tasks</h3><ul>${tasks || '<li>None.</li>'}</ul><h3>Follow-ups due</h3><ul>${followups || '<li>None.</li>'}</ul><h3>Projects needing attention</h3><ul>${projects || '<li>None.</li>'}</ul><p>${escapeHtml(report.grounding)}</p></body></html>`;
}
