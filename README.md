# Tambala MCP

Model Context Protocol server for Tambala Technologies.

## Current status

The development branch includes organization structure and governance scaffolding, per-agent AI provider routing, a visual-only organization chat preview, and a **token-gated live AI agent test console**.

- `/chat` — visual organization chat preview. Messages are simulated.
- `/chat-live` — live test console for calling the configured Orchestrator, Outreach, and Follow-up AI routes.
- `/api/chat-test/status` and `/api/chat-test` — test-only endpoints gated by `TAMBALA_CHAT_TEST_TOKEN`.
- `get_tambala_info` — basic Tambala Technologies information.

The live console is an agent testing surface, not the completed persistent multi-agent organization chat. It does not persist conversations, coordinate multi-agent tasks, send external messages, or execute business actions. Keep it on a separate staging deployment.

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
