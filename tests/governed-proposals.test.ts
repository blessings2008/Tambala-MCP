import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeDutyChange } from '../src/organization/workforce/governed-proposals.ts';
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
  }), /Only People\/HR or Strategy/);
});
