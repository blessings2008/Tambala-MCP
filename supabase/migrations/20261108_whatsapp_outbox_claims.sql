-- Reliable WhatsApp outbox claiming.
-- A claimed message is never automatically re-sent after a worker crash: the provider may
-- already have accepted it. Stale claims are moved to failed for manual reconciliation.

alter table public.organization_messages
  drop constraint if exists organization_messages_status_check;
alter table public.organization_messages
  add constraint organization_messages_status_check
  check (status in ('pending_approval','queued','sending','sent','failed','rejected','blocked','received'));

alter table public.organization_messages
  add column if not exists claimed_at timestamptz;

create index if not exists organization_messages_outbox_claim_idx
  on public.organization_messages(created_at)
  where direction = 'out' and status = 'queued';

create or replace function public.claim_organization_outbox(p_limit integer default 10)
returns setof public.organization_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Do not blindly retry a send whose provider outcome is unknown.
  update public.organization_messages
     set status = 'failed',
         reason = 'Worker lease expired; delivery outcome is unknown. Check the WhatsApp chat before manually retrying.',
         claimed_at = null
   where direction = 'out'
     and status = 'sending'
     and claimed_at < now() - interval '10 minutes';

  return query
    with candidates as (
      select id
        from public.organization_messages
       where direction = 'out' and status = 'queued'
       order by created_at asc
       for update skip locked
       limit greatest(1, least(coalesce(p_limit, 10), 100))
    )
    update public.organization_messages as message
       set status = 'sending', claimed_at = now()
      from candidates
     where message.id = candidates.id
    returning message.*;
end;
$$;

revoke all on function public.claim_organization_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_organization_outbox(integer) to service_role;
