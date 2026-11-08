-- WhatsApp channel (Evolution API), PDF documents, price list, and the invoice ledger for Tambala Pay.

create table if not exists public.organization_messages (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('out','in')),
  number text,                       -- counterpart phone, digits only; null when WhatsApp hid it
  audience text check (audience in ('founder','client')),
  purpose text not null,
  from_role_id text,
  text text not null,
  document_id text,
  approval_id text,
  status text not null check (status in ('pending_approval','queued','sent','failed','rejected','blocked','received')),
  reason text,
  provider_message_id text,
  attempts integer not null default 0,
  task_id text,
  signature text,
  contact_label text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists organization_messages_status_idx on public.organization_messages(direction, status, created_at);
create index if not exists organization_messages_number_idx on public.organization_messages(number, created_at desc);
create unique index if not exists organization_messages_inbound_provider_idx on public.organization_messages(provider_message_id) where direction = 'in' and provider_message_id is not null;

create table if not exists public.organization_contact_blocks (
  number text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_documents (
  id uuid primary key,
  kind text not null check (kind in ('quotation','invoice','receipt','letter')),
  number text not null unique,
  status text not null default 'draft' check (status in ('draft','sent','void')),
  client_name text not null,
  client_phone text,
  client_email text,
  data jsonb not null,
  total_minor bigint not null default 0,
  currency text not null default 'MWK',
  pdf_base64 text not null,
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_role_id text not null,
  signature text,
  created_at timestamptz not null default now()
);
create index if not exists organization_documents_created_idx on public.organization_documents(created_at desc);

create table if not exists public.organization_price_list (
  sku text primary key check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$'),
  name text not null check (char_length(name) between 2 and 200),
  unit text not null default 'each',
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_invoices (
  id uuid primary key,
  idempotency_key text not null unique,
  pay_invoice_id text not null,
  link text,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'MWK',
  client_name text not null,
  client_phone text,
  client_email text,
  description text not null,
  status text not null default 'unpaid',
  created_by_role_id text not null,
  signature text,
  created_at timestamptz not null default now(),
  status_checked_at timestamptz
);
create index if not exists organization_invoices_status_idx on public.organization_invoices(status, created_at);

-- Approvals can now point at the thing being approved (a WhatsApp message), so approving it releases it.
alter table public.organization_approval_requests add column if not exists subject_type text;
alter table public.organization_approval_requests add column if not exists subject_id text;

-- The signature ledger learns the new kinds of signed work.
alter table public.organization_signatures drop constraint if exists organization_signatures_kind_check;
alter table public.organization_signatures add constraint organization_signatures_kind_check
  check (kind in ('duty_result','briefing','handoff_request','handoff_result','approval_decision','document','message','invoice'));

alter table public.organization_messages enable row level security;
alter table public.organization_contact_blocks enable row level security;
alter table public.organization_documents enable row level security;
alter table public.organization_price_list enable row level security;
alter table public.organization_invoices enable row level security;
revoke all on public.organization_messages from anon, authenticated;
revoke all on public.organization_contact_blocks from anon, authenticated;
revoke all on public.organization_documents from anon, authenticated;
revoke all on public.organization_price_list from anon, authenticated;
revoke all on public.organization_invoices from anon, authenticated;

-- Revoked OAuth tokens (refresh tokens rotate; revoking a token records its id until it would have expired anyway).
create table if not exists public.oauth_revoked_tokens (
  jti text primary key,
  expires_at timestamptz not null,
  revoked_at timestamptz not null default now()
);
create index if not exists oauth_revoked_tokens_expiry_idx on public.oauth_revoked_tokens(expires_at);
alter table public.oauth_revoked_tokens enable row level security;
revoke all on public.oauth_revoked_tokens from anon, authenticated;
