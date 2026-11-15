import test from 'node:test';
import assert from 'node:assert/strict';
import { activateApprovedDutyProposal, proposeDutyChange } from '../src/organization/workforce/governed-proposals.ts';
import { InMemoryDutyConfigStore } from '../src/organization/workforce/duty-config.ts';
import { roleIdFor } from '../src/organization/workforce/profiles.ts';

const proposal = {
  title: 'Weekly service quality review',
  agent: 'operations' as const,
  cadence: { kind: 'weekly' as const, day: 5 },
  time: '13:00',
  contexts: ['organization'],
  job: 'Review completed work and identify recurring service quality issues from recorded evidence.',
  deliverable: 'A concise report of verified issues, evidence, recommendations and unavailable data.',
  requiresApproval: true,
  enabled: true,
  evidence: [{ type: 'duty_run', reference: 'organization_duty_runs:recent', summary: 'Recent duty history shows this recurring quality review is not currently assigned.' }],
};

test('duty proposals reject employees outside HR and Strategy', async () => {
  await assert.rejects(proposeDutyChange('ceo', proposal), /Only People\/HR or Strategy/);
});

test('HR and Strategy proposals require persistent Founder approval storage', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await assert.rejects(proposeDutyChange(roleIdFor('people'), proposal), /require persistent approval storage/);
  await assert.rejects(proposeDutyChange(roleIdFor('strategy'), proposal), /require persistent approval storage/);
});

test('role proposals reject non-HR/Strategy proposers before accessing persistent storage', async () => {
  const { proposeRoleChange } = await import('../src/organization/workforce/governed-proposals.ts');
  await assert.rejects(proposeRoleChange('ceo', {
    title: 'Operations Coordinator',
    kind: 'human',
    unitId: 'operations-administration',
    reportsToRoleId: 'ceo',
    purpose: 'Coordinate office operations and internal administration.',
    evidence: [{ type: 'organization_report', reference: 'organization_reports:workforce-review', summary: 'The workforce review identifies a repeated operations coordination gap.' }],
  }), /Only People\/HR or Strategy/);
});


test('approved duty activation uses validated config storage and is idempotent', async () => {
  const store = new InMemoryDutyConfigStore();
  const approval = { id: '12345678-1234-4123-8123-123456789abc', content: JSON.stringify({ version: 1, proposal }) };
  const first = await activateApprovedDutyProposal(approval, store);
  const second = await activateApprovedDutyProposal(approval, store);
  assert.equal(first.id, second.id);
  assert.match(first.id, /^founder-approved-/);
  assert.equal((await store.customs()).length, 1);
  assert.equal((await store.customs())[0].requires_approval, true);
});


test('governed proposals require traceable evidence and HTTPS for web sources', async () => {
  await assert.rejects(proposeDutyChange(roleIdFor('people'), { ...proposal, evidence: [] }), /1 to 8 evidence items/);
  await assert.rejects(proposeDutyChange(roleIdFor('strategy'), {
    ...proposal,
    evidence: [{ type: 'web_source', reference: 'source:1', summary: 'A source summary with enough detail.', sourceUrl: 'http://example.com' }],
  }), /HTTPS source URL/);
});
