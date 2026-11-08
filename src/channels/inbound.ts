import { jidToNumber, maskNumber, normalizePhone } from './phone.js';
import { OPT_OUT_PATTERN } from './policy.js';
import type { MessageStore } from './message-store.js';

export interface InboundDeps {
  store: MessageStore;
  now: () => Date;
  founderNumber: () => string | null;
  instance: () => string | null;
  /** Direct reply on the wire (opt-out confirmations, help text). Never used for sales messages. */
  reply: (number: string, text: string) => Promise<void>;
  /** Message the Founder through the normal, signed, rate-limited path. */
  tellFounder: (text: string) => Promise<void>;
  contactLookup: (number: string) => Promise<string | null>;
  approvals: {
    pending: () => Promise<{ id: string; summary: string }[]>;
    decide: (idPrefix: string, decision: 'approved' | 'rejected', note: string) => Promise<{ ok: boolean; message: string }>;
  };
}

export interface InboundSummary { stored: number; duplicates: number; optOuts: number; founderCommands: number; forwarded: number; unresolved: number; ignored: number }

interface RawMessage { key?: { remoteJid?: unknown; remoteJidAlt?: unknown; fromMe?: unknown; id?: unknown; participant?: unknown }; pushName?: unknown; message?: Record<string, unknown>; senderPn?: unknown }

export function messageText(message: Record<string, unknown> | undefined): string {
  if (!message) return '';
  const ext = message.extendedTextMessage as { text?: unknown } | undefined;
  const image = message.imageMessage as { caption?: unknown } | undefined;
  const doc = message.documentMessage as { caption?: unknown } | undefined;
  const pick = [message.conversation, ext?.text, image?.caption, doc?.caption].find((v) => typeof v === 'string' && v.trim());
  return typeof pick === 'string' ? pick.trim().slice(0, 2000) : '';
}

/** Newer WhatsApp builds hide the phone behind an @lid id. Use the real number when Evolution supplies it. */
export function senderNumber(m: RawMessage): string | null {
  return jidToNumber(m.key?.remoteJid) ?? jidToNumber(m.key?.remoteJidAlt) ?? jidToNumber(m.senderPn) ?? normalizePhone(typeof m.senderPn === 'string' ? m.senderPn.replace(/@.*$/, '') : '');
}

const COMMAND_YES = /^\s*(yes|approve|ok)\s+([0-9a-f]{6})\s*$/i;
const COMMAND_NO = /^\s*(no|reject)\s+([0-9a-f]{6})\s*(.*)$/is;

export async function handleEvolutionWebhook(deps: InboundDeps, payload: unknown): Promise<InboundSummary> {
  const summary: InboundSummary = { stored: 0, duplicates: 0, optOuts: 0, founderCommands: 0, forwarded: 0, unresolved: 0, ignored: 0 };
  const body = payload as { event?: unknown; instance?: unknown; data?: unknown };
  const event = typeof body?.event === 'string' ? body.event.toLowerCase().replace(/_/g, '.') : '';
  if (event !== 'messages.upsert') { summary.ignored += 1; return summary; }
  const expected = deps.instance();
  if (expected && typeof body.instance === 'string' && body.instance !== expected) { summary.ignored += 1; return summary; }

  const items = (Array.isArray(body.data) ? body.data : [body.data]).filter(Boolean) as RawMessage[];
  const founder = deps.founderNumber();
  for (const m of items.slice(0, 20)) {
    if (m.key?.fromMe === true) { summary.ignored += 1; continue; } // our own outgoing echo
    const text = messageText(m.message);
    const providerId = typeof m.key?.id === 'string' ? m.key.id : null;
    if (!text) { summary.ignored += 1; continue; }
    if (providerId && (await deps.store.inboundByProviderId(providerId))) { summary.duplicates += 1; continue; }
    const number = senderNumber(m);
    const label = number ? await deps.contactLookup(number).catch(() => null) : null;
    const pushName = typeof m.pushName === 'string' ? m.pushName.slice(0, 60) : null;

    await deps.store.add({
      direction: 'in', number, audience: null, purpose: 'inbound', from_role_id: null, text, document_id: null, approval_id: null,
      status: 'received', reason: number ? null : 'WhatsApp did not reveal this sender’s phone number.', provider_message_id: providerId, attempts: 0,
      task_id: null, signature: null, contact_label: label ?? pushName, created_at: deps.now().toISOString(), sent_at: null,
    });
    summary.stored += 1;
    if (!number) { summary.unresolved += 1; continue; }

    if (OPT_OUT_PATTERN.test(text)) {
      await deps.store.addBlock(number, 'Customer replied STOP');
      await deps.reply(number, 'You have been unsubscribed and will not receive more messages from Tambala Technologies. Sorry to see you go.').catch(() => undefined);
      await deps.tellFounder(`${label ?? maskNumber(number)} replied STOP and has been added to the do-not-contact list.`).catch(() => undefined);
      summary.optOuts += 1; continue;
    }

    if (founder && number === founder) {
      const yes = text.match(COMMAND_YES); const no = text.match(COMMAND_NO);
      if (yes) { const r = await deps.approvals.decide(yes[2].toLowerCase(), 'approved', 'Approved by WhatsApp'); await deps.reply(number, r.message).catch(() => undefined); summary.founderCommands += 1; continue; }
      if (no) { const r = await deps.approvals.decide(no[2].toLowerCase(), 'rejected', no[3].trim() || 'Rejected by WhatsApp'); await deps.reply(number, r.message).catch(() => undefined); summary.founderCommands += 1; continue; }
      if (/^\s*(pending|list|status)\s*$/i.test(text)) {
        const list = await deps.approvals.pending();
        await deps.reply(number, list.length ? `${list.length} waiting:\n${list.slice(0, 8).map((a) => `${a.id.slice(0, 6)} · ${a.summary.slice(0, 70)}`).join('\n')}\n\nReply YES <code> or NO <code> <reason>.` : 'Nothing is waiting for you.').catch(() => undefined);
        summary.founderCommands += 1; continue;
      }
      await deps.reply(number, 'Commands: YES <code> to approve, NO <code> <reason> to reject, PENDING to list what is waiting.').catch(() => undefined);
      summary.founderCommands += 1; continue;
    }

    await deps.tellFounder(`Reply from ${label ?? pushName ?? maskNumber(number)}:\n"${text.slice(0, 400)}"`).catch(() => undefined);
    summary.forwarded += 1;
  }
  return summary;
}
