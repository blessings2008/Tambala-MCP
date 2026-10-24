import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildResearchQuery } from '../src/services/research-query.js';

test('generic client-finding objective becomes a compact Malawi prospect query', () => {
  const query = buildResearchQuery('Find our next client', 'Identify suitable businesses for Tambala web services.', 'Find our next client and provide verified sources.');
  assert.match(query, /Malawi/);
  assert.match(query, /lodges hotels restaurants/);
  assert.match(query, /website/);
  assert.ok(query.length < 220);
  assert.doesNotMatch(query, /CEO|Founder|objective|provide verified sources/i);
});

test('specific industry and location are preserved in prospect research', () => {
  const query = buildResearchQuery(
    'Find five lodges in Blantyre that could benefit from a better website',
    'Identify real lodge prospects and provide official contact routes.',
    'Blantyre Malawi lodges website contact',
  );
  assert.match(query, /Blantyre Malawi|Malawi/);
  assert.match(query, /lodges/);
  assert.match(query, /website/);
  assert.match(query, /contact/);
  assert.ok(query.length <= 220);
});

test('named-entity research can use a compact suggested query without appending the full prompt', () => {
  const query = buildResearchQuery(
    'Research the official contact details for Sunbird Mount Soche',
    'Return verified official contact channels for the named hotel.',
    'Sunbird Mount Soche official contact details',
  );
  assert.match(query, /Sunbird/);
  assert.match(query, /MOUNT|MOUNT/i);
  assert.match(query, /official|contact/i);
  assert.ok(query.length <= 220);
});

test('explicit non-Malawi geography is not replaced by the default market', () => {
  const query = buildResearchQuery('Find hotels in Zambia that need a website');
  assert.match(query, /Zambia/);
  assert.doesNotMatch(query, /Malawi/);
});
