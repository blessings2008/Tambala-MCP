-- Repair for Render logs reporting PGRST205: public.oauth_revoked_tokens is missing.
-- This is separate from bind_founder.sql. Run once in the Tambala MCP Supabase SQL editor
-- only if the table is absent from the SAME project referenced by Render's SUPABASE_URL.

create table if not exists public.oauth_revoked_tokens (
  jti text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_revoked_tokens_expires_at_idx
  on public.oauth_revoked_tokens (expires_at);

alter table public.oauth_revoked_tokens enable row level security;
revoke all on table public.oauth_revoked_tokens from public, anon, authenticated;
grant select, insert on table public.oauth_revoked_tokens to service_role;

notify pgrst, 'reload schema';
