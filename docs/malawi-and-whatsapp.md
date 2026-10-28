# Malawi-first outreach and WhatsApp readiness

## Operating market

External prospecting, sales outreach, customer acquisition, and relationship workflows are restricted to **Malawi** unless the Founder explicitly changes the policy.

Research agents should prefer Malawian businesses, organizations, locations, decision-makers, and publicly available contact channels. They should not broaden a prospecting task to another country merely because a Malawi search is difficult.

## WhatsApp ownership

WhatsApp is an external communication channel, not a new department.

- **Customer Relations & Support** owns inbound customer conversations and service continuity.
- **Sales & Business Development** owns prospect conversations and outreach execution.
- **Marketing & Brand Management** owns campaign/content context when a conversation originates from a campaign.
- **AI & Automation / Technology & Engineering** own the integration, routing, authentication, webhooks, logging, and reliability layer.
- **Founder** retains approval authority for sensitive outbound communications and financial commitments.

Until WhatsApp provider credentials are configured, the organization must not pretend that WhatsApp is available. The channel should remain a pending integration and fall back to the currently enabled channels.

## Inbound routing principle

Incoming WhatsApp messages should be routed by intent before an agent responds:

1. Existing-client support -> Customer Relations & Support.
2. New prospect / sales enquiry -> Sales & Business Development.
3. Marketing/campaign enquiry -> Marketing & Brand Management.
4. Payment/invoice question -> Finance & Accounting / Tambala Pay responsible workflow.
5. Technical issue -> Technology & Engineering.
6. Ambiguous or sensitive matter -> CEO/Founder review according to organization policy.

## Message handling requirements

The integration should preserve the WhatsApp message ID, sender identifier, timestamp, conversation context, routing decision, agent response, and approval state. Duplicate inbound webhooks must not create duplicate tasks or replies.

The organization should never expose provider credentials to agents or the public frontend.
