import { randomUUID } from 'node:crypto';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../lib/supabase.js';
import { dbConfigured } from '../organization/workforce/db-util.js';
import type { Audience, Purpose } from './policy.js';

export type MessageStatus = 'pending_approval' | 'queued' | 'sent' | 'failed' | 'rejected' | 'blocked' | 'received';

export interface MessageRow {
  id: string;
  direction: 'out' | 'in';
  number: string | null;          // counterpart phone, digits only; null when WhatsApp hid it (@lid)
  audience: Audience | null;
  purpose: Purpose | 'inbound';
  from_role_id: string | null;
  text: string;
  document_id: string | null;
  approval_id: string | null;
  status: MessageStatus;
  reason: string | null;
  provider_message_id: string | null;
  attempts: number;
  task_id: string | null;
  signature: string | null;       // fingerprint of the ledger signature
  contact_label: string | null;   // matched lead/client name, when known
  created_at: string;
  sent_at: string | null;
}

export interface MessageStore {
  add(row: Omit<MessageRow, 'id'>): Promise<MessageRow>;
  update(id: string, patch: Partial<MessageRow>): Promise<void>;
  byId(id: string): Promise<MessageRow | null>;
  queued(limit: number): Promise<MessageRow[]>;
  recent(limit: number): Promise<MessageRow[]>;
  sentSince(sinceIso: string, audience: Audience): Promise<number>;
  duplicateSince(number: string, text: string, sinceIso: string): Promise<boolean>;
  inboundByProviderId(providerId: string): Promise<MessageRow | null>;
  blockedNumbers(): Promise<Set<string>>;
  addBlock(number: string, reason: string): Promise<void>;
}

export class SupabaseMessageStore implements MessageStore {
  add(row: Omit<MessageRow, 'id'>) { return supabaseInsert<MessageRow>('organization_messages', row as unknown as Record<string, unknown>); }
  async update(id: string, patch: Partial<MessageRow>) { await supabaseUpdate('organization_messages', patch as Record<string, unknown>, `id=eq.${encodeURIComponent(id)}`); }
  async byId(id: string) { return (await supabaseSelect<MessageRow>('organization_messages', `select=*&id=eq.${encodeURIComponent(id)}&limit=1`))[0] ?? null; }
  queued(limit: number) { return supabaseSelect<MessageRow>('organization_messages', `select=*&direction=eq.out&status=eq.queued&order=created_at.asc&limit=${limit}`); }
  recent(limit: number) { return supabaseSelect<MessageRow>('organization_messages', `select=*&order=created_at.desc&limit=${limit}`); }
  async sentSince(sinceIso: string, audience: Audience) {
    return (await supabaseSelect<{ id: string }>('organization_messages', `select=id&direction=eq.out&status=eq.sent&audience=eq.${audience}&sent_at=gte.${encodeURIComponent(sinceIso)}&limit=1000`)).length;
  }
  async duplicateSince(number: string, text: string, sinceIso: string) {
    const rows = await supabaseSelect<{ text: string }>('organization_messages', `select=text&direction=eq.out&number=eq.${number}&status=in.(pending_approval,queued,sent)&created_at=gte.${encodeURIComponent(sinceIso)}&limit=50`);
    return rows.some((r) => r.text === text);
  }
  async inboundByProviderId(providerId: string) { return (await supabaseSelect<MessageRow>('organization_messages', `select=*&direction=eq.in&provider_message_id=eq.${encodeURIComponent(providerId)}&limit=1`))[0] ?? null; }
  async blockedNumbers() { return new Set((await supabaseSelect<{ number: string }>('organization_contact_blocks', 'select=number&limit=5000')).map((r) => r.number)); }
  async addBlock(number: string, reason: string) {
    try { await supabaseInsert('organization_contact_blocks', { number, reason }); }
    catch (error) { if (!/409|23505|duplicate/i.test(error instanceof Error ? error.message : '')) throw error; }
  }
}

export class InMemoryMessageStore implements MessageStore {
  readonly rows: MessageRow[] = [];
  readonly blocks = new Map<string, string>();
  async add(row: Omit<MessageRow, 'id'>) { const r = { ...row, id: randomUUID() }; this.rows.push(r); return r; }
  async update(id: string, patch: Partial<MessageRow>) { const r = this.rows.find((x) => x.id === id); if (r) Object.assign(r, patch); }
  async byId(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async queued(limit: number) { return this.rows.filter((r) => r.direction === 'out' && r.status === 'queued').slice(0, limit); }
  async recent(limit: number) { return [...this.rows].reverse().slice(0, limit); }
  async sentSince(sinceIso: string, audience: Audience) { return this.rows.filter((r) => r.direction === 'out' && r.status === 'sent' && r.audience === audience && (r.sent_at ?? '') >= sinceIso).length; }
  async duplicateSince(number: string, text: string, sinceIso: string) { return this.rows.some((r) => r.direction === 'out' && r.number === number && r.text === text && r.created_at >= sinceIso && ['pending_approval', 'queued', 'sent'].includes(r.status)); }
  async inboundByProviderId(id: string) { return this.rows.find((r) => r.direction === 'in' && r.provider_message_id === id) ?? null; }
  async blockedNumbers() { return new Set(this.blocks.keys()); }
  async addBlock(number: string, reason: string) { this.blocks.set(number, reason); }
}

let memory: InMemoryMessageStore | null = null;
export function messageStore(): MessageStore {
  if (dbConfigured()) return new SupabaseMessageStore();
  return (memory ??= new InMemoryMessageStore());
}
