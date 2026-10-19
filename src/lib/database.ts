const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://eljtjiexcwrtkumakscy.supabase.co';

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

export async function getById<T>(table: string, id: string): Promise<T | null> {
  const query = new URLSearchParams({ select: '*', id: `eq.${id}`, limit: '1' });
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: authHeaders() });
  const rows = await read<T[]>(response);
  return rows[0] ?? null;
}

export async function insertRow<T>(table: string, data: Record<string, unknown>): Promise<T> {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(data),
  });
  const rows = await read<T[]>(response);
  if (!rows[0]) throw new Error('Supabase insert returned no row');
  return rows[0];
}

export async function updateRow<T>(table: string, id: string, data: Record<string, unknown>): Promise<T> {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
  });
  const rows = await read<T[]>(response);
  if (!rows[0]) throw new Error(`No ${table} record found with id ${id}`);
  return rows[0];
}
