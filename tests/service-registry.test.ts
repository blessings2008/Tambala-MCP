import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findServicesForCapability,
  getOrganizationService,
  listOrganizationServices,
  resolveServiceBaseUrl,
} from '../src/organization/service-registry.js';

test('registry exposes the internal Tambala services without credentials', () => {
  const services = listOrganizationServices();
  assert.ok(services.some((service) => service.id === 'tambala-pay'));
  assert.ok(services.some((service) => service.id === 'rendering-service'));
  assert.ok(services.every((service) => !('apiKey' in service)));
});

test('capability lookup routes financial reads to Tambala Pay', () => {
  const matches = findServicesForCapability('payments.read');
  assert.deepEqual(matches.map((service) => service.id), ['tambala-pay']);
});

test('service lookup returns a defensive copy', () => {
  const service = getOrganizationService('tambala-pay');
  assert.ok(service);
  service.capabilities.push('test-only');
  assert.ok(!getOrganizationService('tambala-pay')?.capabilities.includes('test-only'));
});

test('external service URL is resolved from environment at runtime', () => {
  const service = getOrganizationService('tambala-pay');
  assert.ok(service);
  const previous = process.env.TAMBALA_PAY_BASE_URL;
  process.env.TAMBALA_PAY_BASE_URL = 'https://payments.example.test';
  try {
    assert.equal(resolveServiceBaseUrl(service), 'https://payments.example.test');
  } finally {
    if (previous === undefined) delete process.env.TAMBALA_PAY_BASE_URL;
    else process.env.TAMBALA_PAY_BASE_URL = previous;
  }
});
