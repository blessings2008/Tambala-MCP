# Tambala Organization — Whole-Organization Readiness Register

## Purpose

This register tracks whether the organization can operate as a coordinated system. A department is not considered operational merely because it exists in the organization chart, has a capability route, or has an AI runtime profile.

This is a development-branch readiness document. It does not certify production deployment, live database state, provider credentials, or external integrations.

## Organization snapshot

The current seed defines:

- 4 divisions: Executive & Governance; Technology & Innovation; Commercial & Growth; Corporate Services.
- 18 departments, including independent Central Research & Intelligence.
- 3 operating business units: Financial Technology; Software & Digital Services; Media & Publishing.
- 18 declared department capabilities, each with a dedicated runtime mapping.
- Founder & Owner as the only role marked active in the seed. Other leadership, department, and business-unit roles remain planned.

Tambala Pay has been confirmed live by the Founder. This is an operating-product fact, not proof that the organization service has authenticated API access or transaction permissions.

## Readiness rules

A department is operational only when all applicable conditions are met:

1. Its purpose, owner, reporting line, and decision boundaries are defined.
2. Its role has been formally activated through trusted organizational records.
3. Its runtime is configured independently and passes a readiness check, where AI execution is required.
4. Its work can be assigned, persisted, monitored, reviewed, and closed with reliable history.
5. Its access to data and tools is limited to its approved responsibilities.
6. Its outputs have measurable quality and service expectations.
7. Any consequential external action is authorized and auditable.

A runtime profile is not an appointment. An appointment is not permission to perform every action. A successful task response is not proof that an external action occurred.

## Organization-wide readiness register

| Area | Current verified position | Work required before operational status |
| --- | --- | --- |
| Founder authority | Founder role exists and is marked active in the seed. | Bind the real Founder identity to a trusted, persistent principal; protect reserved powers. |
| Board & governance | Board and governance structures are represented; roles are planned. | Define actual board membership, quorum/decision rules where applicable, records, and approval lifecycle. |
| CEO & executive management | CEO and executive roles are represented; planned. | Activate only after trusted identity, delegation limits, persistent task flow, and oversight are in place. |
| Strategy & planning | Capability and specialist mapping exist. | Establish approved objectives, owners, measures, review cadence, and decision history. |
| Technology & engineering | Dedicated route and specialist profile exist. | Configure and activate the role; add release, incident, backup, and change-control procedures. |
| AI & automation | Dedicated route and specialist profile exist. | Add workflow ownership, provider isolation, retry limits, failure handling, and human escalation. |
| Product management & innovation | Dedicated route and specialist profile exist. | Establish product briefs, discovery evidence, prioritization, acceptance criteria, and release ownership. |
| Research & development | Dedicated route and specialist profile exist. | Require experiment plans, evidence, reproducibility, and explicit prototype-to-product handoff. |
| Cybersecurity & IT | Dedicated route and specialist profile exist. | Establish access reviews, secret handling, backup/restore tests, incident response, and security reporting. |
| Marketing & brand | Dedicated route and specialist profile exist. | Activate role and runtime; define brand rules, campaign approvals, budget boundaries, and performance measures. |
| Sales & business development | Outreach capability and profile exist. | Formalize lead stages, qualification criteria, follow-up ownership, pipeline reporting, and external-message approval boundaries. |
| Media & content | Dedicated route and specialist profile exist. | Define editorial standards, asset rights checks, content review, publishing permissions, and performance reporting. |
| Customer relations & support | Follow-up capability and profile exist. | Define support ownership, response targets, escalation, complaint handling, and customer-history controls. |
| Finance & accounting | Dedicated route and specialist profile exist. | Establish bookkeeping sources, reconciliation cadence, budget controls, reporting periods, and approval separation. |
| Payments / Financial Technology | Tambala Pay is confirmed live by the Founder; a Payments route/profile exists. | Verify an approved integration using documented, least-privilege access. Keep invoices, payment status, receipts, refunds, and transaction events authoritative in Tambala Pay. |
| Operations & administration | Dedicated route and specialist profile exist. | Document core SOPs, recurring controls, records ownership, service levels, and continuity procedures. |
| People & agent management | Dedicated route and specialist profile exist. | Establish appointment, activation, access review, performance, suspension, and offboarding workflows. |
| Legal, risk & compliance | Dedicated route and specialist profile exist. | Create a risk register, compliance review process, contract controls, privacy rules, and escalation triggers. |
| Procurement & resources | Dedicated route and specialist profile exist. | Define supplier due diligence, quote comparison, purchasing authority, asset register, and procurement approvals. |
| Central Research & Intelligence | Independent cross-organizational route and specialist profile exist. | Define source-quality standards, evidence confidence, research records, and handoff to requesting departments. |
| Financial Technology business unit | Unit exists; Tambala Pay is confirmed live. | Establish product ownership, service monitoring, customer-impact escalation, financial controls, and product reporting. |
| Software & Digital Services business unit | Unit exists. | Define service catalogue, client delivery lifecycle, acceptance, support, maintenance, and profitability reporting. |
| Media & Publishing business unit | Unit exists. | Define channel ownership, editorial calendar, rights management, publishing controls, and revenue/engagement reporting. |

