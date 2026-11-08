import test from 'node:test';
import assert from 'node:assert/strict';
import { canFinalizeStatusReport, isCompanyStatusRequest, isUsableDepartmentReport, STATUS_REPORT_DEPARTMENTS } from '../src/channels/founder-execution.ts';

test('Founder company status requests trigger coordinated department reporting', () => {
  for (const prompt of [
    'Prepare a report on the current status of Tambala Technologies.',
    'Give me the company status.',
    'I need an overall status report for the business.',
    'Send an operational status update for the organisation.',
    'Prepare a short organizational status report covering Sales, Operations, Technology and Finance.',
    'Prepare an organisational status report for the board.',
    'Give me an organizational status update.',
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

test('department report validation rejects missing, placeholder, and truncated reports', () => {
  assert.equal(isUsableDepartmentReport('Operations & Administration', 'No Operations & Administration report was supplied.'), false);
  assert.equal(isUsableDepartmentReport('Operations & Administration', 'No Operations report supplied; the report is unavailable.'), false);
  assert.equal(isUsableDepartmentReport('Sales & Business Development', 'The report is truncated — further details not provided.'), false);
  assert.equal(isUsableDepartmentReport('Finance & Accounting', '   '), false);
});

test('department report validation accepts substantive reports even when a department has zero records', () => {
  assert.equal(isUsableDepartmentReport(
    'Operations & Administration',
    'Operations & Administration — Operations reviewed the available task and project records. Three active projects are recorded; no formal process-change log or risk register is available, so those measures remain unverified.',
  ), true);
  assert.equal(isUsableDepartmentReport(
    'Finance & Accounting',
    'Finance & Accounting — No accounting ledger, expense register, or cash-position statement is currently recorded. Revenue, expenses, cash position, and upcoming obligations therefore remain unavailable for verification.'
  ), true);
});


test('department report validation rejects unfinished output and reports without their own department heading', () => {
  assert.equal(isUsableDepartmentReport('Technology & Engineering', 'No Technology & Engineering report'), false);
  assert.equal(isUsableDepartmentReport('Technology & Engineering', 'No monitoring feed or incident log is available.'), false);
  assert.equal(isUsableDepartmentReport('Operations & Administration', 'Finance & Accounting — No accounting records are available. Revenue and expenses cannot be verified.'), false);
});

test('zero-data report is valid when it clearly identifies the department and data gaps', () => {
  assert.equal(isUsableDepartmentReport(
    'Technology & Engineering',
    'Technology & Engineering — No deployment inventory, monitoring feed, or incident log is currently recorded. Service health and infrastructure capacity therefore remain unverified.',
  ), true);
});
