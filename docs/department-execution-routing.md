# Department execution routing

The organization console uses deterministic capability routing before the CEO delegates a task. The routing layer covers all 18 declared department capabilities and maps each to a distinct specialist runtime profile.

## Organization execution flow

1. The Founder submits an objective.
2. The capability registry scores the objective against department responsibilities, keywords, and expected deliverables.
3. The execution router maps the best capability to its designated specialist profile.
4. The runtime readiness gate checks that the specialist has its own API key, base URL, and model.
5. The CEO prepares the execution brief and delegates only when the route and runtime are valid.
6. The specialist returns its work and supporting evidence to the CEO for review.
7. The CEO returns a consolidated response, identifies unresolved items, and does not mark incomplete work as complete.

## Complete capability-to-specialist map

| Capability | Department / operating unit | Runtime agent |
| --- | --- | --- |
| Sales prospecting | Sales & Business Development | `outreach` |
| Customer relations | Customer Relations & Support | `followup` |
| Independent research | Central Research & Intelligence | `research` |
| Marketing strategy | Marketing & Brand Management | `marketing` |
| Media/content production | Media & Content Production | `content` |
| Finance | Finance & Accounting | `finance` |
| Payments / Tambala Pay | Fintech Ventures | `payments` |
| Technology & engineering | Technology & Engineering | `engineering` |
| Strategy planning | Strategy & Corporate Planning | `strategy` |
| Product management | Product Management & Innovation | `product` |
| Security and IT | Cybersecurity & IT | `security` |
| Operations administration | Operations & Administration | `operations` |
| People and agent management | Human Resources & Agent Management | `people` |
| Legal, risk and compliance | Legal, Risk & Compliance | `legal` |
| Procurement and resources | Procurement & Resource Management | `procurement` |
| Executive management | Executive Management | `executive` |
| Research and development | Research & Development | `rnd` |
| Governance oversight | Board & Corporate Governance | `governance` |

Central Research & Intelligence remains an independent cross-organizational function. Tambala Pay is an operating product within Fintech Ventures; its authoritative invoices, payments, receipts, and transaction records remain in the payment system, not in organization task history.

## Activation and runtime readiness are separate

A route mapping means the organization knows which specialist is responsible. It does **not** mean the role is active, the specialist has credentials, or the specialist can take external action.

Every specialist profile requires its own configuration:

- `TAMBALA_<AGENT>_API_KEY`
- `TAMBALA_<AGENT>_BASE_URL`
- `TAMBALA_<AGENT>_MODEL`

The orchestrator's shared Groq credential is not a fallback for specialist agents. The readiness gate reports missing environment-variable names without exposing secret values. A specialist with incomplete configuration must be blocked rather than silently replaced by Sales, Research, or another unrelated agent.

The seed organization starts specialist roles as `planned`. The live status endpoint reads each agent's exact role activation from the persistent organization snapshot; it does not rely on the static directory defaults. Runtime configuration alone must never activate a role or create an organizational authority binding. The manual activation script also marks a unit `active` when one of its accountable roles is activated, so the org-chart unit status and role activation do not drift apart.

**Execution now enforces this distinction:** a mapped specialist route is blocked with `not_activated` unless the matched organizational role is explicitly `active`. This remains true even when the provider API key, base URL, and model are configured. Only after the role is active does the runtime readiness gate check its dedicated provider configuration. This prevents a configured model from silently becoming an employee or receiving delegated work without an organizational appointment.

The Founder has confirmed that Tambala Pay is live. That is a product-level operating fact supplied by the Founder, not a verification of the Payments agent's API credentials, permissions, or transaction integration. The Payments department may coordinate work around Tambala Pay, but it must not claim to have executed, reconciled, refunded, or verified a transaction unless the payment system returns authoritative evidence.

## Routing and execution safeguards

- Every declared capability has an explicit specialist mapping, and tests verify the mapping set.
- Every specialist directory entry must reference a real unit in the organization definition.
- Unknown objectives return no specialist route and require ownership clarification.
- A missing department in the loaded organization snapshot blocks execution.
- The specialist is recalculated at execution time; a client-supplied specialist field cannot override deterministic routing.
- Research queries are compact capability-specific keywords, not copies of the full Founder prompt.
- Specialist prompts prohibit fabricated sources, clients, testimonials, financial figures, payment outcomes, and deployment claims.
- Runtime limits are bounded per agent.
- A mapped route is not permission to send sensitive external communications, spend funds, issue refunds, or perform other consequential actions. Those actions require the separate authorization and approval controls.

## Persistent task history

Organization task state is designed to persist in the existing Supabase project through `organization_tasks` and append-only `organization_task_events` tables. The task store records the Founder objective, current stage/status, department and role assignment, compact research query, result/error information, timestamps, and execution events.

The migration is located at `supabase/migrations/20261027_organization_tasks.sql`. It must be applied to the existing Tambala MCP Supabase database before persistent task creation can be enabled in a deployed environment. The current chat execution stages are not yet wired end-to-end to persistent task IDs and event history. Do not describe task persistence as live until that integration and the database migration have both been verified.

The task store is separate from financial records. Tambala Pay remains authoritative for invoices, payment status, receipts, refunds, and financial events. The organization may coordinate work around those records only through explicitly authorized and supported integrations.

## Verification

The CI workflow on `org-capability-routing` runs TypeScript build checks and the organization test suite, including:
- structural validation of the organization definition;
- capability-to-agent mapping coverage;
- specialist directory-to-organization-unit consistency;
- independent runtime configuration and credential isolation;
- per-agent prompt rules and bounded runtime limits; and
- task transition and lifecycle rules.

The token-protected `GET /api/chat-test/status` endpoint reports whether the organization snapshot loaded, whether it came from Supabase or the local seed fallback, organization validation errors and unit/role counts, department statuses, and per-agent runtime readiness without returning API-key values.

A `seed-fallback` response is not evidence that the live database was checked. After deployment, use this endpoint to confirm that the deployed service is reading the existing organization database. Never paste the chat-test token or provider credentials into logs or chat.

## Current implementation boundary

The capability map and specialist profiles are implemented and covered by automated tests. This does not mean all 18 specialist runtimes are configured, all roles are activated, or every department is operating autonomously. Persistent task execution, trusted role binding, approval records, and verified external integrations remain separate readiness requirements. No deployment or production activation is implied by changes on this development branch.
