import { randomUUID } from 'node:crypto';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../../lib/supabase.js';
import { AGENT_DIRECTORY, type AgentName } from '../../services/ai/models.js';
import type { OrganizationTaskTransition } from '../task-lifecycle.js';
import { actionHelp, parseActions, type Action } from './actions.js';
import { splitBlocks } from './blocks.js';
import { roleIdFor } from './profiles.js';

export const MAX_HANDOFFS_PER_DUTY = 2;
export const MAX_HANDOFF_ATTEMPTS = 5;

export type HandoffStatus = 'queued' | 'running' | 'awaiting_founder' | 'completed' | 'failed';
export type TaskRoomStatus = 'active' | 'awaiting_founder' | 'blocked' | 'ready_for_review' | 'revision_requested' | 'completed' | 'failed' | 'cancelled' | 'archived';
export interface TaskRoom {
  id: string; handoff_id: string; parent_task_id: string | null; owner_role_id: string; owner_agent: string;
  opened_by_role_id: string; objective: string; context_packet: Record<string, unknown>; status: TaskRoomStatus;
  deliverable: string | null; blocker: string | null; opened_at: string; updated_at: string; closed_at: string | null;
}
export interface Handoff {
  id: string; from_role_id: string; to_role_id: string; to_agent: string; request: string; context_summary: string | null;
  source_task_id: string | null; source_duty_id: string | null; status: HandoffStatus; attempts: number;
  result: string | null; error: string | null; task_id: string | null; room_id: string | null; created_at: string; completed_at: string | null;
}

export class HandoffError extends Error {}

