# Sales & Business Development — Prospecting Workflow

**Owner:** Sales & Business Development  
**Shared research support:** Central Research & Intelligence  
**Current execution path:** Tambala MCP live agent test workflow  
**Status:** Implementation in progress; not yet approved for autonomous external actions.

## Objective

Produce a small, qualified, source-verifiable shortlist of businesses that Tambala could realistically approach for its verified services, then prepare personalized outreach drafts for Founder review.

## Inputs

- Founder/CEO objective, including any explicit location, industry, count, and exclusions.
- Verified active services from the existing Supabase services table.
- Existing lead and client names/statuses from the CRM.
- External research results with source URLs and snippets.

## Workflow

1. **Interpret the objective.** Preserve any explicit geography and industry. For a generic client-finding objective, default to Tambala's established Malawi market and relevant sectors rather than inventing a new target geography.
2. **Construct a focused search query.** Search keywords and entities only; never send the entire agent prompt to the web provider.
3. **Research candidate businesses.** Use web evidence to identify real businesses and retain the exact source URL for every material claim.
4. **Qualify the evidence.** For each candidate, capture business name, location if sourced, official website or clearly marked unknown, evidence of fit, contact route only if publicly listed, and a specific potential opportunity.
5. **Check existing records.** Compare names against supplied CRM leads and clients. If the CRM is unavailable, say so and do not claim a duplicate check was completed.
6. **Prepare a shortlist.** Rank the strongest candidates first; return fewer candidates rather than padding the list with weak matches.
7. **Draft outreach.** Personalize from verified facts and use only services listed in the supplied active-services context.
8. **Founder approval.** Messages remain drafts until the Founder explicitly approves sending through a separately authorized messaging workflow.
9. **Record follow-up.** Any real outreach action must be recorded in the CRM only after it actually occurs.

## Required output per prospect

- Business name
- Town/region/country, if verified
- Official website or "Not verified"
- Evidence-based fit rationale
- Specific opportunity and evidence supporting it
- Source URL(s)
- Public contact route, if actually available
- Duplicate-check outcome: clear / possible duplicate / not checked
- Suggested next step
- Optional outreach draft based only on verified facts

## Non-negotiable rules

- Do not include Tambala itself as a prospect.
- Exclude job listings and unrelated results.
- Do not claim a business lacks a website unless evidence supports that claim.
- Do not invent names, contacts, websites, prices, needs, client results, or past interactions.
- Do not claim a message was sent, a demo shared, or a follow-up completed unless the actual record confirms it.
- Do not expose private CRM notes or contact details in public-facing drafts.
- No autonomous external messages or commitments.

## Acceptance test

The workflow is ready for operational use when a live test:
1. Returns individually identifiable businesses in the requested market and industry.
2. Provides source URLs that actually support the business and fit rationale.
3. Includes no unrelated search snippets or fabricated contacts.
4. Uses existing CRM records for duplicate checks, or explicitly discloses that CRM data was unavailable.
5. Uses only verified Tambala services.
6. Produces useful next steps and outreach drafts.
7. Leaves external actions pending Founder approval.
