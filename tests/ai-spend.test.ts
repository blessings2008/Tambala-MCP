import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFreeAIModel, calculateModelCost, modelPrice } from '../src/services/ai/spend.ts';

test('model usage cost is calculated from explicit per-million input/output rates', () => {
  process.env.TAMBALA_MODEL_PRICING_USD_PER_1M = JSON.stringify({
    'test-model': { inputUsd: 0.5, outputUsd: 1.25 },
  });
  assert.deepEqual(modelPrice('test-model'), { inputUsdPerMillion: 0.5, outputUsdPerMillion: 1.25 });
  assert.equal(calculateModelCost('test-model', 1_000_000, 2_000_000), 3);
});

test('unknown and malformed model prices remain unpriced rather than guessed', () => {
  process.env.TAMBALA_MODEL_PRICING_USD_PER_1M = JSON.stringify({
    'bad-model': { inputUsd: -1, outputUsd: 0.2 },
  });
  assert.equal(modelPrice('missing-model'), null);
  assert.equal(calculateModelCost('bad-model', 1000, 1000), null);
  process.env.TAMBALA_MODEL_PRICING_USD_PER_1M = '{invalid';
  assert.equal(modelPrice('any-model'), null);
  delete process.env.TAMBALA_MODEL_PRICING_USD_PER_1M;
});


test('free-only policy accepts explicit OpenRouter free models and blocks unverified models', () => {
  delete process.env.TAMBALA_AI_FREE_ONLY;
  delete process.env.TAMBALA_FREE_AI_MODEL_ALLOWLIST;
  assert.doesNotThrow(() => assertFreeAIModel('openrouter', 'nvidia/example:free'));
  assert.throws(() => assertFreeAIModel('groq', 'openai/gpt-oss-20b'), /free-only policy/);
  assert.throws(() => assertFreeAIModel('custom', 'some-model'), /No paid fallback was attempted/);
});

test('free-only policy accepts only exact provider:model allowlist entries', () => {
  delete process.env.TAMBALA_AI_FREE_ONLY;
  process.env.TAMBALA_FREE_AI_MODEL_ALLOWLIST = 'groq:openai/gpt-oss-20b,openrouter:another-model:free';
  assert.doesNotThrow(() => assertFreeAIModel('groq', 'openai/gpt-oss-20b'));
  assert.throws(() => assertFreeAIModel('groq', 'openai/gpt-oss-120b'), /free-only policy/);
  delete process.env.TAMBALA_FREE_AI_MODEL_ALLOWLIST;
});
