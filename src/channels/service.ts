import { supabaseSelect } from '../lib/supabase.js';
import { createApprovalRequest, decideApproval, listPendingApprovals, registerApprovalHook } from '../organization/workforce/approvals-service.js';
import { dbConfigured } from '../organization/workforce/db-util.js';
import { labelForRole } from '../organization/workforce/profiles.js';
import { getOrganizationSnapshot, routeOrganizationObjective } from '../organization/service.js';
import { requireConfiguredRuntime, resolveExecutionRoute } from '../organization/execution-router.js';
import { askTambalaAI, askTambalaAIWithWebResearch, getAgentOperationalInfo } from '../services/ai.js';
import { getBusinessSummary, getCompactCompanyContext } from '../services/ai/context.js';
import { buildProspectingSearchQueries } from '../services/web-research.js';
import { signWork } from '../organization/workforce/sign-work.js';
import { loadPdfForSending } from '../documents/service.js';
import { connectionState, evolutionConfig, evolutionConfigured, sendDocument, sendText } from './evolution.js';
import { handleEvolutionWebhook, type FounderMessageEnvelope, type InboundDeps, type InboundSummary } from './inbound.js';
import { messageStore, type MessageStore } from './message-store.js';
import { onApprovalDecided, processOutbox, queueMessage, type OutboxDeps, type QueueInput, type QueueResult, type SendOutcome } from './outbox.js';
import { CLIENT_DAILY_LIMIT, FOUNDER_DAILY_LIMIT } from './policy.js';
import { maskNumber, normalizePhone } from './phone.js';
import { localTime } from '../organization/workforce/schedule.js';
import { isCompanyStatusRequest, isFounderKnowledgeQuestion, runCompanyStatusReport } from './founder-execution.js';

/** The Founder's own WhatsApp number, where employees reach him. Set TAMBALA_FOUNDER_WHATSAPP. */
export function founderNumber(): string | null {
  return normalizePhone(process.env.TAMBALA_FOUNDER_WHATSAPP ?? '');
}

export function productionOutboxDeps(store: MessageStore = messageStore(), now: () => Date = () => new Date()): OutboxDeps {
  return {
    store, now, founderNumber,
    transport: { configured: evolutionConfigured, sendText, sendDocument },
    loadDocument: (id) => loadPdfForSending(id),
    sign: (input) => signWork(input),
    approvals: { create: (input) => createApprovalRequest({ ...input }) },
    senderLabel: (roleId) => labelForRole(roleId),
    cooldownMs: Math.max(90_000, Number(process.env.TAMBALA_WHATSAPP_COOLDOWN_MS) || 90_000),
    verifyOutreachLead: contactLabel,
  };
}

export async function queueWhatsApp(input: QueueInput): Promise<QueueResult> {
  return queueMessage(productionOutboxDeps(), input);
}

let sending = false;
/** Send whatever is due. One pass at a time per process. */
export async function runOutbox(): Promise<SendOutcome[]> {
  if (sending) return [];
  sending = true;
  try { return await processOutbox(productionOutboxDeps()); } finally { sending = false; }
}

// When the Founder decides on a message approval, release or retire the message right away.
registerApprovalHook('outbox_message', async (approval, decision, note) => {
  if (!approval.subject_id) return;
  await onApprovalDecided(productionOutboxDeps(), approval.subject_id, decision, note || null);
  if (decision === 'approved') await runOutbox();
});

// ---- who is this number? ----
let contactCache: { at: number; rows: { type: string; name: string; numbers: string[] }[] } | null = null;
async function contacts() {
  if (contactCache && Date.now() - contactCache.at < 60_000) return contactCache.rows;
  const rows: { type: string; name: string; numbers: string[] }[] = [];
  for (const table of ['clients', 'leads'] as const) {
    const data = await supabaseSelect<Record<string, unknown>>(table, 'select=name,business_name,phone,whatsapp&limit=2000');
    for (const r of data) {
      const numbers = [r.phone, r.whatsapp].map((v) => normalizePhone(v)).filter(Boolean) as string[];
      if (numbers.length) rows.push({ type: table === 'clients' ? 'client' : 'lead', name: String(r.business_name || r.name || ''), numbers });
    }
  }
  contactCache = { at: Date.now(), rows };
  return rows;
}
export async function contactLabel(number: string): Promise<string | null> {
  if (!dbConfigured()) return null;
  const hit = (await contacts()).find((c) => c.numbers.includes(number));
  return hit ? `${hit.name} (${hit.type})` : null;
}

