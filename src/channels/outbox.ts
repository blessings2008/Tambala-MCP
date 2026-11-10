import { normalizePhone } from './phone.js';
import { EvolutionError } from './evolution.js';
import { CLIENT_DAILY_LIMIT, FOUNDER_DAILY_LIMIT, decide, sendWindowOpen, withOptOut, type Purpose } from './policy.js';
import type { MessageRow, MessageStore } from './message-store.js';
import { localTime } from '../organization/workforce/schedule.js';

export class OutboxError extends Error {}

export interface OutboxDeps {
  store: MessageStore;
  now: () => Date;
  founderNumber: () => string | null;
  transport: {
    configured: () => boolean;
    sendText: (number: string, text: string) => Promise<{ id: string | null }>;
    sendDocument: (number: string, base64: string, fileName: string, caption: string) => Promise<{ id: string | null }>;
  };
  loadDocument: (id: string) => Promise<{ base64: string; fileName: string } | null>;
  sign: (input: { roleId: string; kind: 'message'; subjectId: string; content: string }) => Promise<{ block: string; fingerprint: string | null }>;
  approvals: { create: (input: { actionType: string; summary: string; requestedByRoleId: string; riskLevel: 'low' | 'medium'; taskId: string | null; content: string; subjectType: string; subjectId: string }) => Promise<string | null> };
  senderLabel: (roleId: string) => string;
  /** Pause between customer sends, to look like a person rather than a script. Zero in tests. */
  pauseMs?: number;
  /** Minimum gap between customer sends, including across separate worker runs. */
  cooldownMs?: number;
  /** Resolves a normalized WhatsApp number to a CRM lead label; required for autonomous first contact. */
  verifyOutreachLead?: (number: string) => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
}

export interface QueueInput {
  to: string; text: string; purpose: Purpose; roleId: string; agent: string;
  documentId?: string | null; taskId?: string | null; contactLabel?: string | null;
  /** The Founder himself pressed send in the dashboard: no approval needed. Ignored for every other sender. */
  founderApproved?: boolean;
}
export interface QueueResult { id: string; status: MessageRow['status']; reason?: string; approvalId?: string | null }

