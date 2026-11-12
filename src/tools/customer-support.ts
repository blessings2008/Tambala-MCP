import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { queueWhatsApp } from '../channels/service.js';
import {
  addSupportTicketNote, createSupportTicket, customerSupportMetrics, getCustomerConversation,
  listCustomerConversations, listSupportTickets, ticketEvents, updateCustomerContact, updateSupportTicket,
} from '../customer-support/service.js';

const text = (value: unknown, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const phone = z.string().trim().min(8).max(30);

export function registerCustomerSupportTools(server: McpServer): void {
  server.registerTool('list_customer_conversations', {
    description: 'List recent WhatsApp customer conversations for Customer Relations. Includes contact match, last message, unread count, reply-needed state and opt-out status. Read-only.',
    inputSchema: { limit: z.number().int().min(1).max(100).default(40), search: z.string().trim().max(120).optional() },
  }, async ({ limit, search }) => text({ conversations: await listCustomerConversations(limit ?? 40, search) }));

  server.registerTool('get_customer_conversation', {
    description: 'Read a customer WhatsApp conversation and its linked customer profile and support tickets. Read-only.',
    inputSchema: { phone: phone, limit: z.number().int().min(1).max(200).default(100) },
  }, async ({ phone: number, limit }) => text(await getCustomerConversation(number, limit ?? 100)));

  server.registerTool('get_customer_support_metrics', {
    description: 'Read Customer Relations metrics: open/resolved tickets, conversations needing replies, priority breakdown, average response and resolution times. Read-only.',
    inputSchema: {},
  }, async () => text(await customerSupportMetrics()));

  server.registerTool('list_customer_support_tickets', {
    description: 'List Customer Relations support tickets with their customer profiles. Read-only.',
    inputSchema: {
      status: z.enum(['open', 'in_progress', 'waiting_customer', 'waiting_internal', 'resolved', 'closed']).optional(),
      limit: z.number().int().min(1).max(100).default(40),
    },
  }, async ({ status, limit }) => text({ tickets: await listSupportTickets(status, limit ?? 40) }));

  server.registerTool('get_customer_support_ticket_history', {
    description: 'Read the full event history for a support ticket. Read-only.',
    inputSchema: { ticket_id: z.string().uuid() },
  }, async ({ ticket_id }) => text({ events: await ticketEvents(ticket_id) }));

  server.registerTool('update_customer_contact', {
    description: 'Update a customer profile name, email, company or internal notes. Does not send messages.',
    inputSchema: {
      id: z.string().uuid(),
      display_name: z.string().trim().min(1).max(120).optional(),
      email: z.string().trim().email().max(254).optional(),
      company_name: z.string().trim().max(160).optional(),
      notes: z.string().trim().max(3000).optional(),
    },
  }, async (input) => text({ updated: await updateCustomerContact(input) }));

  server.registerTool('create_customer_support_ticket', {
    description: 'Create a trackable support ticket for a customer. Creates or matches the customer profile and assigns the ticket to Customer Relations. Does not contact the customer.',
    inputSchema: {
      phone,
      subject: z.string().trim().min(3).max(180),
      description: z.string().trim().min(1).max(5000),
      category: z.enum(['general', 'billing', 'technical', 'sales', 'complaint', 'other']).default('general'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
      source_channel: z.enum(['whatsapp', 'email', 'phone', 'website', 'manual', 'other']).default('whatsapp'),
    },
  }, async (input) => text({ created: await createSupportTicket(input) }));

  server.registerTool('update_customer_support_ticket', {
    description: 'Update a support ticket status, priority or assigned active organization role. Optional note is saved to the ticket timeline. Does not contact the customer.',
    inputSchema: {
      id: z.string().uuid(),
      status: z.enum(['open', 'in_progress', 'waiting_customer', 'waiting_internal', 'resolved', 'closed']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      assigned_role_id: z.string().trim().min(2).max(120).optional(),
      note: z.string().trim().max(3000).optional(),
    },
  }, async (input) => text({ updated: await updateSupportTicket(input) }));

  server.registerTool('add_customer_support_note', {
    description: 'Add an internal note to a support ticket timeline. The note is not sent to the customer.',
    inputSchema: { ticket_id: z.string().uuid(), note: z.string().trim().min(1).max(3000) },
  }, async ({ ticket_id, note }) => text(await addSupportTicketNote(ticket_id, note)));

  server.registerTool('prepare_customer_reply', {
    description: 'Prepare a WhatsApp reply for a customer and submit it to the existing Founder approval queue. It is NOT sent until approved. Opt-outs, blocked numbers, sending windows and cooldown rules remain enforced.',
    inputSchema: {
      phone,
      message: z.string().trim().min(2).max(1500),
      purpose: z.enum(['reply', 'followup']).default('reply'),
    },
  }, async ({ phone: number, message, purpose }) => {
    const conversation = await getCustomerConversation(number, 1);
    const contact = conversation.contact;
    if (contact?.do_not_contact) return text({ queued: false, blocked: true, reason: 'This customer is marked do-not-contact.' }, true);
    const result = await queueWhatsApp({
      roleId: 'director-customer-relations',
      agent: 'followup',
      to: number,
      text: message,
      purpose,
      contactLabel: contact?.display_name ?? contact?.company_name ?? undefined,
    });
    return text({ queued: result.status === 'pending_approval' || result.status === 'queued', blocked: result.status === 'blocked', result, approval_required: result.status === 'pending_approval', sent: false, note: result.status === 'blocked' ? (result.reason ?? 'The message was blocked by channel policy.') : 'No customer message has been sent. Founder approval is required before delivery.' }, result.status === 'blocked');
  });
}
