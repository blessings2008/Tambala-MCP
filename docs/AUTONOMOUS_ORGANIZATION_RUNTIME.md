# Tambala Autonomous Organisation Runtime

**Status:** Architecture proposal — implementation not yet activated  
**Owner:** Founder  
**Working autonomy model:** Bounded autonomy  
**Implementation branch:** `feat/autonomous-organization-runtime`

## 1. Purpose

Move Tambala MCP from a set of prompt-led, predefined workflows toward one coherent AI-operated organisation.

The organisation is the system. Employees, departments, executives, projects, tasks, decisions, knowledge, tools and approvals are connected parts of that system. An employee profile or system prompt describes identity and behavioural expectations; it is not, by itself, an operational employee.

This design preserves useful existing MCP capabilities while removing the assumption that every situation must match a prewritten task phrase or fixed workflow.

## 2. Current repository findings

The following are verified from the current repository documentation and implementation:

- The organization has a foundational blueprint that already defines Founder authority, Board oversight, a single accountable CEO, an advisory Executive Council, bounded autonomy, progressive activation, least privilege and evidence-backed decisions.
- The capability registry ranks objectives using declared keywords and deliverable hints. The execution router maps eight capabilities to specialist runtime profiles; other capabilities intentionally fail closed.
- Runtime profiles are not proof that organizational roles are active or that role-to-actor bindings exist.
- The current live collaboration test flow is a fixed Founder → CEO → specialist → CEO sequence. The live test console makes real provider calls, but its documentation says the conversation is not persisted end-to-end.
- The `/chat` experience is documented as a visual preview with sample data, not a live persistent employee workspace.
- Organization task and event storage exists in code and migrations, but the task migration must be verified as applied before production persistence can be assumed.
- The automation CLI job is a one-shot preparation/report job. The repository readiness document calls for a separate persistent worker with leases, heartbeats, idempotency, retries and restart recovery.
- Existing approval, identity, audit, handoff, duty, task-room and external-action safeguards should be reused where they meet the new contracts.

These findings mean the project should not be treated as a greenfield rewrite, nor should existing test and preview surfaces be mistaken for a complete operating organisation.

## 3. Foundational model

### 3.1 Organisation charter

The charter is the highest-level source of organisational intent. It contains:

- mission, purpose and long-term objectives;
- approved business units, departments and reporting relationships;
- policies, risk appetite and operating principles;
- reserved Founder and Board decisions;
- delegated authority and resource limits;
- approved services, products and strategic priorities.

Prompts may explain the charter to a model, but the authoritative version must live in structured, versioned records.

### 3.2 Employee contract

An employee is represented by a structured contract, not only a prompt.

Each contract defines:

1. Stable identity and role.
2. Department, manager and reporting relationships.
3. Expertise and areas of responsibility.
4. Outcomes owned and quality expectations.
5. Exclusions and escalation conditions.
6. Available tools and data scopes.
7. Decision authority and approval requirements.
8. Runtime/provider configuration and request budgets.
9. Performance, reliability and review history.
10. Continuity references to active work and approved knowledge.

The model prompt is generated from this contract plus the relevant situation. It must not grant permissions that the deterministic policy layer has not granted.

### 3.3 Capability contracts

Tools and capabilities are registered independently of employees. Each capability describes:

- stable capability ID and purpose;
- input and output schema;
- required permissions and data scopes;
- risk level and whether it has external side effects;
- preconditions, validation and evidence requirements;
- idempotency strategy and retry safety;
- approval requirements;
- timeout, concurrency and provider budget;
- verification procedure.

Employees can use only capabilities allowed by their contract and the current task's authorization context.

## 4. Target runtime layers

1. **Charter and governance:** authoritative policies, objectives, role contracts and decision rights.
2. **Organisational state:** departments, employees, projects, work, resources, decisions and current operational conditions.
3. **Sensing and intelligence:** monitors internal records, incoming requests, task outcomes, service health and approved research sources to identify changes, risks and opportunities.
4. **Deliberation and planning:** reasons about the situation, considers options, identifies uncertainty, and proposes an executable plan.
5. **Capability discovery:** finds the tools, data and expertise needed for the plan; it does not rely solely on a fixed objective-to-agent keyword map.
6. **Executive orchestration:** the CEO sets priorities, resolves ownership, forms temporary cross-functional teams and delegates accountable work.
7. **Execution runtime:** workers claim durable jobs, call authorized tools, save outputs and emit events.
8. **Verification and governance:** validates results, enforces approval gates, checks evidence and records decisions.
9. **Institutional learning:** captures approved lessons, reusable procedures and outcome feedback without treating every model-generated statement as fact.
10. **Control plane:** exposes the real organisation, workload, decisions, approvals, health and audit history to the Founder.

## 5. Adaptive operating cycle

The organisation should continuously follow this cycle:

