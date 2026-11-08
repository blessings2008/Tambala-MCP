import { randomUUID } from 'node:crypto';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../lib/supabase.js';
import { dbConfigured } from '../organization/workforce/db-util.js';
import type { DocKind } from './model.js';

export interface DocumentRow {
  id: string; kind: DocKind; number: string; status: 'draft' | 'sent' | 'void';
  client_name: string; client_phone: string | null; client_email: string | null;
  data: unknown; total_minor: number; currency: string; pdf_base64: string; pdf_sha256: string;
  created_by_role_id: string; signature: string | null; created_at: string;
}
export type DocumentListRow = Omit<DocumentRow, 'pdf_base64' | 'data'>;

export interface PriceItem { sku: string; name: string; unit: string; unit_price_minor: number; active: boolean }

export interface DocumentStore {
  /** The next unused number for this kind and year, e.g. TT-Q-2026-0004. Callers retry if a concurrent insert wins. */
  nextNumber(prefix: string, year: number): Promise<string>;
  add(row: DocumentRow): Promise<DocumentRow>;
  byId(id: string): Promise<DocumentRow | null>;
  list(limit: number): Promise<DocumentListRow[]>;
  update(id: string, patch: Partial<DocumentRow>): Promise<void>;
  prices(): Promise<PriceItem[]>;
  savePrice(item: PriceItem): Promise<void>;
}

const LIST_COLS = 'id,kind,number,status,client_name,client_phone,client_email,total_minor,currency,pdf_sha256,created_by_role_id,signature,created_at';

export class SupabaseDocumentStore implements DocumentStore {
  async nextNumber(prefix: string, year: number) {
    const stem = `TT-${prefix}-${year}-`;
    const rows = await supabaseSelect<{ number: string }>('organization_documents', `select=number&number=like.${encodeURIComponent(stem)}*&order=number.desc&limit=1`);
    const last = rows[0] ? Number(rows[0].number.slice(stem.length)) : 0;
    return `${stem}${String(last + 1).padStart(4, '0')}`;
  }
  add(row: DocumentRow) { return supabaseInsert<DocumentRow>('organization_documents', row as unknown as Record<string, unknown>); }
  async byId(id: string) { return (await supabaseSelect<DocumentRow>('organization_documents', `select=*&id=eq.${encodeURIComponent(id)}&limit=1`))[0] ?? null; }
  list(limit: number) { return supabaseSelect<DocumentListRow>('organization_documents', `select=${LIST_COLS}&order=created_at.desc&limit=${limit}`); }
  async update(id: string, patch: Partial<DocumentRow>) { await supabaseUpdate('organization_documents', patch as Record<string, unknown>, `id=eq.${encodeURIComponent(id)}`); }
  prices() { return supabaseSelect<PriceItem>('organization_price_list', 'select=sku,name,unit,unit_price_minor,active&order=sku.asc&limit=500'); }
  async savePrice(item: PriceItem) {
    const existing = await supabaseSelect<{ sku: string }>('organization_price_list', `select=sku&sku=eq.${encodeURIComponent(item.sku)}&limit=1`);
    if (existing.length) await supabaseUpdate('organization_price_list', { name: item.name, unit: item.unit, unit_price_minor: item.unit_price_minor, active: item.active }, `sku=eq.${encodeURIComponent(item.sku)}`);
    else await supabaseInsert('organization_price_list', item as unknown as Record<string, unknown>);
  }
}

export class InMemoryDocumentStore implements DocumentStore {
  readonly rows: DocumentRow[] = []; readonly priceRows = new Map<string, PriceItem>();
  async nextNumber(prefix: string, year: number) {
    const stem = `TT-${prefix}-${year}-`;
    const last = Math.max(0, ...this.rows.filter((r) => r.number.startsWith(stem)).map((r) => Number(r.number.slice(stem.length))));
    return `${stem}${String(last + 1).padStart(4, '0')}`;
  }
  async add(row: DocumentRow) { if (this.rows.some((r) => r.number === row.number)) throw new Error('duplicate number (409)'); this.rows.push(row); return row; }
  async byId(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async list(limit: number) { return [...this.rows].reverse().slice(0, limit).map(({ pdf_base64: _p, data: _d, ...rest }) => rest); }
  async update(id: string, patch: Partial<DocumentRow>) { const r = this.rows.find((x) => x.id === id); if (r) Object.assign(r, patch); }
  async prices() { return [...this.priceRows.values()].sort((a, b) => a.sku.localeCompare(b.sku)); }
  async savePrice(item: PriceItem) { this.priceRows.set(item.sku, item); }
}

let memory: InMemoryDocumentStore | null = null;
export function documentStore(): DocumentStore {
  if (dbConfigured()) return new SupabaseDocumentStore();
  return (memory ??= new InMemoryDocumentStore());
}
export const newDocumentId = (): string => randomUUID();
