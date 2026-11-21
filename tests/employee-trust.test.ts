import test from 'node:test';
import assert from 'node:assert/strict';
import { earnsStandingApproval, mayUseStandingApproval, STANDING_APPROVAL_DAILY_CAPS, TRUST_APPROVAL_THRESHOLD, TRUST_ELIGIBLE_ACTIONS } from '../src/organization/workforce/trust-ledger.ts';

test('standing approval requires 20 consecutive unedited approvals for an eligible low-risk action', () => {
  assert.equal(TRUST_APPROVAL_THRESHOLD, 20);
  assert.equal(earnsStandingApproval(19, 'prepared_work', true, true), false);
  assert.equal(earnsStandingApproval(20, 'prepared_work', true, true, 'low'), true);
  assert.equal(earnsStandingApproval(25, 'prepared_work', true, false, 'low'), false);
  assert.equal(earnsStandingApproval(25, 'prepared_work', false, true, 'low'), false);
  assert.equal(earnsStandingApproval(25, 'prepared_work', true, true, 'medium'), false);
  assert.equal(earnsStandingApproval(25, 'prepared_work', true, true, 'low', true), false);
});

test('financial, contractual and customer-contact actions are never eligible for standing approval', () => {
  for (const action of ['send_whatsapp_message', 'whatsapp_message', 'prepared_followups', 'create_invoice_link', 'set_price_list_item', 'sign_contract', 'regulatory_submission', 'new_customer_contact']) {
    assert.equal(TRUST_ELIGIBLE_ACTIONS.has(action), false);
  }
});


test('earned standing approval is capped and never covers customers or reserved authority', () => {
  assert.deepEqual(STANDING_APPROVAL_DAILY_CAPS, { prepared_work: 5, prepared_content: 3, prepared_internal_task: 5 });
  const base: { standingApproval: boolean; actionType: string; riskLevel: 'low' | 'medium' | 'high' | 'critical'; customerFacing: boolean; reservedAuthority: boolean; usedToday: number } = { standingApproval: true, actionType: 'prepared_work', riskLevel: 'low', customerFacing: false, reservedAuthority: false, usedToday: 0 };
  assert.equal(mayUseStandingApproval(base).allowed, true);
  assert.equal(mayUseStandingApproval({ ...base, usedToday: 5 }).allowed, false);
  assert.equal(mayUseStandingApproval({ ...base, customerFacing: true }).allowed, false);
  assert.equal(mayUseStandingApproval({ ...base, reservedAuthority: true }).allowed, false);
  assert.equal(mayUseStandingApproval({ ...base, riskLevel: 'high' }).allowed, false);
  assert.equal(mayUseStandingApproval({ ...base, standingApproval: false }).allowed, false);
});
