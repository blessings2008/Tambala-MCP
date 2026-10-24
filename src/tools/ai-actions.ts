import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { askTambalaAI, getAgentModel, getAgentOperationalInfo, type AgentName } from '../services/ai.js';
import { GROUNDING_RULES } from '../services/ai/rules.js';
import { crmStatus, findSubjectInCRM, getBusinessSummary, getVerifiedCompanyContext, resolveClient, resolveLead } from '../services/ai/context.js';

type DbRow = Record<string, unknown>;
const agent = z.enum(['orchestrator', 'outreach', 'followup']);
const uuid = z.string().uuid();
const blantyreTime = () => new Date().toLocaleString('en-GB', { timeZone: 'Africa/Blantyre', dateStyle: 'full', timeStyle: 'long' });
const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerAITools(server: McpServer): void {
  server.registerTool('get_ai_agent_api_routes', {
    description: 'Show which configured API endpoint, model, and credential variable each AI agent uses. Never returns API key values.',
    inputSchema: {},
  }, async () => text({
    policy: 'Each agent uses its own credential. Only the orchestrator may use GROQ_API_KEY as a legacy fallback.',
    agents: (['orchestrator', 'outreach', 'followup'] as const).map((name) => getAgentOperationalInfo(name)),
  }));

  server.registerTool('ask_tambala_ai', {
    description: 'Ask a Tambala AI specialist using live CRM and business context.',
    inputSchema: { agent: agent.describe('AI specialist'), request: z.string().trim().min(1).max(10000), subject: z.string().trim().min(1).max(500).optional(), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ agent: agentName, request, subject, lead_id, client_id }) => {
    const resolvedSubject = subject ?? await findSubjectInCRM(request);
    const [company, summary, lead, client] = await Promise.all([getVerifiedCompanyContext(), getBusinessSummary(), resolveLead(resolvedSubject, lead_id), resolveClient(resolvedSubject, client_id)]);
    const context_status = crmStatus(lead, client);
    const response = await askTambalaAI(agentName as AgentName, request, { company, business_summary: summary, lead, client, grounding_rules: GROUNDING_RULES, context_status, current_time_africa_blantyre: blantyreTime() });
    return text({ agent: agentName, model: getAgentModel(agentName as AgentName), context_used: { ...context_status, lookup_subject: resolvedSubject ?? null }, response, requires_approval: true });
  });

  server.registerTool('draft_outreach', {
    description: 'Draft a personalized prospect message using live CRM context. Default channel is WhatsApp/chat. The draft is never sent.',
    inputSchema: { prospect: z.string().trim().min(1).max(5000), goal: z.string().trim().min(1).max(2000), channel: z.enum(['email', 'sms', 'chat']).default('chat'), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ prospect, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([getVerifiedCompanyContext(), resolveLead(prospect, lead_id), resolveClient(prospect, client_id)]);
    const context_status = crmStatus(lead, client);
    const response = await askTambalaAI('outreach', `Draft a ${channel} message for the goal below. Write as Bless/Tambala, never as a CRM system. Match the requested channel exactly. For chat, write a natural WhatsApp-style message, not an email. Never expose internal notes, statuses, phase labels, follow-up dates, UUIDs or database metadata. Only say something was sent, shared or completed when CRM activity or explicit notes confirms it. Use [LINK] when a verified link is unavailable. Only use portfolio links and project claims from the verified_portfolio list supplied in company context; never invent or infer a portfolio URL. Use configured sender details or placeholders; never use the prospect's number as the sender. Only mention verified services. Never invent portfolio work, partnerships, experience or completed projects. Goal: ${goal}.`, { company, lead, client, supplied_prospect: prospect, grounding_rules: GROUNDING_RULES, context_status });
    return text({ channel, draft: response, requires_approval: true, context_used: { ...context_status, lookup_subject: prospect } });
  });

  server.registerTool('analyze_followup', {
    description: 'Analyze a follow-up using live CRM/activity context. Default channel is WhatsApp/chat. It never sends anything.',
    inputSchema: { subject: z.string().trim().min(1).max(500), history: z.string().trim().min(1).max(10000).optional(), goal: z.string().trim().min(1).max(2000), channel: z.enum(['email', 'sms', 'chat']).default('chat'), lead_id: uuid.optional(), client_id: uuid.optional() },
  }, async ({ subject, history, goal, channel, lead_id, client_id }) => {
    const [company, lead, client] = await Promise.all([getVerifiedCompanyContext(), resolveLead(subject, lead_id), resolveClient(subject, client_id)]);
    const context_status = crmStatus(lead, client);
    const currentTime = blantyreTime();
    const leadRecord = lead?.lead as DbRow | undefined;
    const followUpDue = leadRecord?.next_follow_up_at ?? null;
    const response = await askTambalaAI('followup', `Analyze this ${channel} follow-up using CRM/activity context and supplied history only. Lead notes and activity history are authoritative, with status/notes as secondary evidence when activity is empty. Use the current Africa/Blantyre time and verified follow-up due time. Distinguish requested items from items actually sent/shared. If status is demo_sent but there is no delivery activity, distinguish that status from the missing delivery record; do not say the demo was definitely delivered. Never expose CRM wording or internal schedules to the prospect. Write the final draft as Bless/Tambala speaking naturally in the requested channel. For chat, do not use an email subject. Never invent links, promises, meetings, travel, shipments, contacts, project claims, clients or experience. Use only verified services and only verified portfolio links/projects from company context. Goal: ${goal}.${history ? ` Additional user-supplied history (supplement only): ${history}` : ''}`, { company, lead, client, grounding_rules: GROUNDING_RULES, context_status, current_time_africa_blantyre: currentTime });
    return text({ channel, analysis: response, timing: { current_time_africa_blantyre: currentTime, follow_up_due_at: followUpDue, timing_basis: 'Use the verified due date and current Africa/Blantyre time; do not invent a different deadline.' }, requires_approval: true, context_used: { ...context_status, lookup_subject: subject } });
  });
}
