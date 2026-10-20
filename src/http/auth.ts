import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import { runtimeConfig } from '../config/runtime.js';
import { verifyOAuthAccessToken } from '../oauth.js';

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

export function isAuthorized(headers: IncomingHttpHeaders): boolean {
  const token = providedToken(headers);
  return legacyTokenValid(token) || (!!token && verifyOAuthAccessToken(token));
}

export function unauthorized(res: ServerResponse): void {
  res.writeHead(401, {
    'content-type': 'application/json',
    'WWW-Authenticate': `Bearer realm="tambala-mcp", resource_metadata="${runtimeConfig.publicBaseUrl}/.well-known/oauth-protected-resource"`,
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}
