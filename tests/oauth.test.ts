import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createClientId, getOAuthAccessClientId, handleOAuth, parseClientId, redirectMatchesClient, redirectUriAllowed, resetOAuthLimits, verifyOAuthAccessToken } from '../src/oauth.ts';

process.env.TAMBALA_OAUTH_SECRET = 'oauth-test-secret-0123456789abcdef0123456789';
process.env.TAMBALA_OAUTH_APPROVAL_CODE = 'correct-horse-battery';
process.env.PUBLIC_BASE_URL = 'http://localhost';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeEach(() => resetOAuthLimits());

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(async (req, res) => { const path = req.url?.split('?')[0] ?? '/'; if (!(await handleOAuth(req, res, path))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try { return await fn(base); } finally { server.close(); }
}
const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString(), redirect: 'manual' as const });
async function register(base: string, uris: unknown) {
  return fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: uris }) });
}
function pkce() { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }; }
async function fullFlow(base: string) {
  const reg = await (await register(base, [REDIRECT])).json() as { client_id: string };
  const { verifier, challenge } = pkce();
  const auth = await fetch(`${base}/oauth/authorize`, form({ client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, state: 's1', approval_code: 'correct-horse-battery' }));
  const code = new URL(auth.headers.get('location')!).searchParams.get('code')!;
  const tok = await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }));
  return { clientId: reg.client_id, code, verifier, tokens: await tok.json() as { access_token: string; refresh_token: string }, tokStatus: tok.status, authStatus: auth.status };
}

test('redirect URIs must be https or localhost, without fragments or credentials', () => {
  for (const ok of [REDIRECT, 'http://localhost:3000/cb', 'http://127.0.0.1/cb']) assert.equal(redirectUriAllowed(ok), true, ok);
  for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'https://a.example/cb#frag', 'https://user:pw@a.example/cb', 'not a url', 'ftp://a.example', `https://a.example/${'x'.repeat(600)}`]) assert.equal(redirectUriAllowed(bad), false, bad);
});

test('client ids are signed and bound to their registered redirect URIs', () => {
  const id = createClientId([REDIRECT], 'Claude');
  assert.deepEqual(parseClientId(id), { redirectUris: [REDIRECT] });
  assert.equal(redirectMatchesClient(id, REDIRECT), true);
  assert.equal(redirectMatchesClient(id, 'https://evil.example/cb'), false);
  const [p, body, mac] = id.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ ru: ['https://evil.example/cb'], nm: 'x', iat: 1 })).toString('base64url');
  assert.equal(parseClientId(`${p}.${forgedBody}.${mac}`), null);
  assert.equal(parseClientId(`${p}.${body}.AAAA`), null);
  assert.equal(parseClientId('tmc_legacyid'), null);
});

test('registration only accepts safe redirect URIs and is rate limited', async () => {
  await withServer(async (base) => {
    assert.equal((await register(base, ['http://evil.example/cb'])).status, 400);
    assert.equal((await register(base, [])).status, 400);
    assert.equal((await register(base, Array(6).fill(REDIRECT))).status, 400);
    assert.equal((await register(base, 'nope')).status, 400);
    assert.equal((await register(base, [REDIRECT])).status, 201);
  });
  await withServer(async (base) => {
    let last = 0; for (let i = 0; i < 22; i += 1) last = (await register(base, [REDIRECT])).status;
    assert.equal(last, 429);
  });
});

test('authorization refuses unregistered redirects and legacy client ids; the page escapes its values', async () => {
  await withServer(async (base) => {
    const reg = await (await register(base, [REDIRECT])).json() as { client_id: string };
    const { challenge } = pkce();
    const q = (client: string, redirect: string, state = 'x') => `${base}/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state })}`;
    assert.equal((await fetch(q(reg.client_id, REDIRECT))).status, 200);
    assert.equal((await fetch(q(reg.client_id, 'https://evil.example/cb'))).status, 400);
    assert.equal((await fetch(q('tmc_legacyunsignedid', REDIRECT))).status, 400);
    const page = await (await fetch(q(reg.client_id, REDIRECT, '"><script>alert(1)</script>'))).text();
    assert.doesNotMatch(page, /<script>alert/); assert.match(page, /&lt;script&gt;/);
    const post = await fetch(`${base}/oauth/authorize`, form({ client_id: reg.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, approval_code: 'correct-horse-battery' }));
    assert.equal(post.status, 400); assert.equal(post.headers.get('location'), null); // never redirects, even with the right code
  });
});

test('the approval code is brute-force limited', async () => {
  await withServer(async (base) => {
    const reg = await (await register(base, [REDIRECT])).json() as { client_id: string };
    const { challenge } = pkce();
    const attempt = (code: string) => fetch(`${base}/oauth/authorize`, form({ client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, approval_code: code }));
    for (let i = 0; i < 5; i += 1) assert.equal((await attempt(`wrong-guess-${i}`)).status, 403);
    assert.equal((await attempt('correct-horse-battery')).status, 429); // even the right code is refused while locked out
  });
});

test('the full flow works, codes are single-use, and tokens identify their client', async () => {
  await withServer(async (base) => {
    const f = await fullFlow(base);
    assert.equal(f.authStatus, 302); assert.equal(f.tokStatus, 200);
    assert.equal(verifyOAuthAccessToken(f.tokens.access_token), true);
    assert.equal(getOAuthAccessClientId(f.tokens.access_token), f.clientId);
    assert.equal(verifyOAuthAccessToken(f.tokens.refresh_token), false); // a refresh token is not an access token
    const again = await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code: f.code, code_verifier: f.verifier, client_id: f.clientId, redirect_uri: REDIRECT }));
    assert.equal(again.status, 400); // authorization codes work once
    const wrongVerifier = await fullFlow(base).then(async (g) => fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', code: g.code, code_verifier: 'x'.repeat(43), client_id: g.clientId, redirect_uri: REDIRECT })));
    assert.equal(wrongVerifier.status, 400);
  });
});

test('refresh tokens rotate: the old one dies, the new one works', async () => {
  await withServer(async (base) => {
    const f = await fullFlow(base);
    const r1 = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: f.tokens.refresh_token, client_id: f.clientId }));
    assert.equal(r1.status, 200); const t1 = await r1.json() as { access_token: string; refresh_token: string };
    assert.notEqual(t1.refresh_token, f.tokens.refresh_token); assert.equal(verifyOAuthAccessToken(t1.access_token), true);
    const replay = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: f.tokens.refresh_token, client_id: f.clientId }));
    assert.equal(replay.status, 400);
    const r2 = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: f.clientId }));
    assert.equal(r2.status, 200);
    const otherClient = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: (await r2.json() as any).refresh_token, client_id: 'someone-else' }));
    assert.equal(otherClient.status, 400);
  });
});

test('revocation actually revokes, and always answers 200', async () => {
  await withServer(async (base) => {
    const f = await fullFlow(base);
    assert.equal((await fetch(`${base}/oauth/revoke`, form({ token: f.tokens.access_token }))).status, 200);
    assert.equal(verifyOAuthAccessToken(f.tokens.access_token), false);
    assert.equal(getOAuthAccessClientId(f.tokens.access_token), null);
    assert.equal((await fetch(`${base}/oauth/revoke`, form({ token: f.tokens.refresh_token }))).status, 200);
    const afterRevoke = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: f.tokens.refresh_token, client_id: f.clientId }));
    assert.equal(afterRevoke.status, 400);
    assert.equal((await fetch(`${base}/oauth/revoke`, form({ token: 'garbage' }))).status, 200);
    assert.equal((await fetch(`${base}/oauth/revoke`, form({}))).status, 200);
  });
});
