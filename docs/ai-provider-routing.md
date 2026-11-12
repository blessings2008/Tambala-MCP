# AI agent API ownership and routing

## Routing policy

Each specialist can use a dedicated credential, endpoint, and model. Set `TAMBALA_<AGENT>_PROVIDER=openrouter` to route that agent through the shared `OPENROUTER_API_KEY`; the OpenRouter endpoint defaults to `https://openrouter.ai/api/v1`. This explicit provider selection takes precedence over that agent's dedicated Groq key. The current Research default model is `nvidia/nemotron-3-ultra-550b-a55b:free`. For a small single-provider deployment, the Founder may explicitly enable `TAMBALA_ALLOW_SHARED_GROQ_KEY=true`; this allows agents without dedicated keys to use the existing `GROQ_API_KEY` (or `TAMBALA_ORCHESTRATOR_API_KEY`) with Groq defaults. The shared credential is never used unless this switch is explicitly enabled. Dedicated agent keys always take precedence. All agents sharing one key also share that provider account's quota and billing.

| Agent | Responsibility | API credential | Endpoint | Model default | Status until configured |
|---|---|---|---|---|---|
| Orchestrator | General Tambala planning and coordination | `TAMBALA_ORCHESTRATOR_API_KEY`; legacy fallback `GROQ_API_KEY` | `TAMBALA_ORCHESTRATOR_BASE_URL`; defaults to Groq | `TAMBALA_ORCHESTRATOR_MODEL`; defaults to `openai/gpt-oss-120b` | Uses the current Groq route if the legacy key is present |
| Outreach | Draft personalized prospect messages | `TAMBALA_OUTREACH_API_KEY`; optional explicitly enabled shared Groq key | `TAMBALA_OUTREACH_BASE_URL` (defaults to Groq) | `TAMBALA_OUTREACH_MODEL` (defaults to `openai/gpt-oss-20b`) | Dedicated config or shared-key mode |
| Follow-up | Follow-up analysis and drafts | `TAMBALA_FOLLOWUP_API_KEY`; optional explicitly enabled shared Groq key | `TAMBALA_FOLLOWUP_BASE_URL` (defaults to Groq) | `TAMBALA_FOLLOWUP_MODEL` (defaults to `openai/gpt-oss-20b`) | Dedicated config or shared-key mode |
| Research | Central Research & Intelligence | `TAMBALA_RESEARCH_API_KEY` only | `TAMBALA_RESEARCH_BASE_URL` | `TAMBALA_RESEARCH_MODEL` | Planned profile; requires its own settings |
| Marketing | Marketing & Brand Management | `TAMBALA_MARKETING_API_KEY` only | `TAMBALA_MARKETING_BASE_URL` | `TAMBALA_MARKETING_MODEL` | Planned profile; requires its own settings |
| Content | Media & Content Production | `TAMBALA_CONTENT_API_KEY` only | `TAMBALA_CONTENT_BASE_URL` | `TAMBALA_CONTENT_MODEL` | Planned profile; requires its own settings |
| Finance | Finance & Accounting | `TAMBALA_FINANCE_API_KEY` only | `TAMBALA_FINANCE_BASE_URL` | `TAMBALA_FINANCE_MODEL` | Planned profile; requires its own settings |
| Payments | Payments & Financial Operations | `TAMBALA_PAYMENTS_API_KEY` only | `TAMBALA_PAYMENTS_BASE_URL` | `TAMBALA_PAYMENTS_MODEL` | Planned profile; requires its own settings |
| Engineering | Technology & Engineering | `TAMBALA_ENGINEERING_API_KEY` only | `TAMBALA_ENGINEERING_BASE_URL` | `TAMBALA_ENGINEERING_MODEL` | Planned profile; requires its own settings |

OpenRouter free models are rate-limited and their availability can change. `nvidia/nemotron-3-ultra-550b-a55b:free` is the current Research assignment; verify the free model catalogue before changing it. One OpenRouter key is shared by every agent assigned to OpenRouter, so their usage shares the same account limits. The `openrouter/free` alias is available when automatic free-model selection is preferred, but it can select a different model over time.\n\nThe application uses the OpenAI SDK's **Chat Completions** interface, so each configured endpoint must be OpenAI-compatible for `/chat/completions`. The default for all agents is Groq's OpenAI-compatible endpoint and `openai/gpt-oss-20b` for specialists (`openai/gpt-oss-120b` for the CEO). Set per-agent overrides when assigning different providers or models.

## Environment configuration

Use your deployment environment's secret settings, not committed values:

