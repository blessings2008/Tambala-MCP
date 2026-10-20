const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://eljtjiexcwrtkumakscy.supabase.co';

type DbRow = Record<string, unknown>;

function key(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return value;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const value = key();
  return { apikey: value, Authorization: `Bearer ${value}`, ...extra };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Supabase request timed out after 10 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function supabaseSelect<T extends DbRow = DbRow>(
  table: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const query = new URLSearchParams({ select: '*', ...params });
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: authHeaders() });
  return read<T[]>(response);
}

const entityTypes: Record<string, string> = {
  clients: 'client', leads: 'lead', projects: 'project', tasks: 'task', services: 'service', products: 'product',
};

async function recordAutomaticActivity(table: string, action: 'CREATED' | 'UPDATED', row: DbRow, changedFields?: string[]): Promise<void> {
  if (table === 'activity_log' || !entityTypes[table] || !row.id) return;
  const entityType = entityTypes[table];
  const name = String(row.name ?? row.title ?? row.business_name ?? row.id);
  try {
    await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/activity_log`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({
        activity_type: `${entityType.toUpperCase()}_${action}`,
        title: `${entityType} ${action.toLowerCase()}: ${name}`,
        description: changedFields?.length ? `Updated fields: ${changedFields.join(', ')}` : undefined,
        entity_type: entityType, entity_id: row.id, actor: 'mcp',
        metadata: { source: 'automatic_database_activity', table, ...(changedFields?.length ? { changed_fields: changedFields } : {}) },
      }),
    });
  } catch (error) { console.error('Activity logging failed:', error); }
}

export async function getById<T>(table: string, id: string): Promise<T | null> {
  const rows = await supabaseSelect<T>(table, { id: `eq.${id}`, limit: '1' });
  return rows[0] ?? null;
}

export async function insertRow<T>(table: string, data: Record<string, unknown>): Promise<T> {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(data) });
  const rows = await read<T[]>(response);
  if (!rows[0]) throw new Error('Supabase insert returned no row');
  await recordAutomaticActivity(table, 'CREATED', rows[0] as DbRow);
  return rows[0];
}

export async function updateRow<T>(table: string, id: string, data: Record<string, unknown>): Promise<T> {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }) });
  const rows = await read<T[]>(response);
  if (!rows[0]) throw new Error(`No ${table} record found with id ${id}`);
  await recordAutomaticActivity(table, 'UPDATED', rows[0] as DbRow, Object.keys(data));
  return rows[0];
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders({ Prefer: 'return=minimal' }) });
  if (!response.ok) throw new Error(`Supabase delete failed (${response.status}): ${await response.text()}`);
}
