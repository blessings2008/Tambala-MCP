-- Signature ledger: every piece of work an employee (or the Founder) signs is recorded here, append-only.

create table if not exists public.organization_signatures (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('duty_result','briefing','handoff_request','handoff_result','approval_decision')),
  role_id text not null,
  employee_number text not null check (employee_number ~ '^TT-[0-9]{3}$'),
  subject_id text not null,
  issued_at timestamptz not null,
  content text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  signature text not null check (signature ~ '^[0-9a-f]{64}$'),
  fingerprint text not null check (fingerprint ~ '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$'),
  algorithm text not null,
  created_at timestamptz not null default now()
);
create index if not exists organization_signatures_fingerprint_idx on public.organization_signatures(fingerprint);
create index if not exists organization_signatures_subject_idx on public.organization_signatures(subject_id);
create index if not exists organization_signatures_employee_idx on public.organization_signatures(employee_number, issued_at desc);

-- Append-only: even the service role cannot edit or remove a signed record.
create or replace function public.organization_signatures_block_change() returns trigger
language plpgsql as $$
begin
  raise exception 'organization_signatures is append-only';
end;
$$;
drop trigger if exists organization_signatures_no_update on public.organization_signatures;
create trigger organization_signatures_no_update before update or delete on public.organization_signatures
  for each row execute function public.organization_signatures_block_change();
drop trigger if exists organization_signatures_no_truncate on public.organization_signatures;
create trigger organization_signatures_no_truncate before truncate on public.organization_signatures
  for each statement execute function public.organization_signatures_block_change();

alter table public.organization_signatures enable row level security;
revoke all on public.organization_signatures from anon, authenticated;

-- Staff go by employee number only; the names table from the previous migration is retired.
drop table if exists public.organization_staff_names;
