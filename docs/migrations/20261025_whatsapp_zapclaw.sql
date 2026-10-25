-- Tambala MCP WhatsApp persistence migration.
-- Uses the SAME Supabase project as the MCP.
-- Additive only.

create table if not exists public.whatsapp_inbound_messages (
  message_id text primary key,
  event_type text not null,
  sequence bigint,
  sender_phone text,
  sender_user_id text,
  sender_name text,
  sender_username text,
  message_type text not null,
  message_text text,
  phone_number_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_inbound_messages_sender_idx
  on public.whatsapp_inbound_messages(sender_phone, created_at desc);

create index if not exists whatsapp_inbound_messages_user_idx
  on public.whatsapp_inbound_messages(sender_user_id, created_at desc);

create index if not exists whatsapp_inbound_messages_created_idx
  on public.whatsapp_inbound_messages(created_at desc);

alter table public.whatsapp_inbound_messages enable row level security;
revoke all on public.whatsapp_inbound_messages from anon, authenticated;

-- The MCP service-role path is authoritative. message_id is the deduplication key
-- so ZapClaw retries/redeliveries cannot create duplicate inbound records.
