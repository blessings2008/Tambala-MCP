-- Durable runtime heartbeat and Founder-controlled global pause state.
-- Safe to re-run; no employee identities or existing records are rewritten.

create table if not exists public.organization_runtime_heartbeat (
  id text primary key check (id = 'duty-cycle'),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error text,
  alert_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.organization_runtime_heartbeat (id)
values ('duty-cycle')
on conflict (id) do nothing;

create or replace function public.claim_duty_heartbeat_alert(
  p_now timestamptz,
  p_stale_before timestamptz,
  p_cooldown_seconds integer default 3600
)
returns setof public.organization_runtime_heartbeat
language sql
security definer
set search_path = public
as $$
  update public.organization_runtime_heartbeat
     set alert_sent_at = p_now,
         updated_at = p_now
   where id = 'duty-cycle'
     and coalesce(last_completed_at, last_started_at) is not null
     and coalesce(last_completed_at, last_started_at) < p_stale_before
     and (alert_sent_at is null or alert_sent_at < p_now - make_interval(secs => greatest(60, p_cooldown_seconds)))
  returning *;
$$;

create table if not exists public.organization_runtime_control (
  id text primary key check (id = 'global'),
  paused boolean not null default false,
  reason text,
  paused_at timestamptz,
  paused_by_role_id text,
  updated_at timestamptz not null default now()
);

alter table public.organization_runtime_control
  add column if not exists signature_fingerprint text,
  add column if not exists signature_record_id uuid;

insert into public.organization_runtime_control (id, paused)
values ('global', false)
on conflict (id) do nothing;

alter table public.organization_runtime_heartbeat enable row level security;
alter table public.organization_runtime_control enable row level security;

revoke all on public.organization_runtime_heartbeat from public, anon, authenticated;
revoke all on public.organization_runtime_control from public, anon, authenticated;
grant select, update on public.organization_runtime_heartbeat to service_role;
grant select, update on public.organization_runtime_control to service_role;

revoke all on function public.claim_duty_heartbeat_alert(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_duty_heartbeat_alert(timestamptz, timestamptz, integer) to service_role;
