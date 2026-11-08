-- Workforce layer: standing duties run on a schedule, daily briefings, and approval payloads.

create table if not exists public.organization_duty_runs (
  id uuid primary key default gen_random_uuid(),
  duty_id text not null,
  period_key text not null,
  role_id text not null references public.organization_roles(id) on delete restrict,
  task_id text,
  status text not null check (status in ('running','completed','awaiting_approval','skipped','failed')),
  attempts integer not null default 0,
  summary text,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  -- One run per duty per period (day or ISO week). This is what makes scheduling idempotent across instances.
  unique (duty_id, period_key)
);
create index if not exists organization_duty_runs_started_idx on public.organization_duty_runs(started_at desc);
create index if not exists organization_duty_runs_role_idx on public.organization_duty_runs(role_id, started_at desc);

create table if not exists public.organization_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('daily_briefing')),
  period_key text not null,
  title text not null,
  body text not null,
  task_id text,
  created_at timestamptz not null default now()
);
create index if not exists organization_reports_kind_created_idx on public.organization_reports(kind, created_at desc);

-- Approval requests now carry the prepared work (drafts etc.) and the task that produced it.
alter table public.organization_approval_requests add column if not exists task_id text;
alter table public.organization_approval_requests add column if not exists content text;

alter table public.organization_duty_runs enable row level security;
alter table public.organization_reports enable row level security;
revoke all on public.organization_duty_runs from anon, authenticated;
revoke all on public.organization_reports from anon, authenticated;
