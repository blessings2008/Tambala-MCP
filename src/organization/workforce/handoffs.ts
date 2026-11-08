import { randomUUID } from 'node:crypto';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../../lib/supabase.js';
import { AGENT_DIRECTORY, type AgentName } from '../../services/ai/models.js';
import type { OrganizationTaskTransition } from '../task-lifecycle.js';
import { actionHelp, parseActions, type Action } from './actions.js';
import { splitBlocks } from './blocks.js';
import { roleIdFor } from './profiles.js';

export const MAX_HANDOFFS_PER_DUTY = 2;
const MAX_ATTEMPTS = 3;

export type HandoffStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface Handoff {
  id: string; from_role_id: string; to_role_id: string; to_agent: string; request: string; context_summary: string | null;
  source_task_id: string | null; source_duty_id: string | null; status: HandoffStatus; attempts: number;
  result: string | null; error: string | null; task_id: string | null; created_at: string; completed_at: string | null;
}

export class HandoffError extends Error {}

/** Parse the optional trailing HANDOFFS block an employee may add to their work. */
export function extractHandoffs(body: string, fromAgent: AgentName): { body: string; handoffs: { toAgent: AgentName; request: string }[] } {
  const { clean, blocks } = splitBlocks(body);
  const handoffs = parseHandoffLines(blocks.HANDOFFS ?? '', fromAgent);
  return { body: blocks.HANDOFFS === undefined && blocks.ACTIONS === undefined ? body : clean, handoffs };
}

