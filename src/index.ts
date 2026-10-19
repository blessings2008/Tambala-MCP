import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'tambala-mcp',
    version: '0.2.0',
  });

  server.registerTool(
    'get_tambala_info',
    {
      description: 'Get basic information about Tambala Technologies.',
      inputSchema: z.object({
        topic: z
          .string()
          .optional()
          .describe('Optional topic, such as company, products, or services.'),
      }),
    },
    async ({ topic }) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              company: 'Tambala Technologies',
              country: 'Malawi',
              focus: 'Software, websites, and digital products',
              topic: topic ?? 'general',
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}

// Local MCP clients can still run this server over stdio.
if (process.env.MCP_TRANSPORT === 'stdio') {
  void serveStdio(createServer);
  console.error('Tambala MCP server running on stdio');
}

// HTTP handler for remote MCP deployments.
export const mcpHandler = createMcpHandler(createServer);
