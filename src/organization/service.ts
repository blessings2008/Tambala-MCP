import { initialOrganization } from './seed.js';
import { validateOrganization } from './validate.js';
export { createOrganizationTask, transitionTask } from './task-engine.js';
export type { OrganizationTask, OrganizationTaskEvent, TaskStatus, TaskEventType } from './task-engine.js';

/** Return a defensive copy so callers cannot mutate the in-memory seed. */
export function getOrganizationSnapshot() {
  const validationErrors = validateOrganization(initialOrganization);
  return {
    organization: structuredClone(initialOrganization),
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors,
    },
  };
}

export function getOrganizationSummary() {
  const snapshot = getOrganizationSnapshot();
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
