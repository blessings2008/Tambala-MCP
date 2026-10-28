import { getPersistedOrganizationSnapshot } from './persisted-service.js';

/**
 * Return the organization from the existing Tambala MCP database when configured.
 * Local development without Supabase credentials may still use the seed fallback
 * implemented by the persisted service.
 */
export async function getOrganizationSnapshot() {
  return getPersistedOrganizationSnapshot();
}

export async function getOrganizationSummary() {
  const snapshot = await getOrganizationSnapshot();
  return {
    id: snapshot.organization.id,
    name: snapshot.organization.name,
    mission: snapshot.organization.mission,
    leadership: {
      ownerRoleId: snapshot.organization.ownerRoleId,
      boardRoleId: snapshot.organization.boardRoleId,
      ceoRoleId: snapshot.organization.ceoRoleId,
      executiveCouncilRoleId: snapshot.organization.executiveCouncilRoleId,
    },
    source: snapshot.source,
    units: snapshot.organization.units.map(({ id, name, kind, status, parentId }) => ({
      id,
      name,
      kind,
      status,
      parentId,
    })),
    roles: snapshot.organization.roles.map(({ id, title, kind, unitId, reportsToRoleId, activation }) => ({
      id,
      title,
      kind,
      unitId,
      reportsToRoleId,
      activation,
    })),
    validation: snapshot.validation,
  };
}