## Shared foundations that block organization-wide activation

### 1. Trusted identity and role assignment

The system must resolve who or what is acting from trusted records. A shared API token is not a person-specific identity and must not be treated as proof of Founder, CEO, director, or specialist authority.

Required outcomes:

- Persistent principal-to-role bindings.
- Explicit activation and deactivation records.
- Least-privilege role capabilities.
- Access review and revocation.
- No automatic appointment because a runtime or API key exists.

### 2. Task execution and accountability

The organization needs one reliable work lifecycle across all departments:

Founder request → CEO analysis → department assignment → execution → department review → CEO review → completion or further work.

Required outcomes:

- Persistent task IDs used by every execution stage.
- Append-only event history with actor, stage, timestamp, and outcome.
- Atomic or otherwise consistency-safe task/event writes.
- Retry and idempotency rules.
- Timeouts, cancellation, failure recovery, and escalation.
- No completion status until the responsible reviewer accepts the result.

The task store and migration exist in the codebase, but the execution stages are not yet wired end-to-end to persistent task IDs and event history. The migration must be applied and the deployed database verified before claiming live persistence.

### 3. Approval and financial controls

- Separate proposal, approval, and execution.
- Resolve approvals from trusted persisted records, never from AI-generated text.
- Require explicit Founder approval for reserved actions.
- Keep payment-provider and Tambala Pay transaction records authoritative.
- Never let an agent claim a payment, refund, receipt, or reconciliation succeeded without a returned authoritative result.
- Keep financial reporting read-only unless a separately authorized action is explicitly supported.

### 4. Runtime and quality controls

- Each specialist has its own provider key, base URL, and model configuration.
- Never silently route a department's work to an unrelated agent when its own runtime is unavailable.
- Enforce per-agent limits, timeouts, and concurrency controls.
- Require evidence for research and source-sensitive claims.
- Record outputs, unresolved questions, and review decisions.
- Measure quality, rework, failure rate, response time, and cost per department.

### 5. Organization-wide reporting

The CEO should eventually receive a consolidated view of:

- Active, planned, blocked, and paused departments.
- Work in progress, overdue work, and unresolved escalations.
- Department output quality and service levels.
- Sales pipeline and customer support health.
- Product/service delivery and technical incidents.
- Revenue, expenses, payment exceptions, and cash commitments from authoritative systems.
- Risks, approvals awaiting Founder action, and decisions requiring governance review.
- Runtime availability, usage, errors, and operating cost.

Reports must distinguish verified system data from estimates, recommendations, and missing information.

## Recommended implementation order

1. **Identity and authority:** trusted principal bindings, role activation, capability checks, and approval records.
2. **Persistent execution:** connect all chat stages to task IDs and reliable event history; test retries and failures.
3. **Department operating contracts:** define inputs, outputs, service expectations, escalation paths, and review criteria for every department.
4. **Runtime activation:** configure and activate specialists one at a time only after their department contract and access boundaries are ready.
5. **Product and service integrations:** connect Tambala Pay and other products through documented, least-privilege APIs; verify results from source systems.
6. **Organization dashboard and reporting:** expose actual readiness, task progress, financial summaries, risks, and quality measures.
7. **Operational drills:** test unavailable providers, invalid permissions, failed writes, duplicate requests, payment uncertainty, security incidents, and recovery.

## Definition of done

The organization is not "perfect" because every department has an AI profile. It is ready when every department has accountable ownership, trusted access, a defined operating process, measurable outputs, reliable task history, safe escalation, and verified integrations—and when the CEO can coordinate all of it without inventing progress or bypassing controls.

Until those conditions are demonstrated, the relevant capability or department must remain visibly planned, blocked, or awaiting configuration.
