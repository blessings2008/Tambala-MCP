-- AI provider usage ledger. Append-only usage records; USD cost is NULL when model pricing is not configured.
create table if not exists public.organization_ai_usage (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null,
  agent text not null,
  provider text not null,
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  cost_usd numeric(14,8),
  cost_status text not null default 'unpriced' check (cost_status in ('priced','unpriced')),
  created_at timestamptz not null default now()
);
create index if not exists organization_ai_usage_created_at_idx on public.organization_ai_usage(created_at desc);
create index if not exists organization_ai_usage_employee_day_idx on public.organization_ai_usage(employee_number, created_at desc);
alter table public.organization_ai_usage enable row level security;
revoke all on public.organization_ai_usage from public, anon, authenticated;
grant select, insert on public.organization_ai_usage to service_role;
