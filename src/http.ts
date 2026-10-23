import { createServer as createHttpServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { mcpHandler } from './index.js';
import { getOAuthAccessClientId, handleOAuth } from './oauth.js';
import { runWithRequestPrincipal } from './organization/request-context.js';
import { runtimeConfig } from './config/runtime.js';
import { setCorsHeaders } from './http/cors.js';
import { handleHealth, handleNotFound } from './http/health.js';
import { isAuthorized, unauthorized } from './http/auth.js';

const nodeHandler = toNodeHandler(mcpHandler);

const server = createHttpServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestPath = req.url?.split('?')[0] ?? '/';
  if (await handleOAuth(req, res, requestPath)) return;

  if (requestPath === '/health' && req.method === 'GET') {
    handleHealth(res);
    return;
  }

  if (requestPath === '/' || requestPath === '/mcp') {
    if (!isAuthorized(req.headers)) {
      unauthorized(res);
      return;
    }
    const authorization = req.headers.authorization ?? '';
    const tokenMatch = /^Bearer\\s+(.+)$/i.exec(authorization.trim());
    const token = tokenMatch?.[1] ?? '';
    const clientId = token ? getOAuthAccessClientId(token) : null;
    const principal = clientId
      ? { kind: 'oauth' as const, clientId }
      : token
        ? { kind: 'legacy-shared-token' as const }
        : { kind: 'unknown' as const };
    await runWithRequestPrincipal(principal, () => nodeHandler(req, res));
    return;
  }

  handleNotFound(res);
});

server.listen(runtimeConfig.port, runtimeConfig.host, () => {
  console.log(`Tambala MCP HTTP server listening on ${runtimeConfig.host}:${runtimeConfig.port}`);
});
