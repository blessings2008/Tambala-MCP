import { randomUUID } from 'node:crypto';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../lib/supabase.js';
import { dbConfigured } from '../organization/workforce/db-util.js';
import { signWork } from '../organization/workforce/sign-work.js';
import { createInvoiceWithLink, getInvoiceStatus, invoiceIdempotencyKey } from './tambala-pay.js';

export interface InvoiceRow {
  id: string; idempotency_key: string; pay_invoice_id: string; link: string | null; amount_minor: number; currency: string;
  client_name: string; client_phone: string | null; client_email: string | null; description: string;
  status: string; created_by_role_id: string; signature: string | null; created_at: string; status_checked_at: string | null;
}

export interface InvoiceStore {
  byKey(key: string): Promise<InvoiceRow | null>;
  add(row: InvoiceRow): Promise<InvoiceRow>;
  update(id: string, patch: Partial<InvoiceRow>): Promise<void>;
  recent(limit: number): Promise<InvoiceRow[]>;
  open(sinceIso: string, limit: number): Promise<InvoiceRow[]>;
}

export class SupabaseInvoiceStore implements InvoiceStore {
  async byKey(key: string) { return (await supabaseSelect<InvoiceRow>('organization_invoices', `select=*&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`))[0] ?? null; }
  add(row: InvoiceRow) { return supabaseInsert<InvoiceRow>('organization_invoices', row as unknown as Record<string, unknown>); }
  async update(id: string, patch: Partial<InvoiceRow>) { await supabaseUpdate('organization_invoices', patch as Record<string, unknown>, `id=eq.${encodeURIComponent(id)}`); }
  recent(limit: number) { return supabaseSelect<InvoiceRow>('organization_invoices', `select=*&order=created_at.desc&limit=${limit}`); }
  open(sinceIso: string, limit: number) { return supabaseSelect<InvoiceRow>('organization_invoices', `select=*&status=not.in.(paid,cancelled,void)&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.asc&limit=${limit}`); }
}

export class InMemoryInvoiceStore implements InvoiceStore {
  readonly rows: InvoiceRow[] = [];
  async byKey(key: string) { return this.rows.find((r) => r.idempotency_key === key) ?? null; }
  async add(row: InvoiceRow) { this.rows.push(row); return row; }
  async update(id: string, patch: Partial<InvoiceRow>) { const r = this.rows.find((x) => x.id === id); if (r) Object.assign(r, patch); }
  async recent(limit: number) { return [...this.rows].reverse().slice(0, limit); }
  async open(sinceIso: string, limit: number) { return this.rows.filter((r) => !['paid', 'cancelled', 'void'].includes(r.status) && r.created_at >= sinceIso).slice(0, limit); }
}

let memory: InMemoryInvoiceStore | null = null;
export function invoiceStore(): InvoiceStore {
  if (dbConfigured()) return new SupabaseInvoiceStore();
  return (memory ??= new InMemoryInvoiceStore());
}

export class InvoiceError extends Error {}

/** Create (once) a Tambala Pay invoice and hosted checkout link for a client, and keep our own record of it. */
export async function createClientInvoice(input: {
  roleId: string; clientName: string; clientPhone?: string; clientEmail?: string; description: string; amount: number; store?: InvoiceStore; now?: Date;
}): Promise<{ invoice: InvoiceRow; created: boolean }> {
  const store = input.store ?? invoiceStore();
  const now = input.now ?? new Date();
  if (!(input.amount > 0) || input.amount > 100_000_000) throw new InvoiceError('The amount must be between 1 and 100,000,000 MWK.');
  const description = input.description.trim().slice(0, 180);
  if (!description) throw new InvoiceError('An invoice needs a description.');
  const key = invoiceIdempotencyKey({ description, amount: input.amount, customerName: input.clientName }, now.toISOString());
  const existing = await store.byKey(key);
  if (existing) return { invoice: existing, created: false };

  const made = await createInvoiceWithLink({ description, amount: input.amount, customerName: input.clientName, customerEmail: input.clientEmail });
  const id = randomUUID();
  const stamp = await signWork({ roleId: input.roleId, kind: 'invoice', subjectId: id, content: `invoice ${made.invoiceId} for ${input.clientName}: ${description} MWK ${input.amount}`, now });
  const row: InvoiceRow = {
    id, idempotency_key: key, pay_invoice_id: made.invoiceId, link: made.link, amount_minor: Math.round(input.amount * 100), currency: 'MWK',
    client_name: input.clientName, client_phone: input.clientPhone ?? null, client_email: input.clientEmail ?? null, description,
    status: 'unpaid', created_by_role_id: input.roleId, signature: stamp.fingerprint, created_at: now.toISOString(), status_checked_at: null,
  };
  return { invoice: await store.add(row), created: true };
}

/** Ask Tambala Pay about unpaid invoices and record what it says. Bounded, so a slow API cannot stall a duty. */
export async function refreshOpenInvoices(store: InvoiceStore = invoiceStore(), now: Date = new Date(), max = 15): Promise<number> {
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  let updated = 0;
  for (const row of (await store.open(since, max))) {
    try {
      const { status } = await getInvoiceStatus(row.pay_invoice_id);
      const normalised = /paid|complete|success/i.test(status) && !/part|unpaid|not/i.test(status) ? 'paid' : status.toLowerCase();
      await store.update(row.id, { status: normalised, status_checked_at: now.toISOString() });
      updated += 1;
    } catch { /* leave the row as it was; the next cycle tries again */ }
  }
  return updated;
}
