import { createServer as createHttpServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { mcpHandler } from './index.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const nodeHandler = toNodeHandler(mcpHandler);

const server = createHttpServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'tambala-mcp' }));
    return;
  }

  if (req.url === '/mcp') {
    await nodeHandler(req, res);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, host, () => {
  console.log(`Tambala MCP HTTP server listening on ${host}:${port}`);
});
