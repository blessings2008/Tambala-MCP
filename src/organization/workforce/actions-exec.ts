import { createClientInvoice, type InvoiceRow } from '../../payments/invoices.js';
import { OutboxError, queueMessage, type OutboxDeps } from '../../channels/outbox.js';
import { maskNumber } from '../../channels/phone.js';
import { formatMoney } from '../../documents/model.js';
import { DocumentError } from '../../documents/service.js';
import { InvoiceError } from '../../payments/invoices.js';
import { mayDo, type Action } from './actions.js';

export interface ActionResult { type: string; ok: boolean; detail: string }

export interface ActionExecDeps {
  outbox: OutboxDeps;
  founderNumber: () => string | null;
  createDocument: (input: unknown, roleId: string) => Promise<{ id: string; number: string; total_minor: number; hasCustomLines: boolean }>;
  createInvoice: (input: { roleId: string; clientName: string; clientPhone?: string; clientEmail?: string; description: string; amount: number }) => Promise<{ invoice: InvoiceRow; created: boolean }>;
}

export interface ActionContext { agent: string; roleId: string; taskId: string | null }

const fail = (type: string, detail: string): ActionResult => ({ type, ok: false, detail });

export async function executeActions(deps: ActionExecDeps, ctx: ActionContext, actions: Action[]): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const base = { roleId: ctx.roleId, agent: ctx.agent, taskId: ctx.taskId };
  const toFounder = async (text: string, documentId?: string) => {
    const to = deps.founderNumber();
    if (!to) return false;
    await queueMessage(deps.outbox, { ...base, to, text, purpose: documentId ? 'document' : 'notify_founder', documentId });
    return true;
  };

  for (const action of actions) {
    const denied = mayDo(ctx.agent, action);
    if (denied) { results.push(fail(action.type, denied)); continue; }
    try {
      if (action.type === 'notify_founder') {
        results.push((await toFounder(action.text)) ? { type: 'notify_founder', ok: true, detail: 'Message to the Founder queued.' } : fail('notify_founder', 'The Founder WhatsApp number is not configured (TAMBALA_FOUNDER_WHATSAPP).'));

      } else if (action.type === 'whatsapp') {
        const r = await queueMessage(deps.outbox, { ...base, to: action.to, text: action.text, purpose: action.purpose, contactLabel: action.contact ?? null });
        results.push(r.status === 'blocked' ? fail('whatsapp', `Not sent to ${maskNumber(action.to)}: ${r.reason}`) : { type: 'whatsapp', ok: true, detail: `Message to ${action.contact ?? maskNumber(action.to)} is waiting for the Founder's approval.` });

      } else if (action.type === 'document') {
        const doc = await deps.createDocument({ kind: action.kind, client: action.client, items: action.items, subject: action.subject, body: action.body, notes: action.notes, terms: action.terms, validityDays: action.validityDays }, ctx.roleId);
        const flag = doc.hasCustomLines ? ' (contains custom-priced lines for review)' : '';
        const review = await toFounder(`${doc.number} prepared for ${action.client.name} (${formatMoney(doc.total_minor)})${flag}. PDF attached for your review.`, doc.id);
        if (action.sendTo) {
          const r = await queueMessage(deps.outbox, { ...base, to: action.sendTo, purpose: 'document', documentId: doc.id, contactLabel: action.client.name, text: action.message ?? `Hello ${action.client.name}, please find your ${action.kind} ${doc.number} attached. Tambala Technologies.` });
          results.push(r.status === 'blocked' ? fail('document', `${doc.number} created, but not sent: ${r.reason}`) : { type: 'document', ok: true, detail: `${doc.number} created. Sending to ${action.client.name} awaits the Founder's approval.${flag}` });
        } else results.push({ type: 'document', ok: true, detail: `${doc.number} created${review ? ' and sent to the Founder' : ' (Founder WhatsApp number not configured, so find it in Documents)'}.${flag}` });

      } else if (action.type === 'invoice_link') {
        const { invoice, created } = await deps.createInvoice({ roleId: ctx.roleId, clientName: action.client.name, clientPhone: action.client.phone ?? action.sendTo, clientEmail: action.client.email, description: action.description, amount: action.amount });
        if (!invoice.link) { results.push(fail('invoice_link', `The invoice exists in Tambala Pay (${invoice.pay_invoice_id}) but Pay returned no checkout link, so there is nothing to send yet.`)); continue; }
        let documentId: string | undefined;
        if (action.withPdf) {
          const doc = await deps.createDocument({ kind: 'invoice', client: action.client, items: [{ description: action.description, quantity: 1, unitPrice: action.amount }], paymentLink: invoice.link, reference: invoice.pay_invoice_id }, ctx.roleId);
          documentId = doc.id;
        }
        const text = action.message ?? `Hello ${action.client.name}, here is your invoice for ${formatMoney(invoice.amount_minor)} (${action.description}). You can pay securely here: ${invoice.link}`;
        const note = created ? '' : ' (this invoice already existed today, so no duplicate was made)';
        if (action.sendTo) {
          const r = await queueMessage(deps.outbox, { ...base, to: action.sendTo, purpose: 'invoice', documentId, contactLabel: action.client.name, text });
          results.push(r.status === 'blocked' ? fail('invoice_link', `Link created, not sent: ${r.reason}`) : { type: 'invoice_link', ok: true, detail: `Payment link created. Sending to ${action.client.name} awaits the Founder's approval.${note}` });
        } else {
          await toFounder(`Payment link for ${action.client.name} (${formatMoney(invoice.amount_minor)}): ${invoice.link}`, documentId);
          results.push({ type: 'invoice_link', ok: true, detail: `Payment link created and sent to the Founder.${note}` });
        }
      }
    } catch (error) {
      const known = error instanceof OutboxError || error instanceof DocumentError || error instanceof InvoiceError;
      results.push(fail(action.type, known ? (error as Error).message : `Failed: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}`));
    }
  }
  return results;
}

export function describeResults(results: ActionResult[], rejected: string[]): string {
  const lines = results.map((r) => `${r.ok ? '✔' : '✘'} ${r.type}: ${r.detail}`);
  for (const r of rejected) lines.push(`✘ not understood: ${r}`);
  return lines.length ? `Actions:\n${lines.join('\n')}` : '';
}
