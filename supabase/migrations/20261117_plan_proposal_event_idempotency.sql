-- Idempotent append-only plan proposal events on existing organization tasks.
-- Null event keys preserve the behavior of all existing task-event writers.

alter table public.organization_task_events
  add column if not exists event_key text null;

create unique index if not exists organization_task_events_event_key_unique
  on public.organization_task_events(event_key)
  where event_key is not null;

comment on column public.organization_task_events.event_key is
  'Optional idempotency key for retry-safe workflow events such as versioned plan proposals.';
