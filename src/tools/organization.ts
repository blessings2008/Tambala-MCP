import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { getOrganizationSnapshot, getOrganizationSummary } from '../organization/service.js';

function text(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text'; text: JSON.stringify(value, null, 2) }] };
}

export function registerOrganizationTools(server: McpServer): void {
  server.registerTool(
    'get_organization_summary',
    {
      description: 'Read the current Tambala Organization blueprint: leadership roles, organizational units, activation status, and structural validation.',
      inputSchema: {},
    },
    async () => text(getOrganizationSummary()),
  );

  server.registerTool(
    'get_organization_definition',
    {
      description: 'Read the full initial organization definition, including role responsibilities, capabilities, reporting lines, unit purposes, and structural validation. Read-only.',
      inputSchema: {
        includePlanned: z.boolean().optional().default(true).describe('Include units and roles that are designed but not yet activated.'),
      },
    },
    async ({ includePlanned }) => {
      const snapshot = getOrganizationSnapshot();
      const organization = snapshot.organization;
      return text({
        ...organization,
        units: includePlanned ? organization.units : organization.units.filter((unit) => unit.status === 'active'),
        roles: includePlanned ? organization.roles : organization.roles.filter((role) => role.activation === 'active'),
        validation: snapshot.validation,
      });
    },
  );
}
