import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAIRequestBudget } from '../src/services/ai/request-budget.js';

const recordId = 'ea531986-4923-40e4-847f-2ce32fbd0b3c';

test('Research queue-review handoffs preserve the supplied prospect record', () => {
  const suppliedRecord = JSON.stringify({
    source: 'public.lead_discovery_queue',
    instruction: 'Research is complete. Use only this supplied record; do not repeat web research.',
    prospect: {
      id: recordId,
      organisation_name: 'Zodiak Broadcasting Station',
      website: 'https://zodiakmalawi.com/',
      sector: 'Media & Broadcasting',
      service_fit: ['Web Development', 'Software Development', 'Digital Product Development', 'Social Media Management'],
      reason_for_fit: 'Online news, radio and television, public subscriptions, advertiser information and rate cards.',
      public_email: 'support@zodiakmalawi.com',
      public_phone: '+265 999 566 711',
      source_urls: ['https://zodiakmalawi.com/'],
      verification_status: 'verified',
    },
  });
  const prompt = [
    'TASK ROOM ASSIGNMENT',
    'You are Central Research & Intelligence reviewing one existing lead_discovery_queue record.',
    'Return the exact organisation name, queue record ID, service-fit evidence, source URLs, contact evidence and recommendation.',
    `Queue record ID: ${recordId}.`,
    suppliedRecord,
    'Keep it under 300 words.',
  ].join(' ');

  const budget = getAIRequestBudget('research', prompt);
  assert.equal(budget.userInputLimit, 4_200);
  assert.equal(budget.contextLimit, 700);
  assert.equal(budget.completionBudget, 2_800);
  assert.ok(prompt.length < budget.userInputLimit);
  assert.ok(prompt.includes('Zodiak Broadcasting Station'));
  assert.ok(prompt.includes('support@zodiakmalawi.com'));
});

test('Research recovery reviews receive the same record-preserving budget', () => {
  const prompt = `Central Research & Intelligence: re-assess this existing queue record. Queue record ID: ${recordId}. ${'Prospect evidence '.repeat(80)}`;
  const budget = getAIRequestBudget('research', prompt);
  assert.equal(budget.userInputLimit, 4_200);
  assert.ok(prompt.length < budget.userInputLimit);
});

test('daily queue intelligence keeps its existing conservative budget', () => {
  const budget = getAIRequestBudget('research', 'STANDING DUTY: Daily prospect queue intelligence');
  assert.equal(budget.userInputLimit, 1_800);
  assert.equal(budget.contextLimit, 2_800);
  assert.equal(budget.completionBudget, 2_600);
});

test('ordinary research requests keep the default input and context budgets', () => {
  const budget = getAIRequestBudget('research', 'Research the latest market information.');
  assert.equal(budget.userInputLimit, 1_800);
  assert.equal(budget.contextLimit, 1_200);
  assert.equal(budget.completionBudget, 2_800);
});
