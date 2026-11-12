import { getById, insertRow, supabaseSelect, updateRow } from '../lib/database.js';
import { normalizePhone, maskNumber } from '../channels/phone.js';

type DbRow = Record<string, unknown>;
type ContactType = 'unknown' | 'prospect' | 'client' | 'other';
export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'waiting_internal' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketCategory = 'general' | 'billing' | 'technical' | 'sales' | 'complaint' | 'other';

export interface CustomerContact extends DbRow {
  id: string; phone: string; display_name: string | null; email: string | null; company_name: string | null;
  contact_type: ContactType; client_id: string | null; lead_id: string | null; notes: string | null;
  do_not_contact: boolean; first_seen_at: string; last_seen_at: string;
}
export interface SupportTicket extends DbRow {
  id: string; contact_id: string; subject: string; description: string; category: TicketCategory;
  priority: TicketPriority; status: TicketStatus; assigned_role_id: string; source_channel: string;
  first_response_at: string | null; last_activity_at: string; resolved_at: string | null; closed_at: string | null;
  created_by_role_id: string; created_at: string; updated_at: string;
}
export interface ConversationMessage extends DbRow {
  id: string; direction: 'in' | 'out'; number: string | null; text: string; status: string;
  purpose: string; contact_label: string | null; created_at: string; sent_at: string | null;
}
const nowIso = () => new Date().toISOString();
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const activeStatuses = ['open', 'in_progress', 'waiting_customer', 'waiting_internal'];

export async function syncCustomerContact(phoneInput: string, displayName?: string | null, contactLabel?: string | null): Promise<CustomerContact | null> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return null;
  const [existing, clients, leads] = await Promise.all([
    supabaseSelect<CustomerContact>('customer_service_contacts', { select: '*', phone: `eq.${phone}`, limit: '1' }),
    supabaseSelect<DbRow>('clients', { select: 'id,name,business_name,email,phone,whatsapp', limit: '2000' }),
    supabaseSelect<DbRow>('leads', { select: 'id,name,business_name,email,phone,whatsapp', limit: '2000' }),
  ]);
  const matches = (row: DbRow) => [row.phone, row.whatsapp].some((value) => normalizePhone(value) === phone);
  const client = clients.find(matches);
  const lead = client ? undefined : leads.find(matches);
  const crmName = clean(client?.business_name || client?.name || lead?.business_name || lead?.name);
  const suppliedName = clean(displayName) || clean(contactLabel);
  const name = crmName || suppliedName || null;
  const patch: Record<string, unknown> = {
    ...(name ? { display_name: name } : {}),
    ...(clean(client?.business_name || lead?.business_name) ? { company_name: clean(client?.business_name || lead?.business_name) } : {}),
    ...(clean(client?.email || lead?.email) ? { email: clean(client?.email || lead?.email) } : {}),
    ...(client ? { contact_type: 'client', client_id: client.id, lead_id: null } : lead ? { contact_type: 'prospect', lead_id: lead.id, client_id: null } : {}),
    last_seen_at: nowIso(),
  };
  if (existing[0]) return updateRow<CustomerContact>('customer_service_contacts', existing[0].id, patch);
  return insertRow<CustomerContact>('customer_service_contacts', {
    phone, display_name: name, email: clean(client?.email || lead?.email) || null,
    company_name: clean(client?.business_name || lead?.business_name) || null,
    contact_type: client ? 'client' : lead ? 'prospect' : 'unknown',
    client_id: client?.id ?? null, lead_id: lead?.id ?? null, notes: null, do_not_contact: false,
    first_seen_at: nowIso(), last_seen_at: nowIso(),
  });
}

export async function markCustomerDoNotContact(phoneInput: string): Promise<void> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return;
  const rows = await supabaseSelect<CustomerContact>('customer_service_contacts', { select: 'id', phone: `eq.${phone}`, limit: '1' });
  if (rows[0]) await updateRow<CustomerContact>('customer_service_contacts', rows[0].id, { do_not_contact: true, last_seen_at: nowIso() });
}

