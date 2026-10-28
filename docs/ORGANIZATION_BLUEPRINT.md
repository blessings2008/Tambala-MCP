# Tambala Organization — Foundational Blueprint

**Status:** Initial design baseline  
**Owner:** Founder (Bless)  
**Implementation branch:** `org-platform-redesign`

## 1. Purpose

Tambala MCP is being redesigned from a business-automation MCP server into the operational foundation for a unified AI-operated organization. The organization is the primary system: governance, executives, departments, business units, shared records, and agent workflows are parts of one coherent model.

The platform may use separate modules, services, databases, and external providers where technically useful. Physical distribution must not create fragmented organizational identity, authority, or records.

## 2. Operating principles

1. **Founder authority:** The Founder retains ultimate authority and reserved approval rights.
2. **Hybrid governance:** The Board provides oversight and strategic governance; the CEO leads day-to-day operations.
3. **Single accountable CEO:** One primary CEO agent owns operational coordination and decisions within delegated authority.
4. **Executive Council:** Specialist executive agents advise, challenge, and review important decisions. The CEO remains the operational decision-maker unless a matter is reserved for the Board or Founder.
5. **Bounded autonomy:** Departments operate semi-autonomously within approved objectives, policies, budgets, and permissions.
6. **Progressive activation:** Design the complete organizational model now; activate roles and departments as they become useful.
7. **Central Research & Intelligence:** A shared research function serves the whole organization. Departments may do routine task-specific research, but strategic and cross-functional research is coordinated centrally.
8. **Shared source of truth:** Approved policies, decisions, objectives, budgets, and organizational relationships must have authoritative records.
9. **Least privilege:** Agents only receive the tools, data, and action permissions required for their roles.
10. **Evidence before claims:** Agents must distinguish verified facts, assumptions, recommendations, and unknowns.
11. **Human approval for consequential actions:** External commitments, significant spending, sensitive communications, legal/regulated actions, and other defined high-impact operations require explicit authorization.
12. **Auditable actions:** Important decisions, delegations, approvals, and external actions must be recorded.
13. **Measured outcomes:** Evaluate departments by useful outcomes and quality, not message volume or agent count.
14. **Reuse without architectural captivity:** Existing Tambala MCP capabilities should be reused when sound, but legacy structure must not dictate the organizational design.

## 3. Governance and reporting

```text
Founder / Owner
├── Direct access to CEO and organizational reports
└── Board of Directors
    └── Oversight of CEO, strategy, risk, and performance

CEO
├── Executive Council (advisory/review function)
├── Department Directors
│   ├── Executive & Governance
│   ├── Technology & Innovation
│   ├── Commercial & Growth
│   ├── Corporate Services
│   └── Central Research & Intelligence
└── Business Units & Ventures
    ├── Financial Technology
    ├── Software & Digital Services
    ├── Media & Publishing
    └── Future Ventures
```

This is a conceptual reporting model, not a requirement that every role immediately be implemented as a separate agent. Some roles may initially be represented as configurations or responsibilities handled by a smaller set of agents.

## 4. Initial functional structure

### Executive & Governance
- Board & Corporate Governance
- Executive Management
- Strategy & Corporate Planning

### Technology & Innovation
- Technology & Engineering
- AI & Automation
- Product Management & Innovation
- Research & Development
- Cybersecurity & IT

### Commercial & Growth
- Marketing & Brand Management
- Sales & Business Development
- Media & Content Production
- Customer Relations & Support

### Corporate Services
- Finance & Accounting
- Operations & Administration
- Human Resources & Agent Management
- Legal, Risk & Compliance
- Procurement & Resource Management

### Central Research & Intelligence
- Market and industry research
- Competitor and opportunity analysis
- Technical investigations
- Fact-checking and evidence evaluation
- Strategic intelligence reports

