import type { OrganizationDefinition } from './model.js';

/**
 * Validate structural integrity before an organization definition is loaded.
 * This is configuration validation, not a substitute for authorization.
 */
export function validateOrganization(
  organization: OrganizationDefinition,
): string[] {
  const errors: string[] = [];
  const unitIds = new Set<string>();
  const roleIds = new Set<string>();

  for (const unit of organization.units) {
    if (unitIds.has(unit.id)) errors.push(`Duplicate unit id: ${unit.id}`);
    unitIds.add(unit.id);
  }

  for (const role of organization.roles) {
    if (roleIds.has(role.id)) errors.push(`Duplicate role id: ${role.id}`);
    roleIds.add(role.id);
  }

  if (!organization.id.trim()) errors.push('Organization id must not be empty.');
  if (!organization.name.trim()) errors.push('Organization name must not be empty.');
  if (!organization.mission.trim()) errors.push('Organization mission must not be empty.');

  for (const roleId of [
    organization.ownerRoleId,
    organization.ceoRoleId,
    organization.boardRoleId,
    organization.executiveCouncilRoleId,
  ]) {
    if (!roleIds.has(roleId)) errors.push(`Organization references missing leadership role: ${roleId}`);
  }

  for (const unit of organization.units) {
    if (unit.parentId && !unitIds.has(unit.parentId)) {
      errors.push(`Unit ${unit.id} references missing parent unit: ${unit.parentId}`);
    }
    for (const roleId of unit.accountableRoleIds) {
      if (!roleIds.has(roleId)) errors.push(`Unit ${unit.id} references missing accountable role: ${roleId}`);
    }
  }

  for (const role of organization.roles) {
    if (role.unitId && !unitIds.has(role.unitId)) {
      errors.push(`Role ${role.id} references missing unit: ${role.unitId}`);
    }
    if (role.reportsToRoleId && !roleIds.has(role.reportsToRoleId)) {
      errors.push(`Role ${role.id} reports to missing role: ${role.reportsToRoleId}`);
    }
  }

  detectCycles(
    organization.units.map((unit) => ({ id: unit.id, parentId: unit.parentId })),
    'unit',
    errors,
  );
  detectCycles(
    organization.roles.map((role) => ({ id: role.id, parentId: role.reportsToRoleId })),
    'role reporting',
    errors,
  );

  return errors;
}

function detectCycles(
  nodes: Array<{ id: string; parentId: string | null }>,
  label: string,
  errors: string[],
): void {
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  const completed = new Set<string>();

  for (const node of nodes) {
    if (completed.has(node.id)) continue;
    const path = new Set<string>();
    let current: string | null | undefined = node.id;

    while (current && parentById.has(current) && !completed.has(current)) {
      if (path.has(current)) {
        errors.push(`Cycle detected in ${label} hierarchy at ${current}`);
        break;
      }
      path.add(current);
      current = parentById.get(current);
    }
    for (const id of path) completed.add(id);
  }
}
