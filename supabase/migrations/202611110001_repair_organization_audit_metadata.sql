-- Repair schema drift: recordAudit writes metadata, but the live table was missing it.
-- Additive and safe for existing audit rows.
alter table public.organization_audit_events
  add column if not exists metadata jsonb not null default '{}'::jsonb;
