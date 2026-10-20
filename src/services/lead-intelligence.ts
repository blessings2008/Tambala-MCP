import { supabaseSelect } from '../lib/database.js';

type Row = Record<string, unknown>;
const EXCLUDED = new Set(['archived', 'cancelled', 'canceled', 'lost', 'closed']);

function isTest(row: Row): boolean {
  return /(^|\s)test(\s|[-_])/i.test(`${row.name ?? ''} ${row.business_name ?? ''}`);
}
function daysSince(value: unknown): number | null {
  if (!value) return null;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86400000) : null;
}
function scoreLead(lead: Row, activity: Row[]) {
  let score = 0;
  const reasons: string[] = [];
  const status = String(lead.status ?? '').toLowerCase();
  const due = lead.next_follow_up_at ? new Date(String(lead.next_follow_up_at)).getTime() : NaN;
  const now = Date.now();
  if (Number.isFinite(due)) {
    if (due <= now) { score += 35; reasons.push('follow-up is due or overdue'); }
    else if (due - now <= 3 * 86400000) { score += 20; reasons.push('follow-up is due within 3 days'); }
  }
  if (['replied', 'interested', 'qualified', 'proposal', 'demo_sent'].includes(status)) {
    score += 20; reasons.push(`status indicates active sales progress (${status})`);
  } else if (['contacted', 'new'].includes(status)) score += 5;
  if (activity.length) {
    const recent = Math.min(...activity.map((a) => daysSince(a.created_at) ?? 999));
    if (recent <= 7) { score += 15; reasons.push('recent activity exists'); }
  }
  if (lead.phone || lead.email) { score += 5; reasons.push('a contact channel is available'); }
  if (lead.notes || lead.description) { score += 5; reasons.push('lead context is available for personalization'); }
  let next_action = 'Review the lead record and choose the next evidence-based outreach step.';
  if (Number.isFinite(due) && due <= now) next_action = 'Prepare the scheduled follow-up using verified lead context.';
  else if (status === 'demo_sent') next_action = 'Follow up on the demo and confirm whether the prospect reviewed it.';
  else if (['replied', 'interested', 'qualified'].includes(status)) next_action = 'Continue the conversation toward a concrete next step.';
  else if (status === 'new') next_action = 'Prepare a first-contact message; do not imply prior interest.';
  return { score: Math.min(100, score), reasons, next_action };
}

export async function rankLeads(limit = 10): Promise<Row[]> {
  const [leads, activities] = await Promise.all([
    supabaseSelect<Row>('leads', { select: '*' }),
    supabaseSelect<Row>('activity_log', { select: 'id,entity_id,entity_type,created_at,title,activity_type', entity_type: 'eq.lead', order: 'created_at.desc', limit: '500' }),
  ]);
  return leads.filter((lead) => !EXCLUDED.has(String(lead.status ?? '').toLowerCase()) && !isTest(lead)).map((lead) => {
    const leadActivities = activities.filter((a) => String(a.entity_id ?? '') === String(lead.id));
    const intelligence = scoreLead(lead, leadActivities);
    return { id: lead.id, name: lead.name, business_name: lead.business_name, status: lead.status, next_follow_up_at: lead.next_follow_up_at, score: intelligence.score, reasons: intelligence.reasons, next_action: intelligence.next_action };
  }).sort((a, b) => Number(b.score) - Number(a.score)).slice(0, Math.max(1, Math.min(limit, 50)));
}
