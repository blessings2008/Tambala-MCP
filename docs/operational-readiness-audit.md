# Tambala Organization — Operational Readiness Audit

**Branch:** `org-task-engine`  
**Purpose:** Move the existing organization from a mostly defined structure toward useful internal operations without redesigning or duplicating the existing system.

## Executive finding

The organization model is present in the database, but department records are still marked `planned`. Some real work already exists in the shared task/project records, but several tasks have no department assignment. The next step is to connect real workflows to accountable departments and prove that each workflow produces a useful, verifiable result.

This audit does not activate every department automatically. A department should be marked operational only after its owner, tools, access boundaries, workflow, and acceptance criteria have been verified.

## Existing assets confirmed

- Organization units already exist for Sales & Business Development, Marketing & Brand Management, Media & Content Production, Finance & Accounting, Central Research & Intelligence, Technology & Engineering, AI & Automation, and supporting departments.
- Existing business services include Web Development, Software Development, and Digital Product Development.
- Existing lead, client, task, project, product, and activity records are already in the database; preserve and reuse them.
- Existing work includes outreach batches and follow-ups, active client website projects, the Tambala MCP Organization Platform, and the Tambala Pay internal-finance project.
- The `org-task-engine` branch includes the live agent task runner/event stream and live testing surface. The README's roadmap text is stale relative to some of the newer implementation and should be reconciled after this audit.

## Main gaps

1. Department units are still marked `planned`; defined roles must not be mistaken for active, tested agents.
2. Existing sales/client tasks are often missing `department_id`, weakening ownership and reporting.
3. Research must produce source-backed, relevant prospects and concise evidence—not generic or unrelated search snippets.
4. Marketing and content work needs a repeatable brief → calendar → draft → review → approval → publish workflow. External publishing must remain approval-gated.
5. Finance needs an internal recordkeeping workflow before any live payment integration: invoice identity, partial payments, receipts, balance calculation, audit history, and permissions.
6. Operational task completion must be based on acceptance criteria and actual deliverables, not merely a successful model response.
7. Cross-department work needs clear ownership: Sales owns the lead pipeline; Central Research & Intelligence supports evidence gathering; Marketing owns brand/content; Finance owns financial rules; Technology & Engineering builds systems; AI & Automation integrates workflows.

## Recommended activation order

### 1. Sales & Business Development — first operational workflow
- Use the existing lead database and current client/outreach records.
- Research new prospects with explicit geography, industry, fit criteria, source links, and exclusion of existing leads/clients.
- Produce a qualified shortlist with evidence, fit rationale, contact route where publicly available, and a suggested next step.
- Draft personalized outreach; do not send external messages without explicit approval.
- Track contacted, replied, follow-up, negotiating, won, and lost states accurately.

**Acceptance:** A test task returns relevant, source-verifiable prospects, checks duplicates against existing records, and provides a usable outreach draft without claiming messages were sent.

### 2. Marketing, Content & Communications — second operational workflow
- Keep Marketing & Brand Management and Media & Content Production as existing separate departments; do not create a duplicate department.
- Marketing owns positioning, campaigns, audience, and results.
- Media & Content Production plans and creates assets for approved briefs.
- Start with a weekly content plan, draft posts, asset requirements, and approval status.
- Use real completed work and approved claims; no invented client outcomes, testimonials, or guarantees.

**Acceptance:** A weekly content pack contains dated post ideas, channel, objective, draft copy, asset notes, source/claim checks, and an explicit pending-approval state.

### 3. Finance & Accounting — internal financial service
- Tambala Pay remains an internal service owned operationally by Finance & Accounting, not a public product launch.
- Begin with invoices, manual payment records, partial payments, receipts, outstanding balances, reports, permissions, and audit trails.
- Do not process live money, issue real payment instructions, or launch publicly until the required controls and provider verification are tested.

**Acceptance:** A test invoice supports multiple recorded payments, creates a receipt per confirmed payment, calculates the balance correctly, and preserves an audit trail.

### 4. Central Research & Intelligence — shared evidence capability
- Support Sales and Marketing with focused, query-specific research.
- Separate verified facts, assumptions, and unknowns.
- Retain source URLs and a short explanation of relevance.
- Avoid duplicate work and exclude prospects already present in the existing pipeline.

**Acceptance:** Research output includes the exact question answered, evidence with links, date/context where relevant, and explicit limitations.

### 5. Technology & Engineering + AI & Automation — enabling platform
- Maintain the MCP platform, integrations, and test environment.
- Expose controlled interfaces to existing data rather than letting agents infer business state from chat.
- Keep identity, authorization, auditability, and approval controls deterministic.
- Do not activate external-action tools solely because a role exists in the organization chart.

## Immediate cleanup

- Assign existing outreach tasks to Sales & Business Development.
- Assign payment-status work to Finance & Accounting, website completion work to Technology & Engineering, and portfolio/testimonial work to Marketing & Brand Management.
- Add department-owned activation tasks for Sales, Marketing/Content, Research, and Finance.
- Keep department status `planned` until each department passes its acceptance checks. Do not label agents as active unless their identity, configuration, permissions, and execution path are real and verified.

## Definition of operational

A department is operational only when it has:
1. A clear accountable owner and scope.
2. An executable workflow using real organizational records.
3. The minimum tools and data permissions it needs.
4. Defined deliverables and acceptance criteria.
5. Tests for failures, duplicates, missing evidence, and unauthorized actions.
6. A truthful status/reporting mechanism and a path to escalate blockers.

## Guardrails

- Preserve the existing database and existing records; do not replace tables or seed duplicate organization structures.
- Work on `org-task-engine`; do not modify `main` or deploy without explicit authorization.
- Keep payment processing, outbound messages, public publishing, refunds, and other consequential actions behind appropriate human approval until controls are implemented and tested.


## Progress update — research query reliability

The first Sales/Research implementation slice is now committed on `org-task-engine`:

- Added `src/services/research-query.ts` to create short, intent-aware search queries.
- Generic prospecting defaults to Tambala's known Malawi market and core sectors (lodges, hotels, restaurants) rather than searching the raw prompt.
- Specific locations and industries are retained when the Founder objective provides them.
- The CEO delegation path now derives its search query from the original objective and task instead of trusting a model-generated sentence.
- The web research adapter now searches the compact query alone rather than appending the entire specialist prompt.
- The outreach role instructions now require individually identifiable, source-backed prospects, evidence of fit, verified contact routes, duplicate checks when CRM context is supplied, and honest disclosure when website quality is unknown.
- Added automated tests for generic prospecting, industry/location-specific queries, named-entity research, and explicit non-Malawi geography.

**Verification:** GitHub Actions workflow `Organization foundation checks` passed for commit `899a4578440af97af2e1e040ec71639c0adce402` before the additional outreach-prompt tightening. The newest prompt change has its own CI run and must pass before this slice is treated as fully verified.

**Still not complete:** This improves query construction and research instructions, but does not yet prove that live Tavily results are consistently relevant or that CRM duplicate checks are wired into the live agent context. The department remains `planned` until a real end-to-end prospecting test passes.