/** Remove internal employee identities and workflow annotations from customer-facing copy. */
export function sanitizeCustomerMessage(value: string): string {
  const internalLine = /^\s*(?:by\s+(?:the\s+)?(?:ceo|chief executive officer|head of|director of)\b.*|(?:prepared|generated|drafted|sent)\s+by\b.*|(?:agent|role|employee|department|internal analysis|routing note|internal note|internal only|internal use only)\s*:\s*.*|(?:ceo|chief executive officer|head of [^|—–-]+|director of [^|—–-]+)\s*[|—–-]\s*TT[-\s]?\d{3}.*|(?:—|–|-{1,2})?\s*TT[-\s]?\d{3}\b.*)$/i;
  return value.split(/\r?\n/)
    .filter((line) => !internalLine.test(line))
    .map((line) => line.replace(/\bTT[-\s]?\d{3}\b/gi, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const dayStartIso = (now: Date): string => {
  const lt = localTime(now);
  return new Date(`${lt.date}T00:00:00+02:00`).toISOString(); // Africa/Blantyre is a fixed UTC+2
};

export async function queueMessage(deps: OutboxDeps, input: QueueInput): Promise<QueueResult> {
  const to = normalizePhone(input.to);
  if (!to) throw new OutboxError(`"${input.to}" is not a valid phone number. Use international format, e.g. +265888123456.`);
  const now = deps.now();
  const autonomousOutreach = input.purpose === 'outreach' && input.agent === 'outreach' && input.roleId === 'director-sales-business-development';
  let verifiedContactLabel = input.contactLabel?.trim() || null;
  const founder = deps.founderNumber();
  const blocked = await deps.store.blockedNumbers();
  const base = decide({ to, purpose: input.purpose, agent: input.agent, text: input.text, hasDocument: Boolean(input.documentId) }, { founderNumber: founder, blocked });
  if (base.audience === 'client' && autonomousOutreach && base.verdict !== 'block') {
    const crmLabel = await deps.verifyOutreachLead?.(to);
    if (!crmLabel || !/\(lead\)$/i.test(crmLabel)) {
      throw new OutboxError('Autonomous first-contact outreach requires a matching CRM lead with a verified WhatsApp number. No customer message was queued.');
    }
    verifiedContactLabel = crmLabel;
  }
  const customerCopy = base.audience === 'client' ? sanitizeCustomerMessage(input.text.trim()) : input.text.trim();
  if (base.audience === 'client' && customerCopy.length < 2) throw new OutboxError('The customer message contains no usable business content after internal notes were removed.');
  const text = base.audience === 'client' ? withOptOut(customerCopy, input.purpose) : customerCopy;

  const row = await deps.store.add({
    direction: 'out', number: to, audience: base.audience, purpose: input.purpose, from_role_id: input.roleId, text,
    document_id: input.documentId ?? null, approval_id: null, status: 'queued', reason: null, provider_message_id: null,
    attempts: 0, task_id: input.taskId ?? null, signature: null, contact_label: verifiedContactLabel, created_at: now.toISOString(), sent_at: null,
  });

  if (base.verdict === 'block') { await deps.store.update(row.id, { status: 'blocked', reason: base.reason }); return { id: row.id, status: 'blocked', reason: base.reason }; }
  if (base.audience === 'client') {
    if (await countSame(deps.store, row.id, to, text, new Date(now.getTime() - 24 * 3_600_000).toISOString())) {
      await deps.store.update(row.id, { status: 'blocked', reason: 'The same message was already prepared or sent to this number in the last 24 hours.' });
      return { id: row.id, status: 'blocked', reason: 'duplicate' };
    }
  }

  const stamp = await deps.sign({ roleId: input.roleId, kind: 'message', subjectId: row.id, content: `to ${to}${input.documentId ? ` +document ${input.documentId}` : ''}\n${text}` });
  const patch: Partial<MessageRow> = { signature: stamp.fingerprint };

  if (base.audience === 'founder') {
    // Messages to the Founder carry who sent them and their signature, so he knows exactly who is talking.
    patch.text = `[${deps.senderLabel(input.roleId)}]\n${text}\n\n${stamp.block}`;
    await deps.store.update(row.id, patch);
    return { id: row.id, status: 'queued' };
  }

  // Founder-authorized autonomous first contact: only Outreach may send, and only for a named CRM prospect.
  // Other customer-facing purposes remain behind the normal approval gate.
  if (base.audience === 'client' && autonomousOutreach && verifiedContactLabel) {
    await deps.store.update(row.id, { ...patch, status: 'queued', reason: null });
    return { id: row.id, status: 'queued' };
  }

  if (input.founderApproved && input.roleId === 'founder') {
    await deps.store.update(row.id, { ...patch, status: 'queued' });
    return { id: row.id, status: 'queued' };
  }

  const approvalId = await deps.approvals.create({
    actionType: 'whatsapp_message',
    summary: `WhatsApp ${input.purpose} to ${input.contactLabel ?? to}${input.documentId ? ' with a document' : ''}`,
    requestedByRoleId: input.roleId, riskLevel: input.purpose === 'outreach' ? 'medium' : 'low', taskId: input.taskId ?? null,
    content: `To: ${input.contactLabel ? `${input.contactLabel} ` : ''}${to}${input.documentId ? '\nAttachment: PDF document' : ''}\n\n${text}\n\n${stamp.block}`,
    subjectType: 'outbox_message', subjectId: row.id,
  }).catch(() => null);
  await deps.store.update(row.id, { ...patch, status: 'pending_approval', approval_id: approvalId, reason: approvalId ? null : 'Waiting for the approval inbox (needs the database).' });

  // Tell the Founder right away, so he can answer from his phone.
  if (approvalId && founder) {
    const code = approvalId.slice(0, 6);
    await queueMessage(deps, {
      to: founder, purpose: 'notify_founder', roleId: input.roleId, agent: input.agent, taskId: input.taskId ?? null,
      text: `Needs your OK: ${input.purpose} to ${input.contactLabel ?? to}.\n\n"${text.slice(0, 280)}${text.length > 280 ? '…' : ''}"\n\nReply YES ${code} to send, or NO ${code} <reason> to reject.`,
    }).catch(() => undefined);
  }
  return { id: row.id, status: 'pending_approval', approvalId };
}

/** Looks for an earlier identical message, ignoring the row we just added. */
async function countSame(store: MessageStore, selfId: string, to: string, text: string, sinceIso: string): Promise<boolean> {
  const rows = await store.recent(200);
  return rows.some((r) => r.id !== selfId && r.direction === 'out' && r.number === to && r.text === text && r.created_at >= sinceIso && ['pending_approval', 'queued', 'sent'].includes(r.status));
}

export async function onApprovalDecided(deps: OutboxDeps, messageId: string, decision: 'approved' | 'rejected', note: string | null): Promise<void> {
  const row = await deps.store.byId(messageId);
  if (!row || row.status !== 'pending_approval') return;
  if (decision === 'approved') await deps.store.update(messageId, { status: 'queued', reason: null });
  else await deps.store.update(messageId, { status: 'rejected', reason: note || 'Rejected by the Founder.' });
}

export interface SendOutcome { id: string; status: 'sent' | 'failed' | 'waiting' | 'blocked'; reason?: string }

/** Send what is queued, respecting the sending window, daily caps, opt-outs and retries. */
export async function processOutbox(deps: OutboxDeps, max = 10): Promise<SendOutcome[]> {
  const out: SendOutcome[] = [];
  const now = deps.now();
  const since = dayStartIso(now);
  const blocked = await deps.store.blockedNumbers();
  const counts = { client: await deps.store.sentSince(since, 'client'), founder: await deps.store.sentSince(since, 'founder') };
  let sentClient = 0;

  for (const row of await deps.store.queued(max)) {
    const wait = async (reason: string) => { await deps.store.update(row.id, { status: 'queued', claimed_at: null, reason }); out.push({ id: row.id, status: 'waiting', reason }); };
    if (!row.number) { await deps.store.update(row.id, { status: 'failed', claimed_at: null, reason: 'No destination number is available.' }); out.push({ id: row.id, status: 'failed', reason: 'No destination number is available.' }); continue; }
    if (!deps.transport.configured()) { await wait('WhatsApp is not configured yet.'); continue; }
    if (row.audience === 'client') {
      if (blocked.has(row.number)) { await deps.store.update(row.id, { status: 'blocked', claimed_at: null, reason: 'This number opted out before the message was sent.' }); out.push({ id: row.id, status: 'blocked' }); continue; }
      if (!sendWindowOpen(now)) { await wait('Outside the sending window (Mon-Sat 07:30-19:30). It will go out when the window opens.'); continue; }
      const cooldownMs = Math.max(0, deps.cooldownMs ?? deps.pauseMs ?? 0);
      if (cooldownMs > 0) {
        const latest = (await deps.store.recent(200)).find((message) => message.direction === 'out' && message.audience === 'client' && message.status === 'sent' && message.sent_at);
        const sentAt = latest?.sent_at ? new Date(latest.sent_at).getTime() : 0;
        const remaining = sentAt ? cooldownMs - (now.getTime() - sentAt) : 0;
        if (remaining > 0) { await wait(`Customer-send cooldown active. Try again in about ${Math.ceil(remaining / 1000)} seconds.`); continue; }
      }
      if (counts.client >= CLIENT_DAILY_LIMIT()) { await wait(`Daily customer limit of ${CLIENT_DAILY_LIMIT()} reached. It will go out tomorrow.`); continue; }
    } else if (counts.founder >= FOUNDER_DAILY_LIMIT()) { await wait('Daily limit of messages to the Founder reached.'); continue; }

    try {
      if (row.audience === 'client' && sentClient > 0 && deps.pauseMs) await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(deps.pauseMs);
      let result: { id: string | null };
      if (row.document_id) {
        const doc = await deps.loadDocument(row.document_id);
        if (!doc) throw new EvolutionError('The attached document could not be found.', false);
        result = await deps.transport.sendDocument(row.number, doc.base64, doc.fileName, row.text);
      } else result = await deps.transport.sendText(row.number, row.text);
      await deps.store.update(row.id, { status: 'sent', claimed_at: null, provider_message_id: result.id, sent_at: deps.now().toISOString(), attempts: row.attempts + 1, reason: null });
      if (row.audience === 'client') { counts.client += 1; sentClient += 1; } else counts.founder += 1;
      out.push({ id: row.id, status: 'sent' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Send failed.';
      const retryable = error instanceof EvolutionError ? error.retryable : false;
      const attempts = row.attempts + 1;
      const final = !retryable || attempts >= 3;
      await deps.store.update(row.id, { attempts, status: final ? 'failed' : 'queued', claimed_at: null, reason: message.slice(0, 300) });
      out.push({ id: row.id, status: final ? 'failed' : 'waiting', reason: message });
    }
  }
  return out;
}
