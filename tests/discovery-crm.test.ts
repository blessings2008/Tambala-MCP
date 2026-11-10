import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoveryQueueIdFromReviewRequest,
  discoveryReviewRecommendation,
} from '../src/organization/workforce/discovery-crm.ts';

const queueId = 'aa4c10c3-32b5-42ee-bb98-950835c80519';

test('reads a bold recommendation on the same line', () => {
  assert.equal(discoveryReviewRecommendation('**Recommendation:** **QUALIFY** – verified fit and public contact.'), 'qualify');
});

test('reads a recommendation on the next line', () => {
  assert.equal(discoveryReviewRecommendation('### Recommendation\n\n**QUALIFY** – no further data is required.'), 'qualify');
});

test('recognises investigate and reject decisions', () => {
  assert.equal(discoveryReviewRecommendation('**Recommendation:** Investigate – the evidence is incomplete.'), 'investigate');
  assert.equal(discoveryReviewRecommendation('**Recommendation:** REJECT – no service fit.'), 'reject');
});

test('does not infer a decision when the recommendation section is absent', () => {
  assert.equal(discoveryReviewRecommendation('The prospect could qualify after more research.'), null);
  assert.equal(discoveryReviewRecommendation(null), null);
});

test('extracts only the explicit queue record id from the handoff request', () => {
  assert.equal(discoveryQueueIdFromReviewRequest(`Review this prospect. Queue record ID: ${queueId}.`), queueId);
  assert.equal(discoveryQueueIdFromReviewRequest('Review the new prospect batch. Queue record IDs: none.'), null);
});
