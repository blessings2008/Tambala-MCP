import { randomUUID } from 'node:crypto';
import { supabaseInsert, supabaseSelect } from '../../lib/supabase.js';
import { ALGORITHM } from './signing.js';

export interface LedgerRow {
  id: string; kind: string; role_id: string; employee_number: string; subject_id: string; issued_at: string;
  content: string; content_hash: string; signature: string; fingerprint: string; algorithm: string; created_at?: string;
}

export interface SignatureStore {
  add(row: Omit<LedgerRow, 'id' | 'algorithm'>): Promise<LedgerRow>;
  byFingerprint(fingerprint: string): Promise<LedgerRow[]>;
  byId(id: string): Promise<LedgerRow | null>;
  /** Newest first, WITHOUT content (the ledger list never ships full documents). */
  recent(limit: number): Promise<Omit<LedgerRow, 'content'>[]>;
}

const LIST = 'id,kind,role_id,employee_number,subject_id,issued_at,content_hash,signature,fingerprint,algorithm,created_at';

export class SupabaseSignatureStore implements SignatureStore {
  add(row: Omit<LedgerRow, 'id' | 'algorithm'>) { return supabaseInsert<LedgerRow>('organization_signatures', { ...row, algorithm: ALGORITHM }); }
  byFingerprint(fp: string) { return supabaseSelect<LedgerRow>('organization_signatures', `select=*&fingerprint=eq.${encodeURIComponent(fp)}&limit=5`); }
  async byId(id: string) { return (await supabaseSelect<LedgerRow>('organization_signatures', `select=*&id=eq.${encodeURIComponent(id)}&limit=1`))[0] ?? null; }
  recent(limit: number) { return supabaseSelect<Omit<LedgerRow, 'content'>>('organization_signatures', `select=${LIST}&order=issued_at.desc&limit=${limit}`); }
}

export class InMemorySignatureStore implements SignatureStore {
  readonly rows: LedgerRow[] = [];
  async add(row: Omit<LedgerRow, 'id' | 'algorithm'>) { const r = { ...row, id: randomUUID(), algorithm: ALGORITHM }; this.rows.push(r); return r; }
  async byFingerprint(fp: string) { return this.rows.filter((r) => r.fingerprint === fp); }
  async byId(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async recent(limit: number) { return [...this.rows].reverse().slice(0, limit).map(({ content: _c, ...rest }) => rest); }
}