export function parseHandoffLines(block: string, fromAgent: AgentName): { toAgent: AgentName; request: string }[] {
  const handoffs: { toAgent: AgentName; request: string }[] = [];
  const seen = new Set<string>();
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*[-*]\s*to:\s*([a-z]+)\s*\|\s*task:\s*(.+?)\s*$/i);
    if (!m) continue;
    const toAgent = m[1].toLowerCase() as AgentName;
    const request = m[2].trim();
    if (!(toAgent in AGENT_DIRECTORY) || toAgent === fromAgent || toAgent === 'orchestrator') continue;
    if (request.length < 10 || request.length > 500) continue;
    const key = `${toAgent}|${request.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    handoffs.push({ toAgent, request });
    if (handoffs.length >= MAX_HANDOFFS_PER_DUTY) break;
  }
  return handoffs;
}

export function colleagueList(excluding: AgentName): string {
  return (Object.keys(AGENT_DIRECTORY) as AgentName[])
    .filter((a) => a !== excluding && a !== 'orchestrator')
    .map((a) => `${a} (${AGENT_DIRECTORY[a].title})`).join('; ');
}

export interface HandoffStore {
  create(h: Omit<Handoff, 'id'>): Promise<Handoff>;
  queued(limit: number): Promise<Handoff[]>;
  /** True only for the single worker that moved it from queued to running. */
  claim(id: string): Promise<boolean>;
  update(id: string, patch: Partial<Handoff>): Promise<void>;
  recent(sinceIso: string): Promise<Handoff[]>;
}

export class SupabaseHandoffStore implements HandoffStore {
  create(h: Omit<Handoff, 'id'>) { return supabaseInsert<Handoff>('organization_handoffs', h as unknown as Record<string, unknown>); }
  queued(limit: number) { return supabaseSelect<Handoff>('organization_handoffs', `select=*&status=eq.queued&order=created_at.asc&limit=${limit}`); }
  async claim(id: string) {
    try {
      await supabaseUpdate('organization_handoffs', { status: 'running' }, `id=eq.${encodeURIComponent(id)}&status=eq.queued`);
      return true;
    } catch (error) {
      if (error instanceof Error && /returned no record/.test(error.message)) return false;
      throw error;
    }
  }
  async update(id: string, patch: Partial<Handoff>) { await supabaseUpdate('organization_handoffs', patch as Record<string, unknown>, `id=eq.${encodeURIComponent(id)}`); }
  recent(sinceIso: string) { return supabaseSelect<Handoff>('organization_handoffs', `select=*&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=100`); }
}

export class InMemoryHandoffStore implements HandoffStore {
  readonly rows: Handoff[] = [];
  async create(h: Omit<Handoff, 'id'>) { const row = { ...h, id: randomUUID() }; this.rows.push(row); return row; }
  async queued(limit: number) { return this.rows.filter((r) => r.status === 'queued').slice(0, limit); }
  async claim(id: string) { const r = this.rows.find((x) => x.id === id); if (!r || r.status !== 'queued') return false; r.status = 'running'; return true; }
  async update(id: string, patch: Partial<Handoff>) { const r = this.rows.find((x) => x.id === id); if (r) Object.assign(r, patch); }
  async recent(sinceIso: string) { return this.rows.filter((r) => r.created_at >= sinceIso).reverse(); }
}

export async function queueHandoff(store: HandoffStore, input: {
  fromRoleId: string; toAgent: AgentName; request: string; contextSummary?: string | null; sourceTaskId?: string | null; sourceDutyId?: string | null; now?: Date;
  /** Signs the request as its sender once it has an id. */
  sign?: (input: { roleId: string; kind: 'handoff_request'; subjectId: string; content: string }) => Promise<unknown>;
}): Promise<Handoff> {
  if (!(input.toAgent in AGENT_DIRECTORY) || input.toAgent === 'orchestrator') throw new HandoffError('Choose an employee to assign this to.');
  const request = input.request.trim();
  if (request.length < 5 || request.length > 1000) throw new HandoffError('The request must be 5 to 1000 characters.');
  const created = await store.create({
    from_role_id: input.fromRoleId, to_role_id: roleIdFor(input.toAgent), to_agent: input.toAgent, request,
    context_summary: input.contextSummary ? input.contextSummary.slice(0, 1500) : null,
    source_task_id: input.sourceTaskId ?? null, source_duty_id: input.sourceDutyId ?? null,
    status: 'queued', attempts: 0, result: null, error: null, task_id: null, created_at: (input.now ?? new Date()).toISOString(), completed_at: null,
  });
  if (input.sign) await input.sign({ roleId: input.fromRoleId, kind: 'handoff_request', subjectId: created.id, content: `to ${input.toAgent}: ${request}` });
  return created;
}

export interface HandoffDeps {
  store: HandoffStore;
  now: () => Date;
  agentUnavailableReason(agent: AgentName): Promise<string | null>;
  senderLabel(roleId: string): Promise<string>;
  recipientLabel(agent: AgentName): Promise<string>;
  actions: { run(ctx: { agent: AgentName; roleId: string; taskId: string }, actions: Action[], rejected: string[]): Promise<string> };
  sign(input: { roleId: string; kind: 'handoff_result'; subjectId: string; content: string }): Promise<{ block: string }>;
  buildContext(): Promise<Record<string, unknown>>;
  askAgent(agent: AgentName, prompt: string, context: Record<string, unknown>): Promise<string>;
  tasks: {
    begin(objective: string): Promise<{ taskId: string }>;
    advance(taskId: string, transitions: OrganizationTaskTransition[]): Promise<unknown>;
    fail(taskId: string, message: string): Promise<void>;
  };
}

export interface HandoffOutcome { handoffId: string; toAgent: string; status: 'completed' | 'waiting' | 'retry' | 'failed' | 'already_taken'; reason?: string; taskId?: string }

const RULES = 'Use ONLY the supplied data. If something is missing, say so plainly. Do not sign or add a sign-off: the system signs your work with your employee number. Never invent leads, clients, amounts, dates or results. Anything addressed to a customer is a DRAFT; never claim it was sent. Do not hand work on to anyone else.';

/** Each employee works through their inbox: one handoff at a time, oldest first. */
export async function processHandoffs(deps: HandoffDeps, limit = 5): Promise<HandoffOutcome[]> {
  const outcomes: HandoffOutcome[] = [];
  for (const h of await deps.store.queued(limit)) {
    const agent = h.to_agent as AgentName;
    const blocked = await deps.agentUnavailableReason(agent);
    if (blocked) {
      const waiting = `Waiting: ${blocked}`;
      if (h.error !== waiting) await deps.store.update(h.id, { error: waiting });
      outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: blocked });
      continue;
    }
    if (!(await deps.store.claim(h.id))) { outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'already_taken' }); continue; }
    const attempt = h.attempts + 1;
    const [sender, recipient] = await Promise.all([deps.senderLabel(h.from_role_id), deps.recipientLabel(agent)]);
    const { taskId } = await deps.tasks.begin(`[Handoff from ${sender}] ${h.request.slice(0, 160)}`);
    try {
      await deps.store.update(h.id, { attempts: attempt, task_id: taskId, error: null });
      await deps.tasks.advance(taskId, [
        { status: 'ceo_analyzing', stage: 'ceo', eventType: 'handoff_received', payload: { handoffId: h.id, from: h.from_role_id } },
        { status: 'delegated', stage: 'ceo', eventType: 'handoff_assigned', departmentId: AGENT_DIRECTORY[agent].unitId, roleId: h.to_role_id },
        { status: 'executing', stage: 'department', eventType: 'department_execution_started', roleId: h.to_role_id },
      ]);
      const prompt = [
        'HANDOFF REQUEST', `You are ${recipient}. ${sender} has asked for your help.`, RULES,
        `REQUEST: ${h.request}`, h.context_summary ? `CONTEXT FROM ${sender.toUpperCase()}:\n${h.context_summary}` : '',
        actionHelp(agent),
        'Keep it under 300 words, plain and scannable. Say what you did, what you found, and anything blocked.',
      ].filter(Boolean).join('\n\n');
      const raw = (await deps.askAgent(agent, prompt, await deps.buildContext())).trim();
      const acted = parseActions(raw);
      const result = acted.clean.trim();
      if (!result) throw new Error('The employee returned no work product.');
      const actionsText = await deps.actions.run({ agent, roleId: h.to_role_id, taskId }, acted.actions, acted.rejected);
      const stamp = await deps.sign({ roleId: h.to_role_id, kind: 'handoff_result', subjectId: h.id, content: result });
      const stamped = `${result}${actionsText ? `\n\n${actionsText}` : ''}\n\n${stamp.block}`;
      await deps.tasks.advance(taskId, [
        { status: 'returned_to_ceo', stage: 'review', eventType: 'department_work_returned', roleId: h.to_role_id, result: { handoffId: h.id, summary: stamped.slice(0, 8000) } },
        { status: 'completed', stage: 'complete', eventType: 'handoff_completed', roleId: h.to_role_id, completedAt: new Date().toISOString() },
      ]);
      await deps.store.update(h.id, { status: 'completed', result: stamped.slice(0, 8000), completed_at: deps.now().toISOString() });
      outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'completed', taskId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Handoff failed.';
      await deps.tasks.fail(taskId, message);
      const final = attempt >= MAX_ATTEMPTS;
      await deps.store.update(h.id, { status: final ? 'failed' : 'queued', error: message.slice(0, 500), completed_at: final ? deps.now().toISOString() : null });
      outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: final ? 'failed' : 'retry', reason: message, taskId });
    }
  }
  return outcomes;
}
