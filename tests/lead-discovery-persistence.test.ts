import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProspectBlock } from '../src/organization/workforce/lead-discovery-persistence.ts';

const prospect = (name: string) => ({
  organisation_name: name,
  service_fit: ['web_development'],
  reason_for_fit: 'The organisation has a public-facing booking and enquiry workflow.',
  source_urls: ['https://example.mw/'],
});

test('parses the complete documented prospect wrapper', () => {
  const body = 'Research notes.\nDISCOVERED_PROSPECTS:\n```json\n' +
    JSON.stringify([prospect('One Malawi Limited')]) +
    '\n```\nEND_DISCOVERED_PROSPECTS\nClosing note.';
  const result = parseProspectBlock(body);
  assert.equal(result.prospects.length, 1);
  assert.equal(result.prospects[0].organisation_name, 'One Malawi Limited');
  assert.match(result.cleanBody, /Research notes/);
  assert.doesNotMatch(result.cleanBody, /DISCOVERED_PROSPECTS/);
  assert.equal(result.parseIssue, undefined);
});

test('accepts a fenced JSON array even when the wrapper labels are missing', () => {
  const body = 'Summary.\n```json\n' + JSON.stringify([prospect('Two Malawi Limited')]) + '\n```';
  const result = parseProspectBlock(body);
  assert.equal(result.prospects.length, 1);
  assert.equal(result.prospects[0].organisation_name, 'Two Malawi Limited');
});

test('salvages complete records before a truncated final record', () => {
  const first = prospect('Three Malawi Limited');
  const second = prospect('Four Malawi Limited');
  const body = 'DISCOVERED_PROSPECTS:\n```json\n[' + JSON.stringify(first) + ',' + JSON.stringify(second).slice(0, 55);
  const result = parseProspectBlock(body);
  assert.equal(result.prospects.length, 1);
  assert.equal(result.prospects[0].organisation_name, 'Three Malawi Limited');
  assert.match(result.parseIssue ?? '', /recovered 1 complete prospect/);
});

test('salvages complete records when the closing JSON fence is truncated', () => {
  const body = 'DISCOVERED_PROSPECTS:\n```json\n[' + JSON.stringify(prospect('Five Malawi Limited')) + ',{"organisation_name":"unfinished';
  const result = parseProspectBlock(body);
  assert.equal(result.prospects.length, 1);
  assert.equal(result.prospects[0].organisation_name, 'Five Malawi Limited');
  assert.match(result.parseIssue ?? '', /recovered 1 complete prospect/);
});

test('missing structured output becomes a recorded issue instead of failing the duty', () => {
  const result = parseProspectBlock('The research provider returned a short summary without prospect JSON.');
  assert.deepEqual(result.prospects, []);
  assert.match(result.parseIssue ?? '', /No DISCOVERED_PROSPECTS JSON array/);
});
