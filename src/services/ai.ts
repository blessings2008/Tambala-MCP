import OpenAI from 'openai';
import { getAgentRuntimeConfig, getAgentRuntimeInfo, type AgentName } from './ai/models.js';
import { acquireAgentRequestSlot, getAgentLimitInfo } from './ai/limits.js';
import { AGENT_PROMPT_RULES } from './ai/rules.js';
import { formatResearchContext, webResearch } from './web-research.js';

const clients = new Map<AgentName, OpenAI>();

function getClient(agent: AgentName): OpenAI {
  const existing = clients.get(agent);
  if (existing) return existing;
  const config = getAgentRuntimeConfig(agent);
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 30000, maxRetries: 1 });
  clients.set(agent, client);
  return client;
}

export type { AgentName } from './ai/models.js';

/** Turn organizational instructions and the requested search intent into a compact search query. */
function compactSearchQuery(input: string): string {
  const cleaned = input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const quoted = [...cleaned.matchAll(/["“”']([^"“”']{2,100})["“”']/g)].map((m) => m[1]);
  const proper = [...cleaned.matchAll(/\b(?:[A-Z][A-Za-z0-9&'-]+(?:\s+|$)){1,5}/g)]
    .map((m) => m[0].trim())
    .filter((v) => v.length > 2 && !/^(The|Find|Research|Identify|Determine|Please|What|How|Why|Use|Do|And|For|With|From|This|That)\b/i.test(v));
  const useful = cleaned.match(/\b(?:Malawi|Malawian|Malabi|lodge|lodges|hotel|hotels|tourism|hospitality|website|websites|digital|competitor|competitors|market|prospect|prospects|opportunity|opportunities|Tambala|Exclusive|current|latest|USA|Canada|North America|United States)\b/gi) ?? [];
  const unique = [...new Set([...quoted, ...proper, ...useful.map((v) => v.toLowerCase())])];
  const query = unique.join(' ').replace(/\s+/g, ' ').trim() || cleaned;
  return query.slice(0, 400).trim();
}

/** Route to the assigned provider while enforcing per-agent local request caps. */
export async function askTambalaAI(agent: AgentName, input: string, context?: unknown): Promise<string> {
  return askTambalaAIInternal(agent, input, context);
}

/** Run web search first. The final query is always grounded in both the CEO's compact query and the actual task context, so a bad model-generated keyword cannot derail the research. */
export async function askTambalaAIWithWebResearch(agent: AgentName, input: string, context?: unknown, query?: string): Promise<{ response: string; research: ReturnType<typeof formatResearchContext> }> {
  const searchSeed = [query ?? '', input].filter(Boolean).join(' ');
  const searchQuery = compactSearchQuery(searchSeed);
  const research = await webResearch(searchQuery);
  const researchContext = formatResearchContext(research);
  const response = await askTambalaAIInternal(agent, `${input}\n\n${researchContext}\n\nCITATION RULES: Cite the supplied source URLs next to factual claims that depend on them. If the supplied sources do not establish a claim, label it unknown rather than filling the gap.`, context);
  return { response, research: researchContext };
}

async function askTambalaAIInternal(agent: AgentName, input: string, context?: unknown): Promise<string> {
  const config = getAgentRuntimeConfig(agent);
  const releaseSlot = acquireAgentRequestSlot(agent);
  try {
    const contextText = context === undefined ? '' : `\n\nTambala business context:\n${JSON.stringify(context)}`;
    const response = await getClient(agent).chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: AGENT_PROMPT_RULES[agent] },
        { role: 'user', content: `${input}${contextText}` },
      ],
      temperature: 0.2,
    });
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
