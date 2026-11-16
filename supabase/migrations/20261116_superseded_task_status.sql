-- Preserve a distinct terminal state for attempts intentionally replaced by newer work.
alter table public.organization_tasks
  drop constraint if exists organization_tasks_status_check;

alter table public.organization_tasks
  add constraint organization_tasks_status_check
  check (status = any (array[
    'created','ceo_analyzing','delegated','executing','waiting_for_tool',
    'department_review','returned_to_ceo','needs_more_work','awaiting_founder',
    'superseded','completed','failed'
  ]));
