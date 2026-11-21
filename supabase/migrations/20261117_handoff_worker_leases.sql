-- Lease and heartbeat metadata for existing staff handoffs.
-- Expired running work is quarantined for Founder review, never replayed blindly.

alter table public.organization_handoffs
  add column if not exists claimed_at timestamptz null,
  add column if not exists heartbeat_at timestamptz null;

-- Preserve visibility of any handoff that was already running before this migration.
update public.organization_handoffs
set claimed_at = coalesce(claimed_at, created_at),
    heartbeat_at = coalesce(heartbeat_at, claimed_at, created_at)
where status = 'running';

create index if not exists organization_handoffs_running_heartbeat_idx
  on public.organization_handoffs(status, heartbeat_at)
  where status = 'running';

comment on column public.organization_handoffs.claimed_at is
  'Timestamp when a worker atomically claimed the handoff.';
comment on column public.organization_handoffs.heartbeat_at is
  'Latest worker heartbeat. Expired running work is quarantined for Founder review rather than automatically replayed.';
