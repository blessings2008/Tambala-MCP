import { supabaseSelect } from '../lib/supabase.js';
import { createApprovalRequest, decideApproval, listPendingApprovals, registerApprovalHook } from '../organization/workforce/approvals-service.js';
import { dbConfigured } from '../organization/workforce/db-util.js';
import { labelForRole } from '../organization/workforce/profiles.js';
import { routeOrganizationObjective } from '../organization/service.js';
import { requireConfiguredRuntime, resolveExecutionRoute } from '../organization/execution-router.js';
import { askTambalaAI, askTambalaAIWithWebResearch, getAgentOperationalInfo } from '../services/ai.js';
import { getVerifiedCompanyContext } from '../services/ai/context.js';
import { signWork } from '../organization/workforce/sign-work.js';
import { loadPdfForSending } from '../documents/service.js';
import { connectionState, evolutionConfig, evolutionConfigured, sendDocument, sendText } from './evolution.js';
import { handleEvolutionWebhook, type FounderMessageEnvelope, type InboundDeps, type InboundSummary } from './inbound.js';
import { messageStore, type MessageStore } from './message-store.js';
import { onApprovalDecided, processOutbox, queueMessage, type OutboxDeps, type QueueInput, type QueueResult, type SendOutcome } from './outbox.js';
import { CLIENT_DAILY_LIMIT, FOUNDER_DAILY_LIMIT } from './policy.js';
import { maskNumber, normalizePhone } from './phone.js';
import { localTime } from '../organization/workforce/schedule.js';
import { isCompanyStatusRequest, runCompanyStatusReport } from './founder-execution.js';

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
  try {
    const matches = await routeOrganizationObjective(envelope.content.text);
    const mapped = resolveExecutionRoute(matches[0]);
    const execution = mapped.status === 'ready'
      ? requireConfiguredRuntime(mapped, getAgentOperationalInfo(mapped.agent))
      : mapped;
    const companyContext = await getVerifiedCompanyContext().catch((error) => {
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
      `You are Tambala Technologies' CEO receiving a direct Founder instruction over WhatsApp. Treat the structured envelope as the source message, not as a customer request. Acknowledge it, interpret the objective, and prepare a precise department handoff where possible. Never claim a task is complete unless a specialist actually returned the deliverable. If the route is not activated or its runtime is not configured, explain the exact blocker and what is needed. Do not invent facts or approvals.\n\nVERIFIED TAMBALA OPERATING CONTEXT (company profile, active services, products and CRM exclusions):\n${JSON.stringify(companyContext).slice(0, 10000)}\n\nPROSPECTING DEFAULTS: When the objective is to identify potential clients, use Malawi-wide cross-sector prospecting, assess fit against Tambala's active services, default to 20 qualified prospects, infer reasonable decision-maker roles, and exclude existing CRM leads/clients. Do not ask the Founder to choose a market type, industry, company size, revenue range, job title, or batch size. Ask only if a genuine blocker cannot be resolved from company records or research.\n\nStructured message envelope:\n${envelopeText}\n\nDeterministic capability matches:\n${routeSummary}\n\nExecution gate:\n${JSON.stringify(execution)}`,
      { communicationType: 'Founder -> CEO', sender: envelope.sender.name, recipient: 'Chief Executive Officer', messageId: envelope.message_id, companyContext },
    );

    if (execution.status !== 'ready') {
      return `${ceoBrief}\n\nDepartment routing: ${execution.department ?? 'Unassigned'} — ${execution.status}. ${execution.reason}`;
    }

    const isProspecting = execution.capabilityId === 'sales_prospecting';
    const activeServices = Array.isArray(companyContext.services)
      ? (companyContext.services as Array<Record<string, unknown>>).filter((service) => service.active === true)
      : [];
    const serviceSearchTerms = activeServices
      .map((service) => [service.name, service.description].filter(Boolean).join(': '))
      .join('; ');
    const prospectResearchQuery = `Malawi businesses and organizations that may need ${serviceSearchTerms || 'websites, web applications, custom software, or digital products'}; official business websites, public contact details, and decision makers`.slice(0, 300);
    const specialistTask = `CEO handoff from Founder WhatsApp instruction. Execute the actual task and return the requested deliverable. Use the CEO's interpretation below, but treat the original Founder instruction as authoritative if there is any conflict. Do not claim external actions, messages, payments, deployments, or database changes unless a connected tool has verifiably completed them. If required information or permissions are missing, state the blocker clearly.\n\nVERIFIED TAMBALA OPERATING CONTEXT:\n${JSON.stringify(companyContext).slice(0, 10000)}\n\nCEO handoff summary:\n${ceoBrief}\n\nFounder instruction:\n${envelope.content.text}\n\nDepartment: ${execution.department}\nRole: ${execution.role}\nDeliverable guidance: ${execution.deliverableHints.join('; ')}\nPriority: ${envelope.priority}${isProspecting ? '\n\nPROSPECTING EXECUTION RULES: Identify up to 20 new, qualified Malawi-wide business prospects across relevant sectors. Do not ask the Founder for a market type, industry, company size, revenue range, decision-maker title, or number. Use only verified active Tambala services to judge fit. Prioritize organizations with an evidenced need for websites/web applications, custom software, digital products, or other active services. Exclude all names in prospecting_defaults.excluded_existing_prospects. For each prospect provide business name, location, sector, why it fits, public decision-maker/contact details only when verified, and exact source URLs. Do not invent missing contacts. If evidence supports fewer than 20, return only the qualified prospects and explain the evidence gap.' : ''}`;
    const specialistContext = { communicationType: 'CEO -> Department', sender: 'Chief Executive Officer', recipient: execution.role, messageId: envelope.message_id, companyContext };
    let specialistResult: string;
    const requiresWebResearch = isProspecting || /\\b(research|investigate|look\\s*up|find|identify|web\\s+search|search\\s+online|current|latest|prospect|lead generation)\\b/i.test(envelope.content.text);
    if (requiresWebResearch) {
      const researched = await askTambalaAIWithWebResearch(
        execution.agent,
        specialistTask,
        specialistContext,
        isProspecting ? prospectResearchQuery : execution.researchQuery,
        isProspecting ? { maxResults: 20, searchDepth: 'advanced', country: 'Malawi' } : { maxResults: 8, searchDepth: 'advanced' },
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
