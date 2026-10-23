# Live AI agent testing (staging)

The live test console is served at `/chat-live`. It makes real provider calls through the server. It is separate from the visual-only `/chat` preview.

## Render staging deployment

Create a **new Web Service** in Render for this repository; do not change the existing production service while testing.

- Repository: `blessings2008/Tambala-MCP`
- Branch: `org-platform-redesign`
- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/health` (if offered)
- Environment: Node 20 or newer

After deployment, open `https://YOUR-STAGING-SERVICE.onrender.com/chat-live`. Replace the example host with the URL Render assigns to your staging service.

## Required environment variables

Set these in the **staging service only**. Never commit credentials to Git or paste provider secrets into the chat.

| Variable | Value |
| --- | --- |
| `TAMBALA_CHAT_TEST_TOKEN` | A long, random, private token used only by the live testing console. Generate a fresh one, for example with a password manager. Do not reuse `TAMBALA_MCP_TOKEN`. |
| `GROQ_API_KEY` | Your Groq API key for the orchestrator/CEO agent. The orchestrator has a Groq-compatible default endpoint and model. |

The page asks you for the chat test token. It is kept in the current browser session and sent only to this service's same-origin test endpoints. The token does not grant MCP tool access; it only authorizes the three agent-test endpoints. Anyone who has the token can incur provider usage, so keep it private and rotate it if exposed.

## Optional specialist providers

Outreach and Follow-up intentionally fail closed until their own credentials, endpoint, and model are configured. Configure a provider compatible with the OpenAI Chat Completions API.

| Variable | Example / purpose |
| --- | --- |
| `TAMBALA_OUTREACH_API_KEY` | Dedicated API key for Outreach |
| `TAMBALA_OUTREACH_BASE_URL` | Provider's OpenAI-compatible base URL, commonly ending in `/v1` |
| `TAMBALA_OUTREACH_MODEL` | Model name supported by that provider |
| `TAMBALA_FOLLOWUP_API_KEY` | Dedicated API key for Follow-up |
| `TAMBALA_FOLLOWUP_BASE_URL` | Provider's OpenAI-compatible base URL, commonly ending in `/v1` |
| `TAMBALA_FOLLOWUP_MODEL` | Model name supported by that provider |

The orchestrator can instead use the dedicated `TAMBALA_ORCHESTRATOR_API_KEY`, `TAMBALA_ORCHESTRATOR_BASE_URL`, and `TAMBALA_ORCHESTRATOR_MODEL`. If the dedicated key is absent, the existing `GROQ_API_KEY` is used only for the orchestrator.

## Test steps

1. Deploy the staging branch and wait for the build to complete.
2. Open `/chat-live`, paste `TAMBALA_CHAT_TEST_TOKEN`, then choose **Check connection**.
3. Review readiness for each agent. Missing specialist settings will show as not configured.
4. Select an agent and submit a prompt. The response displayed is from the actual configured AI provider.
5. Inspect Render logs if a request fails. Provider calls have a 30-second timeout and use the existing per-process request/concurrency caps.

## Scope and safety

- This is a live **agent test console**, not the full persistent organization chat yet.
- Messages and responses are currently held in the browser page; they are not persisted in Supabase.
- The console calls one selected agent per request. It does not yet implement CEO delegation, shared room history, agent-to-agent event streams, or live collaboration.
- No WhatsApp/SMS/email messages are sent, and no business actions are executed.
- The test token is checked server-side using a timing-safe comparison. The endpoint accepts only the three known agent names, JSON requests, and prompts up to 10,000 characters.
- Use a separate staging service and token. Do not enable this test surface on the production service unless you explicitly intend to expose a provider-costing test endpoint there.
- The existing `/chat` stays a simulated visual preview. The live console is `/chat-live`.