```dotenv
# Existing provider — reserved for the orchestrator
GROQ_API_KEY=

# Orchestrator can also be assigned a dedicated credential/provider
TAMBALA_ORCHESTRATOR_API_KEY=
TAMBALA_ORCHESTRATOR_BASE_URL=https://api.groq.com/openai/v1
TAMBALA_ORCHESTRATOR_MODEL=openai/gpt-oss-120b

# Route Research through the shared OpenRouter key (overrides its dedicated Groq key)\nTAMBALA_RESEARCH_PROVIDER=openrouter\nTAMBALA_RESEARCH_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free\n\n# Add a separate provider or separate key for outreach
TAMBALA_OUTREACH_API_KEY=
TAMBALA_OUTREACH_BASE_URL=
TAMBALA_OUTREACH_MODEL=

# Add a separate provider or separate key for follow-up
TAMBALA_FOLLOWUP_API_KEY=
TAMBALA_FOLLOWUP_BASE_URL=
TAMBALA_FOLLOWUP_MODEL=

# Dedicated department agents (leave blank until a provider is assigned)
TAMBALA_RESEARCH_API_KEY=
TAMBALA_RESEARCH_BASE_URL=
TAMBALA_RESEARCH_MODEL=
TAMBALA_MARKETING_API_KEY=
TAMBALA_MARKETING_BASE_URL=
TAMBALA_MARKETING_MODEL=
TAMBALA_CONTENT_API_KEY=
TAMBALA_CONTENT_BASE_URL=
TAMBALA_CONTENT_MODEL=
TAMBALA_FINANCE_API_KEY=
TAMBALA_FINANCE_BASE_URL=
TAMBALA_FINANCE_MODEL=
TAMBALA_PAYMENTS_API_KEY=
TAMBALA_PAYMENTS_BASE_URL=
TAMBALA_PAYMENTS_MODEL=
TAMBALA_ENGINEERING_API_KEY=
TAMBALA_ENGINEERING_BASE_URL=
TAMBALA_ENGINEERING_MODEL=
```

Blank example values are intentional. Add actual keys only in Render or the relevant secret manager, never in Git or a prompt.

## Visibility and failure behavior

- `getAgentRuntimeInfo(agent)` returns the agent, configured endpoint/model, credential variable name, readiness, and whether a key is configured. It never returns the key value.
- `askTambalaAI(agent, ...)` routes only to that agent's configured client.
- Specialist calls fail closed if no dedicated key or explicitly enabled shared Groq key is available. In shared-key mode, all agents use the same provider account and therefore share its quota and billing.
- Each client has a 30-second request timeout and at most one SDK retry.
- A local per-agent sliding-window limiter and concurrency cap are enabled by default: Orchestrator 20 requests/minute and 2 concurrent calls; every department agent 8 requests/minute and 2 concurrent calls.
- Override per agent with `TAMBALA_<AGENT>_MAX_REQUESTS_PER_MINUTE` and `TAMBALA_<AGENT>_MAX_CONCURRENCY` (for example `TAMBALA_OUTREACH_MAX_REQUESTS_PER_MINUTE`). Values must be positive integers.
- These limits are per running process and reset on restart; they do not enforce account-wide quotas across multiple instances. Set provider-side quotas too before high-volume/autonomous workloads.
- API keys are credentials, not identities or permissions. Organization authorization and approval checks remain separate.
- Dedicated per-agent credentials remain the recommended production arrangement. Shared-key mode is a deliberate small-team deployment option, not a separate quota or security boundary.

## Agent ownership directory

| Agent | Organizational unit | Role mapping | Scope |
|---|---|---|---|
| Orchestrator | Executive Management | Proposed CEO mapping; CEO role remains planned | Organization-wide planning and coordination |
| Outreach | Sales & Business Development | No organizational role binding yet | Prospect research and outreach drafts |
| Follow-up | Customer Relations & Support | No organizational role binding yet | Follow-up analysis and drafts |
| Research | Central Research & Intelligence | No organizational role binding yet | Independent research and evidence verification |
| Marketing | Marketing & Brand Management | No organizational role binding yet | Brand strategy and campaigns |
| Content | Media & Content Production | No organizational role binding yet | Content drafts and production plans |
| Finance | Finance & Accounting | No organizational role binding yet | Financial reporting and controls |
| Payments | Fintech Ventures / Tambala Pay | No organizational role binding yet | Invoice/payment workflow planning and reconciliation |
| Engineering | Technology & Engineering | No organizational role binding yet | Software, APIs, infrastructure, and AI automation |

These are routing/ownership labels, not authorization grants. An agent's department label does not give it permission to approve spending, send messages, change records, or perform other consequential actions. The CEO role remains planned until the separate activation and trusted identity process is completed.
