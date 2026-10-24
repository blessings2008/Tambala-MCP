import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAgentRuntimeConfig, getAgentRuntimeInfo } from '../src/services/ai/models.js';

const names = [
  'GROQ_API_KEY',
  'TAMBALA_ORCHESTRATOR_API_KEY',
  'TAMBALA_ORCHESTRATOR_BASE_URL',
  'TAMBALA_ORCHESTRATOR_MODEL',
  'TAMBALA_OUTREACH_API_KEY',
  'TAMBALA_OUTREACH_BASE_URL',
  'TAMBALA_OUTREACH_MODEL',
  'TAMBALA_FOLLOWUP_API_KEY',
  'TAMBALA_FOLLOWUP_BASE_URL',
  'TAMBALA_FOLLOWUP_MODEL',
] as const;

function withCleanEnv(run: () => void): void {
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('specialist agents do not fall back to the shared Groq key', () => {
  withCleanEnv(() => {
    process.env.GROQ_API_KEY = 'shared-groq-secret';
    assert.throws(
      () => getAgentRuntimeConfig('outreach'),
      /TAMBALA_OUTREACH_API_KEY; specialist agents do not fall back/,
    );
    assert.throws(
      () => getAgentRuntimeConfig('followup'),
      /TAMBALA_FOLLOWUP_API_KEY; specialist agents do not fall back/,
    );
  });
});

test('each specialist accepts only its own credential, endpoint, and model', () => {
  withCleanEnv(() => {
    process.env.GROQ_API_KEY = 'shared-groq-secret';
    process.env.TAMBALA_OUTREACH_API_KEY = 'outreach-secret';
    process.env.TAMBALA_OUTREACH_BASE_URL = 'https://outreach.example/v1';
    process.env.TAMBALA_OUTREACH_MODEL = 'outreach-model';

    const config = getAgentRuntimeConfig('outreach');
    assert.equal(config.apiKey, 'outreach-secret');
    assert.equal(config.baseURL, 'https://outreach.example/v1');
    assert.equal(config.model, 'outreach-model');
    assert.equal(config.apiKeySource, 'TAMBALA_OUTREACH_API_KEY');
  });
});

test('legacy Groq key is available only to the orchestrator', () => {
  withCleanEnv(() => {
    process.env.GROQ_API_KEY = 'legacy-groq-secret';
    const config = getAgentRuntimeConfig('orchestrator');
    assert.equal(config.apiKey, 'legacy-groq-secret');
    assert.equal(config.baseURL, 'https://api.groq.com/openai/v1');
    assert.equal(config.model, 'openai/gpt-oss-120b');
  });
});

test('route diagnostics never expose secret values and report unconfigured specialists', () => {
  withCleanEnv(() => {
    process.env.GROQ_API_KEY = 'do-not-expose-this';
    const info = getAgentRuntimeInfo('outreach');
    assert.equal(info.apiKeyConfigured, false);
    assert.equal(info.ready, false);
    assert.equal(JSON.stringify(info).includes('do-not-expose-this'), false);
  });
});

import { acquireAgentRequestSlot, getAgentLimitInfo, resetAgentLimitStateForTests } from '../src/services/ai/limits.js';

test('AI request budgets default conservatively by agent', () => {
  assert.equal(getAgentLimitInfo('orchestrator').requestsPerMinute, 20);
  assert.equal(getAgentLimitInfo('outreach').requestsPerMinute, 8);
  assert.equal(getAgentLimitInfo('followup').requestsPerMinute, 8);
});

test('AI request budget rejects excess requests and allows a new window', () => {
  const previous = process.env.TAMBALA_OUTREACH_MAX_REQUESTS_PER_MINUTE;
  try {
    resetAgentLimitStateForTests();
    process.env.TAMBALA_OUTREACH_MAX_REQUESTS_PER_MINUTE = '1';
    const release = acquireAgentRequestSlot('outreach', 100000);
    release();
    assert.throws(() => acquireAgentRequestSlot('outreach', 100001), /limit of 1 requests per minute/);
    assert.doesNotThrow(() => acquireAgentRequestSlot('outreach', 160001));
  } finally {
    resetAgentLimitStateForTests();
    if (previous === undefined) delete process.env.TAMBALA_OUTREACH_MAX_REQUESTS_PER_MINUTE;
    else process.env.TAMBALA_OUTREACH_MAX_REQUESTS_PER_MINUTE = previous;
  }
});

test('AI concurrency caps are isolated between agents', () => {
  const previous = process.env.TAMBALA_OUTREACH_MAX_CONCURRENCY;
  try {
    resetAgentLimitStateForTests();
    process.env.TAMBALA_OUTREACH_MAX_CONCURRENCY = '1';
    const release = acquireAgentRequestSlot('outreach', 200000);
    assert.throws(() => acquireAgentRequestSlot('outreach', 200001), /concurrency limit of 1/);
    assert.doesNotThrow(() => acquireAgentRequestSlot('followup', 200001));
    release();
    assert.doesNotThrow(() => acquireAgentRequestSlot('outreach', 200002));
  } finally {
    resetAgentLimitStateForTests();
    if (previous === undefined) delete process.env.TAMBALA_OUTREACH_MAX_CONCURRENCY;
    else process.env.TAMBALA_OUTREACH_MAX_CONCURRENCY = previous;
  }
});

test('AI route diagnostics identify organizational ownership without granting roles', () => {
  assert.equal(getAgentRuntimeInfo('orchestrator').unitId, 'executive-management');
  assert.equal(getAgentRuntimeInfo('orchestrator').roleStatus, 'planned');
  assert.equal(getAgentRuntimeInfo('outreach').unitId, 'sales-business-development');
  assert.equal(getAgentRuntimeInfo('outreach').roleId, null);
  assert.equal(getAgentRuntimeInfo('followup').unitId, 'customer-relations');
  assert.equal(getAgentRuntimeInfo('followup').roleId, null);
});
