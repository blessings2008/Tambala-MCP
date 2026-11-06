# Tambala MCP

Model Context Protocol server for Tambala Technologies.

## Current status

The development branch contains the full organizational blueprint (4 divisions, 18 departments, and 3 business units), deterministic capability routing for all 18 department capabilities, governance and authorization rules, per-agent AI provider routing, task-lifecycle foundations, a visual-only organization chat preview, and a **token-gated live AI agent test console**.

The organization is designed to work as one coordinated company: the CEO coordinates objectives, specialist departments own their work, Central Research & Intelligence serves the whole organization, and Founder-reserved decisions remain behind explicit approval controls. A department appearing in the blueprint or having a runtime profile does not mean it is activated or authorized to act.

- `/chat` — visual organization chat preview. Messages are simulated.
- `/chat-live` — live test console for calling the configured Orchestrator, Outreach, and Follow-up AI routes.
- `/api/chat-test/status` and `/api/chat-test` — test-only endpoints gated by `TAMBALA_CHAT_TEST_TOKEN`.
- `get_tambala_info` — basic Tambala Technologies information.

The live console is an agent testing surface, not the completed persistent multi-agent organization workspace. It does not yet provide persistent conversations or end-to-end persistent task execution. It must not be treated as proof that every department is active, or as permission to send external messages or execute consequential business actions. Keep it on a separate staging deployment.

See [the department execution map and activation rules](docs/department-execution-routing.md), [the redesign roadmap](docs/REDESIGN_ROADMAP.md), and [AI provider routing](docs/ai-provider-routing.md).

See [live agent testing and staging deployment](docs/live-agent-testing.md) and [the organization chat preview notes](docs/organization-chat-preview.md).

## Requirements

- Node.js 20+

## Install and run locally

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000/chat-live` for live agent testing or `http://localhost:3000/chat` for the visual preview. Configure the environment variables in the live testing guide first.

For MCP stdio transport, run:

```bash
npm run start:stdio
```

## Inspect the server

```bash
npm run inspect
```

The MCP Inspector can be used to connect to the local server and call its tools.

## Roadmap

1. Persist chat rooms and messages in the existing Supabase project.
2. Enforce room authorization using verified actor-role bindings.
3. Build persistent task delegation, agent-to-agent messages, and completion events.
4. Add real-time updates and multi-agent collaboration.
5. Integrate approval gates, audit trails, and organization-wide budget controls.

Never put API keys, database passwords, or other secrets in the repository.

## Tambala Pay MCP integration

Tambala Pay tools are registered in the MCP server and use the documented server-to-server API.
Configure these secrets on the MCP hosting service:

- `TAMBALA_PAY_API_URL=https://tambala-pay.onrender.com`
- `TAMBALA_PAY_API_TOKEN=<the Tambala Pay INTERNAL_ACCESS_TOKEN value>`

Keep the token exclusively in the MCP server environment. Never put it in dashboard/browser
configuration, agent prompts, source control, tool arguments, or logs. The MCP endpoint itself
continues to require its own `TAMBALA_MCP_TOKEN` or OAuth access token; the Tambala Pay
credential is a separate server-to-server secret.

Available tools include service health, invoice listing/creation/lookup, invoice checkout creation,
payment lookup, aggregate payment summaries, one-off payment request listing/creation, and
verified receipt retrieval. Payment creation produces an incoming customer checkout request; it
does not transfer funds out. Payment status must be read from Tambala Pay's server-verified
records, never inferred from a browser redirect.

**Tambala Pay is live as a product**, as confirmed by the Founder. Its authoritative invoices, payment statuses, receipts, and financial events remain in Tambala Pay; the organization must not duplicate or invent those records.

The tools are registered automatically by the MCP registry. The live payment product does not, by itself, prove that the MCP-to-Pay server connection is configured or healthy. After setting the secrets, test `tambala_pay_health` from the deployed MCP service and verify the required permissions before enabling payment workflows. Never treat a successful checkout redirect as proof of payment.
