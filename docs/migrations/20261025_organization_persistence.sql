-- Tambala MCP organization persistence migration.
-- Apply to the SAME Supabase project already used by the MCP.
-- Additive only: does not replace existing operational tables or business data.

create table if not exists public.organization_roles (
  id text primary key,
  title text not null,
  kind text not null check (kind in ('human', 'ai_agent', 'shared_responsibility')),
  unit_id text references public.organization_units(id) on delete restrict,
  reports_to_role_id text references public.organization_roles(id) on delete restrict,
  purpose text not null,
  capabilities text[] not null default '{}',
  activation text not null default 'planned' check (activation in ('planned', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  rationale text not null,
  proposed_by_role_id text not null references public.organization_roles(id) on delete restrict,
  status text not null default 'proposed' check (status in ('proposed', 'pending_approval', 'approved', 'rejected', 'superseded')),
  required_authority text check (required_authority in ('founder', 'board', 'ceo', 'department_director')),
  evidence_refs text[] not null default '{}',
  decided_by_role_id text references public.organization_roles(id) on delete restrict,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.organization_approval_requests (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  summary text not null,
  requested_by_role_id text not null references public.organization_roles(id) on delete restrict,
  required_authority text not null check (required_authority in ('founder', 'board', 'ceo', 'department_director')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  decision_note text,
  resolved_by_role_id text references public.organization_roles(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.organization_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_role_id text references public.organization_roles(id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text not null,
  outcome text not null check (outcome in ('success', 'denied', 'failed')),
  reason text not null,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists organization_roles_unit_id_idx on public.organization_roles(unit_id);
create index if not exists organization_roles_reports_to_idx on public.organization_roles(reports_to_role_id);
create index if not exists organization_decisions_status_created_idx on public.organization_decisions(status, created_at desc);
create index if not exists organization_approval_requests_status_created_idx on public.organization_approval_requests(status, created_at desc);
create index if not exists organization_audit_events_created_idx on public.organization_audit_events(created_at desc);
create index if not exists organization_audit_events_target_idx on public.organization_audit_events(target_type, target_id);

alter table public.organization_roles enable row level security;
alter table public.organization_decisions enable row level security;
alter table public.organization_approval_requests enable row level security;
alter table public.organization_audit_events enable row level security;

revoke all on public.organization_roles from anon, authenticated;
revoke all on public.organization_decisions from anon, authenticated;
revoke all on public.organization_approval_requests from anon, authenticated;
revoke all on public.organization_audit_events from anon, authenticated;

-- Keep the MCP service-role path authoritative. Existing organization_units remain
-- the source of department structure; organization_roles stores the persistent
-- reporting/agent layer used by identity and authorization.
