import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../../lib/supabase.js';

export const dbConfigured = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Insert or update by primary key using the plain REST helpers. */
export async function upsertByKey(table: string, keyColumn: string, key: string, row: Record<string, unknown>): Promise<void> {
  const existing = await supabaseSelect<Record<string, unknown>>(table, `select=${keyColumn}&${keyColumn}=eq.${encodeURIComponent(key)}&limit=1`);
  if (existing.length) await supabaseUpdate(table, row, `${keyColumn}=eq.${encodeURIComponent(key)}`);
  else await supabaseInsert(table, { [keyColumn]: key, ...row });
}

export class NeedsDatabaseError extends Error {
  constructor(what: string) { super(`${what} needs the database (SUPABASE_SERVICE_ROLE_KEY) so the change survives restarts.`); }
}
