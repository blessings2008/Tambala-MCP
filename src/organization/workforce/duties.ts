import type { AgentName } from '../../services/ai/models.js';
import type { Cadence } from './schedule.js';

export type ContextKind = 'crm' | 'company' | 'organization' | 'briefing' | 'catalog' | 'invoices' | 'discovery';

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

export const STANDING_DUTIES: readonly StandingDuty[] = [\n  {
    id: 'daily-lead-discovery', agent: 'research', title: 'Daily Malawi prospect discovery',
    cadence: { kind: 'daily' }, time: '06:00', contexts: ['crm', 'company', 'discovery'], needsWeb: true,
    researchQuery: 'Find up to five new Malawian organisations that plausibly fit Tambala Technologies active services. Verify organisation identity, service-fit evidence, website and publicly listed contacts using official or authoritative sources. Exclude CRM clients/leads and the discovery queue.',
    job: 'Research up to five new organisations in Malawi for Tambala Technologies. Search across sectors and regions. Use the supplied company services and excluded CRM/discovery names. Prefer official organisation websites, official social profiles, regulators, credible directories and recent sources. Do not invent facts, people, emails, phone numbers, websites or needs. A service-fit reason must point to a visible evidence-based opportunity, not a guess. Save only prospects with at least one valid source URL, a substantive fit reason and one or more active Tambala service-fit codes. Use exact codes: web_development, software_development, digital_product_development, social_media_management. Leave unknown contact fields null. If fewer than five meet the evidence bar, return fewer. Do not contact anyone or create CRM records.',
    deliverable: 'A concise research summary, then emit this exact machine-readable wrapper: DISCOVERED_PROSPECTS: followed by a fenced json code block containing a JSON array, then END_DISCOVERED_PROSPECTS on its own line after the closing fence. Each item uses organisation_name, website, sector, service_fit (array of exact codes), reason_for_fit, decision_maker_name, decision_maker_title, public_email, public_phone, source_urls (array of URLs), verification_status (verified, partial, or unverified), and research_notes. Use null for unknown optional values. Include at most five items. Output an empty array if none meet the evidence standard. Do not put commentary inside the JSON block.',
  },
  {
    id: 'sales-discovery-queue-review', agent: 'outreach', title: 'Daily discovery queue review',
    cadence: { kind: 'weekdays' }, time: '08:15', contexts: ['company', 'discovery'],
    job: 'Review the new research prospects supplied in context.discovery. Assess whether the evidence supports the stated Tambala service fit, whether sources are credible, and whether contacts are actually public and attributable. Recommend which records Sales should qualify, reject or investigate further. Do not edit queue statuses, create CRM leads, or contact organisations. If the queue is empty, say so plainly.',
    deliverable: 'A short queue review grouped into recommended qualify, investigate, and reject, with reasons and missing evidence. Clearly state that these are recommendations only; no records were changed.',
  },

  {
    id: 'security-audit-review', agent: 'security', title: 'Daily security and audit review',
    cadence: { kind: 'weekdays' }, time: '07:30', contexts: ['organization'],
    job: 'Review the last day of audit events, denied tool calls, failed tasks and role bindings. Flag anything unusual: repeated denials, activity outside office hours, unbound connections.',
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
    cadence: { kind: 'weekdays' }, time: '08:30', contexts: ['crm', 'company', 'catalog'],
    job: 'Review the lead pipeline by status. Pick the best-fit leads that have not been contacted or are due. Identify up to five qualified CRM prospects that have not been contacted, verify their business names and WhatsApp numbers, and send personalised first-contact WhatsApp messages using the whatsapp action. First-contact messages from Outreach may be sent autonomously under the Founder-approved daily cap and cooldown. Keep each message natural, specific, relevant and customer-ready; never include internal role titles, employee codes (such as TT-001), agent names, signatures, routing notes, draft labels, internal analysis or unrelated information. Do not mention services unless they are in the verified catalogue. Do not message unknown numbers or invent contact details. If a lead clearly needs a quotation and the price list covers it, prepare it with the document action.',
    deliverable: 'Pipeline snapshot, prospects selected, messages actually queued or sent, delivery outcomes, replies received, and any blockers. Clearly separate messages queued, sent, failed, blocked and drafts awaiting approval using the action results; never describe an autonomous first-contact message as awaiting approval when it was queued or sent, and never claim delivery unless the outbox confirms it.',
  },
  {
    id: 'customer-followups', agent: 'followup', title: 'Daily customer follow-ups',
    cadence: { kind: 'weekdays' }, time: '09:00', contexts: ['crm', 'company'],
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
