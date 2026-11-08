import OpenAI from 'openai';
import { getAgentRuntimeConfig, getAgentRuntimeInfo, type AgentName } from './ai/models.js';
import { acquireAgentRequestSlot, getAgentLimitInfo } from './ai/limits.js';
import { AGENT_PROMPT_RULES } from './ai/rules.js';
import { formatResearchContext, webResearch } from './web-research.js';

const clients = new Map<AgentName, OpenAI>();

// Conservative character budgets keep prompts below common provider TPM limits.
const MAX_SYSTEM_PROMPT_CHARS = 6_500;
const MAX_USER_INPUT_CHARS = 7_000;
const MAX_CONTEXT_CHARS = 1_800;
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

function serializeBoundedContext(context: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(context) ?? String(context);
  } catch {
    serialized = '[Context could not be serialized]';
  }
  return boundText(serialized, MAX_CONTEXT_CHARS);
}

function getClient(agent: AgentName): OpenAI {
  const existing = clients.get(agent);
  if (existing) return existing;
  const config = getAgentRuntimeConfig(agent);
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 30000, maxRetries: 1 });
  clients.set(agent, client);
  return client;
}

export type { AgentName } from './ai/models.js';

/** Route to the assigned provider while enforcing per-agent local request caps. */
export async function askTambalaAI(agent: AgentName, input: string, context?: unknown): Promise<string> {
  return askTambalaAIInternal(agent, input, context);
}

/** Run a web search first, then give the returned evidence to the agent as explicit external research context. */
export async function askTambalaAIWithWebResearch(agent: AgentName, input: string, context?: unknown, query?: string, searchOptions?: import('./web-research.js').WebResearchOptions): Promise<{ response: string; research: ReturnType<typeof formatResearchContext> }> {
  const research = await webResearch(query ?? input, searchOptions ?? 5);
  const researchContext = formatResearchContext(research);
  const response = await askTambalaAIInternal(agent, `${input}\n\n${researchContext}\n\nCITATION RULES: Cite the supplied source URLs next to factual claims that depend on them. If the supplied sources do not establish a claim, label it unknown rather than filling the gap.`, context);
  return { response, research: researchContext };
}

async function askTambalaAIInternal(agent: AgentName, input: string, context?: unknown): Promise<string> {
  const config = getAgentRuntimeConfig(agent);
  const releaseSlot = acquireAgentRequestSlot(agent);
  try {
    const systemPrompt = boundText(AGENT_PROMPT_RULES[agent], MAX_SYSTEM_PROMPT_CHARS);
    const userInput = boundText(input, MAX_USER_INPUT_CHARS);
    const contextText = context === undefined ? '' : '\n\nTambala business context:\n' + serializeBoundedContext(context);
    const userMessage = boundText(userInput + contextText, MAX_USER_INPUT_CHARS + MAX_CONTEXT_CHARS + 40);
    let response: { choices: Array<{ message: { content: string | null } }> };
    try {
      response = await getClient(agent).chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        temperature: 0.2,
      });
    } catch (error) {
      const providerError = error as { status?: number; code?: string; request_id?: string; message?: string };
      const status = typeof providerError.status === 'number' ? providerError.status : undefined;
      const code = typeof providerError.code === 'string' ? providerError.code : undefined;
      const requestId = typeof providerError.request_id === 'string' ? providerError.request_id : undefined;
      const detail = providerError.message || 'Unknown provider error';
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
      throw new Error(`${agent} agent ${config.provider} request failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
    }
    const content = response.choices[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error(`The ${agent} AI provider returned an empty response.`);
    return content;
  } finally {
    releaseSlot();
  }
}

export function getAgentModel(agent: AgentName): string { return getAgentRuntimeInfo(agent).model ?? 'not-configured'; }
export { getAgentRuntimeInfo };
export function getAgentOperationalInfo(agent: AgentName) { return { ...getAgentRuntimeInfo(agent), limits: getAgentLimitInfo(agent) }; }
