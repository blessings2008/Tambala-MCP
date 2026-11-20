import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNonSecurityWorkflowBlock } from '../src/organization/workforce/incident-routing.js';

test('business data and policy validation blocks are not routed to Cybersecurity & IT', () => {
  const messages = [
    'The Research employee did not include the required DISCOVERED_PROSPECTS JSON block.',
    'Autonomous first-contact outreach requires a matching CRM lead with a verified WhatsApp number.',
    'Founder input required: Evolution could not verify this CRM number as a WhatsApp-registered lead.',
    'Evolution API 400: {"message":[{"jid":"265993999333@s.whatsapp.net","exists":false,"number":"265993999333"}]}',
    'The supplied phone is not a valid phone number.',
    "AI request blocked by Tambala's free-only policy.",
    'The model is not verified as free for this provider.',
    'Approved first-contact is missing its CRM destination or verified organisation name.',
    'No customer message was queued because the destination is not registered on WhatsApp.',
    'The same message was already prepared or sent to this number in the last 24 hours.',
  ];

  for (const message of messages) {
    assert.equal(isNonSecurityWorkflowBlock(message), true, message);
  }
});

test('infrastructure and uncertain-delivery failures remain eligible for IT investigation', () => {
  const messages = [
    'The handoff worker stopped reporting heartbeats.',
    'Worker lease expired; delivery outcome is unknown. Check the WhatsApp chat before manually retrying.',
    'Groq API 401: Missing Authentication header.',
    'Supabase database connection timeout.',
    'WhatsApp action did not confirm a queued or sent result.',
    'Render service failed its health check and restarted.',
  ];

  for (const message of messages) {
    assert.equal(isNonSecurityWorkflowBlock(message), false, message);
  }
});

test('empty and unrelated messages are not classified as workflow blocks', () => {
  assert.equal(isNonSecurityWorkflowBlock(''), false);
  assert.equal(isNonSecurityWorkflowBlock('The security scan detected an unexpected login.'), false);
});
