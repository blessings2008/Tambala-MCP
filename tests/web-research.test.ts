import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  formatResearchContext,
  normalizeResearchQuery,
  webResearch,
} from '../src/services/web-research.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TAMBALA_WEB_SEARCH_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.TAMBALA_WEB_SEARCH_API_KEY;
  else process.env.TAMBALA_WEB_SEARCH_API_KEY = originalApiKey;
});

test('normalizes agent research prompts without sending the whole instruction', () => {
  assert.equal(
    normalizeResearchQuery('Please research about Malawi fintech market and then identify competitors and prepare a report.'),
    'Malawi fintech market',
  );
  assert.equal(normalizeResearchQuery('   '), '');
  assert.equal(normalizeResearchQuery('Solar energy Malawi?'), 'Solar energy Malawi');
});

test('requires a Tavily key and rejects an empty query before making a request', async () => {
  delete process.env.TAMBALA_WEB_SEARCH_API_KEY;
  await assert.rejects(() => webResearch('Malawi fintech'), /TAMBALA_WEB_SEARCH_API_KEY/);

  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  await assert.rejects(() => webResearch('   '), /query is required/);
});

test('uses advanced search controls, deduplicates URLs and ranks useful sources', async () => {
  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  let sentPayload: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      query: 'Malawi fintech',
      results: [
        { title: 'Lower score', url: 'https://example.com/a?utm_source=test', content: 'A', score: 0.4 },
        { title: 'Higher score', url: 'https://example.com/b#section', content: 'B', score: 0.9, published_date: '2026-11-01' },
        { title: 'Duplicate URL', url: 'https://example.com/a', content: 'duplicate', score: 0.8 },
        { title: 'Unsafe scheme', url: 'javascript:alert(1)', content: 'bad', score: 1 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await webResearch('Please research about Malawi fintech market', {
    maxResults: 5,
    searchDepth: 'advanced',
    topic: 'news',
    timeRange: 'month',
    includeDomains: ['https://example.com/'],
    excludeDomains: ['blocked.example'],
  });

  assert.equal(sentPayload?.search_depth, 'advanced');
  assert.equal(sentPayload?.topic, 'news');
  assert.equal(sentPayload?.time_range, 'month');
  assert.deepEqual(sentPayload?.include_domains, ['example.com']);
  assert.deepEqual(sentPayload?.exclude_domains, ['blocked.example']);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0]?.title, 'Higher score');
  assert.equal(result.results[1]?.url, 'https://example.com/a');
  assert.equal(result.results[1]?.content, 'A');
});

test('keeps the legacy numeric maxResults argument and caps it safely', async () => {
  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  let sentPayload: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;

  await webResearch('test query', 999);
  assert.equal(sentPayload?.max_results, 20);
});

test('formats research with citation guidance and prompt-injection protection', () => {
  const context = formatResearchContext({
    query: 'Malawi fintech',
    results: [{
      title: 'Source',
      url: 'https://example.com/report',
      content: 'Evidence snippet',
      score: 0.87654,
      publishedDate: '2026-11-01',
    }],
  });
  assert.match(context, /https:\/\/example.com\/report/);
  assert.match(context, /Evidence snippet/);
  assert.match(context, /untrusted external data/);
  assert.match(context, /0\.877/);
});

test('supports finance topic, fast search, regional hints and wildcard/path domain filters', async () => {
  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  let sentPayload: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;

  await webResearch('Malawi banking sector', {
    topic: 'finance',
    searchDepth: 'fast',
    chunksPerSource: 4,
    country: 'Malawi',
    includeDomains: ['*.mw', 'linkedin.com/in/'],
  });

  assert.equal(sentPayload?.topic, 'finance');
  assert.equal(sentPayload?.search_depth, 'fast');
  assert.equal(sentPayload?.chunks_per_source, 4);
  assert.equal(sentPayload?.country, 'Malawi');
  assert.deepEqual(sentPayload?.include_domains, ['*.mw', 'linkedin.com/in']);
});

test('allows zero-day news freshness and rejects days on non-news searches', async () => {
  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  let sentPayload: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;

  await webResearch('Malawi news today', { topic: 'news', days: 0 });
  assert.equal(sentPayload?.days, 0);

  await assert.rejects(
    () => webResearch('Malawi technology', { topic: 'general', days: 3 }),
    /only supported for news searches/,
  );
});
