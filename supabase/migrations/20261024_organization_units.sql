-- Organization units (divisions, departments, business units).
-- Safe to run on a project that already has this table.
create table if not exists public.organization_units (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('division','department','business_unit')),
  parent_id text references public.organization_units(id) on delete restrict,
  purpose text not null,
  status text not null default 'planned' check (status in ('planned','active','paused','retired')),
  accountable_role_ids text[] not null default '{}',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.organization_units enable row level security;
revoke all on public.organization_units from anon, authenticated;
