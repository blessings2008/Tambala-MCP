export interface WebResearchResult {
  query: string;
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score?: number;
    publishedDate?: string;
  }>;
}

const TAVILY_URL = 'https://api.tavily.com/search';

/**
 * Convert an agent's natural-language research request into a short search query.
 * Search providers should receive keywords, not the full CEO/delegation prompt.
 */
function normalizeResearchQuery(input: string): string {
  let query = input.replace(/\s+/g, ' ').trim();
  query = query
    .replace(/^(please\s+)?(do\s+)?(some\s+)?(web\s+)?research\s+(on|about|into)\s+/i, '')
    .replace(/^(please\s+)?(research|investigate|look\s*up|find|identify)\s+/i, '')
    .trim();

  const stop = /\s+(?:and|then|to)\s+(?:determine|identify|find|assess|analyse|analyze|research|investigate)\b/i.exec(query);
  if (stop?.index && stop.index > 0) query = query.slice(0, stop.index).trim();

  query = query.replace(/[.?!,:;]+$/g, '').trim();
  if (!query) query = input.replace(/\s+/g, ' ').trim();
  return query.slice(0, 300).trim();
}

/**
 * Shared research tool. It is intentionally separate from model-provider credentials.
 * Configure TAMBALA_WEB_SEARCH_API_KEY with a Tavily key.
 */
export async function webResearch(query: string, maxResults = 5): Promise<WebResearchResult> {
  const apiKey = process.env.TAMBALA_WEB_SEARCH_API_KEY;
  if (!apiKey) throw new Error('Web research is not configured. Set TAMBALA_WEB_SEARCH_API_KEY.');
  const searchQuery = normalizeResearchQuery(query);
  if (!searchQuery) throw new Error('A web research query is required.');
  const boundedResults = Math.min(Math.max(maxResults, 1), 8);

  const response = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: searchQuery,
      search_depth: 'basic',
      max_results: boundedResults,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Web research provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}.`);
  }

  const data = await response.json() as {
    query?: string;
    results?: Array<{ title?: string; url?: string; content?: string; score?: number; published_date?: string }>;
  };

  return {
    query: data.query ?? searchQuery,
    results: (data.results ?? []).map((item) => ({
      title: item.title ?? 'Untitled source',
      url: item.url ?? '',
      content: item.content ?? '',
      score: item.score,
      publishedDate: item.published_date,
    })).filter((item) => item.url),
  };
}

export function formatResearchContext(research: WebResearchResult): string {
  if (!research.results.length) return `WEB RESEARCH RESULT\nQuery: ${research.query}\nNo usable sources were returned.`;
  const sources = research.results.map((item, index) => [
    `[SOURCE ${index + 1}] ${item.title}`,
    `URL: ${item.url}`,
    item.publishedDate ? `Published: ${item.publishedDate}` : '',
    `Snippet: ${item.content}`,
  ].filter(Boolean).join('\n')).join('\n\n');
  return `WEB RESEARCH RESULT\nQuery: ${research.query}\nUse these sources as external evidence. Do not claim to have read anything beyond the supplied snippets.\n\n${sources}`;
}
