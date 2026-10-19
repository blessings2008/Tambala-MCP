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
