-- Attribute inbound customer replies to the outbound message that prompted them.
-- A quotation is marked accepted only after explicit acceptance language from a matched customer.

alter table public.organization_messages
  add column if not exists reply_to_message_id uuid references public.organization_messages(id) on delete set null;
alter table public.organization_messages
  add column if not exists reply_intent text check (reply_intent in ('accepted','interested','not_interested','question','other'));
create index if not exists organization_messages_reply_to_idx
  on public.organization_messages(reply_to_message_id) where reply_to_message_id is not null;

alter table public.organization_documents
  add column if not exists sent_at timestamptz;
alter table public.organization_documents
  add column if not exists accepted_at timestamptz;
alter table public.organization_documents
  add column if not exists accepted_by_message_id uuid references public.organization_messages(id) on delete set null;
alter table public.organization_documents
  add column if not exists acceptance_text text;
alter table public.organization_documents drop constraint if exists organization_documents_status_check;
alter table public.organization_documents add constraint organization_documents_status_check
  check (status in ('draft','sent','accepted','void'));
create index if not exists organization_documents_accepted_idx
  on public.organization_documents(accepted_at desc) where accepted_at is not null;

-- Existing records remain unchanged; this migration is safe to rerun.
