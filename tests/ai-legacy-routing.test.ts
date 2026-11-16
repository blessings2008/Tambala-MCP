import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENT_DEFAULT_MODELS, GROQ_BASE_URL, getAgentRuntimeConfig, getAgentRuntimeInfo } from '../src/services/ai/models.js';

test('legacy routing overrides stale per-agent provider and model settings', () => {
  const keys = [
    'TAMBALA_FORCE_LEGACY_GROQ_ROUTING',
    'TAMBALA_ALLOW_SHARED_GROQ_KEY',
    'TAMBALA_ORCHESTRATOR_API_KEY',
    'OPENROUTER_API_KEY',
    'TAMBALA_ORCHESTRATOR_PROVIDER',
    'TAMBALA_ORCHESTRATOR_MODEL',
    'TAMBALA_SECURITY_PROVIDER',
    'TAMBALA_SECURITY_MODEL',
    'TAMBALA_RESEARCH_PROVIDER',
    'TAMBALA_RESEARCH_MODEL',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.TAMBALA_FORCE_LEGACY_GROQ_ROUTING = 'true';
    process.env.TAMBALA_ALLOW_SHARED_GROQ_KEY = 'true';
    process.env.TAMBALA_ORCHESTRATOR_API_KEY = 'test-groq-key';
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    process.env.TAMBALA_ORCHESTRATOR_PROVIDER = 'openrouter';
    process.env.TAMBALA_ORCHESTRATOR_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    process.env.TAMBALA_SECURITY_PROVIDER = 'openrouter';
    process.env.TAMBALA_SECURITY_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    process.env.TAMBALA_RESEARCH_PROVIDER = 'groq';
    process.env.TAMBALA_RESEARCH_MODEL = 'openai/gpt-oss-20b';

    const orchestrator = getAgentRuntimeConfig('orchestrator');
    assert.equal(orchestrator.provider, 'groq');
    assert.equal(orchestrator.baseURL, GROQ_BASE_URL);
    assert.equal(orchestrator.model, AGENT_DEFAULT_MODELS.orchestrator);

    const security = getAgentRuntimeConfig('security');
    assert.equal(security.provider, 'groq');
    assert.equal(security.baseURL, GROQ_BASE_URL);
    assert.equal(security.model, AGENT_DEFAULT_MODELS.security);

    const research = getAgentRuntimeConfig('research');
    assert.equal(research.provider, 'openrouter');
    assert.equal(research.model, AGENT_DEFAULT_MODELS.research);

    assert.equal(getAgentRuntimeInfo('security').provider, 'groq');
    assert.equal(getAgentRuntimeInfo('research').provider, 'openrouter');
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
