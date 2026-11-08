import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';

import { payBaseUrl as baseUrl, payRequest } from '../payments/tambala-pay.js';

function result(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }; }
const money = z.number().finite().positive().max(100000000);
const email = z.string().email().max(254);
const description = z.string().trim().min(1).max(180);
const customerName = z.string().trim().max(100).optional();

export function registerTambalaPayTools(server: McpServer): void {
  server.registerTool('tambala_pay_health', {
    description: 'Check Tambala Pay service availability and integration configuration. Does not expose credentials.',
    inputSchema: {},
  }, async () => {
    const data = await payRequest('/api/health');
    return result({ ...data, integration: 'configured', base_url: baseUrl() });
  });

  server.registerTool('tambala_pay_list_invoices', {
    description: 'List recent Tambala Pay invoices (up to 250). Use for finance operations and invoice reconciliation.',
    inputSchema: {},
  }, async () => result(await payRequest('/api/invoices')));

  server.registerTool('tambala_pay_get_invoice', {
    description: 'Retrieve a Tambala Pay invoice and its payment attempts by invoice ID.',
    inputSchema: { invoice_id: z.string().trim().min(1).max(120) },
  }, async ({ invoice_id }) => result(await payRequest(`/api/invoices/${encodeURIComponent(invoice_id)}`)));

  server.registerTool('tambala_pay_create_invoice', {
    description: 'Create a Tambala Pay invoice. Autonomous finance agents may create invoices from verified client/project records. This creates an invoice only; it does not debit anyone or transfer funds.',
    inputSchema: {
      description,
      totalAmount: money,
      customerName,
      customerEmail: email.optional(),
    },
  }, async (input) => result(await payRequest('/api/invoices', { method: 'POST', body: JSON.stringify(input) })));

  server.registerTool('tambala_pay_create_invoice_payment', {
    description: 'Create a payment attempt and hosted checkout link for an existing invoice. Amount must not exceed the available invoice balance. This requests payment from the customer; it does not move funds out of Tambala.',
    inputSchema: { invoice_id: z.string().trim().min(1).max(120), amount: money },
  }, async ({ invoice_id, amount }) => result(await payRequest(`/api/invoices/${encodeURIComponent(invoice_id)}/payments`, { method: 'POST', body: JSON.stringify({ amount }) })));

  server.registerTool('tambala_pay_get_payment', {
    description: 'Look up a payment by its exact transaction reference. A pending state is not proof of payment; rely on server-verified status.',
    inputSchema: { tx_ref: z.string().trim().min(1).max(80) },
  }, async ({ tx_ref }) => result(await payRequest(`/api/payments/${encodeURIComponent(tx_ref)}`)));

  server.registerTool('tambala_pay_summary', {
    description: 'Get aggregate payment totals and counts in MWK, including collected and pending amounts.',
    inputSchema: {},
  }, async () => result(await payRequest('/api/summary')));

  server.registerTool('tambala_pay_list_payment_requests', {
    description: 'List recent one-off Tambala Pay payment requests.',
    inputSchema: { limit: z.number().int().min(1).max(250).optional() },
  }, async ({ limit }) => result(await payRequest(`/api/requests${limit ? `?limit=${limit}` : ''}`)));

  server.registerTool('tambala_pay_create_payment_request', {
    description: 'Create a one-off customer payment request with hosted checkout details. Agents may do this for verified, authorized business charges. This is an incoming customer payment request, not an outgoing transfer.',
    inputSchema: { description, amount: money, customerName, customerEmail: email.optional() },
  }, async (input) => result(await payRequest('/api/requests', { method: 'POST', body: JSON.stringify(input) })));

  server.registerTool('tambala_pay_get_payment_request_receipt', {
    description: 'Retrieve the receipt for a one-off payment request. Receipts are only available after payment is verified as paid.',
    inputSchema: { request_id: z.string().trim().min(1).max(120) },
  }, async ({ request_id }) => result(await payRequest(`/api/requests/${encodeURIComponent(request_id)}/receipt`)));

  server.registerTool('tambala_pay_get_invoice_payment_receipt', {
    description: 'Retrieve the receipt for a verified invoice payment.',
    inputSchema: { payment_id: z.string().trim().min(1).max(120) },
  }, async ({ payment_id }) => result(await payRequest(`/api/invoice-payments/${encodeURIComponent(payment_id)}/receipt`)));
}
