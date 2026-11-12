-- Customer Relations & Support foundation.
-- Customer profiles are a service-owned directory linked to existing CRM clients/leads.
-- Conversations remain backed by organization_messages; tickets track issues separately.

create table if not exists public.customer_service_contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^[0-9]{8,15}$'),
  display_name text,
  email text,
  company_name text,
  contact_type text not null default 'unknown' check (contact_type in ('unknown','prospect','client','other')),
  client_id uuid references public.clients(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  notes text,
  do_not_contact boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is null or lead_id is null)
);

create table if not exists public.customer_service_tickets (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.customer_service_contacts(id) on delete restrict,
  subject text not null check (char_length(subject) between 3 and 180),
  description text not null check (char_length(description) between 1 and 5000),
  category text not null default 'general' check (category in ('general','billing','technical','sales','complaint','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_customer','waiting_internal','resolved','closed')),
  assigned_role_id text not null default 'director-customer-relations',
  source_channel text not null default 'whatsapp' check (source_channel in ('whatsapp','email','phone','website','manual','other')),
  first_response_at timestamptz,
  last_activity_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  created_by_role_id text not null default 'director-customer-relations',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_service_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.customer_service_tickets(id) on delete cascade,
  event_type text not null check (event_type in ('created','status_changed','priority_changed','assigned','note','response_prepared','resolved','reopened')),
  actor_role_id text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_service_contacts_last_seen_idx
  on public.customer_service_contacts(last_seen_at desc);
create index if not exists customer_service_tickets_status_priority_idx
  on public.customer_service_tickets(status, priority, last_activity_at desc);
create index if not exists customer_service_tickets_contact_idx
  on public.customer_service_tickets(contact_id, created_at desc);
create index if not exists customer_service_ticket_events_ticket_idx
  on public.customer_service_ticket_events(ticket_id, created_at desc);

alter table public.customer_service_contacts enable row level security;
alter table public.customer_service_tickets enable row level security;
alter table public.customer_service_ticket_events enable row level security;

revoke all on public.customer_service_contacts from anon, authenticated;
revoke all on public.customer_service_tickets from anon, authenticated;
revoke all on public.customer_service_ticket_events from anon, authenticated;
