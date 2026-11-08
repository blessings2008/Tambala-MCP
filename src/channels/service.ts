import { supabaseSelect } from '../lib/supabase.js';
import { createApprovalRequest, decideApproval, listPendingApprovals, registerApprovalHook } from '../organization/workforce/approvals-service.js';
import { dbConfigured } from '../organization/workforce/db-util.js';
import { labelForRole } from '../organization/workforce/profiles.js';
import { routeOrganizationObjective } from '../organization/service.js';
import { requireConfiguredRuntime, resolveExecutionRoute } from '../organization/execution-router.js';
import { askTambalaAI, getAgentOperationalInfo } from '../services/ai.js';
import { signWork } from '../organization/workforce/sign-work.js';
import { loadPdfForSending } from '../documents/service.js';
import { connectionState, evolutionConfig, evolutionConfigured, sendDocument, sendText } from './evolution.js';
import { handleEvolutionWebhook, type FounderMessageEnvelope, type InboundDeps, type InboundSummary } from './inbound.js';
import { messageStore, type MessageStore } from './message-store.js';
import { onApprovalDecided, processOutbox, queueMessage, type OutboxDeps, type QueueInput, type QueueResult, type SendOutcome } from './outbox.js';
import { CLIENT_DAILY_LIMIT, FOUNDER_DAILY_LIMIT } from './policy.js';
import { maskNumber, normalizePhone } from './phone.js';
import { localTime } from '../organization/workforce/schedule.js';

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
    pauseMs: 4000,
  };
}

export const queueWhatsApp = (input: QueueInput): Promise<QueueResult> => queueMessage(productionOutboxDeps(), input);

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
  try {
    const matches = await routeOrganizationObjective(envelope.content.text);
    const mapped = resolveExecutionRoute(matches[0]);
    const execution = mapped.status === 'ready'
      ? requireConfiguredRuntime(mapped, getAgentOperationalInfo(mapped.agent))
      : mapped;
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
      `You are Tambala Technologies' CEO receiving a direct Founder instruction over WhatsApp. Treat the structured envelope as the source message, not as a customer request. Acknowledge it, interpret the objective, and prepare a precise department handoff where possible. Never claim a task is complete unless a specialist actually returned the deliverable. If the route is not activated or its runtime is not configured, explain the exact blocker and what is needed. Do not invent facts or approvals.\n\nStructured message envelope:\n${envelopeText}\n\nDeterministic capability matches:\n${routeSummary}\n\nExecution gate:\n${JSON.stringify(execution)}`,
      { communicationType: 'Founder -> CEO', sender: envelope.sender.name, recipient: 'Chief Executive Officer', messageId: envelope.message_id },
    );

    if (execution.status !== 'ready') {
      return `${ceoBrief}\n\nDepartment routing: ${execution.department ?? 'Unassigned'} — ${execution.status}. ${execution.reason}`;
    }

    const specialistResult = await askTambalaAI(
      execution.agent,
      `CEO handoff from Founder WhatsApp instruction. Execute the actual task and return the requested deliverable. Do not claim external actions, messages, payments, deployments, or database changes unless a connected tool has verifiably completed them. If required information or permissions are missing, state the blocker clearly.\n\nFounder instruction:\n${envelope.content.text}\n\nDepartment: ${execution.department}\nRole: ${execution.role}\nDeliverable guidance: ${execution.deliverableHints.join('; ')}\nPriority: ${envelope.priority}`,
      { communicationType: 'CEO -> Department', sender: 'Chief Executive Officer', recipient: execution.role, messageId: envelope.message_id },
    );
    return await askTambalaAI(
      'orchestrator',
      `Review the specialist's returned work against the original Founder instruction. Give the Founder a clear, useful answer. Distinguish completed analysis/drafting from any external action that still needs approval or a real integration. Do not invent execution.\n\nOriginal instruction:\n${envelope.content.text}\n\nDepartment: ${execution.department}\nSpecialist: ${execution.role}\n\nSpecialist return:\n${specialistResult}`,
      { communicationType: 'Department -> CEO -> Founder', sender: execution.role, recipient: 'Founder / Bless', messageId: envelope.message_id },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'AI runtime unavailable.';
    console.error('Founder WhatsApp instruction could not be routed:', detail);
    return `I received your instruction, but the CEO workflow could not complete it. Runtime issue: ${detail}. Please check the CEO and department runtime configuration; your message has been saved in the inbound message log.`;
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
      intervalMinutes: Math.max(1, Number(process.env.TAMBALA_WHATSAPP_OUTBOX_INTERVAL_MINUTES) || 1),
      endpoint: '/api/channels/outbox/run',
    },
    sentToday: { clients: await store.sentSince(dayStart, 'client').catch(() => 0), founder: await store.sentSince(dayStart, 'founder').catch(() => 0) },
    limits: { clients: CLIENT_DAILY_LIMIT(), founder: FOUNDER_DAILY_LIMIT() },
    blocked: (await store.blockedNumbers().catch(() => new Set<string>())).size,
  };
}
