import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  buildProspectingSearchQueries,
  formatResearchContext,
  hasResearchSourceUrls,
  normalizeResearchQuery,
  webResearch,
  webResearchMany,
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
        { title: 'Higher score', url: 'https://example.com/b#section', content: 'B', raw_content: 'Full page B', score: 0.9, published_date: '2026-11-01' },
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
    includeRawContent: true,
  });

  assert.equal(sentPayload?.search_depth, 'advanced');
  assert.equal(sentPayload?.topic, 'news');
  assert.equal(sentPayload?.time_range, 'month');
  assert.equal(sentPayload?.include_raw_content, 'markdown');
  assert.deepEqual(sentPayload?.include_domains, ['example.com']);
  assert.deepEqual(sentPayload?.exclude_domains, ['blocked.example']);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0]?.title, 'Higher score');
  assert.equal(result.results[0]?.content, 'Full page B');
  assert.equal(result.results[1]?.url, 'https://example.com/a');
  assert.equal(result.results[1]?.content, 'A');
});

test('retries transient web research failures up to five attempts', async () => {
  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts < 5) return new Response('temporarily unavailable', { status: 503 });
    return new Response(JSON.stringify({ results: [{ title: 'Recovered', url: 'https://example.com/recovered', content: 'Recovered source' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const result = await webResearch('Malawi business prospects', { maxResults: 1, timeoutMs: 2_000 });
  assert.equal(attempts, 5);
  assert.equal(result.results[0]?.title, 'Recovered');
});

test('does not retry permanent web research client errors', async () => {
  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response('invalid request', { status: 400 });
  }) as typeof fetch;

  await assert.rejects(() => webResearch('Malawi business prospects'), /HTTP 400/);
  assert.equal(attempts, 1);
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

test('builds focused Malawi sector queries using active Tambala services', () => {
  const queries = buildProspectingSearchQueries(['Website Development', 'Social Media Management']);
  assert.equal(queries.length, 8);
  assert.ok(queries.some((query) => /private schools/i.test(query)));
  assert.ok(queries.some((query) => /hotels lodges/i.test(query)));
  assert.ok(queries.some((query) => /clinics hospitals/i.test(query)));
  assert.ok(queries.every((query) => query.includes('Website Development')));
  assert.ok(queries.every((query) => query.length <= 300));
});

test('runs multiple prospecting searches and selects diverse company-level source domains', async () => {
  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  const seenQueries: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as { query: string; max_results: number };
    seenQueries.push(payload.query);
    const slug = payload.query.split(' ')[1]?.toLowerCase().replace(/[^a-z0-9]/g, '') || String(seenQueries.length);
    return new Response(JSON.stringify({
      query: payload.query,
      results: [
        { title: `Organisation ${slug}`, url: `https://${slug}.mw/about`, content: `Named Malawi organisation discovered for ${payload.query}`, score: 0.9 },
        { title: 'Repeated directory', url: 'https://directory.example.mw/malawi', content: 'Generic directory listing', score: 0.99 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const queries = buildProspectingSearchQueries(['Website Development']);
  const result = await webResearchMany(queries, { maxResults: 2, searchDepth: 'advanced', country: 'Malawi' });
  assert.equal(seenQueries.length, 8);
  assert.equal(result.results.length, 9);
  assert.equal(new Set(result.results.map((item) => new URL(item.url).hostname)).size, 9);
  assert.ok(result.results.some((item) => /organisation/i.test(item.title)));
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

test('caps each source evidence excerpt to keep AI research requests compact', () => {
  const context = formatResearchContext({
    query: 'Malawi prospecting',
    results: [{
      title: 'Long source',
      url: 'https://example.com/long',
      content: 'X'.repeat(2_000),
    }],
  });
  const evidence = context.match(/Page evidence: (X+)/)?.[1] ?? '';
  assert.equal(evidence.length, 250);
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

test('research evidence validator requires an actual HTTP(S) source URL', () => {
  assert.equal(hasResearchSourceUrls(undefined), false);
  assert.equal(hasResearchSourceUrls('No usable sources were returned.'), false);
  assert.equal(hasResearchSourceUrls('[1] source citation without a URL'), false);
  assert.equal(hasResearchSourceUrls('Source: https://example.com/report'), true);
  assert.equal(hasResearchSourceUrls({ sources: [{ url: 'https://example.org/news' }] }), true);
  assert.equal(hasResearchSourceUrls('javascript:alert(1)'), false);
});


test('supports 20 sequentially batched candidate-enrichment searches', async () => {
  process.env.TAMBALA_WEB_SEARCH_API_KEY = 'test-key';
  const seenQueries: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as { query: string };
    seenQueries.push(payload.query);
    const slug = payload.query.match(/Candidate(\d+)/)?.[1] ?? String(seenQueries.length);
    return new Response(JSON.stringify({
      query: payload.query,
      results: [{ title: `Candidate ${slug} leadership`, url: `https://candidate${slug}.mw/leadership`, content: 'Managing director and public contact details', raw_content: 'Leadership page with public details', score: 0.9 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const queries = Array.from({ length: 20 }, (_, index) => `"Candidate${index + 1}" Malawi CEO contact`);
  const result = await webResearchMany(queries, { maxResults: 2, includeRawContent: true });
  assert.equal(seenQueries.length, 20);
  assert.equal(result.results.length, 20);
  assert.ok(result.results.every((item) => item.content.includes('Leadership page')));
});
