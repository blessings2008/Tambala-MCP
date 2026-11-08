-- Maps a verified OAuth client to exactly one organization role.
-- Rows are created only by an administrator (service role / SQL editor).
create table if not exists public.organization_actor_bindings (
  id uuid primary key default gen_random_uuid(),
  principal_type text not null check (principal_type in ('oauth_client')),
  principal_id text not null,
  role_id text not null references public.organization_roles(id) on delete restrict,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
-- At most one active binding per principal, so identity is never ambiguous.
create unique index if not exists organization_actor_bindings_one_active
  on public.organization_actor_bindings(principal_type, principal_id) where active;
alter table public.organization_actor_bindings enable row level security;
revoke all on public.organization_actor_bindings from anon, authenticated;
