-- Idempotent correlation between a planned step and its existing staff handoff.
-- Existing handoffs remain untouched; only non-null plan dispatch keys are unique.

alter table public.organization_handoffs
  add column if not exists dispatch_key text null;

create unique index if not exists organization_handoffs_dispatch_key_unique
  on public.organization_handoffs(dispatch_key)
  where dispatch_key is not null;

comment on column public.organization_handoffs.dispatch_key is
  'Stable plan-step correlation key. A unique partial index prevents duplicate handoffs across retries.';
