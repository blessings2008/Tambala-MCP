-- Align approval request storage with the fields used by the workforce approval service.
-- Additive and safe to re-run. Existing approval decisions and payloads are preserved.

alter table public.organization_approval_requests
  add column if not exists resolution_note text,
  add column if not exists subject_type text,
  add column if not exists subject_id text;

-- The original persistence migration used decision_note; the current service
-- reads resolution_note. Preserve legacy notes while moving reads to the
-- canonical service field.
update public.organization_approval_requests
   set resolution_note = decision_note
 where resolution_note is null
   and decision_note is not null;

create index if not exists organization_approval_requests_subject_idx
  on public.organization_approval_requests(subject_type, subject_id)
  where subject_type is not null and subject_id is not null;

create index if not exists organization_approval_requests_task_idx
  on public.organization_approval_requests(task_id)
  where task_id is not null;

comment on column public.organization_approval_requests.subject_type is
  'Typed approval subject namespace used to invoke a registered post-decision hook.';
comment on column public.organization_approval_requests.subject_id is
  'Exact subject record identifier bound to the approval request.';
comment on column public.organization_approval_requests.resolution_note is
  'Canonical note recorded with the Founder or authorized authority decision.';
