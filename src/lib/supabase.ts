const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://eljtjiexcwrtkumakscy.supabase.co';

function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  return key;
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

export async function supabaseSelect<T>(table: string, query = 'select=*'): Promise<T[]> {
  const key = getServiceRoleKey();
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T[];
}
