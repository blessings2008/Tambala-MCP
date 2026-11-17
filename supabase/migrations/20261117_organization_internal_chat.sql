-- Persistent Founder-to-agent internal room conversations.
-- This ledger is intentionally separate from organization_messages (customer WhatsApp).
create table if not exists public.organization_internal_chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('executive','board','research','sales','customer','technology','finance','founder')),
  sender_type text not null check (sender_type in ('founder','agent')),
  sender_role_id text not null,
  sender_name text not null,
  body text not null check (char_length(body) between 1 and 12000),
  created_at timestamptz not null default now()
);
create index if not exists organization_internal_chat_channel_created_idx
  on public.organization_internal_chat_messages(channel, created_at desc);
alter table public.organization_internal_chat_messages enable row level security;
revoke all on public.organization_internal_chat_messages from anon, authenticated;
