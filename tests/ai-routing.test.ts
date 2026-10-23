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
