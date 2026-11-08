import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { supabaseInsert, supabaseSelect } from './lib/supabase.js';

const baseUrl = () => process.env.PUBLIC_BASE_URL ?? 'https://tambala-mcp.onrender.com';
const secret = () => {
  const value = process.env.TAMBALA_OAUTH_SECRET;
  if (!value || value.length < 32) throw new Error('TAMBALA_OAUTH_SECRET must be configured and at least 32 characters long');
  return value;
};
const approvalCode = () => {
  const value = process.env.TAMBALA_OAUTH_APPROVAL_CODE;
  if (!value || value.length < 12) throw new Error('TAMBALA_OAUTH_APPROVAL_CODE must be configured and at least 12 characters long');
  return value;
};
type Payload = Record<string, string | number>;
function b64(value: string): string { return Buffer.from(value).toString('base64url'); }
function unb64(value: string): string { return Buffer.from(value, 'base64url').toString('utf8'); }
function sign(payload: Payload): string { const body = b64(JSON.stringify(payload)); const mac = createHmac('sha256', secret()).update(body).digest('base64url'); return `${body}.${mac}`; }
function verify(token: string): Payload | null {
  const [body, mac] = token.split('.'); if (!body || !mac) return null;
  const expected = createHmac('sha256', secret()).update(body).digest(); const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const payload = JSON.parse(unb64(body)) as Payload; if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null; return payload; } catch { return null; }
}
function codeMatches(provided: string | null): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(approvalCode()).digest();
  return timingSafeEqual(a, b);
}

const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** A redirect URI must be https, or http on the local machine, with no fragment or credentials. */
export function redirectUriAllowed(value: string): boolean {
  if (value.length > 512) return false;
  let u: URL;
  try { u = new URL(value); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

/**
 * Client ids carry their own registered redirect URIs and are signed, so the server stays stateless but can still
 * refuse an authorization request whose redirect_uri was never registered. Ids from before this change ("tmc_...")
 * carry no URIs; they keep working for refresh, but cannot start a new authorization.
 */
export function createClientId(redirectUris: string[], name: string): string {
  const body = b64(JSON.stringify({ ru: redirectUris, nm: name.slice(0, 80), iat: Math.floor(Date.now() / 1000) }));
  return `tmc2.${body}.${createHmac('sha256', secret()).update(`client:${body}`).digest('base64url')}`;
}
export function parseClientId(clientId: string): { redirectUris: string[] } | null {
  const [prefix, body, mac] = clientId.split('.');
  if (prefix !== 'tmc2' || !body || !mac) return null;
  const expected = createHmac('sha256', secret()).update(`client:${body}`).digest(); const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const p = JSON.parse(unb64(body)) as { ru?: unknown }; return Array.isArray(p.ru) && p.ru.every((u) => typeof u === 'string') ? { redirectUris: p.ru as string[] } : null; } catch { return null; }
}
export function redirectMatchesClient(clientId: string, redirectUri: string): boolean {
  const parsed = parseClientId(clientId);
  return Boolean(parsed && parsed.redirectUris.includes(redirectUri) && redirectUriAllowed(redirectUri));
}

// ---- brute-force and abuse limits (per process) ----
const hits = new Map<string, number[]>();
function limited(bucket: string, key: string, max: number, windowMs: number, record: boolean): boolean {
  const id = `${bucket}:${key}`; const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < windowMs);
  if (record) recent.push(now);
  hits.set(id, recent);
  return recent.length > max;
}
const clientKey = (req: IncomingMessage): string => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
export function resetOAuthLimits(): void { hits.clear(); }

