-- Claim at most one customer message at a time across all workers.
-- The outbox intentionally sends one customer message per pass. Claiming a whole
-- batch first allowed concurrent scheduler/agent runs to strand later rows as
-- 'sending' before they were attempted.
create or replace function public.claim_organization_outbox(p_limit integer default 10)
returns setof public.organization_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize claim decisions. The row remains 'sending' after this transaction,
  -- so the next caller sees it and cannot claim a second customer message.
  perform pg_advisory_xact_lock(hashtext('organization_outbox_claim'));

  -- Do not blindly retry a send whose provider outcome is unknown.
  update public.organization_messages
     set status = 'failed',
         reason = 'Worker lease expired; delivery outcome is unknown. Check the WhatsApp chat before manually retrying.',
         claimed_at = null
   where direction = 'out'
     and status = 'sending'
     and claimed_at < now() - interval '10 minutes';

  return query
    with client_candidate as (
      select message.id, message.created_at
        from public.organization_messages as message
       where message.direction = 'out'
         and message.audience = 'client'
         and message.status = 'queued'
         and not exists (
           select 1
             from public.organization_messages as active
            where active.direction = 'out'
              and active.audience = 'client'
              and active.status = 'sending'
         )
       order by message.created_at asc
       for update skip locked
       limit 1
    ),
    founder_candidates as (
      select message.id, message.created_at
        from public.organization_messages as message
       where message.direction = 'out'
         and message.audience = 'founder'
         and message.status = 'queued'
       order by message.created_at asc
       for update skip locked
       limit greatest(1, least(coalesce(p_limit, 10), 100))
    ),
    candidates as (
      select id, created_at from client_candidate
      union all
      select id, created_at from founder_candidates
    )
    update public.organization_messages as message
       set status = 'sending',
           claimed_at = now()
      from candidates
     where message.id = candidates.id
    returning message.*;
end;
$$;

revoke all on function public.claim_organization_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_organization_outbox(integer) to service_role;
