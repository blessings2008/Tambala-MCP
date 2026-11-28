-- Per-employee/action trust ledger. Trust never grants authority to change permissions or financial/regulatory actions.
create table if not exists public.organization_employee_trust (
  employee_number text not null,
  action_type text not null,
  consecutive_approvals integer not null default 0 check (consecutive_approvals >= 0),
  standing_approval boolean not null default false,
  demoted_reason text,
  updated_at timestamptz not null default now(),
  primary key (employee_number, action_type)
);
alter table public.organization_employee_trust enable row level security;
revoke all on public.organization_employee_trust from public, anon, authenticated;
grant select, insert, update on public.organization_employee_trust to service_role;

create or replace function public.record_employee_trust_outcome(
  p_employee_number text,
  p_action_type text,
  p_approved boolean,
  p_unedited boolean,
  p_eligible boolean,
  p_now timestamptz default now()
)
returns public.organization_employee_trust
language plpgsql
security definer
set search_path = public
as $$
declare result public.organization_employee_trust;
begin
  insert into public.organization_employee_trust(employee_number, action_type, consecutive_approvals, standing_approval, demoted_reason, updated_at)
  values (
    p_employee_number, p_action_type,
    case when p_approved and p_unedited and p_eligible then 1 else 0 end,
    false,
    case when not p_approved then 'Founder rejected the action' when not p_unedited then 'Founder edited or added a note to the approval' when not p_eligible then 'Action type is not eligible for standing approval' else null end,
    p_now
  )
  on conflict (employee_number, action_type) do update set
    consecutive_approvals = case
      when p_approved and p_unedited and p_eligible then public.organization_employee_trust.consecutive_approvals + 1
      else 0 end,
    standing_approval = case
      when p_approved and p_unedited and p_eligible then public.organization_employee_trust.consecutive_approvals + 1 >= 20
      else false end,
    demoted_reason = case
      when p_approved and p_unedited and p_eligible then null
      when not p_approved then 'Founder rejected the action'
      when not p_unedited then 'Founder edited or added a note to the approval'
      else 'Action type is not eligible for standing approval' end,
    updated_at = p_now
  returning * into result;
  return result;
end;
$$;

create or replace function public.demote_employee_trust(
  p_employee_number text,
  p_reason text,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  update public.organization_employee_trust
     set standing_approval = false,
         consecutive_approvals = 0,
         demoted_reason = left(p_reason, 240),
         updated_at = p_now
   where employee_number = p_employee_number;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.record_employee_trust_outcome(text,text,boolean,boolean,boolean,timestamptz) from public, anon, authenticated;
revoke all on function public.demote_employee_trust(text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_employee_trust_outcome(text,text,boolean,boolean,boolean,timestamptz) to service_role;
grant execute on function public.demote_employee_trust(text,text,timestamptz) to service_role;
