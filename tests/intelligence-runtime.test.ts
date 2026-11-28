import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ObjectiveInterpretationError,
  parseObjectiveInterpretation,
} from '../src/organization/intelligence-runtime.js';

const request = 'Improve the onboarding experience for our lodge website clients.';

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    desiredOutcome: 'A clearer and more reliable client onboarding journey.',
    successDescription: 'Clients understand the steps and required information before work begins.',
    requiredCapabilityIds: ['customer_relations', 'operations_administration'],
    assumptions: ['The current onboarding process can be reviewed from existing records.'],
    unresolvedQuestions: [],
    constraints: ['Do not send external messages without Founder approval.'],
    ...overrides,
  });
}

test('parses a structured multi-capability CEO interpretation', () => {
  const parsed = parseObjectiveInterpretation(response(), request);
  assert.equal(parsed.originalRequest, request);
  assert.deepEqual(parsed.requiredCapabilityIds, ['customer_relations', 'operations_administration']);
  assert.match(parsed.desiredOutcome, /onboarding/i);
});

test('accepts a fenced JSON object and safely handles braces inside quoted strings', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const raw = fence + 'json\n' + response({ successDescription: 'The result includes a {clear} sequence.' }) + '\n' + fence;
  const parsed = parseObjectiveInterpretation(raw, request);
  assert.equal(parsed.successDescription, 'The result includes a {clear} sequence.');
});

test('rejects malformed or missing interpretation JSON', () => {
  assert.throws(
    () => parseObjectiveInterpretation('I think we should improve onboarding.', request),
    ObjectiveInterpretationError,
  );
  assert.throws(
    () => parseObjectiveInterpretation('{"desiredOutcome":"Only this"}', request),
    /missing successDescription/i,
  );
});

test('rejects invented capability IDs and duplicate capability requirements', () => {
  assert.throws(
    () => parseObjectiveInterpretation(response({ requiredCapabilityIds: ['magic_department'] }), request),
    /unknown capability IDs/i,
  );
  assert.throws(
    () => parseObjectiveInterpretation(response({ requiredCapabilityIds: ['web_research', 'web_research'] }), request),
    /duplicate capability IDs/i,
  );
});

test('requires an explicit explanation when no existing capability fits', () => {
  const parsed = parseObjectiveInterpretation(response({
    requiredCapabilityIds: [],
    unresolvedQuestions: ['No registered capability currently owns this outcome.'],
  }), request);
  assert.equal(parsed.requiredCapabilityIds.length, 0);
  assert.equal(parsed.unresolvedQuestions.length, 1);
});

test('rejects an empty Founder request', () => {
  assert.throws(
    () => parseObjectiveInterpretation(response(), '   '),
    ObjectiveInterpretationError,
  );
});
