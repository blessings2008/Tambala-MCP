import { supabaseSelect } from '../lib/supabase.js';
import type {
  OrganizationDefinition,
  OrganizationUnit,
  OrganizationalRole,
} from './model.js';
import { initialOrganization } from './seed.js';
import { validateOrganization } from './validate.js';

type UnitRow = {
  id: string;
  name: string;
  kind: OrganizationUnit['kind'];
  parent_id: string | null;
  purpose: string;
  status: OrganizationUnit['status'];
  accountable_role_ids: string[] | null;
  tags: string[] | null;
};

type RoleRow = {
  id: string;
  title: string;
  kind: OrganizationalRole['kind'];
  unit_id: string | null;
  reports_to_role_id: string | null;
  purpose: string;
  capabilities: string[] | null;
  activation: OrganizationalRole['activation'];
};

/**
 * Load organizational units and roles from the existing Supabase project.
 * The Founder/CEO/Board identifiers and mission remain application-level charter
 * metadata until that charter itself is persisted in a dedicated table.
 */
export async function getPersistedOrganizationSnapshot(): Promise<{
  organization: OrganizationDefinition;
  validation: { valid: boolean; errors: string[] };
  source: 'supabase' | 'seed-fallback';
}> {
  // Local tests and local development may run without production credentials.
  // When credentials are configured, database/network errors are surfaced rather
  // than silently hiding stale or unavailable persistent state.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const organization = structuredClone(initialOrganization);
    const errors = validateOrganization(organization);
    return { organization, validation: { valid: errors.length === 0, errors }, source: 'seed-fallback' };
  }

  const [unitRows, roleRows] = await Promise.all([
    supabaseSelect<UnitRow>(
      'organization_units',
      'select=id,name,kind,parent_id,purpose,status,accountable_role_ids,tags&order=kind.asc,name.asc',
    ),
    supabaseSelect<RoleRow>(
      'organization_roles',
      'select=id,title,kind,unit_id,reports_to_role_id,purpose,capabilities,activation&order=title.asc',
    ),
  ]);

  const units: OrganizationUnit[] = unitRows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    purpose: row.purpose,
    status: row.status,
    accountableRoleIds: row.accountable_role_ids ?? [],
    tags: row.tags ?? [],
  }));

  const roles: OrganizationalRole[] = roleRows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    unitId: row.unit_id,
    reportsToRoleId: row.reports_to_role_id,
    purpose: row.purpose,
    capabilities: row.capabilities ?? [],
    activation: row.activation,
  }));

  const organization: OrganizationDefinition = {
    ...initialOrganization,
    units,
    roles,
  };
  const errors = validateOrganization(organization);
  return {
    organization,
    validation: { valid: errors.length === 0, errors },
    source: 'supabase',
  };
}
