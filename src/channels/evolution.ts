/**
 * Evolution API (WhatsApp) client. Endpoints used, per the Evolution API v2 docs:
 *   POST /message/sendText/{instance}     { number, text, delay? }
 *   POST /message/sendMedia/{instance}    { number, mediatype, mimetype, caption, media (URL or base64), fileName, delay? }
 *   GET  /instance/connectionState/{instance}
 * Authentication is the `apikey` header.
 */
export interface EvolutionConfig { url: string; key: string; instance: string }

export function evolutionConfig(): EvolutionConfig | null {
  const url = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
  const key = process.env.EVOLUTION_API_KEY?.trim();
  const instance = process.env.EVOLUTION_INSTANCE?.trim();
  if (!url || !key || !instance) return null;
  if (!/^https?:\/\//.test(url)) return null;
  return { url, key, instance };
}

export const evolutionConfigured = (): boolean => evolutionConfig() !== null;

export class EvolutionError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

async function call(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Record<string, unknown>> {
  const cfg = evolutionConfig();
  if (!cfg) throw new EvolutionError('WhatsApp is not configured (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE).', false);
  let response: Response;
  try {
    response = await fetch(`${cfg.url}${path.replace('{instance}', encodeURIComponent(cfg.instance))}`, {
      method: init.method ?? 'GET',
      headers: { apikey: cfg.key, accept: 'application/json', ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new EvolutionError(`Could not reach the Evolution API: ${error instanceof Error ? error.message : 'network error'}`, true);
  }
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { data = { message: raw.slice(0, 300) }; }
  if (!response.ok) {
    const detail = JSON.stringify(data.response ?? data.message ?? data.error ?? response.statusText).slice(0, 300);
    // 4xx other than rate limiting will not succeed on retry (bad number, bad key); 5xx and 429 might.
    throw new EvolutionError(`Evolution API ${response.status}: ${detail}`, response.status >= 500 || response.status === 429);
  }
  return data;
}

const messageId = (data: Record<string, unknown>): string | null => {
  const key = data.key as { id?: unknown } | undefined;
  return typeof key?.id === 'string' ? key.id : null;
};

export async function sendText(number: string, text: string): Promise<{ id: string | null }> {
  return { id: messageId(await call('/message/sendText/{instance}', { method: 'POST', json: { number, text, delay: 1200 } })) };
}

export async function sendDocument(number: string, base64: string, fileName: string, caption: string): Promise<{ id: string | null }> {
  const data = await call('/message/sendMedia/{instance}', {
    method: 'POST',
    json: { number, mediatype: 'document', mimetype: 'application/pdf', caption, media: base64, fileName, delay: 1200 },
  });
  return { id: messageId(data) };
}

/** Evolution returns { instance: { instanceName, state } } (v2) or { state } on some builds. */
export async function connectionState(): Promise<{ state: string }> {
  const data = await call('/instance/connectionState/{instance}');
  const inner = data.instance as { state?: unknown } | undefined;
  const state = typeof inner?.state === 'string' ? inner.state : typeof data.state === 'string' ? data.state : 'unknown';
  return { state };
}
