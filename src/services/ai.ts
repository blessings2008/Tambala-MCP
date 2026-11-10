import OpenAI from 'openai';
import { getAgentRuntimeConfig, getAgentRuntimeInfo, type AgentName } from './ai/models.js';
import { acquireAgentRequestSlot, getAgentLimitInfo } from './ai/limits.js';
import { AGENT_PROMPT_RULES } from './ai/rules.js';
import { reportRuntimeIncident } from '../organization/workforce/incident-events.js';
import { formatResearchContext, webResearch, webResearchMany } from './web-research.js';

const clients = new Map<AgentName, OpenAI>();

// Preserve the full organization and grounding rules while keeping total requests below provider TPM limits.
const MAX_SYSTEM_PROMPT_CHARS = 9_000;
const MAX_USER_INPUT_CHARS = 3_000;
const MAX_CONTEXT_CHARS = 700;
const MAX_COMPLETION_TOKENS = 900;

function boundText(value: string, maxChars: number): string {
  const normalized = value.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= maxChars) return normalized;
  const marker = '\n[Content shortened to keep the provider request within its size budget.]\n';
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available * 0.78);
  const tail = available - head;
  return normalized.slice(0, head) + marker + (tail ? normalized.slice(-tail) : '');
}

function serializeBoundedContext(context: unknown, maxChars = MAX_CONTEXT_CHARS): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(context) ?? String(context);
  } catch {
    serialized = '[Context could not be serialized]';
  }
  return boundText(serialized, maxChars);
}

const RATE_LIMIT_RETRY_DELAY_MS = 60_000;

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof value.status === 'number' ? value.status : undefined;
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
  return status === 429 || code === 'rate_limit_exceeded'
    || /rate.?limit|too many requests|\\btpm\\b|tokens? per minute|token throughput|per-minute token|token rate limit|requested .* tokens?.* limit/i.test(message);
}

async function requestWithRateLimitRetry<T>(request: () => Promise<T>, agent: AgentName, model: string): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!isRateLimitError(error)) throw error;
    console.warn('AI provider rate limit hit; waiting 60 seconds before one retry', JSON.stringify({ agent, model, waitMs: RATE_LIMIT_RETRY_DELAY_MS }));
    await new Promise<void>((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
    // A second failure is surfaced to the normal incident path; never spin in a retry loop.
    return request();
  }
}

function getClient(agent: AgentName): OpenAI {
  const existing = clients.get(agent);
  if (existing) return existing;
  const config = getAgentRuntimeConfig(agent);
  // Rate-limit retries are handled explicitly below so every retry waits the full 60 seconds.
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 30000, maxRetries: 0 });
  clients.set(agent, client);
  return client;
}

export type { AgentName } from './ai/models.js';

/** Route to the assigned provider while enforcing per-agent local request caps. */
export async function askTambalaAI(agent: AgentName, input: string, context?: unknown): Promise<string> {
  return askTambalaAIInternal(agent, input, context);
}

