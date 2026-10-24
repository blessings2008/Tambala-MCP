# Tambala MCP Redesign — Roadmap

## Direction

Redesign Tambala MCP as the foundation for a unified AI-operated organization, not merely a bag of automation tools. Preserve useful current capabilities, but make the organization domain model and governance rules first-class.

## Working decisions

- Autonomy: semi-autonomous departments working within company-wide objectives and approved boundaries.
- Build approach: balance a correct architecture with progressive implementation and testing.
- Governance: hybrid Founder / Board / CEO model.
- Executive leadership: one CEO agent, supported by a specialist Executive Council.
- Research: centralized Research & Intelligence function.
- Structure: complete blueprint, progressive department activation.
- Existing systems: reuse components when useful; avoid making the new organizational model dependent on the current MCP shape.

## Milestones

### M0 — Baseline and design guardrails
- Record the existing server, transport, tool registry, AI services, automation jobs, database integration, and current deployment assumptions.
- Keep redesign work on a dedicated branch.
- Establish tests and ensure current behavior is not accidentally lost.

### M1 — Organizational domain foundation
- Define typed models for organization, departments, business units, roles/agents, reporting relationships, objectives, tasks, decisions, approvals, and audit events.
- Add initial organization charter and seed structure.
- Keep domain logic independent of MCP transport.

### M2 — Governance and authorization
- Define role-based capabilities and explicit policy checks.
- Model approval requests and their states.
- Ensure AI-generated text cannot grant permissions or bypass deterministic authorization.
- Default consequential external actions to approval-required.

### M3 — Work orchestration
- Add objective-to-project-to-task relationships, assignment, dependencies, status transitions, escalation, and review.
- Add durable records and audit trail.
- Establish retry and duplicate-action protections.

### M4 — Executive layer
- Implement CEO orchestration.
- Add Executive Council consultation for selected decision classes.
- Keep final operational responsibility with the CEO within delegated authority.
- Route Founder-reserved and Board-reserved matters through explicit approvals.

### M5 — Department activation
- Activate a small initial set of departments against real workflows.
- Add director roles and bounded delegation.
- Use performance measures and review before activating more roles.

### M6 — Integration and expansion
- Reuse existing lead, task, email, reporting, AI, and database capabilities through controlled adapters.
- Integrate PocketVault, Tambala Pay, and other business units only after their permissions and data boundaries are defined.
- Add additional ventures and specialized teams as needed.

## Technical guardrails

- Node.js 20+ and TypeScript remain the current baseline unless implementation evidence supports changing them.
- Keep MCP as an interface/protocol, not the place where all business logic lives.
- Use deterministic authorization and schema validation.
- Persist important organizational state; do not rely on model memory.
- Keep secrets in environment/secret storage, never in source files.
- Test critical policy, approval, and state-transition logic.
- Do not enable real-world financial or high-impact actions until approval and audit controls are tested.

## First implementation target

Start with M1: organizational domain models and a seed structure, accompanied by tests. Do not begin by creating many AI agents. Establish the source of truth and governance primitives first.
