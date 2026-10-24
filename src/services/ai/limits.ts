import type { AgentName } from './models.js';

const WINDOW_MS = 60_000;
const DEFAULT_LIMITS: Record<AgentName, { requestsPerMinute: number; concurrency: number }> = {
  orchestrator: { requestsPerMinute: 20, concurrency: 2 },
  outreach: { requestsPerMinute: 8, concurrency: 2 },
  followup: { requestsPerMinute: 8, concurrency: 2 },
};

type AgentState = { startedAt: number[]; active: number };
const states = new Map<AgentName, AgentState>();

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function getAgentLimitInfo(agent: AgentName) {
  const prefix = `TAMBALA_${agent.toUpperCase()}`;
  return {
    requestsPerMinute: positiveInt(process.env[`${prefix}_MAX_REQUESTS_PER_MINUTE`], DEFAULT_LIMITS[agent].requestsPerMinute, `${prefix}_MAX_REQUESTS_PER_MINUTE`),
    concurrency: positiveInt(process.env[`${prefix}_MAX_CONCURRENCY`], DEFAULT_LIMITS[agent].concurrency, `${prefix}_MAX_CONCURRENCY`),
    enforcement: 'per-process in-memory sliding window; provider-side limits are required for account-wide enforcement',
  } as const;
}

/** Local safety rail, not a replacement for provider quotas or distributed rate limiting. */
export function acquireAgentRequestSlot(agent: AgentName, now = Date.now()): () => void {
  const limits = getAgentLimitInfo(agent);
  const state = states.get(agent) ?? { startedAt: [], active: 0 };
  state.startedAt = state.startedAt.filter((timestamp) => now - timestamp < WINDOW_MS);
  if (state.startedAt.length >= limits.requestsPerMinute) throw new Error(`The ${agent} agent reached its local limit of ${limits.requestsPerMinute} requests per minute. Try again later.`);
  if (state.active >= limits.concurrency) throw new Error(`The ${agent} agent reached its local concurrency limit of ${limits.concurrency}. Try again shortly.`);
  state.startedAt.push(now);
  state.active += 1;
  states.set(agent, state);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = states.get(agent);
    if (current) current.active = Math.max(0, current.active - 1);
  };
}

export function resetAgentLimitStateForTests(): void { states.clear(); }
