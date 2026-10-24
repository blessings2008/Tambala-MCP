# Live organization task events

The staging organization console uses a task ID and a server-sent event stream to show lifecycle changes while AI stages execute.

## Endpoints

- `POST /api/chat-test/tasks` — create an in-memory task. Body: `{ "request": "...", "specialist": "outreach" | "followup" }`. Requires a bearer token matching `TAMBALA_CHAT_TEST_TOKEN`.
- `GET /api/chat-test/events?taskId=...` — open the authenticated SSE stream for that task. The server replays the current event history, then streams new events.
- `POST /api/chat-test/step` — execute one stage at a time. Include `taskId` with `stage`, `request`, and stage-specific fields. Stages are `ceo_delegate`, `specialist_execute`, and `ceo_complete`.

## Event sequence

A normal research task records the task creation, CEO analysis, delegation, department execution, web-research request, research completion, department resumption, completed work submission, return to CEO, CEO review, and final completion. Provider failures mark the task failed when the state transition permits it.

## Operational boundaries

- Task/event storage and the active task-runner registry are in-memory. A server restart clears them; this is a staging foundation, not durable task storage.
- The stream is scoped by task ID and protected by the same dedicated test token as the live test endpoints.
- SSE is read through `fetch()` rather than native `EventSource` because the browser must send the bearer token header.
- The task lifecycle tracks observable states and messages; it does not expose private model chain-of-thought.
- The test console does not send external communications or execute business actions.