### Business Units & Ventures
- Financial Technology: PocketVault, Tambala Pay
- Software & Digital Services: software products and web services
- Media & Publishing: content channels and publishing brands
- Future Ventures: created through a review-and-approval process

Departments are shared organizational functions. Business units are operating ventures with their own objectives, accountable leaders, and specialist teams where justified.

## 5. Decision rights — initial defaults

- Agents may perform low-risk, reversible work within their role and approved task.
- Department directors may organize routine work and adjust internal workflows within approved policies.
- The CEO may prioritize work and coordinate departments within approved objectives and resource limits.
- The Executive Council advises and challenges; it does not silently override the CEO.
- The Board reviews strategy, risk, CEO performance, and matters assigned to its oversight.
- Founder approval is required for reserved matters, including major new ventures, material commitments beyond approved limits, fundamental mission changes, and shutting down a major business unit.
- No agent may expand its own permissions, approve its own restricted action, invent an approval, or bypass an explicit denial.
- Exact financial thresholds and action categories remain configurable and must be established before enabling consequential external actions.

## 6. Core platform capabilities

The platform should progressively provide:

1. Organizational registry: people/agents, roles, departments, business units, reporting lines, and status.
2. Governance: policies, delegated authority, approval requests, Board decisions, Founder-reserved matters.
3. Work orchestration: objectives, projects, tasks, dependencies, assignments, status, escalation, and review.
4. Agent runtime: role instructions, model/provider selection, tool access, budgets, timeouts, retries, and lifecycle.
5. Shared knowledge: approved facts, source documents, research, decisions, and searchable records with access controls.
6. Communication: structured messages, handoffs, reports, and notifications.
7. Audit and observability: decision history, tool calls, approvals, costs, errors, and performance.
8. Integration layer: existing MCP tools and approved external services as capabilities available to authorized roles.
9. Safety controls: least privilege, approval gates, idempotency for actions, rate/cost limits, and emergency suspension.
10. Executive reporting: concise daily/weekly status, blockers, material risks, decisions needed, and outcome measures.

## 7. Architecture principles

- Keep the organizational domain model separate from MCP transport and individual integrations.
- Use typed schemas and validate inputs at boundaries.
- Keep model output untrusted until validated against policy and schemas.
- Treat authorization as deterministic application logic, not as an instruction in an AI prompt alone.
- Keep provider/model configuration replaceable.
- Keep business data and secrets out of source control.
- Make consequential external actions approval-gated by default.
- Use durable storage for decisions, tasks, approvals, and audit events; do not rely on model context as the system of record.
- Design for retries, partial failure, duplicate events, and recovery.
- Prefer a small reliable core over premature multi-agent complexity.

## 8. Implementation strategy

Design the full organization up front, but implement it in tested increments:

1. Baseline and preserve current MCP behavior.
2. Add organization domain models and initial charter/policies.
3. Add durable records for organizational units, roles, objectives, tasks, decisions, and approvals.
4. Add deterministic policy and permission enforcement.
5. Add CEO orchestration and executive-council consultation.
6. Add director/delegation workflows and reporting.
7. Integrate existing tools and business systems through controlled adapters.
8. Activate departments progressively and evaluate against real work.

## 9. Non-goals for the first milestone

- Creating dozens of independent agents immediately.
- Giving agents unrestricted access to external systems or money.
- Replacing every existing business application.
- Treating an AI role as a legally recognized human officer.
- Claiming full autonomy before reliable execution, monitoring, and recovery have been demonstrated.

## 10. Acceptance criteria for the foundation

The initial foundation is successful when the platform can accurately answer:
- What organization and business units exist?
- Who/what holds each role, and who reports to whom?
- What is each role permitted to do?
- Which objectives and tasks are active, and who owns them?
- Which decisions are proposed, approved, rejected, or superseded?
- Which actions require Founder or Board approval?
- What happened, why did it happen, and what evidence supports the record?

The platform should expose these records through typed application services and, where appropriate, MCP tools.
