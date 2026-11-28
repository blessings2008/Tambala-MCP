# Approval request schema alignment

The workforce approval service reads and writes `resolution_note`, `subject_type`, and `subject_id`. The original approval table migration created `decision_note`; later workforce migrations added `task_id` and `content`. Live environments may already have some or all of the newer fields.

The migration is additive and safe for either schema state. It adds any missing service fields, copies legacy `decision_note` values into `resolution_note` only when the legacy column exists, and adds lookup indexes for approval subjects and linked parent tasks. It does not delete or rewrite existing approval decisions.

## Production application

Applied to the Tambala MCP Supabase project on 2026-11-19 as migration version `20261119152256` (`approval_request_schema_alignment`). Verification confirmed all five service fields, both new indexes, and all 74 existing approval rows remained present.

