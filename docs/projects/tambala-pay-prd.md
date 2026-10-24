# Tambala Pay — Project Requirements Document

**Product:** Tambala Pay  
**Owner:** Tambala Technologies  
**Version:** 1.0  
**Initial deployment:** Internal use within Tambala Technologies  
**Owning business unit:** Financial Technology (`fintech-ventures`)  
**Accountable business department:** Finance & Accounting (`finance-accounting`)  
**Delivery partners:** Product Management & Innovation; Technology & Engineering; Cybersecurity & IT; Legal, Risk & Compliance; AI & Automation for MCP integration

## 1. Project Overview

Tambala Pay is an internal financial management and payment collection system designed to help Tambala Technologies create invoices, collect full or partial payments, issue receipts, and maintain accurate financial records.

An authorized organization member creates an invoice once and shares it with a client through a secure payment link or QR code. Clients can pay in full or make multiple partial payments against the same invoice. Every confirmed successful payment updates the invoice balance, generates its own receipt, and synchronizes relevant financial information with the organization's database.

## 2. Core Objectives

The system must:

1. Simplify payment collection for Tambala Technologies.
2. Support full and partial payments against existing invoices.
3. Maintain accurate invoice balances and payment histories.
4. Generate receipts for successful payments.
5. Provide secure payment links and QR codes.
6. Maintain a centralized client database.
7. Synchronize financial records with the Tambala organization and MCP system.
8. Support multiple payment providers as integrations become available.
9. Provide financial reporting and outstanding-payment tracking.
10. Establish a foundation for future public release.

## 3. Invoice Management

Authorized organization members must be able to create invoices containing:

- Unique invoice number.
- Client name and business.
- Client contact information.
- Description of the service or product.
- Invoice amount and currency.
- Issue date and due date.
- Payment terms and notes.
- Invoice creator.
- Invoice status.

Each invoice is created once and retains its identity throughout its lifecycle. A new payment must not create a new invoice.

### Invoice statuses

- **Draft:** Created but not yet issued.
- **Unpaid:** Issued with no successful payments.
- **Partially Paid:** At least one successful payment has been received, but a balance remains.
- **Paid:** The full amount has been received.
- **Overdue:** An outstanding balance remains after the due date.
- **Cancelled:** Cancelled by an authorized organization member under financial recordkeeping rules.

## 4. Client Payment Experience

Each issued invoice must have a unique, secure payment page that clients can open without creating an account. The page must display:

- Tambala Technologies branding.
- Invoice number.
- Client and service details.
- Original invoice amount.
- Total amount already paid.
- Outstanding balance.
- Invoice due date and status.
- Available payment methods.

### Payment amount selection

Clients can enter any valid amount up to the outstanding balance. For example, if the invoice is MWK 150,000 and MWK 50,000 has already been paid, the remaining balance is MWK 100,000; the client may pay MWK 20,000, MWK 50,000, or the full MWK 100,000.

The server must reject invalid amounts and prevent overpayment unless an authorized overpayment policy is introduced.

Clients must be able to:

1. Pay immediately using an available payment provider.
2. Leave the invoice unpaid and return later.
3. Save or revisit the payment link.
4. Scan a QR code to access the same invoice.
5. View the updated outstanding balance after successful payments.
6. Access receipts for completed payments.

The payment link and QR code remain associated with the original invoice as its balance changes. A fully paid or cancelled invoice must show its updated status and reject further payments.

## 5. Payment Processing

Use a provider-independent architecture so providers can be added without rewriting invoice and accounting logic.

Each payment record must contain:

- Unique internal payment ID.
- Associated invoice ID.
- Client ID.
- Amount and currency.
- Payment provider.
- Provider transaction reference.
- Payment initiation timestamp.
- Payment confirmation timestamp.
- Payment status.
- Reconciliation information.

### Payment statuses

- Pending
- Successful
- Failed
- Cancelled
- Reversed or Refunded, where applicable

A payment is not successful merely because the client returns to the website or uploads a transaction reference. Verify payment through an authenticated provider confirmation or a documented reconciliation process. Processing must be idempotent so duplicate provider notifications cannot record the same transaction more than once.

