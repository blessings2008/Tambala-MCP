import { createServer as createHttpServer, IncomingHttpHeaders } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { mcpHandler } from './index.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const nodeHandler = toNodeHandler(mcpHandler);

function setCorsHeaders(res: import('node:http').ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

function configuredToken(): string {
  const token = process.env.TAMBALA_MCP_TOKEN;
  if (!token || token.length < 32) {
    throw new Error('TAMBALA_MCP_TOKEN must be configured and at least 32 characters long');
  }
  return token;
}

function providedToken(headers: IncomingHttpHeaders): string | null {
  const authorization = headers.authorization;
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function isAuthorized(headers: IncomingHttpHeaders): boolean {
  const expected = Buffer.from(configuredToken(), 'utf8');
  const provided = providedToken(headers);
  if (!provided) return false;
  const actual = Buffer.from(provided, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function unauthorized(res: import('node:http').ServerResponse) {
  res.writeHead(401, {
    'content-type': 'application/json',
    'WWW-Authenticate': 'Bearer',
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

const server = createHttpServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'tambala-mcp' }));
    return;
  }

  // Compatibility: both the existing Render root URL and the canonical /mcp path
  // serve the authenticated MCP endpoint. This keeps existing AI connectors working.
  const requestPath = req.url?.split('?')[0];
  if (requestPath === '/' || requestPath === '/mcp') {
    try {
      if (!isAuthorized(req.headers)) {
        unauthorized(res);
        return;
      }
    } catch (error) {
      console.error('MCP authentication is not configured correctly:', error);
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'MCP authentication is not configured' }));
      return;
    }

    await nodeHandler(req, res);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, host, () => {
  console.log(`Tambala MCP HTTP server listening on ${host}:${port}`);
});
