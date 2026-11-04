# Tambala Organization — Operating Readiness

This document records the current implementation state and the target operating model. It is an engineering checklist, not a claim that the organization is already fully autonomous or running continuously.

## Verified repository baseline

- Work branch: `org-capability-routing`.
- The HTTP service exposes a token-protected live agent test console and the MCP tool registry.
- The organization chart contains four divisions, eighteen departments, and three business units.
- Capability routing currently has eighteen declared capabilities.
- Eight department capabilities have dedicated runtime mappings: sales prospecting, customer relations, central research, marketing strategy, media content, finance, payments, and technology engineering.
- Other capabilities are deliberately blocked rather than silently redirected to an unrelated agent.
- The CEO and department role records are still marked planned in the seeded organization model. A configured model profile is not proof that its organizational role is active.
- The live test console is not yet the production employee workspace: the staged chat flow does not provide durable task history end-to-end.
- Existing scheduled automation is a one-shot daily preparation job. It prepares follow-up actions and due-task flags; it does not send prospect messages.
- **Tambala Pay is live as a separate payment system (Founder-confirmed, 4 November 2026).** The organization-side MCP adapter and live API operations remain unverified; the payment system being live does not by itself prove this repository is connected to it.

## Whole-organization operating model

Every organizational role should have an explicit job contract:

1. **Identity** — stable role ID, department, reporting line, activation state, and accountable manager.
2. **Responsibilities** — specific owned workflows and clear exclusions.
3. **Inputs** — approved data sources and tools the role may read.
4. **Outputs** — defined deliverables and quality criteria.
5. **Authority** — deterministic capabilities and approval requirements; prompts do not grant authority.
6. **Runtime** — dedicated model/provider configuration, timeouts, concurrency and request budgets.
7. **Performance** — task completion, quality review, blockers, turnaround time and cost.
8. **Continuity** — durable tasks, event history, retries, escalation and restart recovery.

A department is not operational merely because it exists in the organization chart or has a model profile. It becomes operational only after its identity, permissions, runtime, tools, persistence, tests and owner are all verified.

## Department coverage register

| Capability | Department | Current execution state |
|---|---|---|
| `sales_prospecting` | Sales & Business Development | Dedicated runtime mapping exists |
| `customer_relations` | Customer Relations & Support | Dedicated runtime mapping exists |
| `web_research` | Central Research & Intelligence | Dedicated runtime mapping exists |
| `marketing_strategy` | Marketing & Brand Management | Dedicated runtime mapping exists |
| `media_content` | Media & Content Production | Dedicated runtime mapping exists |
| `finance` | Finance & Accounting | Dedicated runtime mapping exists |
| `payments` | Fintech Ventures / Tambala Pay | Tambala Pay platform is live (Founder-confirmed); MCP adapter/API contract and safe end-to-end operation still need verification |
| `technology_engineering` | Technology & Engineering | Dedicated runtime mapping exists |
| `strategy_planning` | Strategy & Corporate Planning | No dedicated executor yet |
| `product_management` | Product Management & Innovation | No dedicated executor yet |
| `security_it` | Cybersecurity & IT | No dedicated executor yet |
| `operations_administration` | Operations & Administration | No dedicated executor yet |
| `people_agent_management` | Human Resources & Agent Management | No dedicated executor yet |
| `legal_risk_compliance` | Legal, Risk & Compliance | No dedicated executor yet |
| `procurement_resources` | Procurement & Resource Management | No dedicated executor yet |
| `executive_management` | Executive Management | No dedicated executor yet |
| `research_development` | Research & Development | No dedicated executor yet |
| `governance_oversight` | Board & Corporate Governance | No dedicated executor yet |

Do not mark these departments active until their dedicated execution contracts and safeguards are implemented and tested.

## Target 24/7 deployment topology

Use separate processes for separate responsibilities:

- **Web service:** authenticated MCP endpoint, OAuth/resource metadata, health endpoint, and Founder dashboard.
- **Background worker:** continuously claims durable organization jobs, runs eligible department workflows, records events, renews leases, and recovers expired claims after restarts.
- **Scheduled jobs:** daily reporting and low-frequency recurring maintenance. These should enqueue durable work rather than own long-running execution.
- **Supabase:** source of truth for organization state, tasks, approvals, events, automation schedules, worker leases and audit history.

A process that runs once and exits is a cron job, not a 24/7 worker. A timer inside the web process is not a reliable durable scheduler. The worker must be deployed as a persistent background process and must tolerate restarts.

Required worker properties:
- atomic job claiming or lease acquisition;
- idempotency keys for every externally visible operation;
- bounded retries with exponential backoff and a dead-letter state;
- heartbeat and lease expiry;
- graceful shutdown and safe recovery;
- concurrency limits per department and provider;
- structured logs and correlation IDs;
- alerting for stale heartbeats, repeated failures and queue growth.

## Tambala Pay integration contract

Tambala Pay is now live as a separate system. The organization must connect to it through a server-side adapter only after its real API contract is obtained and verified. Before implementation, obtain and verify:

- the production API base URL;
- API documentation or OpenAPI specification;
- the exact authentication scheme and token header;
- supported operations and request/response schemas;
- idempotency and webhook signature rules;
- sandbox/test credentials and production rate limits.

Store the authorized token in the hosting provider's secret environment. Never place it in HTML, browser storage, logs, source control, MCP tool descriptions or tool arguments. The MCP tools should expose only the approved operations, validate inputs, use server-side credentials, record audit events, and require explicit approval for refunds, payouts, reversals or other sensitive money movement.

Do not infer API endpoints or payment statuses from a dashboard screenshot. Do not claim a payment tool works until it has been exercised against the actual API with safe test transactions.

## Founder dashboard — functional scope

The dashboard should be a control plane, not a decorative chat page. It should provide:

- organization overview: division/department status, active roles, runtime health and current workload;
- employee directory: job descriptions, reporting lines, capabilities, model/provider readiness, limits and performance;
- task center: objective intake, CEO assignment, department execution, dependencies, review, retries, blockers and full event timeline;
- approvals inbox: pending requests, decision context, evidence, required authority and immutable decision history;
- automation center: schedules, recurring jobs, worker status, last/next run, retries, pause/resume and run history;
- integrations: Tambala Pay, CRM, email, research and other connectors, with connection state and scoped permissions;
- security: OAuth clients, role bindings, token rotation status, audit events and access-denial history;
- configuration: model/provider settings, per-agent budgets, concurrency, timeouts, feature flags and notification rules;
- observability: health checks, queue depth, worker heartbeat, errors, latency, cost and usage;
- system settings: timezone, business hours, retention, backup/export and emergency pause.

All configuration writes must be authenticated, validated, audited and permission-checked. Secrets are write-only: show whether configured and when rotated, never reveal their values. High-impact controls require confirmation and the appropriate approval authority.

## Delivery gates

1. Restore green CI and keep routing tests exhaustive as the registry grows.
2. Implement the missing department runtime profiles and dedicated execution mappings.
3. Complete trusted identity and role binding for the Founder and each service/agent principal.
4. Complete durable task persistence and append-only event recording in the actual execution path.
5. Implement transactional or otherwise failure-safe task/event writes.
6. Implement approval-backed action execution and audit enforcement.
7. Connect the already-live Tambala Pay system to the organization through a verified server-side adapter; test read-only operations first, then approval-gated money movement.
8. Build the Founder dashboard against real read/write APIs, not hard-coded demo data.
9. Deploy web service, background worker and scheduled jobs separately; verify health and recovery.
10. Run end-to-end tests, then enable automation in stages with external actions disabled by default.

## Current blockers that require owner-provided configuration

- Tambala Pay is live, but the organization-side integration still needs its production API URL, API documentation and authorized token supplied through a secure secret-setting path.
- Specialist provider credentials/models must be configured in the host environment; never paste secret values into chat or commit them.
- The organization database migration must be applied and verified before the task engine can be treated as persistent in production.
- The deployment must have a persistent worker process; repository changes alone do not create an always-on deployment.
