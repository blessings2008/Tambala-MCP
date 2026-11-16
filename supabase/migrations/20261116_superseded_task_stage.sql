-- Allow the terminal superseded stage for historical task attempts.
alter table public.organization_tasks
  drop constraint if exists organization_tasks_current_stage_check;

alter table public.organization_tasks
  add constraint organization_tasks_current_stage_check
  check (current_stage = any (array[
    'founder','ceo','department','review','complete','failed','superseded'
  ]));
