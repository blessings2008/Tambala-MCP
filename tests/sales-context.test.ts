import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSalesResearchContext } from '../src/organization/sales-context.js';

test('sales context clearly reports when CRM credentials are unavailable', async () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const context = await getSalesResearchContext();
    assert.equal(context.crmAvailable, false);
    assert.match(context.crmAvailabilityNote, /do not claim to have checked/i);
    assert.deepEqual(context.existingLeads, []);
    assert.deepEqual(context.existingClients, []);
    assert.deepEqual(context.verifiedServices, []);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
  }
});
