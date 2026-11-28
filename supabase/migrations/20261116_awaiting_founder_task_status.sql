-- Distinguish tasks waiting for Founder input from work that genuinely needs a department revision.
alter table public.organization_tasks
  drop constraint if exists organization_tasks_status_check;

alter table public.organization_tasks
  add constraint organization_tasks_status_check
  check (status = any (array[
    'created','ceo_analyzing','delegated','executing','waiting_for_tool',
    'department_review','returned_to_ceo','needs_more_work','awaiting_founder',
    'completed','failed'
  ]));

with moved as (
  update public.organization_tasks t
  set status = 'awaiting_founder',
      current_stage = 'founder',
      updated_at = now()
  from public.organization_handoffs h
  where h.task_id = t.id
    and h.status = 'awaiting_founder'
    and t.status = 'needs_more_work'
  returning t.id, h.id as handoff_id
)
insert into public.organization_task_events(task_id,event_type,stage,actor_role_id,payload)
select id,'task_reclassified_awaiting_founder','founder','ceo',
       jsonb_build_object('handoffId',handoff_id,'reason','Existing handoff is awaiting Founder input; not department revision work.')
from moved;
