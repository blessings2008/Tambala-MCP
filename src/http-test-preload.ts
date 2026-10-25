import { createRequire, syncBuiltinESMExports } from 'node:module';
import { readFile } from 'node:fs/promises';
import { sendZapClawTestText } from './integrations/zapclaw-test-send.js';

const require = createRequire(import.meta.url);
const http = require('node:http') as typeof import('node:http');
const originalCreateServer = http.createServer.bind(http);

type Request = import('node:http').IncomingMessage;
type Response = import('node:http').ServerResponse;

function json(res: Response, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function authorized(req: Request): boolean {
  const expected = process.env.TAMBALA_CHAT_TEST_TOKEN;
  return Boolean(expected && req.headers.authorization === `Bearer ${expected}`);
}

async function readBody(req: Request): Promise<unknown> {
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

const patchedCreateServer = ((...args: any[]) => {
  const listener = args[0];
  const wrapped = async (req: Request, res: Response): Promise<void> => {
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
      await listener(req, res);
      return;
    }
    throw new Error('Unsupported createServer invocation in Tambala HTTP bootstrap.');
  };

  return originalCreateServer(wrapped as any);
}) as typeof http.createServer;

http.createServer = patchedCreateServer;
syncBuiltinESMExports();
