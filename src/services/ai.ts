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

/**
 * Convert task context into a short web-search query.
 * The search provider must receive keywords/entities, never the full agent prompt.
 */
function compactSearchQuery(input: string): string {
  const cleaned = input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const quoted = [...cleaned.matchAll(/["“”']([^"“”']{2,100})["“”']/g)].map((m) => m[1]);

  // Keep meaningful proper-name phrases, but do not accidentally capture entire instructions.
  const proper = [...cleaned.matchAll(/\b[A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*){0,3}\b/g)]
    .map((m) => m[0].trim())
    .filter((v) => v.length > 2 && !/^(The|Find|Research|Identify|Determine|Please|What|How|Why|Use|Do|And|For|With|From|This|That|You|Return|Complete|Provide|Only|Current|All|Ensure)\b/i.test(v));

  const useful = cleaned.match(/\b(?:Malawi|Malawian|Malabi|lodge|lodges|hotel|hotels|resort|resorts|tourism|hospitality|website|websites|digital|competitor|competitors|market|prospect|prospects|opportunity|opportunities|independent|boutique|luxury|eco|ecotourism|wellness|retreat|retreats|Africa|African|Asia|Asian|Southeast Asia|Europe|European|North America|USA|Canada|United States|rooms|employees|owner|manager|director|contact|email|technology|software|booking|PMS|transformation|sustainable|sustainability)\b/gi) ?? [];

  const unique = [...new Set([...quoted, ...proper, ...useful])]
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => !/^(Tambala|Technologies)$/i.test(v));

  // Prefer a compact set of search terms. If the model supplied a noisy query,
  // the task context still contributes the actual subject and domain terms.
  const query = unique.join(' ').replace(/\s+/g, ' ').trim() || cleaned;
  return query.slice(0, 900).trim();
}

/**
 * Run web search first. The final query is grounded in both the CEO's compact
 * search intent and the actual department task, so a bad model-generated
 * keyword cannot derail the research.
 */
export async function askTambalaAIWithWebResearch(agent: AgentName, input: string, context?: unknown, query?: string): Promise<{ response: string; research: ReturnType<typeof formatResearchContext> }> {
  // When the caller has built a task-aware query, search only that query. Appending
  // the full specialist prompt reintroduces instructions and unrelated nouns.
  const searchSeed = query?.trim() || input;
  const searchQuery = compactSearchQuery(searchSeed);
  const research = await webResearch(searchQuery);
  const researchContext = formatResearchContext(research);
  const response = await askTambalaAIInternal(agent, `${input}\n\n${researchContext}\n\nCITATION RULES: Cite the supplied source URLs next to factual claims that depend on them. If the supplied sources do not establish a claim, label it unknown rather than filling the gap.`, context);
  return { response, research: researchContext };
}

/** Route to the assigned provider while enforcing per-agent local request caps. */
export async function askTambalaAI(agent: AgentName, input: string, context?: unknown): Promise<string> {
  return askTambalaAIInternal(agent, input, context);
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
