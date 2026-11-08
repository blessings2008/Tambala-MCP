-- Bind your connection to the Founder role so write tools work with TAMBALA_ENFORCE_ROLE_BINDINGS=true.
-- Find your OAuth client id by calling the MCP tool get_my_organization_identity (it reports the denial with the client id in the audit log),
-- or read it from organization_audit_events (target_type='oauth_client').
insert into public.organization_actor_bindings (principal_type, principal_id, role_id, note)
values ('oauth_client', '<PASTE_OAUTH_CLIENT_ID>', 'founder', 'Founder connection');