async function answerFounderKnowledgeQuestion(envelope: FounderMessageEnvelope): Promise<string> {
  const warnings: string[] = [];
  const [companyContext, businessSummary, snapshot, queueRows, messageRows, approvalRows] = await Promise.all([
    getCompactCompanyContext().catch((error) => { warnings.push('Company profile/services unavailable: ' + (error instanceof Error ? error.message : 'unknown error')); return null; }),
    getBusinessSummary().catch((error) => { warnings.push('CRM summary unavailable: ' + (error instanceof Error ? error.message : 'unknown error')); return null; }),
    getOrganizationSnapshot().catch((error) => { warnings.push('Organization chart unavailable: ' + (error instanceof Error ? error.message : 'unknown error')); return null; }),
    supabaseSelect<Record<string, unknown>>('lead_discovery_queue', 'select=organisation_name,processing_status,verification_status,crm_lead_id,updated_at&order=created_at.desc&limit=500').catch((error) => { warnings.push('Prospect queue unavailable: ' + (error instanceof Error ? error.message : 'unknown error')); return []; }),
    supabaseSelect<Record<string, unknown>>('organization_messages', 'select=direction,audience,purpose,status,sent_at,created_at,contact_label&order=created_at.desc&limit=1000').catch((error) => { warnings.push('Message history unavailable: ' + (error instanceof Error ? error.message : 'unknown error')); return []; }),
    supabaseSelect<Record<string, unknown>>('organization_approval_requests', 'select=action_type,status,summary,created_at,resolved_at&order=created_at.desc&limit=300').catch((error) => { warnings.push('Approval history unavailable: ' + (error instanceof Error ? error.message : 'unknown error')); return []; }),
  ]);

  const countBy = (rows: Record<string, unknown>[], field: string) => rows.reduce<Record<string, number>>((counts, row) => {
    const key = String(row[field] ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const clientOutbound = messageRows.filter((row) => row.direction === 'out' && row.audience === 'client');
  const sentClientMessages = clientOutbound.filter((row) => row.status === 'sent');
  const units = snapshot?.organization?.units ?? [];
  const roles = snapshot?.organization?.roles ?? [];
  const crm = businessSummary ? {
    leads_total: businessSummary.leads_total,
    leads_by_status: businessSummary.leads_by_status,
    clients_total: businessSummary.clients_total,
    clients_by_status: businessSummary.clients_by_status,
    projects_total: businessSummary.projects_total,
    projects_by_status: businessSummary.projects_by_status,
    tasks_total: businessSummary.tasks_total,
    tasks_by_status: businessSummary.tasks_by_status,
    task_details: businessSummary.task_details,
  } : null;
  const verifiedRecords = {
    generated_at: new Date().toISOString(),
    company: companyContext,
    crm,
    organization: snapshot ? {
      source: snapshot.source,
      departments: units.map((unit) => ({ name: unit.name, kind: unit.kind, status: unit.status })),
      roles: roles.map((role) => ({ title: role.title, activation: role.activation, unitId: role.unitId })),
    } : null,
    prospect_queue: {
      total_loaded: queueRows.length,
      by_processing_status: countBy(queueRows, 'processing_status'),
      by_verification_status: countBy(queueRows, 'verification_status'),
      recent: queueRows.slice(0, 30).map((row) => ({
        organisation_name: row.organisation_name,
        processing_status: row.processing_status,
        verification_status: row.verification_status,
        has_crm_lead: Boolean(row.crm_lead_id),
        updated_at: row.updated_at,
      })),
    },
    client_messaging: {
      outbound_client_messages_loaded: clientOutbound.length,
      sent_to_clients: sentClientMessages.length,
      outbound_by_status: countBy(clientOutbound, 'status'),
      latest_successful_client_message_at: sentClientMessages.find((row) => typeof row.sent_at === 'string')?.sent_at ?? null,
      recent_outbound: clientOutbound.slice(0, 15).map((row) => ({
        purpose: row.purpose, status: row.status, contact_label: row.contact_label,
        sent_at: row.sent_at, created_at: row.created_at,
      })),
      note: 'Only organization_messages rows with direction=out, audience=client and status=sent count as sent client messages. Founder notifications are not client outreach.',
    },
    approvals: {
      total_loaded: approvalRows.length,
      by_action_and_status: approvalRows.reduce<Record<string, number>>((counts, row) => {
        const key = String(row.action_type ?? 'unknown') + ':' + String(row.status ?? 'unknown');
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
      recent: approvalRows.slice(0, 20).map((row) => ({
        action_type: row.action_type, status: row.status, summary: row.summary,
        created_at: row.created_at, resolved_at: row.resolved_at,
      })),
    },
    data_warnings: warnings,
  };

  const prompt = [
    'You are the Chief Executive Officer of Tambala Technologies answering a direct factual or operational question from the Founder.',
    'Answer the exact question directly using the verified live records below. You do NOT need to route a question to a department before answering it.',
    'Use counts and timestamps exactly as supplied. Distinguish CRM lead creation from contacting a prospect; distinguish messages to the Founder from messages sent to clients.',
    'If a fact is absent, say it is unavailable in the records. If the records show no client messages, say so plainly.',
    'Never invent work, approvals, messages, department activity, or system status.',
    'If the question actually requests a new action rather than information, explain the next responsible department and approval gate, but do not claim it has been performed.',
    'Founder question:', envelope.content.text,
    'Verified live organizational records:', JSON.stringify(verifiedRecords).slice(0, 14000),
    'Respond in clear, concise language. State relevant blockers and the next concrete action where useful.',
  ].join('\n\n');

  return askTambalaAI(
    'orchestrator',
    prompt,
    { communicationType: 'Founder factual question', sender: envelope.sender.name, recipient: 'Chief Executive Officer', messageId: envelope.message_id, verifiedRecords },
  );
}

async function handleFounderInstruction(envelope: FounderMessageEnvelope): Promise<string> {
  if (isCompanyStatusRequest(envelope.content.text)) {
    try { return await runCompanyStatusReport(envelope); }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'Status-report execution failed.';
      console.error('Founder status report could not be completed:', detail);
      const safeDetail = detail.replace(/(?:gsk_|sk-|Bearer\\s+)[A-Za-z0-9._-]{12,}/g, '[redacted]').slice(0, 240);
      return `I received your status-report instruction, but the coordinated report could not finish. Runtime issue: ${safeDetail}. The CEO workflow needs its task/runtime configuration checked.`;
    }
  }
  if (isFounderKnowledgeQuestion(envelope.content.text)) {
    try { return await answerFounderKnowledgeQuestion(envelope); }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'Founder question lookup failed.';
      console.error('Founder factual question could not be answered:', detail);
      return 'I received your question, but I could not retrieve the live company records needed to answer it. The lookup failed: ' + detail.slice(0, 220) + '. I will not guess.';
    }
  }
  try {
    const matches = await routeOrganizationObjective(envelope.content.text);
    const mapped = resolveExecutionRoute(matches[0]);
    const execution = mapped.status === 'ready'
      ? requireConfiguredRuntime(mapped, getAgentOperationalInfo(mapped.agent))
      : mapped;
    const companyContext = await getCompactCompanyContext().catch((error) => {
      console.warn('Verified company context unavailable to Founder workflow:', error instanceof Error ? error.message : error);
      return {
        company: { name: 'Tambala Technologies', country: 'Malawi', base: 'Lilongwe, Malawi', description: 'Software, websites, and digital products' },
        services: [],
        prospecting_defaults: {
          geographic_scope: 'Malawi-wide',
          market_approach: 'Cross-sector; qualify businesses against Tambala services rather than asking for a market type.',
          first_batch_target: 20,
          clarification_rule: 'Do not ask obvious scoping questions; use these defaults unless a genuine blocker remains.',
        },
      };
    });
    const routeSummary = matches.slice(0, 3).map((match) =>
      `${match.department ?? 'Unassigned'} — ${match.role ?? 'No role'} (score ${match.score}; role ${match.roleActivation ?? 'unknown'})`,
    ).join('\n') || 'No department capability matched. CEO must clarify ownership.';
    const envelopeText = JSON.stringify({
      ...envelope,
      routing: {
        assigned_by: 'capability_router',
        department: matches[0]?.department ?? null,
        capability_id: matches[0]?.capabilityId ?? null,
        role: matches[0]?.role ?? null,
        role_status: matches[0]?.roleActivation ?? null,
        execution_status: execution.status,
        execution_reason: execution.status === 'ready' ? null : execution.reason,
      },
    });
    const ceoBrief = await askTambalaAI(
      'orchestrator',
      `You are Tambala Technologies' CEO receiving a direct Founder instruction over WhatsApp. Treat the structured envelope as the source message, not as a customer request. Acknowledge it, interpret the objective, and prepare a precise department handoff where possible. Never claim a task is complete unless a specialist actually returned the deliverable. If the route is not activated or its runtime is not configured, explain the exact blocker and what is needed. Do not invent facts or approvals.\n\nVERIFIED TAMBALA OPERATING CONTEXT (company profile, active services and CRM exclusions):\n${JSON.stringify(companyContext).slice(0, 10000)}\n\nPROSPECTING DEFAULTS: When the objective is to identify potential clients, use Malawi-wide cross-sector prospecting, assess fit against Tambala's active services, default to 20 qualified prospects, infer reasonable decision-maker roles, and exclude existing CRM leads/clients. Do not ask the Founder to choose a market type, industry, company size, revenue range, job title, or batch size. Ask only if a genuine blocker cannot be resolved from company records or research.\n\nStructured message envelope:\n${envelopeText}\n\nDeterministic capability matches:\n${routeSummary}\n\nExecution gate:\n${JSON.stringify(execution)}`,
      { communicationType: 'Founder -> CEO', sender: envelope.sender.name, recipient: 'Chief Executive Officer', messageId: envelope.message_id, companyContext },
    );

    if (execution.status !== 'ready') {
      return `${ceoBrief}\n\nDepartment routing: ${execution.department ?? 'Unassigned'} — ${execution.status}. ${execution.reason}`;
    }

    const isProspecting = execution.capabilityId === 'sales_prospecting';
    const activeServices = Array.isArray(companyContext.services)
      ? (companyContext.services as Array<Record<string, unknown>>).filter((service) => service.active === true)
      : [];
    const prospectResearchQueries = buildProspectingSearchQueries(activeServices.map((service) => String(service.name ?? '')));
    const specialistTask = `CEO handoff from Founder WhatsApp instruction. Execute the actual task and return the requested deliverable. Use the CEO's interpretation below, but treat the original Founder instruction as authoritative if there is any conflict. Do not claim external actions, messages, payments, deployments, or database changes unless a connected tool has verifiably completed them. If required information or permissions are missing, state the blocker clearly.\n\nVERIFIED TAMBALA OPERATING CONTEXT:\n${JSON.stringify(companyContext).slice(0, 10000)}\n\nCEO handoff summary:\n${ceoBrief}\n\nFounder instruction:\n${envelope.content.text}\n\nDepartment: ${execution.department}\nRole: ${execution.role}\nDeliverable guidance: ${execution.deliverableHints.join('; ')}\nPriority: ${envelope.priority}${isProspecting ? '\n\nPROSPECTING EXECUTION RULES: Identify up to 20 new, qualified Malawi-wide business prospects across relevant sectors. Do not ask the Founder for a market type, industry, company size, revenue range, decision-maker title, or number. Use only verified active Tambala services to judge fit. Prioritize individual, named Malawian organisations, not generic directories, competitor websites, or industry summaries. Use directories only as discovery clues; do not list a directory as a prospect. A prospect can qualify when its existence and at least one plausible service-fit signal are supported by evidence. Do not require a source URL for every field: cite the source(s) that support each material claim, and mark unavailable fields unknown. Public contact and decision-maker details are helpful but optional; never invent them. Exclude all names in prospecting_defaults.excluded_existing_prospects. Return up to 20 candidates, ranked by evidence strength, with business name, location, sector, fit signal, current website if found, public contact if found, and source URLs. If the first source is a directory entry, retain it only as a discovery lead and clearly label it as directory-sourced unless corroborated by a company or credible independent source. Do not stop merely because contact names are unavailable.' : ''}`;
    const specialistContext = { communicationType: 'CEO -> Department', sender: 'Chief Executive Officer', recipient: execution.role, messageId: envelope.message_id, companyContext };
    let specialistResult: string;
    const requiresWebResearch = isProspecting || /\b(research|investigate|look\s*up|find|identify|web\s+search|search\s+online|current|latest|prospect|lead generation)\b/i.test(envelope.content.text);
    if (requiresWebResearch) {
      const researched = await askTambalaAIWithWebResearch(
        execution.agent,
        specialistTask,
        specialistContext,
        isProspecting ? prospectResearchQueries : execution.researchQuery,
        isProspecting ? { maxResults: 4, searchDepth: 'advanced', country: 'Malawi' } : { maxResults: 8, searchDepth: 'advanced' },
      );
      specialistResult = `${researched.response}\n\nVERIFIED WEB RESEARCH EVIDENCE:\n${researched.research}`;
    } else {
      specialistResult = await askTambalaAI(execution.agent, specialistTask, specialistContext);
    }
    return await askTambalaAI(
      'orchestrator',
      `Review the specialist's returned work against the original Founder instruction. Give the Founder a clear, useful answer. Distinguish completed analysis/drafting from any external action that still needs approval or a real integration. Do not invent execution.\n\nOriginal instruction:\n${envelope.content.text}\n\nDepartment: ${execution.department}\nSpecialist: ${execution.role}\n\nSpecialist return:\n${specialistResult}`,
      { communicationType: 'Department -> CEO -> Founder', sender: execution.role, recipient: 'Founder / Bless', messageId: envelope.message_id, companyContext },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'AI runtime unavailable.';
    console.error('Founder WhatsApp instruction could not be routed:', detail);
    const safeDetail = detail.replace(/(?:gsk_|sk-|Bearer\\s+)[A-Za-z0-9._-]{12,}/g, '[redacted]').slice(0, 240);
    return `I received your instruction, but the CEO workflow could not complete it. Runtime issue: ${safeDetail}. Please check the CEO and department runtime configuration; your message has been saved in the inbound message log.`;
  }
}

export function productionInboundDeps(store: MessageStore = messageStore()): InboundDeps {
  return {
    store, now: () => new Date(), founderNumber,
    instance: () => evolutionConfig()?.instance ?? null,
    reply: async (number, text) => { await sendText(number, text); },
    tellFounder: async (text) => {
      const to = founderNumber();
      if (!to) return;
      await queueMessage(productionOutboxDeps(store), { to, text, purpose: 'notify_founder', roleId: 'ceo', agent: 'orchestrator' });
      await runOutbox();
    },
    contactLookup: contactLabel,
    handleFounderInstruction,
    approvals: {
      pending: async () => (dbConfigured() ? (await listPendingApprovals()).map((a) => ({ id: a.id, summary: a.summary })) : []),
      async decide(prefix, decision, note) {
        if (!dbConfigured()) return { ok: false, message: 'The approval inbox needs the database.' };
        const match = (await listPendingApprovals()).filter((a) => a.id.toLowerCase().startsWith(prefix));
        if (match.length !== 1) return { ok: false, message: match.length ? 'That code matches more than one request. Use the dashboard.' : 'No pending request has that code. Send PENDING to list them.' };
        try {
          await decideApproval({ id: match[0].id, decision, note });
          return { ok: true, message: decision === 'approved' ? `Approved ${prefix}. It will be sent in the next window.` : `Rejected ${prefix}.` };
        } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Could not record that.' }; }
      },
    },
  };
}

export async function handleWebhook(payload: unknown): Promise<InboundSummary> {
  const summary = await handleEvolutionWebhook(productionInboundDeps(), payload);
  if (summary.optOuts || summary.founderCommands) await runOutbox();
  return summary;
}

export async function channelStatus() {
  const configured = evolutionConfigured();
  const store = messageStore();
  const dayStart = new Date(`${localTime(new Date()).date}T00:00:00+02:00`).toISOString();
  let state: string | null = null; let error: string | null = null;
  if (configured) { try { state = (await connectionState()).state; } catch (e) { error = e instanceof Error ? e.message.slice(0, 160) : 'Unreachable.'; } }
  const founder = founderNumber();
  return {
    configured, state, error, instance: evolutionConfig()?.instance ?? null,
    founderNumber: founder ? maskNumber(founder) : null, founderConfigured: Boolean(founder),
    webhookTokenSet: Boolean(process.env.EVOLUTION_WEBHOOK_TOKEN && process.env.EVOLUTION_WEBHOOK_TOKEN.length >= 16),
    webhookPath: '/webhooks/evolution',
    webhookEvent: 'MESSAGES_UPSERT',
    outboxWorker: {
      mode: process.env.TAMBALA_WHATSAPP_OUTBOX_SCHEDULER === 'true' ? 'in_process' : 'external_cron',
      schedulerTokenSet: Boolean(process.env.TAMBALA_SCHEDULER_TOKEN && process.env.TAMBALA_SCHEDULER_TOKEN.length >= 24),
      intervalMinutes: Math.max(1, Number(process.env.TAMBALA_WHATSAPP_OUTBOX_INTERVAL_MINUTES) || 1),
      endpoint: '/api/channels/outbox/run',
    },
    sentToday: { clients: await store.sentSince(dayStart, 'client').catch(() => 0), founder: await store.sentSince(dayStart, 'founder').catch(() => 0) },
    limits: { clients: CLIENT_DAILY_LIMIT(), founder: FOUNDER_DAILY_LIMIT() },
    blocked: (await store.blockedNumbers().catch(() => new Set<string>())).size,
  };
}
