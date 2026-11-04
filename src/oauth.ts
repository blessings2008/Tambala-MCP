import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

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
    try {
      const data = JSON.parse(await body(req)) as { client_name?: string; redirect_uris?: string[] };
      if (!Array.isArray(data.redirect_uris) || data.redirect_uris.length === 0) { json(res, { error: 'invalid_client_metadata' }, 400); return true; }
      for (const uri of data.redirect_uris) new URL(uri);
      const clientId = `tmc_${randomBytes(18).toString('base64url')}`;
      json(res, { client_id: clientId, client_name: data.client_name ?? 'MCP client', redirect_uris: data.redirect_uris, token_endpoint_auth_method: 'none' }, 201); return true;
    } catch { json(res, { error: 'invalid_client_metadata' }, 400); return true; }
  }

  if (path === '/oauth/authorize' && req.method === 'GET') {
    const q = new URL(req.url ?? '/', baseUrl()).searchParams;
    const clientId = q.get('client_id'); const redirectUri = q.get('redirect_uri'); const challenge = q.get('code_challenge'); const state = q.get('state') ?? '';
    if (!clientId || !redirectUri || !challenge || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256') { html(res, '<h2>Invalid OAuth request</h2>', 400); return true; }
    const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${value.replaceAll('"', '&quot;')}">`;
    html(res, `<!doctype html><html><body style="font-family:sans-serif;max-width:520px;margin:60px auto"><h2>Connect to Tambala MCP</h2><p>An AI client is requesting access to your Tambala MCP.</p><form method="post" action="/oauth/authorize">${hidden('client_id', clientId)}${hidden('redirect_uri', redirectUri)}${hidden('code_challenge', challenge)}${hidden('state', state)}<label>Approval code<br><input name="approval_code" type="password" required minlength="12" style="width:100%;padding:10px;margin:8px 0"></label><button type="submit" style="padding:10px 18px">Approve connection</button></form><p><small>Only approve a connection you initiated.</small></p></body></html>`); return true;
  }

  if (path === '/oauth/authorize' && req.method === 'POST') {
    const p = form(await body(req)); const clientId = p.get('client_id'); const redirectUri = p.get('redirect_uri'); const challenge = p.get('code_challenge'); const state = p.get('state') ?? '';
    if (!clientId || !redirectUri || !challenge || p.get('approval_code') !== approvalCode()) { html(res, '<h2>Authorization denied</h2><p>Invalid approval code.</p>', 403); return true; }
    const code = sign({ typ: 'code', client: clientId, redirect: redirectUri, challenge, exp: Math.floor(Date.now() / 1000) + 300 });
    const target = new URL(redirectUri); target.searchParams.set('code', code); if (state) target.searchParams.set('state', state); res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' }); res.end(); return true;
  }

  if (path === '/oauth/token' && req.method === 'POST') {
    const p = form(await body(req)); const grant = p.get('grant_type');
    if (grant === 'authorization_code') {
      const payload = verify(p.get('code') ?? ''); const verifier = p.get('code_verifier') ?? '';
      if (!payload || payload.typ !== 'code' || payload.client !== p.get('client_id') || payload.redirect !== p.get('redirect_uri')) { json(res, { error: 'invalid_grant' }, 400); return true; }
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== payload.challenge) { json(res, { error: 'invalid_grant' }, 400); return true; }
      const access = sign({ typ: 'access', client: String(payload.client), scope: 'mcp', exp: Math.floor(Date.now() / 1000) + 3600 });
      const refresh = sign({ typ: 'refresh', client: String(payload.client), scope: 'mcp', exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 });
      json(res, { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: 'mcp' }); return true;
    }
    if (grant === 'refresh_token') {
      const payload = verify(p.get('refresh_token') ?? ''); if (!payload || payload.typ !== 'refresh' || payload.client !== p.get('client_id')) { json(res, { error: 'invalid_grant' }, 400); return true; }
      const access = sign({ typ: 'access', client: String(payload.client), scope: 'mcp', exp: Math.floor(Date.now() / 1000) + 3600 }); json(res, { access_token: access, token_type: 'Bearer', expires_in: 3600, scope: 'mcp' }); return true;
    }
    json(res, { error: 'unsupported_grant_type' }, 400); return true;
  }

  if (path === '/oauth/revoke' && req.method === 'POST') { json(res, {}); return true; }
  return false;
}

export function verifyOAuthAccessToken(token: string): boolean { const payload = verify(token); return !!payload && payload.typ === 'access' && payload.scope === 'mcp'; }

/**
 * Return the verified OAuth client identifier for request-scoped identity mapping.
 * A client ID is only a principal identifier; it is NOT itself an organization role.
 * Legacy shared bearer tokens intentionally return null.
 */
export function getOAuthAccessClientId(token: string): string | null {
  const payload = verify(token);
  if (!payload || payload.typ !== 'access' || payload.scope !== 'mcp') return null;
  return typeof payload.client === 'string' && payload.client.length > 0 ? payload.client : null;
}
