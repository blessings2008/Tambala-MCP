# Tambala MCP

Model Context Protocol server for Tambala Technologies.

## Current status

The server foundation includes organization structure, governance scaffolding, and per-agent AI provider routing. The organization chat UI is currently a **non-live preview**: it demonstrates room separation and a sample CEO → Research → Sales workflow, but does not call AI providers or persist chat messages.

- `get_tambala_info` — basic Tambala Technologies information.
- `/chat` — organization chat frontend preview when running the HTTP server.

See [the organization chat preview notes](docs/organization-chat-preview.md) for current scope and the security boundary.

## Requirements

- Node.js 20+

## Install

```bash
npm install
```

## Run locally

```bash
npm run build
npm start
```

Then open `http://localhost:3000/chat` to view the organization chat preview.

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

1. Connect the chat UI to persistent rooms and messages.
2. Implement server-side room authorization using verified actor-role bindings.
3. Build persistent task delegation, agent-to-agent messages, and completion events.
4. Connect each agent to its separately configured provider.
5. Add approval gates, audit trails, and organization-wide budget controls.

Never put API keys, database passwords, or other secrets in the repository.
