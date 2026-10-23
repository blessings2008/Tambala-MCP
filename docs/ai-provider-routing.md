# AI agent API ownership and routing

## Routing policy

Every specialist has its own credential, endpoint, and model configuration. A specialist must not silently fall back to another agent's key. The only legacy compatibility fallback is `GROQ_API_KEY` for the orchestrator; it is not shared with outreach or follow-up.

| Agent | Responsibility | API credential | Endpoint | Model default | Status until configured |
|---|---|---|---|---|---|
| Orchestrator | General Tambala planning and coordination | `TAMBALA_ORCHESTRATOR_API_KEY`; legacy fallback `GROQ_API_KEY` | `TAMBALA_ORCHESTRATOR_BASE_URL`; defaults to Groq | `TAMBALA_ORCHESTRATOR_MODEL`; defaults to `openai/gpt-oss-120b` | Uses the current Groq route if the legacy key is present |
| Outreach | Draft personalized prospect messages | `TAMBALA_OUTREACH_API_KEY` only | `TAMBALA_OUTREACH_BASE_URL` | `TAMBALA_OUTREACH_MODEL` | Disabled/fails closed until all three settings are supplied |
| Follow-up | Follow-up analysis and drafts | `TAMBALA_FOLLOWUP_API_KEY` only | `TAMBALA_FOLLOWUP_BASE_URL` | `TAMBALA_FOLLOWUP_MODEL` | Disabled/fails closed until all three settings are supplied |

The application uses the OpenAI SDK's **Chat Completions** interface, so each configured endpoint must be OpenAI-compatible for `/chat/completions`. Configure provider-specific base URLs and model names; never assume model names are portable between providers.

## Environment configuration

Use your deployment environment's secret settings, not committed values:

```dotenv
# Existing provider — reserved for the orchestrator
GROQ_API_KEY=

# Orchestrator can also be assigned a dedicated credential/provider
TAMBALA_ORCHESTRATOR_API_KEY=
TAMBALA_ORCHESTRATOR_BASE_URL=https://api.groq.com/openai/v1
TAMBALA_ORCHESTRATOR_MODEL=openai/gpt-oss-120b

# Add a separate provider or separate key for outreach
TAMBALA_OUTREACH_API_KEY=
TAMBALA_OUTREACH_BASE_URL=
TAMBALA_OUTREACH_MODEL=

# Add a separate provider or separate key for follow-up
TAMBALA_FOLLOWUP_API_KEY=
TAMBALA_FOLLOWUP_BASE_URL=
TAMBALA_FOLLOWUP_MODEL=
```

Blank example values are intentional. Add actual keys only in Render or the relevant secret manager, never in Git or a prompt.

## Visibility and failure behavior

- `getAgentRuntimeInfo(agent)` returns the agent, configured endpoint/model, credential variable name, readiness, and whether a key is configured. It never returns the key value.
- `askTambalaAI(agent, ...)` routes only to that agent's configured client.
- Specialist calls fail with an explicit configuration error if their own key, endpoint, or model is missing. They do not silently consume the orchestrator's API quota.
- Each client has a 30-second request timeout and at most one SDK retry.
- A local per-agent sliding-window limiter and concurrency cap are enabled by default: Orchestrator 20 requests/minute and 2 concurrent calls; Outreach 8 requests/minute and 2 concurrent calls; Follow-up 8 requests/minute and 2 concurrent calls.
- Override per agent with `TAMBALA_<AGENT>_MAX_REQUESTS_PER_MINUTE` and `TAMBALA_<AGENT>_MAX_CONCURRENCY` (for example `TAMBALA_OUTREACH_MAX_REQUESTS_PER_MINUTE`). Values must be positive integers.
- These limits are per running process and reset on restart; they do not enforce account-wide quotas across multiple instances. Set provider-side quotas too before high-volume/autonomous workloads.
- API keys are credentials, not identities or permissions. Organization authorization and approval checks remain separate.
- No new API key has been configured by this code change. Until you add the specialist settings, outreach and follow-up AI calls will return a clear configuration error rather than using the shared Groq key.

## Agent ownership directory

| Agent | Organizational unit | Role mapping | Scope |
|---|---|---|---|
| Orchestrator | Executive Management | Proposed CEO mapping; CEO role remains planned | Organization-wide planning and coordination |
| Outreach | Sales & Business Development | No organizational role binding yet | Prospect research and outreach drafts |
| Follow-up | Customer Relations & Support | No organizational role binding yet | Follow-up analysis and drafts |

These are routing/ownership labels, not authorization grants. An agent's department label does not give it permission to approve spending, send messages, change records, or perform other consequential actions. The CEO role remains planned until the separate activation and trusted identity process is completed.
