# Finance & Accounting — Tambala Pay Internal Workflow

## Purpose

Tambala Pay is currently an **internal financial-management and payment-collection capability for Tambala Technologies**. It is not being treated as a public SaaS product yet.

The Finance & Accounting department owns the financial rules and records. Technology & Engineering owns implementation. Customer Relations supports client-facing payment communication. Legal, Risk & Compliance reviews regulated or high-risk payment changes. The CEO/Founder retain approval powers defined by organizational policy.

## Core rule

**Create the invoice once. Accept multiple payments against that invoice. Generate one receipt per confirmed successful payment. Maintain the balance from financial records.**

## Department responsibilities

### Finance & Accounting — accountable owner

- Define invoice and receipt numbering rules.
- Maintain authoritative invoice, payment, receipt, refund, and reconciliation records.
- Define partial-payment and overdue rules.
- Review and reconcile offline payments.
- Produce revenue, outstanding-balance, overdue, and payment-provider reports.
- Define which financial actions require approval.
- Validate financial calculations and acceptance criteria.

### Technology & Engineering — implementation owner

- Build the dashboard and public invoice-payment page.
- Implement server-side balance validation.
- Implement secure payment links and QR codes.
- Implement provider adapters and authenticated webhook handling.
- Enforce idempotency and audit logging.
- Generate PDF invoices and receipts.
- Provide authenticated APIs for organization queries.

### Customer Relations & Support — client experience

- Help clients understand invoices and payment links.
- Handle payment-status questions using verified records.
- Escalate failed, pending, reversed, or disputed payments.
- Never confirm a payment solely from a screenshot or client claim.

### Legal, Risk & Compliance — control review

- Review payment-provider and financial-data handling requirements.
- Review refund, reversal, cancellation, privacy, and retention rules.
- Flag regulated activities before public release.

### CEO / Founder — approvals

- Approve material financial policy changes and configured reserved actions.
- Approve transition toward public productization.

## Phase 1 — internal foundation

1. Internal authentication and role-based access.
2. Client records.
3. Invoice creation and issuance.
4. Draft/unpaid/partially-paid/paid/overdue/cancelled status handling.
5. Multiple payments against one invoice.
6. Manual/offline payment recording with audit logs.
7. PDF invoice and receipt generation.
8. Secure payment links and QR codes.
9. Accurate outstanding-balance calculations.

No live payment provider is required to complete this phase.

## Phase 2 — online collection

- Add the first approved provider through an adapter.
- Create payment attempts against existing invoice IDs.
- Verify successful payments using authenticated provider confirmation or documented reconciliation.
- Generate receipts only after confirmation.
- Handle failed, cancelled, refunded, reversed, and duplicate notifications.

## Phase 3 — organization integration

Publish reliable events such as:

- `client_created`
- `invoice_created`
- `invoice_issued`
- `payment_initiated`
- `payment_received`
- `invoice_partially_paid`
- `invoice_paid`
- `invoice_overdue`
- `payment_failed`
- `payment_refunded`

Agents may query financial records only through authenticated, permission-controlled interfaces. They must not calculate authoritative balances from conversation history.

## Required internal queries

Authorized organization users/agents should be able to retrieve:

- Revenue received this month.
- Outstanding invoices.
- Amount owed by a client.
- Overdue invoices.
- Payment history for a client.
- Payments requiring reconciliation.
- Total invoiced for a period.

## Financial integrity rules

- A successful payment must reference exactly one invoice.
- A payment cannot exceed the current outstanding balance unless an explicit overpayment policy exists.
- Duplicate provider events must be idempotent.
- A client returning to the payment page does not prove payment success.
- Financial records are never silently overwritten or deleted.
- Refunds and reversals preserve the original transaction history.
- Public invoice tokens must be unguessable and must not expose confidential information.
- Provider secrets stay server-side.

## Initial acceptance test

The internal version is ready for the next phase only when an authorized user can:

1. Create and issue one invoice.
2. Open its secure payment page.
3. Record or receive a partial payment.
4. See the same invoice move to `partially_paid`.
5. Generate a receipt for that payment.
6. Make a second payment against the same invoice.
7. See the remaining balance reach zero.
8. See the invoice become `paid`.
9. Confirm that another payment is rejected.
10. Verify that the complete transaction history remains intact.

## Future public release

Public multi-organization support is explicitly out of scope for the internal version. Before public release, the organization must add tenant isolation, organization-level branding/configuration, pricing, usage policies, stronger operational controls, and a legal/security review.