1. **Observe:** receive an objective or detect a relevant event.
2. **Understand:** retrieve the applicable charter, policies, history, records and constraints.
3. **Frame:** determine the desired outcome, urgency, risk, dependencies and unknowns.
4. **Plan:** produce one or more possible approaches, including the minimum useful next action.
5. **Discover:** identify required capabilities, data and expertise.
6. **Authorize:** check each proposed action against role permissions, policy, risk and approval requirements.
7. **Organize:** assign accountable owners and create temporary collaboration where needed.
8. **Execute:** run durable, bounded steps with checkpoints and structured outputs.
9. **Verify:** inspect evidence and acceptance criteria; do not accept a claim of completion as proof.
10. **Adapt:** revise the plan when tools fail, evidence changes or new constraints emerge.
11. **Record and learn:** persist the result, decision, evidence, lessons and unresolved work.

A task may be decomposed, regrouped, delegated or replanned during execution. This is expected behaviour, not an exception.

## 6. Natural-language intake

Users should be able to express outcomes naturally. The system must not require the wording to match a specific tool name or prewritten task template.

The intake layer should:

- extract the requested outcome, constraints and deadline where stated;
- resolve known references from organisational context;
- distinguish an outcome from a suggested method;
- identify missing information that materially changes risk or scope;
- ask one focused clarification only when necessary;
- otherwise make a clearly labelled, low-risk working assumption and proceed;
- translate the request into a typed objective and plan before execution.

The model may interpret language and propose a plan. Deterministic code validates the plan, permissions, tool arguments and state transitions.

## 7. CEO and executive behaviour

The CEO is the single accountable operational coordinator. The CEO must be able to:

- maintain a current view of organisational objectives, workload, resources and risks;
- recognize work that crosses departmental boundaries;
- select owners based on demonstrated expertise, capability readiness and workload;
- create temporary teams for objectives that need multiple disciplines;
- delegate outcomes rather than dictate every implementation step;
- evaluate reports against evidence and acceptance criteria;
- resolve conflicts or escalate matters beyond delegated authority;
- identify opportunities and operational improvements;
- report decisions, risks, blockers and outcomes to the Founder.

The CEO does not receive universal tool access merely because of the title. The CEO coordinates authorized specialists and can use only explicitly granted executive capabilities.

The Executive Council provides challenge, specialist advice and review. It does not silently override the CEO or Founder.

## 8. Bounded autonomy and decision rights

Default operating rules:

- Employees may research, analyze, draft, plan and perform low-risk reversible internal work within their role and assigned objective.
- Department directors may organize routine departmental work within approved policies and resources.
- The CEO may prioritize, delegate and coordinate work within approved objectives and limits.
- Cross-functional work may form temporary teams with clear ownership and access scopes.
- External communications, material commitments, financial transactions, refunds, payouts, sensitive data disclosure, legal/regulated actions and other high-impact operations require the configured approval authority.
- Founder-reserved and Board-reserved decisions remain reserved regardless of model confidence.
- No agent may grant itself permissions, approve its own restricted action, bypass a denial, fabricate approval or alter immutable decision history.

Exact financial thresholds and risk categories must be explicitly configured before consequential external actions are enabled.

## 9. Durable work and worker runtime

A persistent worker is required; a prompt call, HTTP request or scheduled one-shot job is not a substitute.

The worker architecture must support:

- durable work items and append-only event history;
- atomic claim or lease acquisition;
- lease renewal and heartbeat;
- bounded retry with exponential backoff;
- idempotency keys for external side effects;
- dead-letter and human-review states;
- per-role, per-provider and per-capability concurrency limits;
- request-size, timeout and token budgets;
- graceful shutdown and restart recovery;
- correlation IDs and structured logs;
- pause/resume and emergency stop controls.

The web service should accept requests and expose APIs. Persistent workers should execute durable jobs. Scheduled jobs should enqueue work rather than own long-running execution.

## 10. Memory and organisational knowledge

Use distinct memory classes:

- **Authoritative records:** charter, policies, approved decisions, role contracts, budgets and business records.
- **Operational history:** task events, tool calls, approvals, messages, handoffs and execution outcomes.
- **Working context:** task-specific summaries and retrieved records assembled for a model call.
- **Institutional knowledge:** verified research, reusable procedures, lessons and documented decisions with provenance and review status.

Model context is temporary working material, not the system of record. Generated claims do not become institutional knowledge until validated and appropriately approved.

Memory retrieval must respect role, department, project and data sensitivity boundaries.

## 11. Observability and Founder control

The control centre should show the actual state of the organisation:

- active, planned, paused and blocked roles;
- employee contracts, capability access and runtime readiness;
- objectives, projects, tasks, dependencies and accountable owners;
- current plans, execution checkpoints and verification results;
- decisions proposed, approved, rejected and superseded;
- pending approvals and why they are required;
- worker heartbeat, queue depth, retries, dead letters and incidents;
- provider usage, latency, failures and cost budgets;
- audit trail for every consequential action.