// ---- revocation ----
const revoked = new Map<string, number>(); // jti -> expiry (unix seconds)
const dbOn = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const prune = () => { const now = Math.floor(Date.now() / 1000); for (const [j, exp] of revoked) if (exp <= now) revoked.delete(j); };
export function isRevoked(jti: unknown): boolean { return typeof jti === 'string' && revoked.has(jti); }
export async function revokeToken(token: string): Promise<boolean> {
  const payload = verify(token);
  if (!payload || typeof payload.jti !== 'string') return false;
  revoked.set(payload.jti, Number(payload.exp));
  if (dbOn()) { try { await supabaseInsert('oauth_revoked_tokens', { jti: payload.jti, expires_at: new Date(Number(payload.exp) * 1000).toISOString() }); } catch (e) { if (!/409|23505|duplicate/i.test(e instanceof Error ? e.message : '')) console.error('Revocation not persisted:', e instanceof Error ? e.message : e); } }
  return true;
}
/** Pull revocations made by other processes into memory. Called on a timer. */
export async function syncRevocations(): Promise<void> {
  if (!dbOn()) return;
  try {
    const rows = await supabaseSelect<{ jti: string; expires_at: string }>('oauth_revoked_tokens', `select=jti,expires_at&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=5000`);
    for (const r of rows) revoked.set(r.jti, Math.floor(Date.parse(r.expires_at) / 1000));
    prune();
  } catch (error) { console.error('Could not sync token revocations:', error instanceof Error ? error.message : error); }
}
export function startRevocationSync(): void {
  void syncRevocations();
  setInterval(() => { void syncRevocations(); }, 60_000).unref();
}
const issue = (typ: 'access' | 'refresh', client: string, ttlSeconds: number): string =>
  sign({ typ, client, scope: 'mcp', jti: randomBytes(12).toString('base64url'), exp: Math.floor(Date.now() / 1000) + ttlSeconds });
