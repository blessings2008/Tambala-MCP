import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { sendZapClawTestText } from './integrations/zapclaw-test-send.js';

const require = createRequire(import.meta.url);
const http = require('node:http') as typeof import('node:http');
const originalCreateServer = http.createServer.bind(http);

function json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function authorized(req: import('node:http').IncomingMessage): boolean {
  const expected = process.env.TAMBALA_CHAT_TEST_TOKEN;
  const header = req.headers.authorization ?? '';
  return Boolean(expected && header === `Bearer ${expected}`);
}

async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 8_000) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

http.createServer = ((...args: Parameters<typeof http.createServer>) => {
  const listener = args[0];
  const wrapped = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const path = req.url?.split('?')[0] ?? '/';

    if (path === '/whatsapp-test' && req.method === 'GET') {
      try {
        const html = await readFile(new URL('../public/whatsapp-test.html', import.meta.url));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(html);
      } catch {
        json(res, 500, { error: 'WhatsApp test page is unavailable.' });
      }
      return;
    }

    if (path === '/api/whatsapp-test/send' && req.method === 'POST') {
      if (!authorized(req)) {
        json(res, 401, { error: 'Unauthorized. Check the chat test token.' });
        return;
      }
      if (!req.headers['content-type']?.toLowerCase().includes('application/json')) {
        json(res, 415, { error: 'Content-Type must be application/json.' });
        return;
      }
      try {
        const body = await readBody(req) as { to?: unknown; text?: unknown };
        if (typeof body.to !== 'string' || typeof body.text !== 'string') {
          json(res, 400, { error: 'Provide a recipient number and message.' });
          return;
        }
        const result = await sendZapClawTestText(body.to, body.text);
        json(res, 200, { ok: true, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'WhatsApp test send failed.';
        console.error('WhatsApp test send failed:', message);
        json(res, 502, { error: message });
      }
      return;
    }

    if (typeof listener === 'function') {
      return listener(req, res);
    }
    listener.emit('request', req, res);
  };

  return originalCreateServer(wrapped as Parameters<typeof http.createServer>[0]);
}) as typeof http.createServer;

syncBuiltinESMExports();
