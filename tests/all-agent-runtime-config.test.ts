import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_DIRECTORY,
  getAgentRuntimeConfig,
  getAgentRuntimeInfo,
  type AgentName,
} from '../src/services/ai/models.js';

const specialistAgents = [
  'outreach', 'followup', 'research', 'marketing', 'content', 'finance',
  'payments', 'engineering', 'strategy', 'product', 'security', 'operations',
  'people', 'legal', 'procurement', 'executive', 'rnd', 'governance',
] as const satisfies readonly AgentName[];

const environmentNames = specialistAgents.flatMap((agent) => {
  const prefix = `TAMBALA_${agent.toUpperCase()}`;
  return [`${prefix}_API_KEY`, `${prefix}_BASE_URL`, `${prefix}_MODEL`];
});

function withCleanAgentEnvironment(run: () => void): void {
  const previous = new Map(environmentNames.map((name) => [name, process.env[name]]));
  const previousGroq = process.env.GROQ_API_KEY;
  for (const name of environmentNames) delete process.env[name];
  delete process.env.GROQ_API_KEY;

  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (previousGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroq;
  }
}

test('every department specialist has a distinct directory identity and remains unactivated by configuration', () => {
  for (const agent of specialistAgents) {
    const entry = AGENT_DIRECTORY[agent];
    assert.ok(entry.title.trim(), `${agent} needs a title`);
    assert.ok(entry.responsibility.trim(), `${agent} needs an explicit responsibility`);
    assert.ok(entry.unitId.trim(), `${agent} needs an organizational unit`);
    assert.equal(entry.roleStatus, 'planned', `${agent} must not become an active organizational role merely by having a profile`);
  }
});

test('every specialist requires its own key, endpoint, and model even when the shared Groq key exists', () => {
  withCleanAgentEnvironment(() => {
    process.env.GROQ_API_KEY = 'shared-key-must-not-be-used';
    for (const agent of specialistAgents) {
      assert.throws(
        () => getAgentRuntimeConfig(agent),
        new RegExp(`TAMBALA_${agent.toUpperCase()}_API_KEY; specialist agents do not fall back`),
        `${agent} must not silently inherit the orchestrator credential`,
      );
      const info = getAgentRuntimeInfo(agent);
      assert.equal(info.ready, false);
      assert.equal(info.apiKeyConfigured, false);
      assert.equal(JSON.stringify(info).includes('shared-key-must-not-be-used'), false);
    }
  });
});

test('each specialist accepts only its own runtime configuration and diagnostics never reveal credentials', () => {
  withCleanAgentEnvironment(() => {
    for (const agent of specialistAgents) {
      const prefix = `TAMBALA_${agent.toUpperCase()}`;
      const secret = `secret-for-${agent}`;
      process.env[`${prefix}_API_KEY`] = secret;
      process.env[`${prefix}_BASE_URL`] = `https://${agent}.example/v1`;
      process.env[`${prefix}_MODEL`] = `${agent}-model`;

      const config = getAgentRuntimeConfig(agent);
      assert.equal(config.apiKey, secret);
      assert.equal(config.apiKeySource, `${prefix}_API_KEY`);
      assert.equal(config.baseURL, `https://${agent}.example/v1`);
      assert.equal(config.model, `${agent}-model`);

      const info = getAgentRuntimeInfo(agent);
      assert.equal(info.ready, true);
      assert.equal(info.apiKeyConfigured, true);
      assert.equal(JSON.stringify(info).includes(secret), false);
    }
  });
});