function html(res: ServerResponse, body: string, status = 200): void { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
function json(res: ServerResponse, value: unknown, status = 200): void { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage): Promise<string> { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString('utf8'); }
function form(value: string): URLSearchParams { return new URLSearchParams(value); }

export function oauthMetadata(): Record<string, unknown> {
  const issuer = baseUrl();
  return { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, revocation_endpoint: `${issuer}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] };
}
export function protectedResourceMetadata(): Record<string, unknown> { const issuer = baseUrl(); return { resource: issuer, authorization_servers: [issuer], scopes_supported: ['mcp'] }; }

export async function handleOAuth(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (path === '/.well-known/oauth-authorization-server' && req.method === 'GET') { json(res, oauthMetadata()); return true; }
  if (path === '/.well-known/oauth-protected-resource' && req.method === 'GET') { json(res, protectedResourceMetadata()); return true; }

  if (path === '/oauth/register' && req.method === 'POST') {
    if (limited('register', clientKey(req), 20, 3_600_000, true)) { json(res, { error: 'too_many_requests' }, 429); return true; }
    try {
      const data = JSON.parse(await body(req)) as { client_name?: string; redirect_uris?: unknown };
      const uris = Array.isArray(data.redirect_uris) ? data.redirect_uris : [];
      if (uris.length === 0 || uris.length > 5 || !uris.every((u): u is string => typeof u === 'string' && redirectUriAllowed(u))) { json(res, { error: 'invalid_redirect_uri', error_description: 'Redirect URIs must be https (or http on localhost), at most 5.' }, 400); return true; }
      const name = typeof data.client_name === 'string' ? data.client_name : 'MCP client';
      json(res, { client_id: createClientId(uris, name), client_name: name.slice(0, 80), redirect_uris: uris, token_endpoint_auth_method: 'none' }, 201); return true;
    } catch { json(res, { error: 'invalid_client_metadata' }, 400); return true; }
  }

  if (path === '/oauth/authorize' && req.method === 'GET') {
    const q = new URL(req.url ?? '/', baseUrl()).searchParams;
    const clientId = q.get('client_id'); const redirectUri = q.get('redirect_uri'); const challenge = q.get('code_challenge'); const state = q.get('state') ?? '';
    if (!clientId || !redirectUri || !challenge || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256') { html(res, '<h2>Invalid OAuth request</h2>', 400); return true; }
    if (!redirectMatchesClient(clientId, redirectUri)) { html(res, '<h2>Invalid OAuth request</h2><p>This redirect address was not registered for this client. Disconnect and reconnect the connector.</p>', 400); return true; }
    const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
    html(res, `<!doctype html><html><body style="font-family:sans-serif;max-width:520px;margin:60px auto"><h2>Connect to Tambala MCP</h2><p>An AI client is requesting access to your Tambala MCP.</p><form method="post" action="/oauth/authorize">${hidden('client_id', clientId)}${hidden('redirect_uri', redirectUri)}${hidden('code_challenge', challenge)}${hidden('state', state)}<label>Approval code<br><input name="approval_code" type="password" required minlength="12" style="width:100%;padding:10px;margin:8px 0"></label><button type="submit" style="padding:10px 18px">Approve connection</button></form><p><small>Only approve a connection you initiated.</small></p></body></html>`); return true;
  }

  if (path === '/oauth/authorize' && req.method === 'POST') {
    const p = form(await body(req)); const clientId = p.get('client_id'); const redirectUri = p.get('redirect_uri'); const challenge = p.get('code_challenge'); const state = p.get('state') ?? '';
    if (limited('approve', clientKey(req), 4, 900_000, false)) { // five failures lock the door for 15 minutes
       html(res, '<h2>Too many attempts</h2><p>Try again in 15 minutes.</p>', 429); return true; }
    if (!clientId || !redirectUri || !challenge || !redirectMatchesClient(clientId, redirectUri)) { html(res, '<h2>Invalid OAuth request</h2>', 400); return true; }
    if (!codeMatches(p.get('approval_code'))) { limited('approve', clientKey(req), 5, 900_000, true); html(res, '<h2>Authorization denied</h2><p>Invalid approval code.</p>', 403); return true; }
    const code = sign({ typ: 'code', client: clientId, redirect: redirectUri, challenge, jti: randomBytes(12).toString('base64url'), exp: Math.floor(Date.now() / 1000) + 300 });
    const target = new URL(redirectUri); target.searchParams.set('code', code); if (state) target.searchParams.set('state', state); res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' }); res.end(); return true;
  }

  if (path === '/oauth/token' && req.method === 'POST') {
    const p = form(await body(req)); const grant = p.get('grant_type');
    if (grant === 'authorization_code') {
      const payload = verify(p.get('code') ?? ''); const verifier = p.get('code_verifier') ?? '';
      if (!payload || payload.typ !== 'code' || payload.client !== p.get('client_id') || payload.redirect !== p.get('redirect_uri')) { json(res, { error: 'invalid_grant' }, 400); return true; }
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== payload.challenge) { json(res, { error: 'invalid_grant' }, 400); return true; }
      if (isRevoked(payload.jti)) { json(res, { error: 'invalid_grant' }, 400); return true; }
      if (typeof payload.jti === 'string') revoked.set(payload.jti, Number(payload.exp)); // an authorization code works once
      const access = issue('access', String(payload.client), 3600);
      const refresh = issue('refresh', String(payload.client), 30 * 24 * 3600);
      json(res, { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: 'mcp' }); return true;
    }
    if (grant === 'refresh_token') {
      const payload = verify(p.get('refresh_token') ?? '');
      if (!payload || payload.typ !== 'refresh' || payload.client !== p.get('client_id') || isRevoked(payload.jti)) { json(res, { error: 'invalid_grant' }, 400); return true; }
      // Rotation: every refresh retires the old refresh token and issues a new one, so a stolen copy stops working.
      await revokeToken(p.get('refresh_token') as string);
      const client = String(payload.client);
      const access = issue('access', client, 3600);
      const refresh = issue('refresh', client, Math.max(60, Number(payload.exp) - Math.floor(Date.now() / 1000)));
      json(res, { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: 'mcp' }); return true;
    }
    json(res, { error: 'unsupported_grant_type' }, 400); return true;
  }

  if (path === '/oauth/revoke' && req.method === 'POST') {
    // RFC 7009: always answer 200, whether or not the token was valid, so the endpoint reveals nothing.
    const token = form(await body(req)).get('token');
    if (token) await revokeToken(token).catch(() => false);
    json(res, {}); return true;
  }
  return false;
}

export function verifyOAuthAccessToken(token: string): boolean { const payload = verify(token); return !!payload && payload.typ === 'access' && payload.scope === 'mcp' && !isRevoked(payload.jti); }

/**
 * Return the verified OAuth client identifier for request-scoped identity mapping.
 * A client ID is only a principal identifier; it is NOT itself an organization role.
 * Legacy shared bearer tokens intentionally return null.
 */
export function getOAuthAccessClientId(token: string): string | null {
  const payload = verify(token);
  if (!payload || payload.typ !== 'access' || payload.scope !== 'mcp' || isRevoked(payload.jti)) return null;
  return typeof payload.client === 'string' && payload.client.length > 0 ? payload.client : null;
}
