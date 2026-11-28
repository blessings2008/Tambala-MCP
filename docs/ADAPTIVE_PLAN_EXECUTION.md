# Adaptive CEO plan execution

## Runtime path

1. A verified Founder WhatsApp message enters the existing Founder-only inbound boundary.
2. Multi-capability objectives are interpreted and assessed by the CEO planner.
3. The validated plan is persisted as an `organizational_plan_proposed` event on one existing `organization_tasks` parent record.
4. Every step marked as approval-required receives a persistent `organization_approval_requests` record with:
   - subject type `organizational_plan_step`
   - plan ID and revision
   - step ID
   - SHA-256 fingerprint of the complete plan snapshot
   - the exact plan snapshot and step identifier in approval content
5. Only dependency-ready steps with an active, uniquely mapped, runtime-ready employee can become handoffs.
6. Steps requiring approval remain blocked until a matching Founder approval is recorded.
7. The approval hook rechecks the exact plan fingerprint and step before reconciliation. A changed plan revision cannot reuse the old approval.
8. Existing workforce maintenance cycles rebuild state from plan events, approval rows and handoff rows, then queue newly eligible steps through the existing handoff/task-room system.
9. The parent task moves through existing task statuses and is completed only when every plan step has a recorded completed handoff.

## Safety boundaries

- The model proposes plans; deterministic validation and runtime checks decide whether a step can be queued.
- A plan approval authorizes only that exact step in that exact plan revision. It does not bypass the separate action policy for WhatsApp, financial, legal, security or other external side effects.
- Missing, duplicate, malformed, stale or mismatched approval evidence is treated as pending/blocked.
- Employee identity and capability ownership come from the organization registry and employee profiles, never from model-provided identifiers.
- No second task queue or schema migration is introduced.
- Proposal persistence and handoff dispatch use existing organization task events, approvals, handoffs and task rooms.

## Runtime availability

The plan reconciler runs during the existing scheduled workforce maintenance cycle and immediately after a plan-step approval. A queued handoff still requires the existing workforce handoff processor to run. The dedicated `worker:org` process is not started by this feature; activating a persistent worker remains a separate infrastructure decision.