## 6. Receipt Generation

Every confirmed successful payment must generate a receipt containing:

- Unique receipt number.
- Client name and business.
- Payment amount.
- Payment date.
- Associated invoice number.
- Payment method or provider.
- Transaction reference, where appropriate.
- Remaining invoice balance.
- Receipt status, where relevant.
- Tambala Technologies identification.

Receipts must be downloadable as PDFs and accessible through secure links. Each partial payment receives its own receipt. If a payment is reversed or refunded, retain the original receipt and payment history and record the reversal/refund separately.

## 7. QR Code Generation

Generate a QR code for every issued invoice. It must direct the client to the invoice's secure payment page without exposing confidential client information or sensitive payment credentials. The QR code continues to identify the original invoice as its balance changes.

Once an invoice is fully paid or cancelled, the payment page must display the updated status and prevent further payments against it.

## 8. Client Management

Maintain a centralized client database. Each client should have:

- Unique client ID.
- Client name.
- Business name, if applicable.
- Contact information.
- Invoice history.
- Payment history.
- Outstanding balance.
- Total invoiced.
- Total successfully paid.
- Associated projects or services.
- Relationship status.

### Client identity matching

Match clients using existing client IDs and verified identifiers such as registered contact details. Names and business names may assist matching but are not unique identifiers. If a potential duplicate is detected, an authorized member must be able to review and merge records without losing transaction history.

## 9. Tambala Organization and MCP Integration

Tambala Pay must integrate with the existing Tambala organization rather than operate as an isolated financial application. The financial database is the authoritative source for invoice balances, payments, receipts, and transaction records. The organization and AI agents retrieve financial information through authenticated, permission-controlled interfaces.

### Required organization events

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

Events must be delivered reliably, with retries and duplicate-event protection.

### Example organizational queries

Authorized agents should be able to answer:

- How much revenue did Tambala receive this month?
- Which clients have outstanding invoices?
- How much does a particular client still owe?
- Which invoices are overdue?
- How much has a particular client paid?
- Which payments require reconciliation?
- What was the total amount invoiced this quarter?

Agents must query actual financial records rather than infer answers from chat history. Financial actions—including refunds, invoice cancellation, and record adjustments—must require appropriate permissions and approval where configured.

## 10. Internal Dashboard

### Overview

- Total invoiced.
- Total successfully received.
- Outstanding balances.
- Overdue invoices.
- Recent payments.
- Pending payment confirmations.

### Invoices

- Create and edit drafts.
- Issue invoices.
- Generate payment links and QR codes.
- View invoice histories.
- Record authorized offline payments.
- Cancel invoices according to policy.

### Clients

- Create and manage client profiles.
- View payment and invoice histories.
- Identify potential duplicate records.

### Payments

- View all transactions.
- Filter by date, client, provider, invoice, and status.
- Investigate failed or pending payments.
- Reconcile offline payments.
- Record refunds and reversals.

### Receipts

- View and download receipts.
- Search by invoice, client, receipt number, or transaction reference.

### Reports

- Revenue by period.
- Outstanding invoices.
- Overdue payments.
- Partial-payment activity.
- Client payment history.
- Payment-provider performance.

### Settings

- Organization details and branding.
- Invoice numbering.
- Receipt numbering.
- Payment-provider configuration.
- User roles and permissions.
- Integration credentials and webhook settings.

## 11. Security and Financial Integrity

The system must implement:

- Authentication for internal users.
- Role-based access control.
- Secure public invoice links using unguessable tokens.
- Server-side amount and balance validation.
- Authenticated payment-provider webhooks.
- Idempotent transaction processing.
- Audit logs for financial changes.
- Secure handling of API credentials.
- Rate limiting and abuse prevention.
- Database backups and recovery procedures.
- Appropriate protection of client information.

Payment credentials and provider secrets must never be exposed to public frontend code. Public invoice pages must disclose only the information needed to identify and pay the invoice. Financial records must not be silently overwritten or deleted.

## 12. Suggested Technical Architecture

Preserve existing Tambala infrastructure where practical.

