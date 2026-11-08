import { createHash } from 'node:crypto';

type Json = Record<string, unknown>;

export const payBaseUrl = (): string => (process.env.TAMBALA_PAY_API_URL || 'https://tambala-pay.onrender.com').replace(/\/$/, '');
export function payConfigured(): boolean {
  const t = process.env.TAMBALA_PAY_API_TOKEN;
  return Boolean(t && t.length >= 32);
}
function token(): string {
  const value = process.env.TAMBALA_PAY_API_TOKEN;
  if (!value || value.length < 32) throw new Error('Tambala Pay is not configured: set TAMBALA_PAY_API_TOKEN (minimum 32 characters).');
  return value;
}

export async function payRequest(path: string, init: RequestInit = {}): Promise<Json> {
  const response = await fetch(payBaseUrl() + path, {
    ...init,
    headers: { authorization: `Bearer ${token()}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let data: Json = {};
  try { data = raw ? JSON.parse(raw) as Json : {}; } catch { data = { message: raw.slice(0, 500) }; }
  if (!response.ok) throw new Error(`Tambala Pay API ${response.status}: ${String(data.error ?? data.message ?? response.statusText)}`);
  return data;
}

/** Live check used by the dashboard: reachable, how fast, and whether our token is accepted. */
export async function payHealth(): Promise<{ configured: boolean; reachable: boolean; authorised: boolean | null; ms: number | null; detail: string }> {
  if (!payConfigured()) return { configured: false, reachable: false, authorised: null, ms: null, detail: 'TAMBALA_PAY_API_TOKEN is not set (32+ characters).' };
  const started = Date.now();
  try {
    await payRequest('/api/health');
    const ms = Date.now() - started;
    try { await payRequest('/api/summary'); return { configured: true, reachable: true, authorised: true, ms, detail: 'Reachable and the token is accepted.' }; }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      return { configured: true, reachable: true, authorised: /40[13]/.test(message) ? false : null, ms, detail: /40[13]/.test(message) ? 'Reachable, but the token was rejected.' : `Reachable. Summary check failed: ${message.slice(0, 120)}` };
    }
  } catch (error) {
    return { configured: true, reachable: false, authorised: null, ms: Date.now() - started, detail: error instanceof Error ? error.message.slice(0, 160) : 'Unreachable.' };
  }
}

/**
 * Find a hosted checkout URL in a Pay API response. The exact field name is not documented in this repo, so look in the
 * common places and accept only https links. Returns null (never a guess) when none is present.
 */
export function extractCheckoutUrl(value: unknown, depth = 0): string | null {
  if (depth > 3 || value === null || typeof value !== 'object') return null;
  const o = value as Json;
  for (const key of ['checkout_url', 'checkoutUrl', 'payment_url', 'paymentUrl', 'payment_link', 'paymentLink', 'hosted_url', 'hostedUrl', 'authorization_url', 'redirect_url', 'link', 'url']) {
    const v = o[key];
    if (typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v)) return v;
  }
  for (const key of ['data', 'payment', 'checkout', 'invoice', 'request']) {
    const found = extractCheckoutUrl(o[key], depth + 1);
    if (found) return found;
  }
  return null;
}

const idOf = (o: Json): string | null => {
  for (const key of ['id', 'invoice_id', 'invoiceId', 'request_id', 'requestId']) { const v = o[key]; if (typeof v === 'string' || typeof v === 'number') return String(v); }
  const nested = (o.invoice ?? o.data ?? o.request) as Json | undefined;
  return nested && typeof nested === 'object' ? idOf(nested) : null;
};

export interface InvoiceLinkResult { invoiceId: string; link: string | null; amount: number; responseKeys: string[] }

/** Create an invoice and the hosted checkout link for its full amount. */
export async function createInvoiceWithLink(input: { description: string; amount: number; customerName?: string; customerEmail?: string }): Promise<InvoiceLinkResult> {
  const invoice = await payRequest('/api/invoices', { method: 'POST', body: JSON.stringify({ description: input.description, totalAmount: input.amount, customerName: input.customerName, customerEmail: input.customerEmail }) });
  const invoiceId = idOf(invoice);
  if (!invoiceId) throw new Error(`Tambala Pay created an invoice but returned no id (fields: ${Object.keys(invoice).join(', ') || 'none'}).`);
  let link = extractCheckoutUrl(invoice);
  let keys = Object.keys(invoice);
  if (!link) {
    const payment = await payRequest(`/api/invoices/${encodeURIComponent(invoiceId)}/payments`, { method: 'POST', body: JSON.stringify({ amount: input.amount }) });
    link = extractCheckoutUrl(payment); keys = Object.keys(payment);
  }
  return { invoiceId, link, amount: input.amount, responseKeys: keys };
}

/** Same amount, same client, same description, same day: one invoice, however many times a retry asks. */
export const invoiceIdempotencyKey = (input: { description: string; amount: number; customerName?: string }, dayIso: string): string =>
  createHash('sha256').update([input.customerName ?? '', input.description.trim().toLowerCase(), input.amount, dayIso.slice(0, 10)].join('|')).digest('hex').slice(0, 32);

export async function getInvoiceStatus(invoiceId: string): Promise<{ status: string; raw: Json }> {
  const data = await payRequest(`/api/invoices/${encodeURIComponent(invoiceId)}`);
  const inner = (data.invoice ?? data.data ?? data) as Json;
  const status = [inner.status, inner.payment_status, inner.state].find((v) => typeof v === 'string') as string | undefined;
  return { status: status ?? 'unknown', raw: data };
}

let healthCache: { at: number; value: Awaited<ReturnType<typeof payHealth>> } | null = null;
/** The dashboard refreshes often; do not hammer the payment service. */
export async function payHealthCached(maxAgeMs = 60_000): ReturnType<typeof payHealth> {
  if (healthCache && Date.now() - healthCache.at < maxAgeMs) return healthCache.value;
  const value = await payHealth();
  healthCache = { at: Date.now(), value };
  return value;
}
