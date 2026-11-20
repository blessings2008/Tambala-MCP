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


test('CEO handoff reviews preserve the employee deliverable for acceptance', () => {
  const deliverable = [
    '**Organisation:** Sunbird Tourism plc',
    '**Queue Record ID:** 669033c0-6c6e-4920-abe7-c7fa4f5729ed',
    '**Service-fit evidence:** Operates nine hotels across Malawi with central reservations and online booking.',
    '**Source URLs:** https://www.sunbirdmalawi.com/ and https://www.sunbirdmalawi.com/contact-us.html',
    '**Public organisational contact evidence:** centralres@sunbirdmalawi.com; +265 885 996 521.',
    '**Verification gaps:** Verify the listed phone and email against the official contact page.',
    '**Recommendation:** INVESTIGATE.',
    'Additional evidence notes: '.concat('verified record detail '.repeat(180)),
  ].join(' ');
  const prompt = [
    'CEO REVIEW — you own acceptance of this delegated work.',
    'Review only whether the employee completed the exact request.',
    'Return exactly one first-line decision: DECISION: ACCEPT, DECISION: REVISION_REQUIRED, or DECISION: FOUNDER_INPUT_REQUIRED.',
    'ORIGINAL REQUEST: review the supplied prospect record and return evidence-based qualification.',
    `EMPLOYEE DELIVERABLE: ${deliverable}`,
    'Accept when the requested work is complete against the supplied evidence.',
  ].join('\n\n');

  const budget = getAIRequestBudget('orchestrator', prompt);
  assert.equal(budget.userInputLimit, 6_500);
  assert.equal(budget.contextLimit, 300);
  assert.equal(budget.completionBudget, 700);
  assert.ok(prompt.length < budget.userInputLimit);
  assert.ok(prompt.includes('Sunbird Tourism plc'));
  assert.ok(prompt.includes('INVESTIGATE'));
});

test('ordinary orchestrator prompts keep the default budget', () => {
  const budget = getAIRequestBudget('orchestrator', 'Summarise the organisation.');
  assert.equal(budget.userInputLimit, 1_800);
  assert.equal(budget.contextLimit, 1_200);
  assert.equal(budget.completionBudget, 3_200);
});


test('Outreach prospect-record reviews preserve the supplied queue record', () => {
  const recordId = '94876992-4205-4c27-bbe3-420cae4f5ea4';
  const prompt = [
    'TASK ROOM ASSIGNMENT',
    'You are Head of Sales & Business Development reviewing this single researched Tambala prospect using the attached record.',
    'Return the organisation name, service fit, source evidence, available public contact, and a qualify / investigate / reject recommendation.',
    `Queue record ID: ${recordId}.`,
    JSON.stringify({
      source: 'public.lead_discovery_queue',
      prospect: {
        id: recordId,
        organisation_name: 'HMS Foods & Grains Limited',
        website: 'https://hmsmalawi.net/',
        sector: 'Manufacturing — food milling and processing, pulses and soap products',
        service_fit: ['web_development', 'digital_product_development', 'social_media_management'],
        reason_for_fit: 'Its official website lists wheat and maize milling, toor-dal processing, laundry-soap manufacturing, domestic product lines and contact information.',
        public_email: 'info@hmsmalawi.net',
        public_phone: '+265 991 657 155; +265 991 657 199',
        source_url: 'https://hmsmalawi.net/',
        verification_status: 'verified',
      },
    }),
    'Do not repeat research or contact the prospect.',
  ].join('\n\n');

  const budget = getAIRequestBudget('outreach', prompt);
  assert.equal(budget.userInputLimit, 4_200);
  assert.equal(budget.contextLimit, 700);
  assert.equal(budget.completionBudget, 2_800);
  assert.ok(prompt.length < budget.userInputLimit);
  assert.ok(prompt.includes('HMS Foods & Grains Limited'));
  assert.ok(prompt.includes('info@hmsmalawi.net'));
});

test('ordinary Outreach requests retain the existing default budget', () => {
  const budget = getAIRequestBudget('outreach', 'Draft a personalised WhatsApp introduction.');
  assert.equal(budget.userInputLimit, 1_800);
  assert.equal(budget.contextLimit, 1_200);
  assert.equal(budget.completionBudget, 3_200);
});
