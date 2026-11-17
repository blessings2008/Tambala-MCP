import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  internalChatAgentForRole,
  internalChatChannelForAgent,
  isInternalChatChannel,
} from '../src/organization/internal-chat.js';

test('department roles resolve to their matching internal chat agent', () => {
  assert.equal(internalChatAgentForRole('director-research-intelligence'), 'research');
  assert.equal(internalChatAgentForRole('director-sales-business-development'), 'outreach');
  assert.equal(internalChatAgentForRole('director-customer-relations'), 'followup');
  assert.equal(internalChatAgentForRole('director-board-governance'), 'governance');
});

test('agents map only to the explicitly configured room channels', () => {
  assert.equal(internalChatChannelForAgent('orchestrator'), 'executive');
  assert.equal(internalChatChannelForAgent('governance'), 'board');
  assert.equal(internalChatChannelForAgent('research'), 'research');
  assert.equal(internalChatChannelForAgent('outreach'), 'sales');
  assert.equal(internalChatChannelForAgent('engineering'), 'technology');
  assert.equal(internalChatChannelForAgent('finance'), 'finance');
  assert.equal(internalChatChannelForAgent('marketing'), null);
});

test('chat channel validation rejects arbitrary room names', () => {
  assert.equal(isInternalChatChannel('sales'), true);
  assert.equal(isInternalChatChannel('founder'), true);
  assert.equal(isInternalChatChannel('payroll'), false);
  assert.equal(isInternalChatChannel(null), false);
});
