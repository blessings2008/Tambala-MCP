# Organization identity and approval enforcement

## Current identity model

The HTTP transport verifies its bearer token first. OAuth access tokens carry a signed OAuth client ID; the HTTP layer attaches that verified client ID to request-scoped async context. Organization tools do not accept role IDs or approval claims as tool arguments.

The server resolves the verified OAuth client ID through `public.organization_actor_bindings`, then loads the bound role from `public.organization_roles`. A role is accepted only when the binding is active, exactly one binding exists, exactly one role exists, and that role is active.

The legacy shared `TAMBALA_MCP_TOKEN` can authenticate transport access but cannot identify a unique person or agent. It intentionally receives no organization role.

## Binding a client to a role

Bindings are deliberately not created automatically. An authorized operator must verify the OAuth client ID out-of-band and create a binding in the Supabase SQL editor. Do not let a model or MCP tool self-assign a role.

Example only — replace the placeholder with the exact verified OAuth client ID for the intended client:

```sql
insert into public.organization_actor_bindings
  (principal_type, principal_id, role_id, active)
values
  ('oauth_client', 'REPLACE_WITH_VERIFIED_OAUTH_CLIENT_ID', 'founder', true);
```

Only bind the Founder role to a client whose ownership and control you have independently verified. Do not bind arbitrary AI clients to the Founder role. The unique constraint prevents more than one binding per OAuth client. To revoke a binding, an authorized database operator can set `active = false`.

The Founder role is currently the only active organizational role. The Board, CEO, and department roles are planned and will not resolve as active identities until deliberately activated.

## Governance data integrity

- Audit events are append-only; updates and deletes are rejected by a database trigger.
- Approval requests cannot be deleted, and a pending request can only transition to approved, rejected, or cancelled.
- Approval request details cannot be rewritten during resolution.
- Approved/rejected requests require an active resolver role that matches the request's required authority.
- Finalized decisions cannot be rewritten or deleted; create a superseding decision instead.
- Organization governance tables are server-side only, with RLS enabled and direct `anon`/`authenticated` grants revoked.

## Important boundary

These controls establish trusted identity lookup and database invariants. They do not yet authorize or execute consequential business actions, and they do not yet expose approval mutation tools. Before such tools are enabled, the server must combine the resolved role, deterministic policy, a persisted matching approval record, and a final action-specific check; it must write an audit event and fail closed on errors. The database service-role key must remain server-side and must never be accepted as a tool argument or committed to the repository.
