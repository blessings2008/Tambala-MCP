import { supabaseInsert, supabaseSelect } from '../../lib/supabase.js';
import { EMPLOYEE_NUMBERS } from '../../organization/workforce/profiles.js';

export interface ModelPrice { inputUsdPerMillion: number; outputUsdPerMillion: number }
export interface AIUsageRecord {
  employee_number: string; agent: string; provider: string; model: string;
  prompt_tokens: number; completion_tokens: number; cost_usd: number | null; cost_status: 'priced' | 'unpriced';
  created_at?: string;
}

export function modelPrice(model: string): ModelPrice | null {
  const raw = process.env.TAMBALA_MODEL_PRICING_USD_PER_1M;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[model];
    if (!value || typeof value !== 'object') return null;
    const price = value as Record<string, unknown>;
    const input = Number(price.inputUsd);
    const output = Number(price.outputUsd);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
    return { inputUsdPerMillion: input, outputUsdPerMillion: output };
  } catch { return null; }
}

export function calculateModelCost(model: string, promptTokens: number, completionTokens: number): number | null {
  const price = modelPrice(model);
  if (!price) return null;
  return Number(((promptTokens * price.inputUsdPerMillion + completionTokens * price.outputUsdPerMillion) / 1_000_000).toFixed(8));
}

export async function recordAIUsage(input: {
  agent: keyof typeof EMPLOYEE_NUMBERS; provider: string; model: string;
  promptTokens?: number; completionTokens?: number; now?: Date;
}): Promise<AIUsageRecord> {
  const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0));
  const cost = calculateModelCost(input.model, promptTokens, completionTokens);
  const row: AIUsageRecord = {
    employee_number: EMPLOYEE_NUMBERS[input.agent], agent: input.agent, provider: input.provider, model: input.model,
    prompt_tokens: promptTokens, completion_tokens: completionTokens, cost_usd: cost,
    cost_status: cost === null ? 'unpriced' : 'priced',
    created_at: (input.now ?? new Date()).toISOString(),
  };
  await supabaseInsert<AIUsageRecord>('organization_ai_usage', row as unknown as Record<string, unknown>);
  return row;
}

export async function getDailyAIUsage(now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return supabaseSelect<AIUsageRecord>('organization_ai_usage', `select=employee_number,agent,provider,model,prompt_tokens,completion_tokens,cost_usd,cost_status,created_at&created_at=gte.${encodeURIComponent(start.toISOString())}&order=created_at.desc&limit=5000`);
}


/** Free-only is the default. Unknown provider/model pricing is never treated as free. */
export function assertFreeAIModel(provider: string, model: string): void {
  if (process.env.TAMBALA_AI_FREE_ONLY === 'false') return;
  if (provider === 'openrouter' && (/:free$/i.test(model) || model === 'openrouter/free')) return;
  const allowlist = (process.env.TAMBALA_FREE_AI_MODEL_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const exactId = `${provider}:${model}`;
  if (allowlist.includes(exactId)) return;
  throw new Error(
    `AI request blocked by Tambala's free-only policy: ${exactId} is not verified as free. ` +
    'No paid fallback was attempted. Add this exact provider:model to TAMBALA_FREE_AI_MODEL_ALLOWLIST only after confirming it is available at no charge.',
  );
}
