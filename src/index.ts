import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerTambalaTools } from './tools/tambala.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'tambala-mcp',
    version: '0.3.0',
  });

  registerTambalaTools(server);

  return server;
}

if (process.env.MCP_TRANSPORT === 'stdio') {
  void serveStdio(createServer);
  console.error('Tambala MCP server running on stdio');
}

export const mcpHandler = createMcpHandler(createServer);
