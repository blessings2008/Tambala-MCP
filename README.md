# Tambala MCP

Model Context Protocol server for Tambala Technologies.

## Current status

The first working server foundation is in place. It currently exposes one safe test tool:

- `get_tambala_info` — returns basic Tambala Technologies information.

## Requirements

- Node.js 20+

## Install

```bash
npm install
```

## Run locally

```bash
npm start
```

The server uses MCP stdio transport. It waits for an MCP client to connect.

## Inspect the server

```bash
npm run inspect
```

The MCP Inspector can be used to connect to the local server and call its tools.

## Roadmap

1. Add useful Tambala tools.
2. Add Supabase integration with narrowly scoped access.
3. Add authentication and authorization for remote use.
4. Add Streamable HTTP transport.
5. Connect the remote MCP server to supported AI hosts.

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

The tools are registered automatically by the MCP registry. After setting the secrets, deploy the
MCP service and test `tambala_pay_health` before enabling the finance agent to use write tools.
