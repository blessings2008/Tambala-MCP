# Department execution routing

The live organization console uses deterministic capability routing before the CEO delegates a task.

## Current execution flow

1. Founder enters an objective.
2. The capability registry ranks departments using objective keywords and deliverable hints.
3. The execution router maps the best match to an existing agent profile where a supported mapping exists.
4. The runtime readiness gate checks that the mapped agent has its own API key, base URL, and model configured.
5. The CEO receives the route and creates the execution brief.
6. The selected agent executes the brief and returns work to the CEO for final review.

## Agent mappings currently available

| Capability | Runtime agent | Runtime identity |
| --- | --- | --- |
| Sales prospecting | `outreach` | Head of Sales & Business Development |
| Customer relations | `followup` | Head of Customer Relations & Support |
| Independent research | `research` | Head of Central Research & Intelligence |
| Marketing strategy | `marketing` | Head of Marketing & Brand Management |
| Media/content production | `content` | Head of Media & Content Production |
| Finance | `finance` | Head of Finance & Accounting |
| Payments / Tambala Pay | `payments` | Head of Payments & Financial Operations |
| Technology & Engineering | `engineering` | Head of Technology & Engineering |

These are runtime execution profiles. Their presence does not create a database role binding or change the organization-chart role activation status.

## Runtime readiness

The department-specific execution profiles now exist for all core capabilities, but Research, Marketing, Content, Finance, Payments, and Engineering remain unconfigured until their own API key, base URL, and model are assigned. The runtime gate returns a configuration blocker and does not call a department agent with missing settings. It must not silently redirect Finance work to Sales or claim an unconfigured agent completed work.

## Runtime configuration

Each mapped agent must have its own configured:

- `TAMBALA_<AGENT>_API_KEY`
- `TAMBALA_<AGENT>_BASE_URL`
- `TAMBALA_<AGENT>_MODEL`

The runtime readiness gate checks these without exposing secret values. If a required setting is missing, the console reports the environment-variable names and does not start specialist execution.

## Routing safeguards

- Objectives with no matching capability return no route rather than defaulting to Sales.
- Research queries are compact keywords, not copies of the Founder prompt.
- The UI no longer asks the Founder to manually choose Sales or Customer Relations for organization-mode tasks.
- The same route is recalculated at specialist execution, so a client-supplied specialist field cannot override deterministic routing.
- This is test/staging execution only. It does not grant organizational authority or enable external business actions.

## Persistent task history

Organization task state is now designed to persist in the existing Supabase project through `organization_tasks` and append-only `organization_task_events` tables. The task store records the Founder objective, current stage/status, department and role assignment, compact research query, result/error information, timestamps, and the execution events that led to the current state.

The task store is deliberately separate from financial records. Tambala Pay remains responsible for authoritative invoices, payments, receipts, and financial events; organization task history only records orchestration and execution state.

The SQL migration is located at `supabase/migrations/20261027_organization_tasks.sql`. It must be applied to the existing Tambala MCP Supabase database before persistent task creation is enabled in a deployed environment.

## Verification

The CI workflow on `org-capability-routing` runs TypeScript build checks and the organization test suite, including routing and runtime-readiness tests.

The token-protected `GET /api/chat-test/status` endpoint also reports:
- whether the organization snapshot loaded successfully;
- whether it came from the existing Supabase tables or the local seed fallback;
- organization validation errors and unit/role counts;
- the current department names/statuses; and
- per-agent runtime readiness without returning API-key values.

A `seed-fallback` response is explicitly **not** evidence that the live database was checked. If the persistent snapshot cannot load, the endpoint reports it as unavailable rather than presenting a successful live verification. Use this endpoint after deployment to confirm the deployed service is reading the existing organization database. Do not paste the chat-test token or any provider credentials into logs or chat.