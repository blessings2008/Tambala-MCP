import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { getPersistedOrganizationSnapshot } from '../organization/persisted-service.js';

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function registerOrganizationTools(server: McpServer): void {
  server.registerTool(
    'get_organization_summary',
    {
      description: 'Read the current Tambala Organization structure from persistent storage, including leadership roles, organizational units, activation status, and structural validation.',
      inputSchema: {},
    },
    async () => {
      const snapshot = await getPersistedOrganizationSnapshot();
      const organization = snapshot.organization;
      return text({
        id: organization.id,
        name: organization.name,
        mission: organization.mission,
        leadership: {
          ownerRoleId: organization.ownerRoleId,
          boardRoleId: organization.boardRoleId,
          ceoRoleId: organization.ceoRoleId,
          executiveCouncilRoleId: organization.executiveCouncilRoleId,
        },
        units: organization.units.map(({ id, name, kind, status, parentId }) => ({
          id, name, kind, status, parentId,
        })),
        roles: organization.roles.map(({ id, title, kind, unitId, reportsToRoleId, activation }) => ({
          id, title, kind, unitId, reportsToRoleId, activation,
        })),
        validation: snapshot.validation,
        source: snapshot.source,
      });
    },
  );

  server.registerTool(
    'get_organization_definition',
    {
      description: 'Read the full organization definition, including role responsibilities, capabilities, reporting lines, unit purposes, and structural validation. Read-only.',
      inputSchema: {
        includePlanned: z.boolean().optional().default(true).describe('Include units and roles that are designed but not yet activated.'),
      },
    },
    async ({ includePlanned }) => {
      const snapshot = await getPersistedOrganizationSnapshot();
      const organization = snapshot.organization;
      return text({
        ...organization,
        units: includePlanned ? organization.units : organization.units.filter((unit) => unit.status === 'active'),
        roles: includePlanned ? organization.roles : organization.roles.filter((role) => role.activation === 'active'),
        validation: snapshot.validation,
        source: snapshot.source,
      });
    },
  );
}
