-- Staff names, handoffs between employees, and no-code duty configuration.

create table if not exists public.organization_staff_names (
  role_id text primary key references public.organization_roles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_handoffs (
  id uuid primary key default gen_random_uuid(),
  from_role_id text not null references public.organization_roles(id) on delete restrict,
  to_role_id text not null references public.organization_roles(id) on delete restrict,
  to_agent text not null,
  request text not null check (char_length(request) between 5 and 1000),
  context_summary text,
  source_task_id text,
  source_duty_id text,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  attempts integer not null default 0,
  result text,
  error text,
  task_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists organization_handoffs_status_idx on public.organization_handoffs(status, created_at);
create index if not exists organization_handoffs_created_idx on public.organization_handoffs(created_at desc);

-- Founder overrides of built-in duties (enable/disable, time, wording).
create table if not exists public.organization_duty_config (
  duty_id text primary key,
  enabled boolean not null default true,
  time text check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  job text check (job is null or char_length(job) <= 2000),
  deliverable text check (deliverable is null or char_length(deliverable) <= 1000),
  updated_at timestamptz not null default now()
);

-- Duties the Founder adds from the dashboard.
create table if not exists public.organization_custom_duties (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  agent text not null,
  title text not null check (char_length(title) between 3 and 120),
  cadence_kind text not null check (cadence_kind in ('weekdays','weekly')),
  cadence_day integer check (cadence_day between 1 and 7),
  time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  contexts text[] not null default '{}',
  job text not null check (char_length(job) between 10 and 2000),
  deliverable text not null check (char_length(deliverable) between 5 and 1000),
  requires_approval boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  check ((cadence_kind = 'weekly' and cadence_day is not null) or (cadence_kind = 'weekdays' and cadence_day is null))
);

alter table public.organization_staff_names enable row level security;
alter table public.organization_handoffs enable row level security;
alter table public.organization_duty_config enable row level security;
alter table public.organization_custom_duties enable row level security;
revoke all on public.organization_staff_names from anon, authenticated;
revoke all on public.organization_handoffs from anon, authenticated;
revoke all on public.organization_duty_config from anon, authenticated;
revoke all on public.organization_custom_duties from anon, authenticated;
