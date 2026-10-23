import { supabaseInsert, supabaseSelect } from '../lib/supabase.js';
import { getRequestPrincipal } from './request-context.js';
import type { OrganizationalRole } from './model.js';

type BindingRow = {
  principal_id: string;
  role_id: string;
  active: boolean;
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

export type ResolvedOrganizationIdentity =
  | { authenticated: true; principalType: 'oauth'; clientId: string; role: OrganizationalRole }
  | { authenticated: true; principalType: 'legacy-shared-token'; clientId: null; role: null }
  | { authenticated: false; principalType: 'unknown'; clientId: null; role: null; reason: string };

/**
 * Resolve a request identity only from the verified HTTP principal and persisted binding.
 * Tool arguments are never accepted as identity evidence. A shared legacy token authenticates
 * transport access but cannot identify an organizational role.
 */
export async function resolveOrganizationIdentity(): Promise<ResolvedOrganizationIdentity> {
  const principal = getRequestPrincipal();

  if (principal.kind === 'legacy-shared-token') {
    return {
      authenticated: true,
      principalType: 'legacy-shared-token',
      clientId: null,
      role: null,
    };
  }

  if (principal.kind !== 'oauth') {
    return {
      authenticated: false,
      principalType: 'unknown',
      clientId: null,
      role: null,
      reason: 'No verified OAuth principal is attached to this request.',
    };
  }

  const bindings = await supabaseSelect<BindingRow>(
    'organization_actor_bindings',
    `select=principal_id,role_id,active&principal_type=eq.oauth_client&principal_id=eq.${encodeURIComponent(principal.clientId)}&active=eq.true&limit=2`,
  );

  if (bindings.length !== 1) {
    const reason = bindings.length === 0
      ? 'OAuth client has no active organization role binding.'
      : 'Multiple active bindings exist for this OAuth client; refusing to choose an identity.';
    await supabaseInsert('organization_audit_events', {
      actor_role_id: null,
      action: 'resolve_organization_identity',
      target_type: 'oauth_client',
      target_id: principal.clientId,
      outcome: 'denied',
      reason,
    });
    return {
      authenticated: false,
      principalType: 'unknown',
      clientId: null,
      role: null,
      reason,
    };
  }

  const rows = await supabaseSelect<RoleRow>(
    'organization_roles',
    `select=id,title,kind,unit_id,reports_to_role_id,purpose,capabilities,activation&id=eq.${encodeURIComponent(bindings[0].role_id)}&limit=2`,
  );

  if (rows.length !== 1 || rows[0].activation !== 'active') {
    const reason = rows.length === 0
      ? 'Bound organization role does not exist.'
      : rows.length > 1
        ? 'Multiple role records match the binding.'
        : 'Bound organization role is not active.';
    await supabaseInsert('organization_audit_events', {
      actor_role_id: null,
      action: 'resolve_organization_identity',
      target_type: 'oauth_client',
      target_id: principal.clientId,
      outcome: 'denied',
      reason,
    });
    return {
      authenticated: false,
      principalType: 'unknown',
      clientId: null,
      role: null,
      reason,
    };
  }

  return {
    authenticated: true,
    principalType: 'oauth',
    clientId: principal.clientId,
    role: {
      id: rows[0].id,
      title: rows[0].title,
      kind: rows[0].kind,
      unitId: rows[0].unit_id,
      reportsToRoleId: rows[0].reports_to_role_id,
      purpose: rows[0].purpose,
      capabilities: rows[0].capabilities ?? [],
      activation: rows[0].activation,
    },
  };
}
