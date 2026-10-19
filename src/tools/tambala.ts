import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';

const services = [
  {
    name: 'Web Development',
    description: 'Responsive websites and web applications for businesses and organizations.',
  },
  {
    name: 'Software Development',
    description: 'Custom software and digital products built around specific business needs.',
  },
  {
    name: 'Digital Product Development',
    description: 'Design and development of digital products and platforms.',
  },
];

const products = [
  {
    name: 'PocketVault',
    category: 'Savings platform',
    description: 'A digital savings product designed around organized savings goals and contributions.',
  },
  {
    name: 'Tambala Pay',
    category: 'Payments',
    description: 'A planned Tambala payments product.',
  },
  {
    name: 'Tambala Email',
    category: 'Business communication',
    description: 'A planned Tambala email service.',
  },
];

export function registerTambalaTools(server: McpServer): void {
  server.registerTool(
    'get_company_info',
    {
      description: 'Get the official basic profile of Tambala Technologies.',
      inputSchema: {
        topic: z.string().optional().describe('Optional topic such as company, focus, or location.'),
      },
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

  server.registerTool(
    'list_services',
    {
      description: 'List the services currently represented by Tambala MCP.',
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(services, null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    'list_products',
    {
      description: 'List Tambala Technologies products and their descriptions.',
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(products, null, 2),
        },
      ],
    }),
  );
}
