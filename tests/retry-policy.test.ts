import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPermanentAgentFailure } from '../src/organization/workforce/retry-policy.js';

test('free-only model policy blocks are not retried automatically', () => {
  assert.equal(isPermanentAgentFailure("AI request blocked by Tambala's free-only policy: groq:openai/gpt-oss-20b is not verified as free."), true);
});

test('missing provider credentials and model configuration are not retried automatically', () => {
  assert.equal(isPermanentAgentFailure('No API key configured for the research agent.'), true);
  assert.equal(isPermanentAgentFailure('No OpenRouter API key configured.'), true);
  assert.equal(isPermanentAgentFailure('TAMBALA_RESEARCH_MODEL must be configured for the research agent.'), true);
});

test('transient provider failures remain eligible for bounded retries', () => {
  assert.equal(isPermanentAgentFailure('HTTP 429 rate limit exceeded; retry after 30 seconds.'), false);
  assert.equal(isPermanentAgentFailure('The provider returned HTTP 503.'), false);
});
