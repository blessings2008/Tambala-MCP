# Getting Tambala MCP fully functional

1. **Run the migrations** in `supabase/migrations/` in filename order (SQL editor). They are idempotent. Apply `20261108_whatsapp_outbox_claims.sql` after `20261101_channels_documents_payments.sql` and before enabling the WhatsApp worker.
2. **Activate the agents you want working:** review then run `supabase/manual/activate_agent_roles.sql`.
   Execution only happens for `active` roles; this is deliberately not a migration.
3. **Set environment variables** from `.env.example` (at minimum the Supabase key, the orchestrator and each
   specialist's key/base URL/model, and `TAMBALA_WEB_SEARCH_API_KEY` for research tasks).
4. **Deploy, then open `/chat-live`**, paste `TAMBALA_CHAT_TEST_TOKEN`, run a task. The completion message shows
   whether the run was recorded (`organization_tasks` / `organization_task_events`).
5. **Turn on role enforcement (recommended):** connect your Claude connector through OAuth, read your client id from
   `organization_audit_events`, run `supabase/manual/bind_founder.sql` with it, then set
   `TAMBALA_ENFORCE_ROLE_BINDINGS=true`. Write tools (CRM changes, Tambala Pay creation, report email, approvals)
   then require a bound active role; Founder-only tools reject every other role. Do the binding BEFORE enabling
   enforcement or your own connection is denied.

Local dev without a database: `TAMBALA_DEV_ACTIVE_ROLES=true` treats agent roles as active; runs are not recorded.
Regenerate SQL after editing the seed: `npm run seed:sql`.

## Running the organization day to day

Each role is a staff member with a job description, working hours (Mon-Fri 08:00-17:00, Africa/Blantyre) and
standing duties (see `src/organization/workforce/duties.ts`). Examples: Security reviews the audit log at 07:30,
Operations checks the task board at 08:00, Sales prepares outreach drafts at 08:30, Customer Relations prepares
follow-ups at 09:00, Finance reviews billing readiness on Mondays, and the CEO compiles the daily briefing at 16:30.

1. Run `supabase/migrations/20261029_organization_workforce.sql` and `20261030_organization_staff_handoffs_duties.sql` and `20261031_organization_signatures.sql` and `20261101_channels_documents_payments.sql`.
2. Start the clock: either set `TAMBALA_DUTY_SCHEDULER=true` (host must stay awake), or have an external cron call
   `POST /api/duties/run` every 5-10 minutes with `Authorization: Bearer $TAMBALA_SCHEDULER_TOKEN`.
   Duties are idempotent per day or week, so calling often is safe.
3. Open **Workforce** in the dashboard. A role must be *active* and have a working model to do its job; otherwise its
   duties show as skipped with the reason. Use **Run now** on a duty to test it immediately.
4. Anything addressed to a customer is parked in **Approvals**. Approve or reject there (rejecting needs a reason).
   Approval releases the message to the WhatsApp outbox; it is sent only inside the allowed sending window and subject to opt-out and daily-limit checks. Check **Messages** for delivery status.
5. From Claude chat: `get_workforce_status`, `run_due_organization_duties`, `get_daily_briefing`,
   `decide_organization_approval` (Founder-only when role enforcement is on).

## Identity, handoffs and editing jobs

- **Identity:** staff go by employee number only (TT-001 CEO … TT-019). Numbers are frozen in `workforce/profiles.ts`
  and are the root of each employee's signing key, so never renumber. The Founder is TT-000.
- **Handoffs:** while doing a duty, an employee may ask a colleague for help (max 2 per duty, never the CEO, never
  themselves). It lands in the colleague's inbox and is done on the next cycle. The colleague cannot hand work on again,
  so chains cannot loop. Waiting handoffs show why (e.g. role not active). Failed ones retry three times.
- **Assigning work:** on any employee's card, type a task and press Assign (or use the `assign_work_to_employee` tool).
  It is worked immediately and shown under "Work between staff".
- **Editing duties:** Edit changes a built-in duty's time, wording or on/off; Reset returns it to the default. "Add a duty"
  creates your own (weekday or weekly, which data it may use, whether drafts need your approval). Duty edits
  need the database so they survive restarts.

## Signatures

Every piece of work is signed by the employee who produced it: duty results, handoff results, the daily briefing, and
your own approval decisions (signed as TT-000). Each signed item ends with a line like

    — TT-002 · Head of Sales & Business Development
      ✍ 7F3A-91C2-B0D4-18E6 · signed 2026-11-09 07:02 UTC

- **Unique per worker:** each employee's signing key is derived from `TAMBALA_SIGNING_SECRET` and their employee number,
  so no two workers can produce the same signature and nobody can sign as someone else. Each also has an identity glyph
  drawn from their key (shown on their card).
- **Tamper-evident:** a signature covers the worker, record type, record id, time and a hash of the content. Edit any of
  them and verification fails. Records go to `organization_signatures`, which the database refuses to update or delete.
- **Verify:** open **Signatures**, paste any fingerprint (or press Verify on a ledger row), or use the `verify_signature` tool.
- **Without a secret** nothing is signed and work is stamped `UNSIGNED`; it never pretends. Set `TAMBALA_SIGNING_SECRET`
  (32+ characters, keep it stable: changing it makes older signatures unverifiable). If it is unset, `TAMBALA_OAUTH_SECRET`
  is used through a one-way derivation.
- A signature proves which worker produced the work and that it is unchanged. It does not prove the work is correct.

## WhatsApp (Evolution API)

1. Set `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` (the instance connected to the business number) and
   `TAMBALA_FOUNDER_WHATSAPP` (your own number, where employees reach you).
2. If it has not already been applied, run `20261108_whatsapp_outbox_claims.sql` before enabling the WhatsApp worker. On an always-on host, set `TAMBALA_WHATSAPP_OUTBOX_SCHEDULER=true` (optional interval: `TAMBALA_WHATSAPP_OUTBOX_INTERVAL_MINUTES=1`). On a sleeping/free host, use the external cron endpoint described below.
3. In Evolution, set the instance webhook to `https://<your-host>/webhooks/evolution?token=<EVOLUTION_WEBHOOK_TOKEN>`
   with the `MESSAGES_UPSERT` event on and "webhook base64" off. Without the token the endpoint refuses everything.
4. Open **Messages** in the dashboard and press *Send me a test*.

How it behaves:

- **You:** anyone on staff can message you (signed, with their employee number). Reply `YES a1b2c3` or `NO a1b2c3 reason`
  to approve or reject a customer message from your phone, or `PENDING` to list what is waiting.
- **Customers:** nothing reaches a customer until you approve it. Then it goes out only Mon-Sat 07:30-19:30 Malawi time,
  a few seconds apart, within the daily cap, never twice within 24 hours, and never to a number that opted out.
  Outreach ends with "Reply STOP to opt out"; a bare STOP blocks the number permanently and tells you.
- **Who may write to customers:** Outreach, Customer Relations, Finance and Payments. Everyone else may only message you.
- **Customer replies** are stored and forwarded to you; they are not treated as employee instructions.
- **Your own messages** from `TAMBALA_FOUNDER_WHATSAPP` are packaged as a structured Founder instruction and delivered to the CEO. The CEO uses deterministic capability routing and may hand the task to its mapped specialist only when that role is active and its dedicated runtime is configured. The response returns to your WhatsApp. Approval and role-binding controls still apply to consequential writes and customer-facing actions.
- Captionless images, videos, documents, audio, locations and contact cards are recorded as typed attachment notices. This build records their presence and metadata; it does not yet download or store the original media file. Incoming media attachments are not yet downloaded or made available in the dashboard; caption-only text is handled as text.
- **Caveat:** Evolution uses an unofficial WhatsApp connection. Bulk or cold messaging can get a number banned. Keep volume low.
- WhatsApp sometimes hides a sender's number (`@lid`). Such messages are stored but cannot be matched, opted out or treated as you.



For hosts that sleep (including Render's free web-service plan), do not rely on an in-process timer. Configure an external cron to call `POST https://<your-host>/api/channels/outbox/run` every minute with `Authorization: Bearer $TAMBALA_SCHEDULER_TOKEN`. The token must be at least 24 characters. On an always-on host, you may instead set `TAMBALA_WHATSAPP_OUTBOX_SCHEDULER=true` and `TAMBALA_WHATSAPP_OUTBOX_INTERVAL_MINUTES=1`. The outbox uses atomic claims to prevent two workers from sending the same queued row concurrently.

## PDF documents

Quotations, invoices, receipts and letters: numbered (`TT-Q-2026-0001`), signed by their author, totals computed by the
system (never by a model), stored in the database and downloadable from **Documents & payments**.

- Fill the **price list** first. Employees quote by price-list code; a custom-priced line is allowed but is flagged for you.
- Set `TAMBALA_COMPANY_*`, `TAMBALA_PAYMENT_INSTRUCTIONS` and `TAMBALA_VAT_PERCENT` for the header and footer details.
- Employees request documents by ending their work with an `ACTIONS:` block. A document with no recipient goes to you on
  WhatsApp for review; one addressed to a customer waits for your approval first.
- **Your design:** all colours, fonts, the logo and company details live in `src/documents/design.ts`, and the page layout in
  `src/documents/renderer.ts`. The current look is a placeholder in the brand palette. When you send the quotation design,
  send it as a PDF or image plus: logo file (PNG/SVG), fonts used, colour codes, and any wording that must appear.

## Payments (Tambala Pay)

- Set `TAMBALA_PAY_API_TOKEN` (32+ characters) and, if different, `TAMBALA_PAY_API_URL`. The dashboard checks the connection live.
- Finance and Payments can create an invoice and a hosted checkout link, optionally with an invoice PDF, and send it to the
  client (after your approval). The same client, description, amount and day produce one invoice, however often it is retried.
- The daily *unpaid invoice follow-up* duty asks Tambala Pay for the status of open invoices and drafts reminders with the link.
- Tambala Pay's response field for the checkout link is not documented in this repo, so the code looks in the usual places
  (`checkout_url`, `payment_url`, `link`, `url`, nested `data`) and accepts only https. If your Pay API names it differently,
  invoices still get created but the system reports "no checkout link" instead of guessing; tell me the field and I will add it.

## Security hardening

- **OAuth revocation ledger:** the runtime syncs revoked token IDs through `public.oauth_revoked_tokens`. If Render logs report `PGRST205` for that table, verify Render's `SUPABASE_URL` points to the intended Tambala MCP project, then run `supabase/manual/repair_oauth_revoked_tokens.sql` in that project's SQL editor. This is separate from `bind_founder.sql`; it does not create or change Founder role bindings.
- Connector sign-in: client ids are signed and carry their registered redirect URIs, so an authorization request with any
  other redirect is refused. Redirects must be https (or localhost). Registration is rate limited, the approval code locks out
  after five wrong tries for 15 minutes, authorization codes work once, refresh tokens rotate, and `/oauth/revoke` really revokes.
- Existing connectors keep working (they refresh). If a connector is ever asked to authorize again and fails, disconnect and
  reconnect it once; it re-registers with a signed id. A new client id means any role binding for the old one must be redone.
- Run the new migration so revocations survive restarts and are shared across servers.
