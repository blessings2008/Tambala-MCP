import { createServer as createHttpServer, IncomingHttpHeaders } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { mcpHandler } from './index.js';
import { handleOAuth, protectedResourceMetadata, verifyOAuthAccessToken } from './oauth.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const nodeHandler = toNodeHandler(mcpHandler);

function setCorsHeaders(res: import('node:http').ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

function providedToken(headers: IncomingHttpHeaders): string | null {
  const authorization = headers.authorization;
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function legacyTokenValid(token: string | null): boolean {
  const expectedValue = process.env.TAMBALA_MCP_TOKEN;
  if (!expectedValue || !token) return false;
  const expected = Buffer.from(expectedValue, 'utf8');
  const actual = Buffer.from(token, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isAuthorized(headers: IncomingHttpHeaders): boolean {
  const token = providedToken(headers);
  return legacyTokenValid(token) || (!!token && verifyOAuthAccessToken(token));
}

function unauthorized(res: import('node:http').ServerResponse) {
  const resource = `${process.env.PUBLIC_BASE_URL ?? 'https://tambala-mcp.onrender.com'}`;
  res.writeHead(401, {
    'content-type': 'application/json',
    'WWW-Authenticate': `Bearer realm="tambala-mcp", resource_metadata="${resource}/.well-known/oauth-protected-resource"`,
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

const server = createHttpServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const requestPath = req.url?.split('?')[0] ?? '/';
  if (await handleOAuth(req, res, requestPath)) return;

  if (requestPath === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'tambala-mcp' }));
    return;
  }

  if (requestPath === '/' || requestPath === '/mcp') {
    if (!isAuthorized(req.headers)) { unauthorized(res); return; }
    await nodeHandler(req, res);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, host, () => {
  console.log(`Tambala MCP HTTP server listening on ${host}:${port}`);
});
