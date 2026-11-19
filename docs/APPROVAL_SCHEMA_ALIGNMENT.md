# Approval request schema alignment

The workforce approval service reads and writes `resolution_note`, `subject_type`, and `subject_id`. The original approval table migration created `decision_note` but did not create the two subject fields, and the workforce migration added only `task_id` and `content`.

Apply `supabase/migrations/20261119150000_approval_request_schema_alignment.sql` to the existing Tambala MCP Supabase project before enabling plan-step approval hooks. The migration is additive, preserves the legacy `decision_note` field, copies existing decision notes into `resolution_note`, and adds lookup indexes for approval subjects and parent tasks.

This code change does not apply the migration to production. Production schema changes still require explicit Founder authorization.