/** Detect explicit requests for human clarification; questions alone are not enough. */
export function isFounderClarificationRequest(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return /(?:clarification\s+(?:required|needed)|awaiting\s+(?:founder|your)\s+(?:input|clarification)|need(?:s)?\s+(?:the\s+)?founder(?:'s)?\s+(?:input|clarification)|please\s+clarify|before\s+i\s+(?:can|proceed)|which\s+(?:entity|business|company|location)\s+(?:do|should)|could\s+you\s+confirm\s+(?:which|whether|the))\b/i.test(text)
    || /^\s{0,3}#{1,4}\s*(?:clarification required|clarification needed|waiting for founder)\b/im.test(text);
}

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
  claim(id: string): Promise<boolean>;
  update(id: string, patch: Partial<Handoff>): Promise<void>;
  recent(sinceIso: string): Promise<Handoff[]>;
  get(id: string): Promise<Handoff | null>;
  getByRoomId(roomId: string): Promise<Handoff | null>;
  createRoom(room: Omit<TaskRoom, 'id'>): Promise<TaskRoom>;
  updateRoom(id: string, patch: Partial<TaskRoom>): Promise<void>;
  roomEvent(roomId: string, eventType: string, actorRoleId: string | null, payload?: unknown): Promise<void>;
}

export class SupabaseHandoffStore implements HandoffStore {
  create(h: Omit<Handoff, 'id'>) { return supabaseInsert<Handoff>('organization_handoffs', h as unknown as Record<string, unknown>); }
  queued(limit: number) { return supabaseSelect<Handoff>('organization_handoffs', `select=*&status=eq.queued&order=created_at.asc&limit=${limit}`); }
  async claim(id: string) {
    try { await supabaseUpdate('organization_handoffs', { status: 'running' }, `id=eq.${encodeURIComponent(id)}&status=eq.queued`); return true; }
    catch (error) { if (error instanceof Error && /returned no record/.test(error.message)) return false; throw error; }
  }
  async update(id: string, patch: Partial<Handoff>) { await supabaseUpdate('organization_handoffs', patch as Record<string, unknown>, `id=eq.${encodeURIComponent(id)}`); }
  recent(sinceIso: string) { return supabaseSelect<Handoff>('organization_handoffs', `select=*&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=100`); }
  async get(id: string) { return (await supabaseSelect<Handoff>('organization_handoffs', `select=*&id=eq.${encodeURIComponent(id)}&limit=1`))[0] ?? null; }
  async getByRoomId(roomId: string) { return (await supabaseSelect<Handoff>('organization_handoffs', `select=*&room_id=eq.${encodeURIComponent(roomId)}&limit=1`))[0] ?? null; }
  createRoom(room: Omit<TaskRoom, 'id'>) { return supabaseInsert<TaskRoom>('organization_task_rooms', room as unknown as Record<string, unknown>); }
  async updateRoom(id: string, patch: Partial<TaskRoom>) { await supabaseUpdate('organization_task_rooms', { ...patch, updated_at: new Date().toISOString() }, `id=eq.${encodeURIComponent(id)}`); }
  async roomEvent(roomId: string, eventType: string, actorRoleId: string | null, payload?: unknown) {
    await supabaseInsert('organization_task_room_events', { room_id: roomId, event_type: eventType, actor_role_id: actorRoleId, payload: payload ?? null });
  }
}

export class InMemoryHandoffStore implements HandoffStore {
  readonly rows: Handoff[] = [];
  readonly rooms: TaskRoom[] = [];
  readonly roomEvents: { room_id: string; event_type: string; actor_role_id: string | null; payload?: unknown }[] = [];
  async create(h: Omit<Handoff, 'id'>) { const row = { ...h, id: randomUUID() }; this.rows.push(row); return row; }
  async queued(limit: number) { return this.rows.filter((r) => r.status === 'queued').slice(0, limit); }
  async claim(id: string) { const r = this.rows.find((x) => x.id === id); if (!r || r.status !== 'queued') return false; r.status = 'running'; return true; }
  async update(id: string, patch: Partial<Handoff>) { const r = this.rows.find((x) => x.id === id); if (r) Object.assign(r, patch); }
  async recent(sinceIso: string) { return this.rows.filter((r) => r.created_at >= sinceIso).reverse(); }
  async get(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async getByRoomId(roomId: string) { return this.rows.find((r) => r.room_id === roomId) ?? null; }
  async createRoom(room: Omit<TaskRoom, 'id'>) { const row = { ...room, id: randomUUID() }; this.rooms.push(row); return row; }
  async updateRoom(id: string, patch: Partial<TaskRoom>) { const row = this.rooms.find((r) => r.id === id); if (row) Object.assign(row, patch); }
  async roomEvent(roomId: string, eventType: string, actorRoleId: string | null, payload?: unknown) { this.roomEvents.push({ room_id: roomId, event_type: eventType, actor_role_id: actorRoleId, payload }); }
}

export async function queueHandoff(store: HandoffStore, input: {
  fromRoleId: string; toAgent: AgentName; request: string; contextSummary?: string | null; sourceTaskId?: string | null; sourceDutyId?: string | null; now?: Date;
  sign?: (input: { roleId: string; kind: 'handoff_request'; subjectId: string; content: string }) => Promise<unknown>;
}): Promise<Handoff> {
  if (!(input.toAgent in AGENT_DIRECTORY) || input.toAgent === 'orchestrator') throw new HandoffError('Choose an employee to assign this to.');
  const request = input.request.trim();
  if (request.length < 5 || request.length > 1000) throw new HandoffError('The request must be 5 to 1000 characters.');
  const created = await store.create({
    from_role_id: input.fromRoleId, to_role_id: roleIdFor(input.toAgent), to_agent: input.toAgent, request,
    context_summary: input.contextSummary ? input.contextSummary.slice(0, 8000) : null,
    source_task_id: input.sourceTaskId ?? null, source_duty_id: input.sourceDutyId ?? null,
    status: 'queued', attempts: 0, result: null, error: null, task_id: null, room_id: null,
    created_at: (input.now ?? new Date()).toISOString(), completed_at: null,
  });
  try {
    const room = await store.createRoom({
      handoff_id: created.id, parent_task_id: input.sourceTaskId ?? null, owner_role_id: created.to_role_id,
      owner_agent: input.toAgent, opened_by_role_id: input.fromRoleId, objective: request,
      context_packet: { context_summary: input.contextSummary ?? null, source_duty_id: input.sourceDutyId ?? null },
      status: 'active', deliverable: null, blocker: null, opened_at: created.created_at, updated_at: created.created_at, closed_at: null,
    });
    await store.update(created.id, { room_id: room.id });
    await store.roomEvent(room.id, 'room_opened', input.fromRoleId, { objective: request, ownerAgent: input.toAgent });
    created.room_id = room.id;
  } catch (error) {
    await store.update(created.id, { status: 'failed', error: `Task room could not be opened: ${error instanceof Error ? error.message : 'storage error'}` });
    throw new HandoffError('The task room could not be created, so the handoff was not dispatched.');
  }
  if (input.sign) await input.sign({ roleId: input.fromRoleId, kind: 'handoff_request', subjectId: created.id, content: `to ${input.toAgent}: ${request}` });
  return created;
}

export async function resumeFounderHandoff(store: HandoffStore, handoffId: string, clarification: string, actorRoleId = 'founder'): Promise<Handoff> {
  const answer = clarification.trim();
  if (answer.length < 2 || answer.length > 2000) throw new HandoffError('Provide a clarification between 2 and 2,000 characters.');
  const handoff = await store.get(handoffId);
  if (!handoff || handoff.status !== 'awaiting_founder' || !handoff.room_id) throw new HandoffError('This handoff is not waiting for Founder clarification.');
  const context = [handoff.context_summary, `FOUNDER CLARIFICATION: ${answer}`].filter(Boolean).join('\n\n').slice(0, 3000);
  await store.update(handoff.id, { status: 'queued', context_summary: context, error: null, completed_at: null });
  await store.updateRoom(handoff.room_id, { status: 'active', blocker: null });
  await store.roomEvent(handoff.room_id, 'founder_clarification_received', actorRoleId, { clarification: answer });
  return { ...handoff, status: 'queued', context_summary: context, error: null, completed_at: null };
}

/** Resolve a public room identifier to its parent handoff before resuming Founder clarification. */
export async function resumeFounderTaskRoom(store: HandoffStore, roomId: string, clarification: string, actorRoleId = 'founder'): Promise<Handoff> {
  const handoff = await store.getByRoomId(roomId);
  if (!handoff) throw new HandoffError('The task room could not be found.');
  return resumeFounderHandoff(store, handoff.id, clarification, actorRoleId);
}

export interface HandoffDeps {
  store: HandoffStore; now: () => Date;
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
    fail(taskId: string, message: string, sourceAgent?: AgentName): Promise<void>;
  };
}

export interface HandoffOutcome { handoffId: string; toAgent: string; status: 'completed' | 'waiting' | 'retry' | 'failed' | 'already_taken'; reason?: string; taskId?: string; roomId?: string }

const RULES = 'Use ONLY the supplied data. If something is missing, say so plainly. Do not sign or add a sign-off: the system signs your work with your employee number. Never invent leads, clients, amounts, dates or results. Anything addressed to a customer is a DRAFT; never claim it was sent. Do not hand work on to anyone else. If the assignment is ambiguous, explicitly label your response "Clarification Required", ask the Founder one precise question, and do not present a guessed answer as completed work.';

/** Each delegation runs in an isolated, durable room. A room closes only after its deliverable is accepted. */
export async function processHandoffs(deps: HandoffDeps, limit = 5): Promise<HandoffOutcome[]> {
  const outcomes: HandoffOutcome[] = [];
  for (const h of await deps.store.queued(limit)) {
    const agent = h.to_agent as AgentName;
    const blocked = await deps.agentUnavailableReason(agent);
    if (blocked) {
      const waiting = `Waiting: ${blocked}`;
      if (h.error !== waiting) await deps.store.update(h.id, { error: waiting });
      if (h.room_id) { await deps.store.updateRoom(h.room_id, { status: 'blocked', blocker: blocked }); await deps.store.roomEvent(h.room_id, 'room_blocked', h.from_role_id, { reason: blocked }); }
      outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: blocked, roomId: h.room_id ?? undefined });
      continue;
    }
    if (!(await deps.store.claim(h.id))) { outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'already_taken', roomId: h.room_id ?? undefined }); continue; }
    const attempt = h.attempts + 1;
    const [sender, recipient] = await Promise.all([deps.senderLabel(h.from_role_id), deps.recipientLabel(agent)]);
    const taskId = h.task_id ?? (await deps.tasks.begin(`[Room ${h.room_id ?? h.id}] [Handoff from ${sender}] ${h.request.slice(0, 160)}`)).taskId;
    try {
      await deps.store.update(h.id, { attempts: attempt, task_id: taskId, error: null });
      if (h.room_id) {
        await deps.store.updateRoom(h.room_id, { status: 'active', blocker: null });
        await deps.store.roomEvent(h.room_id, 'room_execution_started', h.to_role_id, { taskId, attempt });
      }
      await deps.tasks.advance(taskId, [
        { status: 'ceo_analyzing', stage: 'ceo', eventType: 'handoff_received', payload: { handoffId: h.id, roomId: h.room_id, from: h.from_role_id } },
        { status: 'delegated', stage: 'ceo', eventType: 'handoff_assigned', departmentId: AGENT_DIRECTORY[agent].unitId, roleId: h.to_role_id },
        { status: 'executing', stage: 'department', eventType: 'department_execution_started', roleId: h.to_role_id },
      ]);
      const prompt = [
        'TASK ROOM ASSIGNMENT', `You are ${recipient}. ${sender} has assigned this work to your room.`, RULES,
        `ROOM ID: ${h.room_id ?? 'not recorded'}`, `REQUEST: ${h.request}`,
        h.context_summary ? `CONTEXT FROM ${sender.toUpperCase()}:\n${h.context_summary}` : '',
        actionHelp(agent),
        'Keep it under 300 words, plain and scannable. Say what you did, what you found, and anything blocked.',
      ].filter(Boolean).join('\n\n');
      const contextPacket = await deps.buildContext();
      if (h.room_id) await deps.store.updateRoom(h.room_id, { context_packet: { context_summary: h.context_summary, source_duty_id: h.source_duty_id, organization_context: contextPacket } });
      const raw = (await deps.askAgent(agent, prompt, contextPacket)).trim();
      const acted = parseActions(raw);
      const result = acted.clean.trim();
      if (!result) throw new Error('The employee returned no work product.');
      const actionsText = await deps.actions.run({ agent, roleId: h.to_role_id, taskId }, acted.actions, acted.rejected);
      const stamp = await deps.sign({ roleId: h.to_role_id, kind: 'handoff_result', subjectId: h.id, content: result });
      const stamped = `${result}${actionsText ? `\n\n${actionsText}` : ''}\n\n${stamp.block}`;
      if (h.room_id) await deps.store.roomEvent(h.room_id, 'employee_deliverable_submitted', h.to_role_id, { response: result.slice(0, 8000), actions: actionsText || null });
      if (isFounderClarificationRequest(result)) {
        const question = result.slice(0, 8000);
        await deps.tasks.advance(taskId, [
          { status: 'needs_more_work', stage: 'ceo', eventType: 'handoff_waiting_for_founder', roleId: 'ceo', result: { handoffId: h.id, roomId: h.room_id, clarification: question } },
        ]);
        await deps.store.update(h.id, { status: 'awaiting_founder', result: stamped.slice(0, 8000), error: 'Awaiting Founder clarification.', completed_at: null });
        if (h.room_id) {
          await deps.store.updateRoom(h.room_id, { status: 'awaiting_founder', deliverable: stamped.slice(0, 8000), blocker: question });
          await deps.store.roomEvent(h.room_id, 'clarification_requested', h.to_role_id, { question, response: stamped.slice(0, 8000) });
        }
        outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: 'Founder clarification required.', taskId, roomId: h.room_id ?? undefined });
        continue;
      }
      if (h.room_id) {
        await deps.store.updateRoom(h.room_id, { status: 'ready_for_review', deliverable: stamped.slice(0, 8000) });
        await deps.store.roomEvent(h.room_id, 'room_ready_for_review', h.to_role_id, { taskId });
      }
      const review = (await deps.askAgent('orchestrator', [
        'CEO REVIEW — you own acceptance of this delegated work.',
        'Review only whether the employee completed the exact request. Use the request and deliverable below; do not add facts or assume missing work was done.',
        'Return exactly one first-line decision: DECISION: ACCEPT, DECISION: REVISION_REQUIRED, or DECISION: FOUNDER_INPUT_REQUIRED. Follow it with a short reason.',
        `ORIGINAL REQUEST: ${h.request}`,
        `EMPLOYEE DELIVERABLE: ${stamped.slice(0, 7000)}`,
        'Accept only if the requested deliverable is actually present and any required evidence is included. If it is incomplete, request a specific revision. If the subject or instructions are ambiguous, ask the Founder.',
      ].join('\n\n'), contextPacket)).trim();
      const decision = review.match(/^\s*DECISION:\s*(ACCEPT|REVISION_REQUIRED|FOUNDER_INPUT_REQUIRED)\b/im)?.[1];
      if (decision !== 'ACCEPT') {
        const reason = review.slice(0, 1500) || 'CEO review did not return a recognized decision.';
        await deps.tasks.advance(taskId, [
          { status: 'needs_more_work', stage: 'ceo', eventType: decision === 'REVISION_REQUIRED' ? 'ceo_revision_requested' : 'ceo_review_waiting_for_founder', roleId: 'ceo', result: { handoffId: h.id, roomId: h.room_id, review: reason } },
        ]);
        const awaitingFounder = decision !== 'REVISION_REQUIRED';
        const revisionExhausted = !awaitingFounder && attempt >= MAX_HANDOFF_ATTEMPTS;
        const contextSummary = [h.context_summary, `CEO REVIEW FEEDBACK: ${reason}`].filter(Boolean).join('\n\n').slice(0, 3000);
        if (revisionExhausted) {
          await deps.tasks.fail(taskId, `Maximum of ${MAX_HANDOFF_ATTEMPTS} attempts reached: ${reason}`, agent);
          await deps.store.update(h.id, { status: 'failed', context_summary: contextSummary, result: stamped.slice(0, 8000), error: reason, completed_at: deps.now().toISOString() });
          if (h.room_id) {
            await deps.store.updateRoom(h.room_id, { status: 'failed', deliverable: stamped.slice(0, 8000), blocker: reason, closed_at: deps.now().toISOString() });
            await deps.store.roomEvent(h.room_id, 'room_failed', 'ceo', { reason, attempt, maxAttempts: MAX_HANDOFF_ATTEMPTS });
          }
          outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'failed', reason, taskId, roomId: h.room_id ?? undefined });
          continue;
        }
        await deps.store.update(h.id, { status: awaitingFounder ? 'awaiting_founder' : 'queued', context_summary: contextSummary, result: stamped.slice(0, 8000), error: reason, completed_at: null });
        if (h.room_id) {
          await deps.store.updateRoom(h.room_id, { status: awaitingFounder ? 'awaiting_founder' : 'revision_requested', deliverable: stamped.slice(0, 8000), blocker: reason });
          await deps.store.roomEvent(h.room_id, awaitingFounder ? 'ceo_review_needs_founder' : 'ceo_revision_requested', 'ceo', { review: reason, attempt, maxAttempts: MAX_HANDOFF_ATTEMPTS });
        }
        outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: awaitingFounder ? 'waiting' : 'retry', reason, taskId, roomId: h.room_id ?? undefined });
        continue;
      }
      await deps.tasks.advance(taskId, [
        { status: 'returned_to_ceo', stage: 'review', eventType: 'department_work_returned', roleId: h.to_role_id, result: { handoffId: h.id, roomId: h.room_id, summary: stamped.slice(0, 8000) } },
        { status: 'completed', stage: 'complete', eventType: 'handoff_completed', roleId: 'ceo', completedAt: deps.now().toISOString() },
      ]);
      await deps.store.update(h.id, { status: 'completed', result: stamped.slice(0, 8000), completed_at: deps.now().toISOString(), error: null });
      if (h.room_id) {
        await deps.store.roomEvent(h.room_id, 'ceo_review_accepted', 'ceo', { taskId, review });
        await deps.store.updateRoom(h.room_id, { status: 'archived', closed_at: deps.now().toISOString(), blocker: null });
        await deps.store.roomEvent(h.room_id, 'room_archived', 'ceo', { retained: true });
      }
      outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'completed', taskId, roomId: h.room_id ?? undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Handoff failed.';
      const final = attempt >= MAX_HANDOFF_ATTEMPTS;
      if (final) {
        await deps.tasks.fail(taskId, message, agent);
      } else {
        await deps.tasks.advance(taskId, [
          { status: 'needs_more_work', stage: 'ceo', eventType: 'handoff_retry_scheduled', roleId: 'ceo', result: { handoffId: h.id, roomId: h.room_id, attempt, maxAttempts: MAX_HANDOFF_ATTEMPTS, error: message.slice(0, 500) } },
        ]);
      }
      await deps.store.update(h.id, { status: final ? 'failed' : 'queued', error: message.slice(0, 500), completed_at: final ? deps.now().toISOString() : null });
      if (h.room_id) {
        await deps.store.updateRoom(h.room_id, { status: final ? 'failed' : 'active', blocker: message.slice(0, 500), ...(final ? { closed_at: deps.now().toISOString() } : {}) });
        await deps.store.roomEvent(h.room_id, final ? 'room_failed' : 'room_retry_scheduled', h.to_role_id, { error: message.slice(0, 500), attempt });
      }
      outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: final ? 'failed' : 'retry', reason: message, taskId, roomId: h.room_id ?? undefined });
    }
  }
  return outcomes;
}
