import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { channelStatus, queueWhatsApp, runOutbox } from '../channels/service.js';
import { messageStore } from '../channels/message-store.js';
import { OutboxError } from '../channels/outbox.js';
import { createDocument, DocumentError } from '../documents/service.js';
import { documentStore } from '../documents/store.js';
import { toMinor } from '../documents/model.js';
import { createClientInvoice, InvoiceError, invoiceStore } from '../payments/invoices.js';
import { payHealth } from '../payments/tambala-pay.js';
import { dbConfigured } from '../organization/workforce/db-util.js';

const text = (value: unknown, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const party = z.object({ name: z.string().min(1).max(120), business: z.string().max(120).optional(), phone: z.string().max(30).optional(), email: z.string().max(254).optional(), address: z.string().max(200).optional() });

export function registerChannelTools(server: McpServer): void {
  server.registerTool('get_channel_status', {
    description: 'Check the WhatsApp channel (Evolution API): configured, connection state, Founder number set, messages sent today against the limits. Read-only.',
    inputSchema: {},
  }, async () => text(await channelStatus()));

  server.registerTool('list_whatsapp_messages', {
    description: 'List recent WhatsApp messages sent and received, with status (pending_approval, queued, sent, failed, rejected, blocked, received). Read-only.',
    inputSchema: { limit: z.number().int().min(1).max(50).optional().default(20) },
  }, async ({ limit }) => text((await messageStore().recent(limit ?? 20)).map((m) => ({ id: m.id, direction: m.direction, number: m.number, status: m.status, purpose: m.purpose, reason: m.reason, text: m.text.slice(0, 300), at: m.created_at }))));

  server.registerTool('send_whatsapp_message', {
    description: 'Queue a WhatsApp message to a customer or prospect. Customer messages are never sent immediately: they wait for the Founder\'s approval (dashboard, or reply YES <code> on WhatsApp), then go out inside the sending window. Opted-out numbers are refused.',
    inputSchema: { to: z.string().describe('Phone number, e.g. +265888123456 or 0888123456.'), text: z.string().min(2).max(1500), purpose: z.enum(['outreach', 'followup', 'reply']).default('followup') },
  }, async ({ to, text: body, purpose }) => {
    try { return text(await queueWhatsApp({ to, text: body, purpose, roleId: 'founder', agent: 'founder' })); }
    catch (error) { if (error instanceof OutboxError) return text({ error: error.message }, true); throw error; }
  });

  server.registerTool('create_document', {
    description: 'Create a numbered, signed PDF: a quotation, invoice, receipt or letter. Totals are computed by the system. Items reference the price list by sku, or are custom lines {description, quantity, unitPrice} that are flagged. Returns the document id and number; view it in the dashboard Documents page. It is not sent anywhere by this tool.',
    inputSchema: {
      kind: z.enum(['quotation', 'invoice', 'receipt', 'letter']), client: party,
      items: z.array(z.union([z.object({ sku: z.string(), quantity: z.number().positive().default(1) }), z.object({ description: z.string(), quantity: z.number().positive().default(1), unitPrice: z.number().min(0) })])).default([]),
      subject: z.string().max(160).optional(), body: z.string().max(4000).optional(), notes: z.string().max(1500).optional(), terms: z.string().max(2000).optional(),
      validityDays: z.number().int().min(1).max(365).optional(), paymentLink: z.string().url().optional(),
    },
  }, async (input) => {
    try { const d = await createDocument(input, 'founder'); return text({ id: d.id, number: d.number, totalMwk: d.total_minor / 100, customLines: d.hasCustomLines, signature: d.signature }); }
    catch (error) { if (error instanceof DocumentError) return text({ error: error.message }, true); throw error; }
  });

  server.registerTool('list_documents', { description: 'List recent generated documents (quotations, invoices, letters). Read-only.', inputSchema: {} },
    async () => text((await documentStore().list(30)).map((d) => ({ id: d.id, number: d.number, kind: d.kind, client: d.client_name, totalMwk: d.total_minor / 100, status: d.status, at: d.created_at }))));

  server.registerTool('list_price_list', { description: 'Read the price list that quotations draw from. Read-only.', inputSchema: {} },
    async () => text((await documentStore().prices()).map((p) => ({ sku: p.sku, name: p.name, unit: p.unit, priceMwk: p.unit_price_minor / 100, active: p.active }))));

  server.registerTool('set_price_list_item', {
    description: 'Add or change a price list item. Founder-only. Prices are in MWK.',
    inputSchema: { sku: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/), name: z.string().min(2).max(200), unit: z.string().max(30).default('each'), priceMwk: z.number().min(0).max(1_000_000_000), active: z.boolean().default(true) },
  }, async ({ sku, name, unit, priceMwk, active }) => {
    if (!dbConfigured()) return text({ error: 'Editing the price list needs the database.' }, true);
    await documentStore().savePrice({ sku, name, unit, unit_price_minor: toMinor(priceMwk), active });
    return text({ saved: sku });
  });

  server.registerTool('check_payment_system', {
    description: 'Check Tambala Pay: reachable, token accepted, response time, plus the most recent invoices created through this system with their payment links and last known status. Read-only.',
    inputSchema: {},
  }, async () => text({ health: await payHealth(), invoices: (await invoiceStore().recent(10)).map((i) => ({ client: i.client_name, amountMwk: i.amount_minor / 100, status: i.status, link: i.link, at: i.created_at })) }));

  server.registerTool('create_invoice_link', {
    description: 'Create an invoice and a hosted Tambala Pay checkout link for a client (once per client, description, amount and day). Founder-only. Returns the link; it does not message the client.',
    inputSchema: { client: party, description: z.string().min(3).max(180), amountMwk: z.number().positive().max(100_000_000) },
  }, async ({ client, description, amountMwk }) => {
    try {
      const { invoice, created } = await createClientInvoice({ roleId: 'founder', clientName: client.name, clientPhone: client.phone, clientEmail: client.email, description, amount: amountMwk });
      return text({ created, invoiceId: invoice.pay_invoice_id, link: invoice.link, status: invoice.status, note: invoice.link ? undefined : 'Tambala Pay returned no checkout link.' });
    } catch (error) { if (error instanceof InvoiceError) return text({ error: error.message }, true); return text({ error: error instanceof Error ? error.message : 'Failed.' }, true); }
  });

  server.registerTool('send_pending_messages', { description: 'Send any approved WhatsApp messages that are waiting for the sending window or retry. Safe to call repeatedly.', inputSchema: {} },
    async () => text({ results: await runOutbox() }));
}
