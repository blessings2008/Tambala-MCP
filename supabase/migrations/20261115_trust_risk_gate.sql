-- Replace the earlier trust RPC with an explicit risk-level gate.
-- Customer-facing and reserved-authority actions must never earn standing approval.

drop function if exists public.record_employee_trust_outcome(text,text,boolean,boolean,boolean,timestamptz);
drop function if exists public.record_employee_trust_outcome(text,text,boolean,boolean,boolean,text,timestamptz);

create function public.record_employee_trust_outcome(
  p_employee_number text,
  p_action_type text,
  p_approved boolean,
  p_unedited boolean,
  p_eligible boolean,
  p_risk_level text,
  p_now timestamptz default now()
)
returns public.organization_employee_trust
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.organization_employee_trust;
  can_earn boolean := p_approved and p_unedited and p_eligible and p_risk_level = 'low';
begin
  insert into public.organization_employee_trust(employee_number, action_type, consecutive_approvals, standing_approval, demoted_reason, updated_at)
  values (
    p_employee_number, p_action_type,
    case when can_earn then 1 else 0 end,
    false,
    case
      when not p_approved then 'Founder rejected the action'
      when p_risk_level <> 'low' then 'Only low-risk actions can earn standing approval'
      when not p_unedited then 'Founder edited the approved work'
      when not p_eligible then 'Action type is not eligible for standing approval'
      else null
    end,
    p_now
  )
  on conflict (employee_number, action_type) do update set
    consecutive_approvals = case
      when can_earn then public.organization_employee_trust.consecutive_approvals + 1
      else 0 end,
    standing_approval = case
      when can_earn then public.organization_employee_trust.consecutive_approvals + 1 >= 20
      else false end,
    demoted_reason = case
      when can_earn then null
      when not p_approved then 'Founder rejected the action'
      when p_risk_level <> 'low' then 'Only low-risk actions can earn standing approval'
      when not p_unedited then 'Founder edited the approved work'
      else 'Action type is not eligible for standing approval' end,
    updated_at = p_now
  returning * into result;
  return result;
end;
$$;

revoke all on function public.record_employee_trust_outcome(text,text,boolean,boolean,boolean,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_employee_trust_outcome(text,text,boolean,boolean,boolean,text,timestamptz) to service_role;