- **Frontend:** Responsive internal dashboard and public invoice pages.
- **Backend:** Secure API for invoice management, payment initiation, provider verification, receipts, QR codes, and organization integration.
- **Database:** Relational database such as PostgreSQL with separate records for clients, invoices, invoice line items, payments, receipts, refunds/reversals, provider events, organization events, audit logs, users, and permissions.
- **Payment integration:** Provider adapters that allow new providers without rewriting core invoice/accounting logic.
- **Organization integration:** Authenticated API endpoints or reliable event delivery connecting Tambala Pay to the existing MCP organization.

The financial database—not an AI agent—must calculate balances and confirm transactions.

## 13. Recommended Development Phases

### Phase 1: Internal financial foundation

- Authentication and permissions.
- Client management.
- Invoice creation and tracking.
- Partial-payment calculations.
- Manual payment recording with audit logs.
- PDF invoices and receipts.
- Payment links and QR codes.

### Phase 2: Online payment collection

- Integrate the first supported payment provider.
- Initiate payments securely.
- Verify payment confirmations.
- Generate receipts automatically.
- Handle failed payments and duplicate notifications.

### Phase 3: Organization integration

- Synchronize client records.
- Publish financial events.
- Enable authorized agents to query financial data.
- Build organization-level financial reports.

### Phase 4: Operational improvements

- Automated overdue reminders.
- Reconciliation tools.
- Additional payment providers.
- Advanced reporting and exports.
- Improved client payment history.

### Phase 5: Public product preparation

- Support multiple organizations.
- Separate each organization's data securely.
- Introduce organization-specific branding and settings.
- Establish pricing and usage policies.
- Review legal, financial, security, and operational requirements before public launch.

## 14. Acceptance Criteria

The first production-ready internal version must satisfy these conditions:

1. An authorized user can create and issue an invoice.
2. The invoice receives a unique identifier.
3. The client can access its payment page securely.
4. The client can enter a partial or full payment amount.
5. The system prevents invalid payment amounts.
6. Every successful payment updates the existing invoice.
7. Multiple payments can be associated with one invoice.
8. Each successful payment generates a unique receipt.
9. The remaining balance is calculated accurately.
10. A fully paid invoice cannot accept another payment.
11. Payment links and QR codes reference the correct invoice.
12. Client records are associated with the correct invoices.
13. Financial changes are recorded in an audit log.
14. The organization can retrieve verified financial information.
15. Duplicate payment notifications cannot create duplicate transactions.
16. Transaction history is preserved when refunds or reversals occur.

## 15. Product Direction

Tambala Pay begins as an internal financial management and payment collection system for Tambala Technologies. Its first priority is to make the company's own invoicing and payment collection reliable.

**Core principle:** Create the invoice once. Accept multiple payments. Generate a receipt for every successful payment. Maintain an accurate balance. Keep the entire organization informed.

The system should eventually serve other businesses without compromising financial accuracy, security, or data isolation.

## Departmental Ownership and Governance

- **Owning business unit:** Financial Technology (`fintech-ventures`).
- **Accountable business department:** Finance & Accounting (`finance-accounting`). Owns financial workflows, invoice/payment/receipt policy, reconciliation requirements, reporting definitions, and internal acceptance of financial controls.
- **Product lead:** Product Management & Innovation (`product-innovation`). Maintains the roadmap, scope, user requirements, and delivery coordination.
- **Engineering delivery:** Technology & Engineering (`technology-engineering`). Owns architecture, implementation, testing, reliability, and data integrity.
- **Security review:** Cybersecurity & IT (`cybersecurity-it`). Reviews access control, secrets, webhooks, rate limiting, backups, and incident recovery.
- **Risk review:** Legal, Risk & Compliance (`legal-risk-compliance`). Reviews provider terms, privacy, financial/legal obligations, refunds, and launch readiness.
- **MCP integration:** AI & Automation (`ai-automation`). Exposes authenticated, permission-controlled financial queries and consumes reliable events; AI must never become the source of truth for financial balances or payment confirmation.

This PRD records requirements and ownership only. It does not authorize a live payment provider, real-money processing, refunds, production deployment, or public release.
