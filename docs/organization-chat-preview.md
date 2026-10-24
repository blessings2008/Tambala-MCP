# Organization Chat Preview

The organization chat preview is served at `/chat` by the HTTP server.

## What it demonstrates

- Separate conversation spaces for Executive Management, Board & Governance, Research & Intelligence, Sales & Business Development, Customer Relations, Technology & AI, Finance, and the Founder Desk.
- A room-specific agent roster and workflow activity panel.
- A simulated collaboration walkthrough showing CEO delegation, Research handoff, Sales drafting, and CEO review.
- Responsive layout for desktop and mobile.

## Important boundary

This is a **frontend interaction preview**, not the live multi-agent messaging system. All messages, agent states, and workflow activity are sample data. Sending a message in the preview only adds it to the local screen and shows a preview notice. It does not call an AI provider, write to Supabase, send external messages, or execute actions.

The UI's room separation is illustrative only. The production version must enforce room membership, message visibility, task access, and any cross-department report sharing on the server using verified identities and authorization checks. Hiding a room in the browser is not access control.

## Before enabling live conversations

1. Establish verified actor-to-role bindings; the shared legacy MCP token is not a unique organizational identity.
2. Persist rooms, messages, tasks, events, and report references in the existing Supabase project using additive schema changes.
3. Enforce role-based room access on every read and write, including board and founder-only rooms.
4. Connect messages to the persistent task/delegation system and route each agent through its dedicated provider configuration.
5. Add approval gates, audit records, rate limits, and budget controls before allowing consequential actions.
6. Add integration tests for cross-room isolation and unauthorized requests.

No existing tables or production data are changed by this frontend preview.