export async function updateCustomerContact(input: {
  id: string; display_name?: string; email?: string; company_name?: string; notes?: string;
}): Promise<CustomerContact> {
  const current = await getById<CustomerContact>('customer_service_contacts', input.id);
  if (!current) throw new Error('Customer contact not found.');
  const patch: Record<string, unknown> = {};
  for (const key of ['display_name', 'email', 'company_name', 'notes'] as const) {
    if (input[key] !== undefined) patch[key] = input[key]?.trim() || null;
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new Error('Enter a valid email address.');
  if (!Object.keys(patch).length) throw new Error('Provide at least one contact field to update.');
  return updateRow<CustomerContact>('customer_service_contacts', current.id, patch);
}

export async function listCustomerConversations(limit = 50, search?: string) {
  const [messages, contacts, blocks] = await Promise.all([
    supabaseSelect<ConversationMessage>('organization_messages', { select: 'id,direction,number,text,status,purpose,contact_label,created_at,sent_at', order: 'created_at.desc', limit: '500' }),
    supabaseSelect<CustomerContact>('customer_service_contacts', { select: '*', order: 'last_seen_at.desc', limit: '1500' }),
    supabaseSelect<DbRow>('organization_contact_blocks', { select: 'number', limit: '5000' }),
  ]);
  const contactByPhone = new Map(contacts.map((contact) => [contact.phone, contact]));
  const blocked = new Set(blocks.map((row) => String(row.number)));
  const grouped = new Map<string, ConversationMessage[]>();
  for (const message of messages) {
    const key = message.number ?? `unknown:${message.id}`;
    const group = grouped.get(key) ?? [];
    group.push(message); grouped.set(key, group);
  }
  const needle = clean(search).toLowerCase();
  return [...grouped.entries()].map(([key, rows]) => {
    const latest = rows[0];
    const phone = latest.number;
    const contact = phone ? contactByPhone.get(phone) ?? null : null;
    const lastOutboundAt = rows.find((row) => row.direction === 'out')?.created_at ?? null;
    const unreadCount = rows.filter((row) => row.direction === 'in' && (!lastOutboundAt || row.created_at > lastOutboundAt)).length;
    const label = contact?.display_name || latest.contact_label || (phone ? maskNumber(phone) : 'Unknown WhatsApp sender');
    return {
      key, phone, contact, contact_name: label, company_name: contact?.company_name ?? null,
      last_message: latest.text.slice(0, 500), last_message_at: latest.created_at,
      last_direction: latest.direction, message_count: rows.length, unread_count: unreadCount,
      needs_reply: latest.direction === 'in', blocked: Boolean(phone && (blocked.has(phone) || contact?.do_not_contact)),
      channel: 'whatsapp' as const,
    };
  }).filter((row) => !needle || [row.contact_name, row.company_name, row.phone, row.last_message].some((v) => String(v ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at)).slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function getCustomerConversation(phoneInput: string, limit = 100) {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error('Enter a valid WhatsApp phone number.');
  const [messages, contacts, tickets] = await Promise.all([
    supabaseSelect<ConversationMessage>('organization_messages', { select: 'id,direction,number,text,status,purpose,contact_label,created_at,sent_at', number: `eq.${phone}`, order: 'created_at.desc', limit: String(Math.max(1, Math.min(limit, 200))) }),
    supabaseSelect<CustomerContact>('customer_service_contacts', { select: '*', phone: `eq.${phone}`, limit: '1' }),
    supabaseSelect<SupportTicket>('customer_service_tickets', { select: '*', order: 'created_at.desc', limit: '100' }),
  ]);
  const contact = contacts[0] ?? null;
  const contactTickets = contact ? tickets.filter((ticket) => ticket.contact_id === contact.id) : [];
  return { phone, contact, messages: messages.reverse(), tickets: contactTickets };
}

export async function createSupportTicket(input: {
  phone: string; subject: string; description: string; category?: TicketCategory; priority?: TicketPriority;
  source_channel?: string; actor_role_id?: string;
}): Promise<SupportTicket> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error('A valid customer phone number is required.');
  const subject = input.subject.trim(); const description = input.description.trim();
  if (subject.length < 3 || subject.length > 180) throw new Error('Ticket subject must be 3–180 characters.');
  if (!description || description.length > 5000) throw new Error('Ticket description must be 1–5,000 characters.');
  const contact = await syncCustomerContact(phone);
  if (!contact) throw new Error('Could not create or find the customer profile.');
  const actor = input.actor_role_id ?? 'director-customer-relations';
  const ticket = await insertRow<SupportTicket>('customer_service_tickets', {
    contact_id: contact.id, subject, description, category: input.category ?? 'general',
    priority: input.priority ?? 'normal', status: 'open', assigned_role_id: 'director-customer-relations',
    source_channel: input.source_channel ?? 'whatsapp', first_response_at: null, last_activity_at: nowIso(),
    resolved_at: null, closed_at: null, created_by_role_id: actor,
  });
  await insertRow('customer_service_ticket_events', {
    ticket_id: ticket.id, event_type: 'created', actor_role_id: actor,
    body: 'Support ticket created.', metadata: { source_channel: ticket.source_channel },
  });
  return ticket;
}

export async function updateSupportTicket(input: {
  id: string; status?: TicketStatus; priority?: TicketPriority; assigned_role_id?: string; note?: string; actor_role_id?: string;
}): Promise<SupportTicket> {
  const current = await getById<SupportTicket>('customer_service_tickets', input.id);
  if (!current) throw new Error('Support ticket not found.');
  const actor = input.actor_role_id ?? 'director-customer-relations';
  const patch: Record<string, unknown> = { last_activity_at: nowIso() };
  const events: { event_type: string; body: string; metadata: Record<string, unknown> }[] = [];
  if (input.status && input.status !== current.status) {
    patch.status = input.status;
    if (input.status === 'resolved') { patch.resolved_at = nowIso(); patch.closed_at = null; }
    else if (input.status === 'closed') { patch.closed_at = nowIso(); patch.resolved_at = current.resolved_at ?? nowIso(); }
    else if (input.status === 'waiting_customer' && !current.first_response_at) { patch.first_response_at = nowIso(); }
    else if (current.status === 'resolved' || current.status === 'closed') { patch.resolved_at = null; patch.closed_at = null; }
    events.push({ event_type: input.status === 'resolved' ? 'resolved' : (current.status === 'resolved' || current.status === 'closed') ? 'reopened' : 'status_changed', body: `Status changed from ${current.status} to ${input.status}.`, metadata: { from: current.status, to: input.status } });
  }
  if (input.priority && input.priority !== current.priority) {
    patch.priority = input.priority;
    events.push({ event_type: 'priority_changed', body: `Priority changed from ${current.priority} to ${input.priority}.`, metadata: { from: current.priority, to: input.priority } });
  }
  if (input.assigned_role_id && input.assigned_role_id !== current.assigned_role_id) {
    const roles = await supabaseSelect<DbRow>('organization_roles', { select: 'id,activation', id: `eq.${input.assigned_role_id}`, limit: '1' });
    if (!roles[0] || roles[0].activation !== 'active') throw new Error('The assigned role does not exist or is not active.');
    patch.assigned_role_id = input.assigned_role_id;
    events.push({ event_type: 'assigned', body: `Ticket assigned to ${input.assigned_role_id}.`, metadata: { from: current.assigned_role_id, to: input.assigned_role_id } });
  }
  const note = clean(input.note);
  if (note) events.push({ event_type: 'note', body: note, metadata: {} });
  if (Object.keys(patch).length === 1 && !events.length) throw new Error('No ticket changes were supplied.');
  const updated = await updateRow<SupportTicket>('customer_service_tickets', current.id, patch);
  for (const event of events) await insertRow('customer_service_ticket_events', { ticket_id: current.id, event_type: event.event_type, actor_role_id: actor, body: event.body, metadata: event.metadata });
  return updated;
}

export async function addSupportTicketNote(id: string, bodyInput: string, actor = 'director-customer-relations') {
  const body = bodyInput.trim();
  if (!body || body.length > 3000) throw new Error('A note of 1–3,000 characters is required.');
  const ticket = await getById<SupportTicket>('customer_service_tickets', id);
  if (!ticket) throw new Error('Support ticket not found.');
  await insertRow('customer_service_ticket_events', { ticket_id: id, event_type: 'note', actor_role_id: actor, body, metadata: {} });
  return { saved: true, ticket_id: id };
}

export async function listSupportTickets(status?: TicketStatus, limit = 50) {
  const params: Record<string, string> = { select: '*', order: 'last_activity_at.desc', limit: String(Math.max(1, Math.min(limit, 100))) };
  if (status) params.status = `eq.${status}`;
  const [tickets, contacts] = await Promise.all([
    supabaseSelect<SupportTicket>('customer_service_tickets', params),
    supabaseSelect<CustomerContact>('customer_service_contacts', { select: '*', limit: '1500' }),
  ]);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  return tickets.map((ticket) => ({ ...ticket, contact: contactById.get(ticket.contact_id) ?? null }));
}

export async function customerSupportMetrics() {
  const [tickets, conversations] = await Promise.all([
    supabaseSelect<SupportTicket>('customer_service_tickets', { select: 'id,status,priority,created_at,first_response_at,resolved_at', order: 'created_at.desc', limit: '1000' }),
    listCustomerConversations(100),
  ]);
  const byStatus = tickets.reduce<Record<string, number>>((acc, ticket) => { acc[ticket.status] = (acc[ticket.status] ?? 0) + 1; return acc; }, {});
  const byPriority = tickets.reduce<Record<string, number>>((acc, ticket) => { acc[ticket.priority] = (acc[ticket.priority] ?? 0) + 1; return acc; }, {});
  const responseMinutes = tickets.filter((ticket) => ticket.first_response_at).map((ticket) => (Date.parse(ticket.first_response_at!) - Date.parse(ticket.created_at)) / 60000).filter((n) => Number.isFinite(n) && n >= 0);
  const resolved = tickets.filter((ticket) => ticket.resolved_at);
  const resolutionMinutes = resolved.map((ticket) => (Date.parse(ticket.resolved_at!) - Date.parse(ticket.created_at)) / 60000).filter((n) => Number.isFinite(n) && n >= 0);
  const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  return {
    tickets_total: tickets.length, tickets_open: tickets.filter((t) => activeStatuses.includes(t.status)).length,
    tickets_resolved: byStatus.resolved ?? 0, tickets_closed: byStatus.closed ?? 0,
    conversations_total: conversations.length, conversations_needing_reply: conversations.filter((c) => c.needs_reply && !c.blocked).length,
    by_status: byStatus, by_priority: byPriority,
    average_first_response_minutes: average(responseMinutes), average_resolution_minutes: average(resolutionMinutes),
    measured_from: 'Stored ticket timestamps; null means no qualifying records are available.',
  };
}

export async function ticketEvents(ticketId: string) {
  return supabaseSelect<DbRow>('customer_service_ticket_events', { select: '*', ticket_id: `eq.${ticketId}`, order: 'created_at.asc', limit: '300' });
}
