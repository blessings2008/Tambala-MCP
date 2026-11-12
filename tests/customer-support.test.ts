import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportTicket, recordCustomerResponse, updateSupportTicket } from '../src/customer-support/service.ts';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_ID = '22222222-2222-4222-8222-222222222222';
const PHONE = '265888123456';

function mockDatabase() {
  const tables: Record<string, Record<string, unknown>[]> = {
    customer_service_contacts: [], customer_service_tickets: [], customer_service_ticket_events: [],
  };
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const table = url.pathname.split('/').pop()!;
    const method = init?.method ?? 'GET';
    const query = url.searchParams;
    const rows = tables[table] ?? [];
    if (method === 'GET') {
      let found = [...rows];
      for (const [key, value] of query.entries()) {
        if (key === 'select' || key === 'order' || key === 'limit') continue;
        if (value.startsWith('eq.')) found = found.filter((row) => String(row[key]) === value.slice(3));
        if (value.startsWith('in.(')) {
          const allowed = value.slice(4, -1).split(',');
          found = found.filter((row) => allowed.includes(String(row[key])));
        }
      }
      return new Response(JSON.stringify(found), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const row = { id: table === 'customer_service_contacts' ? CONTACT_ID : table === 'customer_service_tickets' ? TICKET_ID : '33333333-3333-4333-8333-333333333333', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body };
      (tables[table] ??= []).push(row);
      return new Response(JSON.stringify([row]), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (method === 'PATCH') {
      const id = query.get('id')?.replace(/^eq\./, '');
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
      Object.assign(row, JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('unsupported', { status: 405 });
  }) as typeof fetch;
  return {
    tables,
    restore() {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    },
  };
}

test('support ticket creation creates a contact profile and an auditable ticket event', async () => {
  const db = mockDatabase();
  try {
    const ticket = await createSupportTicket({
      phone: '0888 123 456', subject: 'Cannot access account', description: 'Customer cannot sign in to the service.',
      category: 'technical', priority: 'high',
    });
    assert.equal(ticket.id, TICKET_ID);
    assert.equal(ticket.status, 'open');
    assert.equal(ticket.assigned_role_id, 'director-customer-relations');
    assert.equal(db.tables.customer_service_contacts.length, 1);
    assert.equal(db.tables.customer_service_contacts[0].phone, PHONE);
    assert.equal(db.tables.customer_service_ticket_events.length, 1);
    assert.equal(db.tables.customer_service_ticket_events[0].event_type, 'created');
  } finally { db.restore(); }
});

test('ticket updates record status and priority changes in the event timeline', async () => {
  const db = mockDatabase();
  try {
    db.tables.customer_service_tickets.push({
      id: TICKET_ID, contact_id: CONTACT_ID, subject: 'Cannot access account', description: 'Customer cannot sign in.',
      category: 'technical', priority: 'normal', status: 'open', assigned_role_id: 'director-customer-relations',
      first_response_at: null, last_activity_at: new Date().toISOString(), resolved_at: null, closed_at: null,
      created_by_role_id: 'director-customer-relations', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const updated = await updateSupportTicket({ id: TICKET_ID, status: 'in_progress', priority: 'urgent', note: 'Investigating login failure.' });
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.priority, 'urgent');
    assert.deepEqual(db.tables.customer_service_ticket_events.map((event) => event.event_type), ['status_changed', 'priority_changed', 'note']);
  } finally { db.restore(); }
});

test('first-response metrics change only after a customer-facing reply is delivered', async () => {
  const db = mockDatabase();
  try {
    db.tables.customer_service_contacts.push({
      id: CONTACT_ID, phone: PHONE, display_name: 'Test Customer', contact_type: 'unknown', do_not_contact: false,
    });
    db.tables.customer_service_tickets.push({
      id: TICKET_ID, contact_id: CONTACT_ID, subject: 'Support request', description: 'A test request.',
      category: 'general', priority: 'normal', status: 'open', assigned_role_id: 'director-customer-relations',
      first_response_at: null, last_activity_at: new Date().toISOString(), resolved_at: null, closed_at: null,
      created_by_role_id: 'director-customer-relations', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await recordCustomerResponse(PHONE);
    assert.equal(db.tables.customer_service_tickets[0].status, 'waiting_customer');
    assert.equal(typeof db.tables.customer_service_tickets[0].first_response_at, 'string');
  } finally { db.restore(); }
});
