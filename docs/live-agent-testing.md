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
| `TAMBALA_WEB_SEARCH_API_KEY` | Your Tavily API key. This is separate from every model-provider API key and is used only by the web research capability. |

The page asks you for the chat test token. It is kept in the current browser session and sent only to this service's same-origin test endpoints. The token does not grant MCP tool access; it only authorizes the test endpoints. Anyone who has the token can incur provider usage, so keep it private and rotate it if exposed.

## Web research provider

Use **Tavily** for the initial Research capability. Tavily's current pricing page lists a free tier with **1,000 API credits per month and no credit card required**. citeturn0search0

The server expects the key in `TAMBALA_WEB_SEARCH_API_KEY` and calls Tavily's search endpoint directly. Search results are passed to the agent as explicit evidence with their source URLs. The agent is instructed not to claim it browsed anything beyond the supplied results and not to fabricate sources.

The live collaboration route automatically enables web research for an Outreach task when the objective contains research-oriented terms such as `research`, `find`, `identify`, `market`, `prospect`, `hotel`, `lodge`, or `tourism`. You can also explicitly set `useWebResearch: true` when calling the API.

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
2. Add `TAMBALA_WEB_SEARCH_API_KEY` to the staging environment.
3. Open `/chat-live`, paste `TAMBALA_CHAT_TEST_TOKEN`, then choose **Check connection**.
4. Review readiness for each agent and confirm the Research provider reports as configured.
5. Select **CEO delegates to department**, choose **Head of Sales & Business Development**, and submit a constrained task such as: `Research three realistic ways Tambala can acquire lodge/hotel website clients in Malawi. Use current public web sources and return the source URLs. Do not invent Tambala services or contact details.`
6. The backend will search the web, give the results to Outreach, then send Outreach's report to the CEO for a constraint/provenance review.
7. Inspect Render logs if a request fails. Provider calls have timeouts and use the existing per-process request/concurrency caps.

## Scope and safety

- This is a live **agent test console**, not the full persistent organization chat yet.
- Messages and responses are currently held in the browser response; they are not persisted in Supabase.
- Collaboration now supports real Founder -> CEO -> department -> CEO -> Founder mediation and optional/automatic web research, but persistent event history and autonomous multi-step delegation are still future work.
- No WhatsApp/SMS/email messages are sent, and no business actions are executed.
- The test token is checked server-side using a timing-safe comparison. The endpoints accept only known agent names, JSON requests, and bounded prompt/query sizes.
- Use a separate staging service and token. Do not enable this test surface on the production service unless you explicitly intend to expose provider-costing test endpoints there.
- The existing `/chat` stays a simulated visual preview. The live console is `/chat-live`.
- The CEO is now instructed to reject specialist reports that violate explicit constraints, fabricate company capabilities or contacts, or claim research without evidence. This is a model-level guardrail; it is not a substitute for deterministic validation, which will be added as the organization workflow matures.
