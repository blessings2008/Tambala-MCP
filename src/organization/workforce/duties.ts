import type { AgentName } from '../../services/ai/models.js';
import type { Cadence } from './schedule.js';

export type ContextKind = 'crm' | 'crm_detail' | 'company' | 'organization' | 'briefing' | 'catalog' | 'invoices' | 'discovery';

export interface StandingDuty {
  id: string;
  agent: AgentName;
  title: string;
  cadence: Cadence;
  time: string; // HH:MM office time
  contexts: ContextKind[];
  needsWeb?: boolean;
  researchQuery?: string;
  /** What the employee actually does. Grounded in supplied data only. */
  job: string;
  deliverable: string;
  /** When set, the finished work is parked for Founder approval before anything leaves the building. */
  approval?: { actionType: string; riskLevel: 'low' | 'medium'; summary: string };
  /** When set, the output is also filed as an organization report. */
  report?: 'daily_briefing';
  /** Set by the loader, not in the built-in list. */
  custom?: boolean;
  enabled?: boolean;
  edited?: boolean;
}

export const STANDING_DUTIES: readonly StandingDuty[] = [
  {
    id: 'daily-lead-discovery', agent: 'research', title: 'Daily prospect queue intelligence',
    cadence: { kind: 'daily' }, time: '06:00', contexts: ['discovery'],
    job: `TEMPORARY MODE — the external discovery engine is under repair. Do NOT perform web research and do NOT generate new prospects. Work exclusively from context.discovery, which is a compact full-table snapshot of the live lead_discovery_queue. Report its total and processing_status/verification_status counts, list the organisations still awaiting review, and flag any status inconsistencies. The compact snapshot does not contain source evidence or contacts, so do not decide qualification from it; individual record handoffs provide the full evidence for that assessment. Never reject a record merely because a named decision-maker is missing. Do not change queue rows, create CRM records, or contact organisations. Do not repeat work already completed or treat promoted/rejected records as pending. Be explicit if the supplied snapshot is incomplete or truncated.`,
    deliverable: 'A concise daily queue utilisation report: total records, processing and verification counts, names still awaiting Research review, and any status inconsistencies. Do not claim to have checked individual source evidence. Clearly state that this is a read-only report.',
  },
  {
    id: 'sales-discovery-queue-review', agent: 'research', title: 'Research department queue assessment',
    cadence: { kind: 'weekdays' }, time: '08:15', contexts: ['company', 'discovery'],
    job: 'Review the discovery queue records supplied in context.discovery. This is a read-only oversight review; the individual record assessment workflow is handled by the queue watcher. Identify records stuck in reviewing and any status inconsistencies. Do not assess service-fit evidence from the compact summary; individual Research handoffs carry that evidence. Do not repeat web research while the discovery engine is paused. Do not edit statuses, create CRM leads, or contact organisations.',
    deliverable: 'A short exception report naming queue IDs and organisations, explaining the exact issue and recommended next step. Do not re-list all records.',
  },

  {
    id: 'security-audit-review', agent: 'security', title: 'Daily incident monitoring and security review',
    cadence: { kind: 'daily' }, time: '07:30', contexts: ['organization'],
    job: 'Act as the organisation incident-monitoring and security function, not merely an audit-event summariser. Review audit_last_24h, audit_non_success_last_24h, audit_denials_truncated, tasks_last_7d, failed_task_events_last_7d, duty_runs_last_7d and active_role_bindings. The failed_task_events_last_7d list is authoritative for execution failures because task failures are recorded in organization_task_events, not necessarily in organization_audit_events. Correlate each stage_failed event with its task and duty run where possible. Report every distinct failure with timestamp, affected task/duty/department if known, exact error, likely cause category (provider/model, rate limit, tool/schema, application, permissions, data/persistence, or unknown), and whether it repeated. Any non-success audit event, truncated denied-event list, failed task, failed duty, skipped critical duty, unbound active connection, or rejected security action means status MUST be Needs attention; never report Normal while any such issue is present. State Normal only when the relevant sources were checked and there are no failures or anomalies. Do not invent tool actions such as check_tool_permissions; the only action you may request is notify_founder. When notifying the Founder, use exactly this schema inside ACTIONS: {\"type\":\"notify_founder\",\"text\":\"Subject: ...\\n\\nMessage: ...\"}. Never use an action or payload property. For repeated production failures or a security/permission risk, include this exact valid action. Distinguish no events found from monitoring unavailable or incomplete data.' ,
    deliverable: 'A short security status (Normal / Needs attention), the specific items behind it, and one recommended action if any.',
  },
  {
    id: 'task-board-hygiene', agent: 'operations', title: 'Daily task board check',
    cadence: { kind: 'weekdays' }, time: '08:00', contexts: ['crm'],
    job: 'Review open CRM tasks and projects. Identify overdue items, items with no due date, and work that has sat untouched. Do not change any record.',
    deliverable: 'Overdue list, stale list, and the three items the Founder should look at first today.',
  },
  {
    id: 'sales-pipeline-review', agent: 'outreach', title: 'Daily pipeline review and outreach preparation',
    cadence: { kind: 'weekdays' }, time: '08:30', contexts: ['crm', 'crm_detail', 'company', 'catalog'],
    job: 'Review the lead pipeline by status. Pick the best-fit leads that have not been contacted or are due. Identify the single best-fit CRM prospect that has not been contacted, verify its business name and WhatsApp number, and send one personalised first-contact WhatsApp message using the whatsapp action. The system processes additional approved prospects in separate scheduler cycles to respect the customer-send cooldown. First-contact messages from Outreach may be sent autonomously under the Founder-approved daily cap and cooldown. Keep each message natural, specific, relevant and customer-ready; never include internal role titles, employee codes (such as TT-001), agent names, signatures, routing notes, draft labels, internal analysis or unrelated information. Do not mention services unless they are in the verified catalogue. Do not message unknown numbers or invent contact details. If a lead clearly needs a quotation and the price list covers it, prepare it with the document action.',
    deliverable: 'Pipeline snapshot, the one prospect selected, the message actually queued or sent, delivery outcome, replies received, and any blockers. Clearly separate messages queued, sent, failed, blocked and drafts awaiting approval using the action results; never describe an autonomous first-contact message as awaiting approval when it was queued or sent, and never claim delivery unless the outbox confirms it.',
  },
  {
    id: 'customer-followups', agent: 'followup', title: 'Daily customer follow-ups',
    cadence: { kind: 'weekdays' }, time: '09:00', contexts: ['crm', 'crm_detail', 'company'],
    job: 'Find leads and clients whose next follow-up is due or overdue, and open client tasks. Prepare a short check-in WhatsApp message (whatsapp action) for each due contact who has a number in the records, using only facts in the supplied records.',
    deliverable: 'Who is due and why, then one draft per person. Say clearly if nobody is due.',
    approval: { actionType: 'prepared_followups', riskLevel: 'low', summary: 'Prepared customer follow-up drafts awaiting Founder approval' },
  },
  {
    id: 'payment-followups', agent: 'finance', title: 'Daily unpaid invoice follow-up',
    cadence: { kind: 'weekdays' }, time: '10:30', contexts: ['invoices', 'crm'],
    job: 'Review the invoices that are still unpaid. For each one that is more than three days old, send a polite payment reminder with its payment link (whatsapp action, purpose followup) to the client\'s number from the data. Do not remind the same client twice in a week. For anything more than 14 days old, tell the Founder (notify_founder). Never state a balance you were not given.',
    deliverable: 'Who is overdue and by how long, the reminders you prepared, and what you escalated.',
  },
  {
    id: 'weekly-billing-readiness', agent: 'finance', title: 'Weekly billing readiness review',
    cadence: { kind: 'weekly', day: 1 }, time: '09:00', contexts: ['crm'],
    job: 'Review active projects and their due dates and statuses to identify work that is complete or near complete and may be ready to invoice. You have no payment or bank data: do not state any amounts, balances or revenue.',
    deliverable: 'Projects that look ready to bill, projects that are not, and which records are missing the data needed to decide.',
  },
  {
    id: 'weekly-market-scan', agent: 'research', title: 'Weekly market scan',
    cadence: { kind: 'weekly', day: 1 }, time: '09:30', contexts: ['company'], needsWeb: true, researchQuery: 'Malawi mobile money digital payments regulation business digitisation news',
    job: 'Search the web for current developments relevant to a small Malawian software and fintech company: mobile money, digital payments regulation, and local business digitisation. Cite source URLs.',
    deliverable: 'Up to five findings, each with a source URL, labelled fact or inference, and why it matters to Tambala.',
  },
  {
    id: 'weekly-marketing-focus', agent: 'marketing', title: 'Weekly marketing focus',
    cadence: { kind: 'weekly', day: 1 }, time: '10:00', contexts: ['crm', 'company'],
    job: 'Using the pipeline and the verified services list, recommend what marketing should focus on this week and for which audience. Do not invent clients, testimonials or results.',
    deliverable: 'One focus, the audience, two concrete actions, and what would show it is working.',
  },
  {
    id: 'weekly-workforce-review', agent: 'people', title: 'Weekly workforce performance review',
    cadence: { kind: 'weekly', day: 5 }, time: '14:00', contexts: ['organization'],
    job: 'Review how the AI staff performed this week from the supplied duty runs: completed, skipped, failed, awaiting approval. Identify which roles are unreliable and which have no duties.',
    deliverable: 'A per-role table of results, the top two problems, and recommended changes to duties or activation. Recommendations only; do not change appointments.',
  },
  {
    id: 'weekly-priorities-review', agent: 'strategy', title: 'Weekly priorities and risk review',
    cadence: { kind: 'weekly', day: 5 }, time: '15:00', contexts: ['crm', 'organization'],
    job: 'Review the week across the pipeline, tasks and organization activity. State what moved, what stalled, and the top three priorities for next week with reasons.',
    deliverable: 'What moved, what stalled, three priorities, and the single biggest risk.',
  },
  {
    id: 'ceo-weekly-operating-plan', agent: 'orchestrator', title: 'Weekly CEO operating plan',
    cadence: { kind: 'weekly', day: 1 }, time: '08:00', contexts: ['crm', 'organization', 'invoices', 'company'],
    job: 'You are the CEO. Prepare the company operating plan for the coming week using only the supplied CRM, invoice, organization and company records. Review real pipeline movement, quotations, payments, overdue work, duty outcomes, staffing readiness and risks. Set no financial commitments, prices or regulatory positions. Do not assign work outside active employee duties or change anyone’s permissions. Separate verified metrics from unavailable data and recommendations. Escalate any decision requiring Founder authority.',
    deliverable: 'A signed weekly operating plan with: measurable company targets based on the actual baseline; sales pipeline priorities; delivery and client commitments already on record; cash/invoice facts; department priorities and owners; risks and blockers; Founder decisions required; and what evidence will be reviewed next week. Label every unavailable metric explicitly.',
  },
  {
    id: 'ceo-daily-briefing', agent: 'orchestrator', title: 'Daily executive briefing',
    cadence: { kind: 'weekdays' }, time: '16:30', contexts: ['briefing'], report: 'daily_briefing',
    job: 'You are the CEO. Compile the end-of-day briefing for the Founder from today’s duty results: what each department did, what needs a Founder decision, what failed or was skipped, and tomorrow’s focus.',
    deliverable: 'A briefing the Founder can read in two minutes: headline, decisions needed, department updates, problems, tomorrow.',
  },
];

export function dutiesFor(agent: AgentName): StandingDuty[] {
  return STANDING_DUTIES.filter((d) => d.agent === agent);
}

export function getDuty(id: string): StandingDuty | undefined {
  return STANDING_DUTIES.find((d) => d.id === id);
}
