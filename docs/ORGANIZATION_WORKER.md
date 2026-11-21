# Tambala Organization Worker

## Purpose

`npm run worker:org` runs the existing scheduled organization maintenance cycle as a long-lived process. It does not introduce a second task queue: it reuses the current duty scheduler, discovery queue, approval queue, handoff store, task rooms, outbox, and runtime heartbeat.

## Runtime behavior

- Requires the configured Supabase database and refuses to start with in-memory stores.
- Runs one maintenance cycle at a time; it never overlaps its own cycles.
- Runs a cycle immediately on startup, then waits for the configured interval.
- Uses `TAMBALA_ORG_WORKER_INTERVAL_SECONDS` (30 seconds to 15 minutes; default 60 seconds).
- Backs off after repeated failures, capped at five minutes; a successful cycle resets the backoff.
- Writes the existing duty-cycle heartbeat and logs a compact cycle summary.
- On SIGTERM or SIGINT, it stops scheduling new cycles and finishes the current cycle before exiting.
- Existing handoff lease, retry, Founder-review, and approval safeguards remain authoritative.

## Deployment

Build and run:

```sh
npm install
npm run build
npm run worker:org
```

The worker must receive the same required server-side environment configuration as the Tambala Org service, including the Supabase service-role key and configured free AI provider credentials. Never place service-role keys or provider keys in a browser or client bundle.

When deploying a dedicated worker process, disable `TAMBALA_DUTY_SCHEDULER` on the web service so the same maintenance cycle is not scheduled by both processes. Keep the WhatsApp outbox scheduler configured according to its separate operating requirement.

## Activation gate

This entrypoint is code-ready but is not activated by this commit. A dedicated continuously running Render worker may require a paid Render instance. Do not create or upgrade a paid service without the Founder's explicit approval. The current free web service may sleep, so an in-process scheduler on that service must not be described as guaranteed 24/7 execution.

Before activation, confirm the hosting plan, environment variables, exactly one organization worker owner, runtime pause behavior, and health monitoring. Validate the worker against a staging database before using production.
