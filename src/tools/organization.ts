import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseSelect } from '../lib/supabase.js';
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

  server.registerTool(
    'list_pending_organization_approvals',
    {
      description: 'Read pending approval requests from the organization governance register. This tool does not approve or reject requests.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().default(25).describe('Maximum number of pending requests to return (1–100).'),
      },
    },
    async ({ limit }) => {
      const rows = await supabaseSelect<Record<string, unknown>>(
        'organization_approval_requests',
        `select=id,action_type,summary,requested_by_role_id,required_authority,status,risk_level,created_at&status=eq.pending&order=created_at.asc&limit=${limit}`,
      );
      return text({ count: rows.length, approvals: rows });
    },
  );

  server.registerTool(
    'get_recent_organization_decisions',
    {
      description: 'Read recent organizational decisions and their approval status. Read-only; this tool cannot make or change decisions.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().default(25).describe('Maximum number of decisions to return (1–100).'),
      },
    },
    async ({ limit }) => {
      const rows = await supabaseSelect<Record<string, unknown>>(
        'organization_decisions',
        `select=id,title,rationale,proposed_by_role_id,status,required_authority,evidence_refs,decided_by_role_id,created_at,decided_at&order=created_at.desc&limit=${limit}`,
      );
      return text({ count: rows.length, decisions: rows });
    },
  );

  server.registerTool(
    'get_organization_audit_log',
    {
      description: 'Read recent organization governance audit events, including denied attempts. Read-only; no audit event can be modified through this tool.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().default(25).describe('Maximum number of audit events to return (1–100).'),
      },
    },
    async ({ limit }) => {
      const rows = await supabaseSelect<Record<string, unknown>>(
        'organization_audit_events',
        `select=id,actor_role_id,action,target_type,target_id,outcome,reason,correlation_id,created_at&order=created_at.desc&limit=${limit}`,
      );
      return text({ count: rows.length, events: rows });
    },
  );
}