An empty or unavailable dataset must be shown honestly. A configured prompt must never be presented as an active employee.

## 12. Implementation sequence

### Stage 0 — Baseline and safety
- Preserve current production behaviour.
- Verify the deployed commit, migrations, runtime configuration and existing integrations.
- Inventory task, duty, handoff, approval, identity and audit paths.
- Mark previews, test-only endpoints and incomplete integrations clearly.

### Stage 1 — Domain foundation
- Version the organisation charter and policies.
- Define typed employee, role, capability, authority, objective, plan, decision and evidence contracts.
- Add validation and compatibility adapters for existing records.
- Keep role activation explicit and progressive.

### Stage 2 — Intelligence and planning
- Add a structured objective interpreter.
- Add context retrieval and uncertainty handling.
- Add plan generation, decomposition and dynamic capability discovery.
- Retain deterministic checks and fail-closed behaviour for unavailable capabilities.

### Stage 3 — Executive orchestration
- Implement CEO planning, delegation, temporary team formation and review.
- Add cross-functional dependency and ownership management.
- Persist decisions and delegation rationale.
- Support replanning without losing task history.

### Stage 4 — Durable execution
- Implement a separate persistent worker and lease-based queue.
- Integrate existing tools through capability contracts.
- Add idempotency, retry, dead-letter, recovery and verification.
- Keep consequential external actions disabled until approval tests pass.

### Stage 5 — Institutional memory and continuous operations
- Add provenance-aware knowledge and lessons.
- Introduce event-driven monitoring and bounded initiative generation.
- Evaluate initiatives against objectives, cost, risk and capacity.
- Add scheduled executive review and operational reporting.

### Stage 6 — Founder control plane
- Connect the dashboard to authoritative APIs.
- Display real-time work, decisions, workforce, approvals and runtime health.
- Add safe controls for configuration, activation, pause/resume and approvals.

## 13. Acceptance tests

The foundation is not complete until tests demonstrate that:

1. Equivalent natural-language requests produce sensible plans without exact keyword matching.
2. A request requiring several disciplines forms a cross-functional plan with one accountable owner.
3. A capability with missing configuration is reported as blocked, never falsely completed or silently routed to an unrelated employee.
4. The system can ask for clarification when ambiguity changes risk or scope, but does not ask unnecessary questions for routine work.
5. A worker restart recovers leased work without losing event history or duplicating external actions.
6. A tool failure triggers bounded replanning or escalation rather than an empty success response.
7. Model-generated tool arguments are schema-validated and policy-checked before execution.
8. An unauthorized employee cannot read restricted data or execute a restricted action.
9. Founder- and Board-reserved decisions cannot be bypassed by CEO or department prompts.
10. Completion requires verified deliverables and evidence, not merely a model response.
11. The dashboard reflects database and worker state, including honest empty, blocked and unavailable states.
12. The free-provider-only budget policy is enforced; no paid provider is introduced without Founder approval.

## 14. Non-goals

- Creating a separate model agent for every job title before the runtime is reliable.
- Giving all agents all tools.
- Replacing deterministic governance with prompt instructions.
- Allowing uncontrolled autonomous spending or external commitments.
- Treating generated text as verified work.
- Claiming 24/7 operation until persistent workers, monitoring and restart recovery are deployed and tested.

## 15. Initial implementation boundary

This document is an architecture proposal. It does not activate roles, change production data, run migrations, alter provider settings, send external messages, execute payments or deploy services.

Implementation should proceed in small reviewed pull requests, with production changes gated by explicit Founder approval.


## 16. Current implementation boundary

The current implementation branch adds the first safe execution bridge without activating it in the live Founder instruction path:

- A validated CEO plan can be recorded as a versioned event on an existing organisation task.
- Ready plan steps can be queued as existing staff handoffs and task rooms.
- Unique database correlation keys make plan proposal events and handoff creation idempotent across retries.
- Plan progress can be reconstructed from durable handoff statuses after a process restart.
- Approval state remains a separate input from the approval system; a handoff record never implies approval.
- Handoff workers claim work conditionally and refresh a heartbeat while processing.
- A running handoff whose heartbeat expires after 30 minutes is moved to Founder review, not automatically replayed. This is deliberate: a crashed worker may have completed an external side effect before it stopped recording progress.
- If a worker loses its lease, it stops before starting further action execution. Founder review is required to verify uncertain side effects before resuming.

Three additive migrations accompany this bridge: plan-step handoff idempotency, plan-proposal event idempotency, and handoff worker lease metadata. They must be reviewed and applied in the correct deployment sequence before deploying code that depends on the new columns. They have not been applied to production.

The existing `runDutiesOnce` cycle still performs one bounded pass over duties and queued handoffs. The lease and recovery safeguards improve that existing worker path, but they do not turn it into a continuously running worker service. A separately supervised worker, monitoring, graceful shutdown and deployment-time migration verification remain outstanding.
