import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompanyStatusRequest } from '../src/channels/founder-execution.ts';

test('Founder company status requests trigger coordinated department reporting', () => {
  for (const prompt of [
    'Prepare a report on the current status of Tambala Technologies.',
    'Give me the company status.',
    'I need an overall status report for the business.',
    'Send an operational status update for the organisation.',
  ]) assert.equal(isCompanyStatusRequest(prompt), true, prompt);
});

test('ordinary Founder instructions do not get forced into the company status workflow', () => {
  for (const prompt of [
    'Draft a WhatsApp message to a new prospect.',
    'Create a quotation for this client.',
    'Research payment providers in Malawi.',
  ]) assert.equal(isCompanyStatusRequest(prompt), false, prompt);
});
