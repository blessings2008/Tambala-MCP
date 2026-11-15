# Getting Tambala MCP fully functional

1. **Run the migrations** in `supabase/migrations/` in filename order (SQL editor). They are idempotent. Apply `20261108_whatsapp_outbox_claims.sql` after `20261101_channels_documents_payments.sql` and before enabling the WhatsApp worker.
2. Apply `supabase/migrations/20261115_runtime_reliability.sql` after the existing migrations. It creates the durable duty heartbeat and Founder-controlled global pause state.
3. **Activate the agents you want working:** review then run `supabase/manual/activate_agent_roles.sql`. Execution only happens for `active` roles; this is deliberately not a migration.
4. **Set environment variables** from `.env.example` (at minimum the Supabase key, the orchestrator and each
   specialist's key/base URL/model, and `TAMBALA_WEB_SEARCH_API_KEY` for research tasks).
5. **Deploy, then open `/chat-live`**, paste `TAMBALA_CHAT_TEST_TOKEN`, run a task. The completion message shows
   whether the run was recorded (`organization_tasks` / `organization_task_events`).
6. **Turn on role enforcement (recommended):** connect your Claude connector through OAuth, read your client id from
   `organization_audit_events`, run `supabase/manual/bind_founder.sql` with it, then set
   `TAMBALA_ENFORCE_ROLE_BINDINGS=true`. Write tools (CRM changes, Tambala Pay creation, report email, approvals)
   then require a bound active role; Founder-only tools reject every other role. Do the binding BEFORE enabling
   enforcement or your own connection is denied.

Local dev without a database: `TAMBALA_DEV_ACTIVE_ROLES=true` treats agent roles as active; runs are not recorded.
Regenerate SQL after editing the seed: `npm run seed:sql`.

## Running the organization day to day

### Reliability, watchdog and emergency pause

- `GET /health` is a liveness check: it confirms the Node process is responding. `GET /ready` is the dependency check: it reports Supabase readiness and Evolution WhatsApp state separately. A disconnected WhatsApp channel is visible as a dependency warning; it does not make the application process appear dead.
- The in-process duty scheduler records a durable heartbeat in `organization_runtime_heartbeat` after a completed duty cycle and records the latest failure. Configure `TAMBALA_HEARTBEAT_MAX_MINUTES` (default 30) and `TAMBALA_HEARTBEAT_ALERT_COOLDOWN_MINUTES` (default 60).
- Configure an external cron to call `POST /api/runtime/watchdog` every minute with `Authorization: Bearer $TAMBALA_SCHEDULER_TOKEN`. It sends a signed Founder WhatsApp alert when the last completed duty cycle is overdue. It suppresses alerts while the global pause is active. This watchdog cron must run independently of the in-process scheduler.
- The dashboard's runtime metrics include a rolling 24-hour duty error budget. It counts recorded completed/awaiting-approval versus failed duty runs; if no runs are recorded, the rate is reported as unavailable, not zero. Set `TAMBALA_DUTY_SUCCESS_TARGET_PERCENT` (default 95) to choose the success target.
- The dashboard has a **Pause all / Resume all** control. The Founder can also send `PAUSE ALL [reason]`, `PAUSE STATUS`, or `RESUME ALL` from the verified Founder WhatsApp number. The MCP tools `get_global_runtime_control` and `set_global_runtime_pause` expose the same control; the write tool requires an OAuth client actively bound to the Founder role.
- Every pause/resume action is signed as TT-000 and persisted with its signature fingerprint. AI requests, duty execution, and queued WhatsApp delivery are blocked while paused. The inbound Founder command remains available so the Founder can resume. Applying the migration and configuring a stable `TAMBALA_SIGNING_SECRET` are required before the switch can be changed.
- The pause switch does not stop Render itself, database services, or external cron infrastructure. It stops organization execution paths inside this application.

For a reliable 24/7 deployment, use an always-on Render web service/paid instance or a separate always-on worker. Do not rely on an in-process timer on a sleeping/free web-service plan. Run the watchdog and duty triggers from an independent external scheduler so they can wake/check the service even after an application process restart.


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

### Exact Render environment variables

Add these variables to the Tambala MCP web service. Do not paste secrets into chat or commit them to Git.

| Variable | Required | Purpose |
| --- | --- | --- |
| `EVOLUTION_API_URL` | Yes | Base HTTPS URL of your Evolution API server, without a trailing slash. |
| `EVOLUTION_API_KEY` | Yes | Evolution API key sent in the `apikey` request header. |
| `EVOLUTION_INSTANCE` | Yes | Exact Evolution instance name paired to the Tambala business WhatsApp number. |
| `EVOLUTION_WEBHOOK_TOKEN` | Yes | Random secret of at least 16 characters. Authenticates Evolution's webhook requests. |
| `TAMBALA_FOUNDER_WHATSAPP` | Yes | Founder's personal WhatsApp number in international format, e.g. `+265...`; employee notifications and approvals go here. |
| `TAMBALA_WHATSAPP_FOUNDER_DAILY_LIMIT` | Optional | Maximum daily messages to the Founder; defaults to 40. This is not a customer daily cap. |
| `TAMBALA_WHATSAPP_COOLDOWN_MS` | Optional | Minimum interval between customer sends across worker runs; defaults to 90,000 ms and is never allowed below 90 seconds in the production service. |
| `TAMBALA_WHATSAPP_OUTBOX_SCHEDULER` | Optional | Set `true` only when this process is on an always-on host; enables the in-process outbox timer. |
| `TAMBALA_WHATSAPP_OUTBOX_INTERVAL_MINUTES` | Optional | In-process outbox interval; defaults to 1 minute. |
| `TAMBALA_SCHEDULER_TOKEN` | Required for external cron | Random token of at least 24 characters. Authorizes the external outbox cron endpoint; separate from chat and webhook tokens. |
| `PUBLIC_BASE_URL` | Recommended | Public HTTPS base URL used by the checklist to print the exact webhook URL. |

### Bring-up and live verification

1. Confirm migrations `20261101_channels_documents_payments.sql` and `20261108_whatsapp_outbox_claims.sql` have been applied to the intended Supabase project. The claims migration must be applied before enabling the worker.
2. Set the variables above in Render and redeploy the service. The business WhatsApp number must already be paired and connected in Evolution.
3. Run `npm run check:evolution` in an environment with the same Evolution variables. It checks configuration, calls Evolution's connection-state endpoint, checks required tokens and prints the webhook URL. It does not send a message by default.
4. To explicitly send one test message to the configured Founder number only, run `npm run check:evolution -- --send-test`. The script first checks that the Founder number is registered on WhatsApp. It never sends to a customer.
5. In Evolution, set the instance webhook to the URL printed by the script: `https://<your-host>/webhooks/evolution?token=<EVOLUTION_WEBHOOK_TOKEN>`. Enable `MESSAGES_UPSERT` and disable webhook base64. The endpoint also accepts the token in the `x-webhook-token` header. Requests without a valid token are rejected.
6. From a second phone, send a simple test message to the connected business number. Confirm the inbound message appears in **Messages** and a notification reaches the Founder. This live inbound delivery cannot be proven by a local mock-server test.
7. Reply to the business number from the Founder phone with `PENDING`; confirm the approvals list arrives. Use a test approval only if a harmless test approval is actually pending. Do not approve a real customer message just to test the channel.
8. If a customer-facing test is necessary, use a test contact that has explicitly agreed to receive it. Create a draft through the normal approval path and verify it is not delivered before Founder approval.

### How it behaves

- **Founder:** staff can message the configured Founder number through the signed, rate-limited path. Reply `YES a1b2c3` or `NO a1b2c3 reason` to decide a pending approval, or `PENDING` to list waiting approvals. Only the configured Founder number can use these commands.
- **Customers:** no customer message is sent until Founder approval. Delivery is restricted to Monday-Saturday, 07:30-19:30 Africa/Blantyre time; one customer message is attempted per outbox pass; the default cross-run cooldown is 90 seconds; duplicates and opted-out numbers are blocked. There is no customer daily-send cap in the current implementation. The separate daily limit applies to messages sent to the Founder.
- **Who may write to customers:** Outreach, Customer Relations, Finance and Payments. Other roles may message the Founder only.
- **Customer replies:** stored and forwarded to the Founder; they are not treated as employee instructions. STOP/unsubscribe requests create a do-not-contact block.
- **Founder instructions:** ordinary messages from the configured Founder number are delivered to the CEO as structured instructions. The CEO uses deterministic capability routing; a specialist must be active and have a configured runtime. Consequential writes and customer-facing actions retain their approval and role-binding gates.
- **Media limitation:** captionless images, videos, documents, audio, locations and contact cards are recorded as typed attachment notices. Original inbound media is not yet downloaded or stored; captions are handled as text.
- **Privacy/identity limitation:** WhatsApp may hide a sender's number behind an `@lid` identifier. Such messages are stored but cannot be matched, opted out or treated as Founder instructions unless Evolution supplies the real number.
- **Caveat:** Evolution uses an unofficial WhatsApp connection. Bulk or cold messaging can lead to restrictions or bans. Keep volume low and respect consent.

### Keep the outbox running

For a sleeping host (including Render's free web-service plan), do not rely on an in-process timer. Configure an external cron to call `POST https://<your-host>/api/channels/outbox/run` every minute with `Authorization: Bearer $TAMBALA_SCHEDULER_TOKEN`. The token must be at least 24 characters. On an always-on host, you may instead set `TAMBALA_WHATSAPP_OUTBOX_SCHEDULER=true` and `TAMBALA_WHATSAPP_OUTBOX_INTERVAL_MINUTES=1`. The outbox uses atomic database claims to prevent two workers from sending the same queued row concurrently.

## Runtime reliability and company outcomes

Apply `supabase/migrations/20261115_runtime_reliability.sql` and `supabase/migrations/20261115_ai_usage_ledger.sql` to the production Supabase project before enabling the heartbeat or reading the AI usage ledger. Both migrations are additive and safe to re-run.

### Heartbeat and dead-man's switch

- `TAMBALA_HEARTBEAT_MAX_MINUTES=30`: mark the duty cycle stale after this many minutes without a successful full cycle (minimum 5).
- `TAMBALA_HEARTBEAT_ALERT_COOLDOWN_MINUTES=60`: avoid repeating the same outage alert more frequently than this (minimum 15).
- Configure an independent external cron to POST `/api/runtime/watchdog` every 5 minutes with `Authorization: Bearer $TAMBALA_SCHEDULER_TOKEN`. This must be independent of the application process; an in-process timer cannot reliably report that the process itself has stopped.
- The watchdog queues an alert to `TAMBALA_FOUNDER_WHATSAPP` when the last full duty cycle is stale. A real alert requires the database, scheduler token, Founder number and Evolution connection to work.
- `GET /health` is liveness only. `GET /ready` checks database readiness and, when configured, Evolution connectivity. A disconnected optional WhatsApp provider is reported in readiness details; database failure makes readiness return HTTP 503.

### Pause everything

The global pause is a Founder-controlled runtime switch. Use the dashboard pause/resume controls, the Founder WhatsApp command, or the Founder-bound MCP pause tool. The switch blocks new AI calls, scheduled duties, guarded writes and WhatsApp outbox delivery. It does not stop the HTTP process or erase queued work. Resume only after the reason is understood. Only the Founder identity can change this control; all changes are signed/audited.

### Error budget and always-on hosting

The dashboard's rolling 24-hour duty error budget is calculated from recorded duty-run rows only. No recorded runs means unavailable, not 100% success. Use an always-on Render paid web service or a VPS/container host with process supervision, restart policy, persistent secrets and external cron. Do not rely on Render free-instance in-process timers for 24/7 execution. Configure external cron for both duty execution and the watchdog; use the same scheduler token with HTTPS Bearer authentication.

### Weekly CEO planning duty

The CEO has a built-in weekly operating-plan duty scheduled for Monday at 08:00 Africa/Blantyre time. It reads the CRM, organization, invoice and company contexts and produces a signed duty result covering evidence-based targets, department priorities, existing commitments, risks and Founder decisions. It cannot change prices, make financial commitments, alter employee permissions or take regulatory positions. Duty scheduling still requires the always-on worker or external cron described above.

### Governed growth proposals

The MCP tool `propose_organization_duty` is restricted to a trusted OAuth-bound People/HR or Strategy role. It creates a signed-governance approval request; no duty is written to the active configuration at proposal time. Once the Founder approves, the approval hook validates the stored proposal and applies it through the existing duty configuration save path. Rejections leave the active configuration unchanged.

Every duty and role proposal must include 1–8 traceable evidence items (CRM record, task, duty run, organization report or HTTPS web source), each with a reference and a concise evidence summary. This records why the change is being proposed; it does not convert an unverified claim into a fact. New duties must be attached to an existing employee and require approval for prepared work. Proposals cannot change permissions, employee numbers, model budgets, pricing, financial authority or regulatory policy. Role proposals use `propose_organization_role`. They are restricted to human/shared-responsibility positions in existing units; after Founder approval the role is inserted as active with an empty capability list. AI-agent role creation is deliberately excluded because no new frozen employee number may be allocated by an employee proposal. The Founder must separately appoint and bind a person or agent and grant only approved capabilities.

### Employee trust ledger

Apply `supabase/migrations/20261115_employee_trust_ledger.sql` before using the trust ledger. It records approval history by frozen employee number and action type. A low-risk action type earns standing-approval eligibility only after 20 consecutive approvals with no Founder edits or rejection. The current eligible categories are prepared follow-ups, prepared work, prepared content and prepared internal tasks; financial, contractual, regulatory and new-customer-contact actions are excluded.

A rejection or an edited approval resets that employee/action streak. Customer complaints and STOP/opt-out messages demote standing approvals for the employee associated with the most recent sent customer message to that number. These records are an earned-trust signal, not a permission system: they do not alter employee roles, tool capabilities, prices or approval authority. Automatic execution under standing approval is not activated until the action-specific message caps and Founder-approved autonomy limits are implemented and reviewed.

### Company outcomes

The dashboard exposes a rolling 30-day `goals` section sourced from the discovery queue, quotation documents, invoice ledger and WhatsApp message ledger:
- Prospect counts by actual discovery processing status.
- Quotations created and sent. Acceptance count/rate remains unavailable until a structured client acceptance event is recorded.
- Invoices created, paid/unpaid counts and paid revenue in MWK.
- Outbound customer messages sent and inbound customer replies. A reliable reply rate is unavailable until message-to-message attribution is recorded.
- Basic employee attribution from each record's existing role field. Unattributed activity remains grouped as `unattributed`.

Do not treat sent quotations as accepted or invoice creation as revenue. Paid revenue counts only invoice rows whose recorded status is `paid`; reconciliation still depends on the Tambala Pay status refresh.

### AI spend and free-only policy

`organization_ai_usage` stores employee number, agent, provider, model and actual token usage. The Founder has set the current operating policy to **free AI only**; no paid model or paid fallback may be used.

- `TAMBALA_AI_FREE_ONLY=true` is the default and should remain enabled. OpenRouter models ending in the explicit `:free` suffix are accepted.
- Other provider/model combinations are blocked unless the exact `provider:model` pair is added to `TAMBALA_FREE_AI_MODEL_ALLOWLIST` after verifying that the provider account can use that model at no charge. Example: `groq:openai/gpt-oss-20b`. This allowlist does not claim that every provider account receives free usage.
- Unknown pricing is never assumed to be zero. If free capacity is unavailable, the request fails with a clear policy error; the system does not silently switch to a paid model.
- Set `TAMBALA_MODEL_PRICING_USD_PER_1M` only when verified provider prices are available. The dashboard then reports priced spend; otherwise usage remains explicitly unpriced.
- Daily USD spend caps are not used while paid AI is prohibited. Any move away from free-only requires explicit Founder approval and a separately configured spend cap.

## PDF documents

Quotations, invoices, receipts and letters are numbered, signed by their author, totals computed by the system (never by a model), stored in the database and downloadable from **Documents & payments**. Quotations render as a two-page A4 Helvetica document following the MCHS quotation structure. Their client reference is generated as `TT-<CLIENTCODE>-<YEAR>-<SEQUENCE>` (for example `TT-MCHS-2026-001`); supply `clientCode` to set the code explicitly. The quotation model accepts `project`, `sections`, `milestones`, `recurringFees`, `termsBullets` and `closingLine`. Milestone percentages must total 100%; each milestone amount is calculated from the server-computed document total, with the final milestone absorbing any rounding remainder. Quotation validity defaults to 30 days. A document retains its employee signature fingerprint in the PDF.

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
