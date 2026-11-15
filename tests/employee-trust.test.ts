import test from 'node:test';
import assert from 'node:assert/strict';
import { earnsStandingApproval, TRUST_APPROVAL_THRESHOLD, TRUST_ELIGIBLE_ACTIONS } from '../src/organization/workforce/trust-ledger.ts';

test('standing approval requires 20 consecutive unedited approvals for an eligible low-risk action', () => {
  assert.equal(TRUST_APPROVAL_THRESHOLD, 20);
  assert.equal(earnsStandingApproval(19, 'prepared_followups', true, true), false);
  assert.equal(earnsStandingApproval(20, 'prepared_followups', true, true), true);
  assert.equal(earnsStandingApproval(25, 'prepared_followups', true, false), false);
  assert.equal(earnsStandingApproval(25, 'prepared_followups', false, true), false);
});

test('financial, contractual and customer-contact actions are never eligible for standing approval', () => {
  for (const action of ['send_whatsapp_message', 'create_invoice_link', 'set_price_list_item', 'sign_contract', 'regulatory_submission', 'new_customer_contact']) {
    assert.equal(TRUST_ELIGIBLE_ACTIONS.has(action), false);
  }
});
