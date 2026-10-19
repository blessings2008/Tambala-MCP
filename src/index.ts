import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

function createServer(): McpServer {
  const server = new McpServer({
    name: 'tambala-mcp',
    version: '0.1.0',
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
    async ({ topic }) => {
      const information = {
        company: 'Tambala Technologies',
        country: 'Malawi',
        focus: 'Software, websites, and digital products',
        topic: topic ?? 'general',
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(information, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

void serveStdio(createServer);
console.error('Tambala MCP server running on stdio');
