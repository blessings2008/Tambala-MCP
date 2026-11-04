import { getPersistedOrganizationSnapshot } from './persisted-service.js';
import { buildResearchQuery, routeObjective } from './capability-registry.js';

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

/**
 * Resolve an objective to the organization's known capabilities before the CEO
 * creates a delegation. This keeps routing deterministic and prevents a model
 * from inventing departments or passing the entire Founder prompt to research.
 */
export async function routeOrganizationObjective(objective: string) {
  const snapshot = await getOrganizationSnapshot();
  return routeObjective(snapshot.organization, objective).map((match) => ({
    capabilityId: match.capability.id,
    departmentId: match.unit?.id ?? null,
    department: match.unit?.name ?? null,
    roleId: match.role?.id ?? null,
    role: match.role?.title ?? null,
    roleActivation: match.role?.activation ?? null,
    score: match.score,
    researchQuery: buildResearchQuery(objective, match),
    description: match.capability.description,
    deliverableHints: match.capability.deliverableHints,
  }));
}
