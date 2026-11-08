import test from 'node:test';
import assert from 'node:assert/strict';
import { canFinalizeStatusReport, isCompanyStatusRequest, STATUS_REPORT_DEPARTMENTS } from '../src/channels/founder-execution.ts';

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


test('status report requires separate completed reports from all four departments', () => {
  assert.deepEqual(STATUS_REPORT_DEPARTMENTS, [
    'Sales & Business Development',
    'Operations & Administration',
    'Technology & Engineering',
    'Finance & Accounting',
  ]);
  assert.equal(canFinalizeStatusReport(STATUS_REPORT_DEPARTMENTS, []), true);
});

test('status report cannot be finalized while any department is incomplete or blocked', () => {
  for (const missing of STATUS_REPORT_DEPARTMENTS) {
    const completed = STATUS_REPORT_DEPARTMENTS.filter((department) => department !== missing);
    assert.equal(canFinalizeStatusReport(completed, [missing]), false, missing);
  }
  assert.equal(canFinalizeStatusReport(STATUS_REPORT_DEPARTMENTS.slice(0, 3), []), false);
});