/** Run a web search first, then give the returned evidence to the agent as explicit external research context. */
export async function askTambalaAIWithWebResearch(agent: AgentName, input: string, context?: unknown, query?: string | string[], searchOptions?: import('./web-research.js').WebResearchOptions): Promise<{ response: string; research: ReturnType<typeof formatResearchContext> }> {
  let prospectDiscoveryNotes = '';
  let research = Array.isArray(query)
    ? await webResearchMany(query, { ...searchOptions, maxResults: 4, includeRawContent: true })
    : await webResearch(query ?? input, searchOptions ?? 5);

  // Stage 1: discover named organisations from page-level evidence. Search
  // snippets alone were too thin and repeatedly surfaced directories.
  if (agent === 'outreach' && Array.isArray(query) && research.results.length) {
    const discoveryEvidence = {
      ...research,
      results: research.results.slice(0, 8).map((item) => ({ ...item, content: item.content.slice(0, 500) })),
    };
    const discoveryPrompt = [
      'You are the discovery pass for a Malawi-wide prospecting task.',
      'Inspect the supplied page-level evidence, including company names embedded in directory pages, association member lists, news stories, project pages and official organisation pages.',
      'Extract up to 20 distinct, real Malawian businesses or organisations explicitly named in the supplied evidence.',
      'Exclude web-development/software/marketing agencies and other direct competitors. Do not list directories or generic pages as prospects.',
      'Prefer organisations with a visible service gap or credible growth/activity signal. Do not claim a need merely because an organisation exists.',
      'Return ONLY valid JSON: {"candidates":[{"name":"Exact organisation name","source_url":"exact URL from supplied evidence","reason":"short evidence-based discovery clue"}]}.',
      'Names must appear verbatim in the source title or page evidence. Never invent or complete a name. Return fewer than 20 if fewer are evidenced.',
      formatResearchContext(discoveryEvidence),
    ].join('\n\n');
    const discovery = await askTambalaAIInternal(agent, discoveryPrompt, context);
    const json = discovery.match(/\{[\s\S]*\}/)?.[0];
    let candidates: Array<{ name: string; source_url: string; reason: string }> = [];
    if (json) {
      try {
        const parsed = JSON.parse(json) as { candidates?: unknown };
        if (Array.isArray(parsed.candidates)) {
          const seenNames = new Set<string>();
          candidates = parsed.candidates.filter((candidate): candidate is { name: string; source_url: string; reason: string } => {
            if (!candidate || typeof candidate !== 'object') return false;
            const item = candidate as Record<string, unknown>;
            if (typeof item.name !== 'string' || typeof item.source_url !== 'string') return false;
            const name = item.name.trim();
            const source = research.results.find((result) => result.url === item.source_url);
            const key = name.toLowerCase();
            if (name.length < 3 || name.length > 100 || !source || seenNames.has(key)) return false;
            if (!`${source.title} ${source.content}`.toLowerCase().includes(key)) return false;
            if (/directory|business listings|web design|software development|digital marketing|IT solutions/i.test(name)) return false;
            if (/^(infi-tech|uprise malawi|chikotech solutions)$/i.test(name)) return false;
            seenNames.add(key);
            return true;
          }).slice(0, 20).map((candidate) => ({
            name: candidate.name.trim(),
            source_url: candidate.source_url,
            reason: typeof candidate.reason === 'string' ? candidate.reason.slice(0, 240) : 'Named in discovery source; qualification pending.',
          }));
        }
      } catch {
        candidates = [];
      }
    }

    if (candidates.length) {
      prospectDiscoveryNotes = candidates.map((candidate, index) => `${index + 1}. ${candidate.name} — discovery clue: ${candidate.reason} — discovery source: ${candidate.source_url}`).join('\n');
      // Stage 2: enrich each named candidate independently for official web,
      // leadership, role, published email and phone. Missing fields stay unknown.
      const enrichmentQueries = candidates.map(({ name }) =>
        `"${name}" Malawi official website CEO managing director leadership email phone contact`,
      );
      const enrichment = await webResearchMany(enrichmentQueries, {
        ...searchOptions,
        maxResults: 2,
        includeRawContent: true,
      });
      const seen = new Set<string>();
      const combined = [...enrichment.results, ...research.results].filter((item) => {
        const key = item.url.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 20);
      research = {
        query: `Malawi discovery: ${research.query} | named-candidate contact enrichment: ${enrichment.query}`.slice(0, 1_000),
        results: combined,
      };
    }
  }

  const researchContext = formatResearchContext(research);
  const discoveryNotes = prospectDiscoveryNotes ? `\n\nDISCOVERED CANDIDATES AND THEIR ORIGINAL EVIDENCE:\n${prospectDiscoveryNotes}\nTreat these as candidates only; use the verification sources to qualify them and preserve both source URLs where relevant.` : '';
  const response = await askTambalaAIInternal(agent, `${input}${discoveryNotes}\n\n${researchContext}\n\nCITATION RULES: Cite the supplied source URLs next to factual claims that depend on them. If the supplied sources do not establish a claim, label it unknown rather than filling the gap.`, context);
  return { response, research: researchContext };
}

async function askTambalaAIInternal(agent: AgentName, input: string, context?: unknown): Promise<string> {
  const config = getAgentRuntimeConfig(agent);
  const releaseSlot = acquireAgentRequestSlot(agent);
  try {
    const systemPrompt = boundText(AGENT_PROMPT_RULES[agent], agent === 'outreach' && input.includes('WEB RESEARCH RESULT') ? 4_200 : MAX_SYSTEM_PROMPT_CHARS);
    const researchHeavyOutreach = agent === 'outreach' && input.includes('WEB RESEARCH RESULT');
    const userInputLimit = researchHeavyOutreach ? 5_500 : MAX_USER_INPUT_CHARS;
    const contextLimit = researchHeavyOutreach ? 250 : MAX_CONTEXT_CHARS;
    const userInput = boundText(input, userInputLimit);
    const contextText = context === undefined ? '' : '\n\nTambala business context:\n' + serializeBoundedContext(context, contextLimit);
    const userMessage = boundText(userInput + contextText, userInputLimit + contextLimit + 40);
    const completionBudget = agent === 'operations' ? 1_600 : researchHeavyOutreach ? (input.includes('discovery pass') ? 700 : 1_400) : agent === 'research' ? 1_800 : MAX_COMPLETION_TOKENS;
    const requestPayload = {
      model: config.model,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userMessage },
      ],
      max_completion_tokens: completionBudget,
      temperature: 0.2,
    };
    const requestBodyBytes = new TextEncoder().encode(JSON.stringify(requestPayload)).byteLength;
    console.info('AI request size', JSON.stringify({
      agent,
      provider: config.provider,
      model: config.model,
      requestBodyBytes,
      systemPromptChars: systemPrompt.length,
      userMessageChars: userMessage.length,
      contextChars: contextText.length,
      maxCompletionTokens: completionBudget,
    }));
    let response: {
      choices: Array<{
        finish_reason?: string | null;
        message: { content: string | null; refusal?: string | null; reasoning?: string | null };
      }>;
      usage?: { completion_tokens?: number; prompt_tokens?: number; total_tokens?: number };
    };
    try {
      response = await requestWithRateLimitRetry(() => getClient(agent).chat.completions.create(requestPayload), agent, config.model);
    } catch (error) {
      const providerError = error as { status?: number; code?: string; request_id?: string; message?: string; headers?: Headers | Record<string, string> };
      const status = typeof providerError.status === 'number' ? providerError.status : undefined;
      const code = typeof providerError.code === 'string' ? providerError.code : undefined;
      const requestId = typeof providerError.request_id === 'string' ? providerError.request_id : undefined;
      const detail = providerError.message || 'Unknown provider error';
      const detailLower = detail.toLowerCase();
      const tpmFailure = /\btpm\b|tokens? per minute|token throughput|per-minute token|token rate limit|requested .* tokens?.* limit/i.test(detail);
      const rateLimitFailure = status === 429 || code === 'rate_limit_exceeded' || /rate.?limit|too many requests/i.test(detailLower);
      const category = tpmFailure ? 'tpm' as const : rateLimitFailure ? 'rate_limit' as const : 'provider' as const;
      const headers = providerError.headers;
      let retryAfterSeconds: number | undefined;
      try {
        const retryHeader = headers && typeof (headers as Headers).get === 'function'
          ? (headers as Headers).get('retry-after')
          : headers ? (headers as Record<string, string>)['retry-after'] ?? (headers as Record<string, string>)['Retry-After'] : undefined;
        if (retryHeader) {
          const seconds = Number(retryHeader);
          retryAfterSeconds = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : Math.max(0, Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000));
        }
      } catch { /* retry metadata is optional */ }
      console.error('AI provider request failed', JSON.stringify({
        agent,
        provider: config.provider,
        model: config.model,
        baseURL: config.baseURL,
        apiKeySource: config.apiKeySource,
        apiKeyPresent: Boolean(config.apiKey?.trim()),
        status,
        code,
        requestId,
        message: detail,
      }));
      await reportRuntimeIncident({
        source: 'AI provider request',
        message: detail.slice(0, 700),
        agent,
        provider: config.provider,
        model: config.model,
        category,
        severity: tpmFailure || rateLimitFailure ? 'high' : status && status >= 500 ? 'high' : 'medium',
        statusCode: status,
        requestId,
        retryAfterSeconds,
      });
      throw new Error(`${agent} agent ${config.provider} request failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
    }
    let content = response.choices[0]?.message?.content;
    if ((typeof content !== 'string' || !content.trim()) && agent === 'operations') {
      const firstChoice = response.choices[0];
      console.warn('Operations provider returned no message content; retrying once with a larger completion budget', JSON.stringify({
        provider: config.provider,
        model: config.model,
        finishReason: firstChoice?.finish_reason ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
        refusalPresent: Boolean(firstChoice?.message?.refusal),
        reasoningPresent: Boolean(firstChoice?.message?.reasoning),
      }));
      const retryPayload = { ...requestPayload, max_completion_tokens: 2_400 };
      response = await requestWithRateLimitRetry(() => getClient(agent).chat.completions.create(retryPayload), agent, config.model);
      content = response.choices[0]?.message?.content;
    }
    if (typeof content !== 'string' || !content.trim()) {
      const choice = response.choices[0];
      console.error('AI provider returned no usable message content', JSON.stringify({
        agent,
        provider: config.provider,
        model: config.model,
        finishReason: choice?.finish_reason ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
        refusalPresent: Boolean(choice?.message?.refusal),
        reasoningPresent: Boolean(choice?.message?.reasoning),
      }));
      throw new Error(`The ${agent} AI provider returned an empty response.`);
    }
    return content;
  } finally {
    releaseSlot();
  }
}

export function getAgentModel(agent: AgentName): string { return getAgentRuntimeInfo(agent).model ?? 'not-configured'; }
export { getAgentRuntimeInfo };
export function getAgentOperationalInfo(agent: AgentName) { return { ...getAgentRuntimeInfo(agent), limits: getAgentLimitInfo(agent) }; }
