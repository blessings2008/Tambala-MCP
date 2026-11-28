import { randomUUID } from 'node:crypto';
import { normalizePhoneFromLabel } from '../../channels/phone.js';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../../lib/supabase.js';
import { AGENT_DIRECTORY, type AgentName } from '../../services/ai/models.js';
import type { OrganizationTaskTransition } from '../task-lifecycle.js';
import { isAllowedOrganizationTaskTransition } from '../task-transition-rules.js';
import type { OrganizationTaskStatus } from '../task-store.js';
import { actionHelp, parseActions, type Action } from './actions.js';
import { splitBlocks } from './blocks.js';
import { roleIdFor } from './profiles.js';
import { isPermanentAgentFailure } from './retry-policy.js';
import { extractDiscoveryRecommendation, isFalseMissingDeliverableReview, isResearchDailyQuotaExhausted } from './discovery-queue-utils.js';

export const MAX_HANDOFFS_PER_DUTY = 2;
export const MAX_HANDOFF_ATTEMPTS = 5;
export const HANDOFF_LEASE_TIMEOUT_MS = 30 * 60 * 1000;
export const HANDOFF_HEARTBEAT_INTERVAL_MS = 30 * 1000;

export type HandoffStatus = 'queued' | 'running' | 'awaiting_founder' | 'completed' | 'failed';
export type TaskRoomStatus = 'active' | 'awaiting_founder' | 'blocked' | 'ready_for_review' | 'revision_requested' | 'completed' | 'failed' | 'cancelled' | 'archived';
export interface TaskRoom {
  id: string; handoff_id: string; parent_task_id: string | null; owner_role_id: string; owner_agent: string;
  opened_by_role_id: string; objective: string; context_packet: Record<string, unknown>; status: TaskRoomStatus;
  deliverable: string | null; blocker: string | null; opened_at: string; updated_at: string; closed_at: string | null;
}
export interface Handoff {
  id: string; from_role_id: string; to_role_id: string; to_agent: string; request: string; context_summary: string | null;
  source_task_id: string | null; source_duty_id: string | null; dispatch_key?: string | null; claimed_at?: string | null; heartbeat_at?: string | null; status: HandoffStatus; attempts: number;
  result: string | null; error: string | null; task_id: string | null; room_id: string | null; created_at: string; completed_at: string | null;
}

export class HandoffError extends Error {}

/** Read-only AI & Automation incident reports can be accepted by a deterministic contract. */
function hasAutomationIncidentReport(value: string): boolean {
  const text = value.trim();
  // Accept the model's existing structured formats as well as the preferred headings.
  // The execution path separately forbids actions, so a report can never claim an
  // unverified production change or perform one.
  const hasEvidence = /(?:^|\n)\s*(?:\*\*)?(?:FACTS|EVIDENCE|OBSERVED FACTS)(?:\s*\([^)]*\))?(?:\*\*)?/im.test(text);
  const hasDiagnosis = /(?:^|\n)\s*(?:\*\*)?(?:DIAGNOSIS|HYPOTHESES|ROOT CAUSE)(?:\*\*)?/im.test(text);
  const hasNextStep = /(?:RECOMMENDED|SAFE NEXT STEP|NEXT STEP|RECOMMENDATION)/i.test(text);
  return text.length >= 180 && hasEvidence && hasDiagnosis && hasNextStep
    && !/DECISION:\\s*FOUNDER_INPUT_REQUIRED|Clarification Required/i.test(text);
}

/**
 * Research-queue reviews have a fixed, machine-checkable contract. The CEO model
 * previously rejected complete reports while claiming the deliverable was absent.
 * Validate the evidence packet and required fields deterministically instead of
 * spending another model call re-reading the same report.
 */
export function validateDiscoveryQueueDeliverable(contextSummary: string | null, deliverable: string): { ok: boolean; reason: string } {
  if (!contextSummary) return { ok: false, reason: 'The discovery review has no supplied prospect record.' };
  let packet: { prospect?: Record<string, unknown> };
  try {
    const source = contextSummary.split(/\n\nCEO REVIEW FEEDBACK:/i)[0];
    packet = JSON.parse(source) as { prospect?: Record<string, unknown> };
  } catch {
    return { ok: false, reason: 'The supplied prospect context is not a readable discovery-queue record.' };
  }
  const prospect = packet.prospect;
  if (!prospect || typeof prospect !== 'object') return { ok: false, reason: 'The supplied prospect record is missing.' };
  const name = typeof prospect.organisation_name === 'string' ? prospect.organisation_name.trim() : '';
  const recordId = typeof prospect.id === 'string' ? prospect.id.trim() : '';
  const text = deliverable.trim();
  const normalized = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!name || !normalized(text).includes(normalized(name))) return { ok: false, reason: 'The report must identify the exact organisation name from the supplied record.' };
  if (!recordId || !text.toLowerCase().includes(recordId.toLowerCase())) return { ok: false, reason: 'The report must include the exact lead_discovery_queue record ID.' };
  if (!/service[\\u2010-\\u2015\\u2212 -]+fit evidence|supported service fit/i.test(text)) return { ok: false, reason: 'The report must include a service-fit evidence section.' };
  const fits = Array.isArray(prospect.service_fit) ? prospect.service_fit.filter((v): v is string => typeof v === 'string') : [];
  if (fits.length && !fits.some((fit) => normalized(text).includes(normalized(fit)))) return { ok: false, reason: 'The report must name at least one service fit recorded in the supplied prospect record.' };
  const sources = Array.isArray(prospect.source_urls) ? prospect.source_urls.filter((v): v is string => typeof v === 'string' && /^https?:\/\//i.test(v)) : [];
  if (!sources.length || !sources.some((url) => text.includes(url))) return { ok: false, reason: 'The report must cite at least one source URL supplied with the prospect record.' };
  const contactHeading = text.match(/public organisational contact evidence|public organizational contact evidence/i);
  if (!contactHeading || contactHeading.index === undefined) return { ok: false, reason: 'The report must explicitly state the public organisational contact evidence.' };
  const contactTail = text.slice(contactHeading.index + contactHeading[0].length);
  const contactEnd = contactTail.search(/\n\s*\*{0,2}(?:remaining\s+)?verification gaps\b|\n\s*\*{0,2}recommendation\b/i);
  const contactSection = contactTail.slice(0, contactEnd < 0 ? undefined : contactEnd);
  const emails = typeof prospect.public_email === 'string' ? prospect.public_email.split(/[;,]/).map((v) => v.trim()).filter(Boolean) : [];
  const phones = typeof prospect.public_phone === 'string' ? prospect.public_phone.split(/[;,/]/).map((v) => v.trim()).filter(Boolean) : [];
  const hasEmail = emails.some((email) => contactSection.toLowerCase().includes(email.toLowerCase()));
  const hasPhone = phones.some((phone) => {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 8 && contactSection.replace(/\D/g, '').includes(digits);
  });
  const hasSuppliedContact = emails.length > 0 || phones.length > 0;
  const explicitlyNoContact = /\bnone\b|no (?:verified )?(?:public )?(?:organisational )?(?:email|phone|contact)|not available|not supplied|not verified/i.test(contactSection);
  if (hasSuppliedContact && !hasEmail && !hasPhone) return { ok: false, reason: 'The report must reproduce at least one public email or phone number supplied in the prospect record under its contact-evidence section.' };
  if (!hasSuppliedContact && !explicitlyNoContact) return { ok: false, reason: 'The report must explicitly say in its contact-evidence section that no public organisational email or phone is supplied.' };
  const gapsHeading = text.match(/verification gaps/i);
  if (!gapsHeading || gapsHeading.index === undefined) return { ok: false, reason: 'The report must explicitly list remaining verification gaps, or state that none were identified.' };
  const gapsTail = text.slice(gapsHeading.index + gapsHeading[0].length);
  const gapsEnd = gapsTail.search(/\n\s*\*{0,2}recommendation\b/i);
  const gapsSection = gapsTail.slice(0, gapsEnd < 0 ? undefined : gapsEnd).replace(/[\s*:*-]/g, '');
  if (gapsSection.length < 3) return { ok: false, reason: 'The report must state the remaining verification gaps or explicitly say none were identified.' };
  const recommendation = extractDiscoveryRecommendation(text, name);
  if (!recommendation) return { ok: false, reason: 'The report must end with one explicit QUALIFY, INVESTIGATE, or REJECT recommendation.' };
  if (recommendation === 'QUALIFY' && (String(prospect.verification_status ?? '').toLowerCase() !== 'verified' || phones.length === 0 || !hasPhone)) {
    return { ok: false, reason: 'QUALIFY requires a verified prospect record and at least one supplied public WhatsApp phone number reproduced in the contact-evidence section.' };
  }
  return { ok: true, reason: 'The discovery report identifies the exact record, supported service fit, supplied source evidence, public contact status, verification gaps, and a permitted recommendation.' };
}

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
  claim(id: string, claimedAt?: string): Promise<boolean>;
  heartbeat(id: string, heartbeatAt: string): Promise<boolean>;
  expiredRunning(beforeIso: string, limit: number): Promise<Handoff[]>;
  quarantineExpired(id: string, beforeIso: string, reason: string): Promise<boolean>;
  update(id: string, patch: Partial<Handoff>): Promise<void>;
  recent(sinceIso: string): Promise<Handoff[]>;
  awaitingFounderDiscoverySince(sinceIso: string, limit: number): Promise<Handoff[]>;
  get(id: string): Promise<Handoff | null>;
  getByRoomId(roomId: string): Promise<Handoff | null>;
  getByDispatchKey(dispatchKey: string): Promise<Handoff | null>;
  createRoom(room: Omit<TaskRoom, 'id'>): Promise<TaskRoom>;
  updateRoom(id: string, patch: Partial<TaskRoom>): Promise<void>;
  roomEvent(roomId: string, eventType: string, actorRoleId: string | null, payload?: unknown): Promise<void>;
}

export class SupabaseHandoffStore implements HandoffStore {
  create(h: Omit<Handoff, 'id'>) { return supabaseInsert<Handoff>('organization_handoffs', h as unknown as Record<string, unknown>); }
  queued(limit: number) { return supabaseSelect<Handoff>('organization_handoffs', `select=*&status=eq.queued&order=created_at.asc&limit=${limit}`); }
  async claim(id: string, claimedAt = new Date().toISOString()) {
    try { await supabaseUpdate('organization_handoffs', { status: 'running', claimed_at: claimedAt, heartbeat_at: claimedAt }, `id=eq.${encodeURIComponent(id)}&status=eq.queued`); return true; }
    catch (error) { if (error instanceof Error && /returned no record/.test(error.message)) return false; throw error; }
  }
  async heartbeat(id: string, heartbeatAt: string) {
    try { await supabaseUpdate('organization_handoffs', { heartbeat_at: heartbeatAt }, `id=eq.${encodeURIComponent(id)}&status=eq.running`); return true; }
    catch (error) { if (error instanceof Error && /returned no record/.test(error.message)) return false; throw error; }
  }
  expiredRunning(beforeIso: string, limit: number) { return supabaseSelect<Handoff>('organization_handoffs', `select=*&status=eq.running&heartbeat_at=lt.${encodeURIComponent(beforeIso)}&order=heartbeat_at.asc&limit=${limit}`); }
  async quarantineExpired(id: string, beforeIso: string, reason: string) {
    try { await supabaseUpdate('organization_handoffs', { status: 'failed', error: reason, completed_at: new Date().toISOString() }, `id=eq.${encodeURIComponent(id)}&status=eq.running&heartbeat_at=lt.${encodeURIComponent(beforeIso)}`); return true; }
    catch (error) { if (error instanceof Error && /returned no record/.test(error.message)) return false; throw error; }
  }
  async update(id: string, patch: Partial<Handoff>) { await supabaseUpdate('organization_handoffs', patch as Record<string, unknown>, `id=eq.${encodeURIComponent(id)}`); }
  recent(sinceIso: string) { return supabaseSelect<Handoff>('organization_handoffs', `select=*&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=100`); }
  awaitingFounderDiscoverySince(sinceIso: string, limit: number) { return supabaseSelect<Handoff>('organization_handoffs', `select=*&status=eq.awaiting_founder&source_duty_id=in.(lead-discovery-queue-watcher,lead-discovery-queue-research-review)&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=${Math.min(500, Math.max(1, Math.floor(limit)))}`); }
  async get(id: string) { return (await supabaseSelect<Handoff>('organization_handoffs', `select=*&id=eq.${encodeURIComponent(id)}&limit=1`))[0] ?? null; }
  async getByRoomId(roomId: string) { return (await supabaseSelect<Handoff>('organization_handoffs', `select=*&room_id=eq.${encodeURIComponent(roomId)}&limit=1`))[0] ?? null; }
  async getByDispatchKey(dispatchKey: string) { return (await supabaseSelect<Handoff>('organization_handoffs', `select=*&dispatch_key=eq.${encodeURIComponent(dispatchKey)}&limit=1`))[0] ?? null; }
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
  async create(h: Omit<Handoff, 'id'>) {
    if (h.dispatch_key && this.rows.some((row) => row.dispatch_key === h.dispatch_key)) throw new Error('duplicate key value violates unique constraint organization_handoffs_dispatch_key_unique');
    const row = { ...h, id: randomUUID() }; this.rows.push(row); return row;
  }
  async queued(limit: number) { return this.rows.filter((r) => r.status === 'queued').slice(0, limit); }
  async claim(id: string, claimedAt = new Date().toISOString()) { const r = this.rows.find((x) => x.id === id); if (!r || r.status !== 'queued') return false; r.status = 'running'; r.claimed_at = claimedAt; r.heartbeat_at = claimedAt; return true; }
  async heartbeat(id: string, heartbeatAt: string) { const r = this.rows.find((x) => x.id === id); if (!r || r.status !== 'running') return false; r.heartbeat_at = heartbeatAt; return true; }
  async expiredRunning(beforeIso: string, limit: number) { return this.rows.filter((r) => r.status === 'running' && Boolean(r.heartbeat_at) && r.heartbeat_at! < beforeIso).sort((a, b) => (a.heartbeat_at ?? '').localeCompare(b.heartbeat_at ?? '')).slice(0, limit); }
  async quarantineExpired(id: string, beforeIso: string, reason: string) { const r = this.rows.find((x) => x.id === id); if (!r || r.status !== 'running' || !r.heartbeat_at || r.heartbeat_at >= beforeIso) return false; r.status = 'failed'; r.error = reason; r.completed_at = new Date().toISOString(); return true; }
  async update(id: string, patch: Partial<Handoff>) { const r = this.rows.find((x) => x.id === id); if (r) Object.assign(r, patch); }
  async recent(sinceIso: string) { return this.rows.filter((r) => r.created_at >= sinceIso).reverse(); }
  async awaitingFounderDiscoverySince(sinceIso: string, limit: number) { return this.rows.filter((r) => r.status === 'awaiting_founder' && ['lead-discovery-queue-watcher', 'lead-discovery-queue-research-review'].includes(r.source_duty_id ?? '') && r.created_at >= sinceIso).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Math.min(500, Math.max(1, Math.floor(limit)))); }
  async get(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async getByRoomId(roomId: string) { return this.rows.find((r) => r.room_id === roomId) ?? null; }
  async getByDispatchKey(dispatchKey: string) { return this.rows.find((r) => r.dispatch_key === dispatchKey) ?? null; }
  async createRoom(room: Omit<TaskRoom, 'id'>) { const row = { ...room, id: randomUUID() }; this.rooms.push(row); return row; }
  async updateRoom(id: string, patch: Partial<TaskRoom>) { const row = this.rooms.find((r) => r.id === id); if (row) Object.assign(row, patch); }
  async roomEvent(roomId: string, eventType: string, actorRoleId: string | null, payload?: unknown) { this.roomEvents.push({ room_id: roomId, event_type: eventType, actor_role_id: actorRoleId, payload }); }
}

export async function queueHandoff(store: HandoffStore, input: {
  fromRoleId: string; toAgent: AgentName; request: string; contextSummary?: string | null; sourceTaskId?: string | null; sourceDutyId?: string | null; dispatchKey?: string | null; now?: Date;
  sign?: (input: { roleId: string; kind: 'handoff_request'; subjectId: string; content: string }) => Promise<unknown>;
}): Promise<Handoff> {
  if (!(input.toAgent in AGENT_DIRECTORY) || input.toAgent === 'orchestrator') throw new HandoffError('Choose an employee to assign this to.');
  const request = input.request.trim();
  if (request.length < 5 || request.length > 1000) throw new HandoffError('The request must be 5 to 1000 characters.');
  const dispatchKey = input.dispatchKey?.trim() || null;
  if (dispatchKey) {
    if (dispatchKey.length > 240) throw new HandoffError('The dispatch key must not exceed 240 characters.');
    const existing = await store.getByDispatchKey(dispatchKey);
    if (existing) {
      if (existing.from_role_id !== input.fromRoleId || existing.to_agent !== input.toAgent || existing.request !== request || existing.source_task_id !== (input.sourceTaskId ?? null)) {
        throw new HandoffError('This dispatch key is already associated with different work.');
      }
      return existing;
    }
  }
  let created: Handoff;
  try {
    created = await store.create({
    from_role_id: input.fromRoleId, to_role_id: roleIdFor(input.toAgent), to_agent: input.toAgent, request,
    context_summary: input.contextSummary ? input.contextSummary.slice(0, 8000) : null,
    source_task_id: input.sourceTaskId ?? null, source_duty_id: input.sourceDutyId ?? null, dispatch_key: dispatchKey,
    status: 'queued', attempts: 0, result: null, error: null, task_id: null, room_id: null,
    created_at: (input.now ?? new Date()).toISOString(), completed_at: null,
    });
  } catch (error) {
    if (dispatchKey && error instanceof Error && /unique|duplicate|23505/i.test(error.message)) {
      const existing = await store.getByDispatchKey(dispatchKey);
      if (existing && existing.from_role_id === input.fromRoleId && existing.to_agent === input.toAgent && existing.request === request && existing.source_task_id === (input.sourceTaskId ?? null)) return existing;
    }
    throw error;
  }
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
  actions: { run(ctx: { agent: AgentName; roleId: string; taskId: string; qualifiedProspectFirstContact?: boolean }, actions: Action[], rejected: string[]): Promise<string> };
  sign(input: { roleId: string; kind: 'handoff_result'; subjectId: string; content: string }): Promise<{ block: string }>;
  buildContext(): Promise<Record<string, unknown>>;
  askAgent(agent: AgentName, prompt: string, context: Record<string, unknown>): Promise<string>;
  tasks: {
    begin(objective: string): Promise<{ taskId: string }>;
    advance(taskId: string, transitions: OrganizationTaskTransition[]): Promise<unknown>;
    getStatus(taskId: string): Promise<OrganizationTaskStatus | null>;
    fail(taskId: string, message: string, sourceAgent?: AgentName): Promise<void>;
  };
}

export interface HandoffOutcome { handoffId: string; toAgent: string; status: 'completed' | 'waiting' | 'retry' | 'failed' | 'already_taken'; reason?: string; taskId?: string; roomId?: string }

const RULES = 'Use ONLY the supplied data. If something is missing, say so plainly. Do not sign or add a sign-off: the system signs your work with your employee number. Never invent leads, clients, amounts, dates or results. Anything addressed to a customer is a DRAFT; never claim it was sent. Do not hand work on to anyone else. If the assignment is ambiguous, explicitly label your response "Clarification Required", ask the Founder one precise question, and do not present a guessed answer as completed work.';

export function approvedFirstContactTarget(contextSummary: string | null): { phone: string; contact: string } | null {
  if (!contextSummary) return null;
  try {
    const root = JSON.parse(contextSummary) as Record<string, unknown>;
    const lead = root.crm_lead && typeof root.crm_lead === 'object' ? root.crm_lead as Record<string, unknown> : {};
    const prospect = root.prospect && typeof root.prospect === 'object' ? root.prospect as Record<string, unknown> : {};
    const rawPhone = [lead.whatsapp, lead.phone].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
    const contact = [prospect.organisation_name, lead.business_name, lead.name].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
    if (!rawPhone || !contact) return null;
    // CRM values sometimes include a city/contact label, e.g. "Lilongwe: +265 888 826 648".
    // Extract exactly one numeric candidate, then run the shared Malawi-aware normalizer.
    // Multiple numbers are ambiguous and must not be guessed.
    const phone = normalizePhoneFromLabel(rawPhone);
    return phone ? { phone, contact } : null;
  } catch {
    return null;
  }
}

function approvedFirstContactMessage(contextSummary: string | null, target: { phone: string; contact: string }): string | null {
  if (!contextSummary) return null;
  try {
    const root = JSON.parse(contextSummary) as Record<string, unknown>;
    const prospect = root.prospect && typeof root.prospect === 'object' ? root.prospect as Record<string, unknown> : {};
    const prepared = typeof prospect.first_contact_message === 'string' ? prospect.first_contact_message.trim() : '';
    if (prepared.length >= 30 && prepared.length <= 1500) return prepared;

    const sector = typeof prospect.sector === 'string' ? prospect.sector.trim() : '';
    const fit = Array.isArray(prospect.service_fit) ? prospect.service_fit.filter((v): v is string => typeof v === 'string') : [];
    const labels: Record<string, string> = {
      web_development: 'website design and development',
      digital_product_development: 'digital product development',
      software_development: 'custom software development',
      social_media_management: 'social media management and content planning',
    };
    const services = [...new Set(fit.map((item) => labels[item.toLowerCase().replace(/[\s-]+/g, '_')]).filter(Boolean))];
    if (!services.length) return null;
    const sectorLine = sector ? ` I came across your work in ${sector}.` : '';
    return [
      `Good morning. My name is Bless from Tambala Technologies.`,
      `I wanted to introduce our services to ${target.contact}.${sectorLine}`,
      `We provide ${services.join(' and ')} to help organisations strengthen their digital presence and communicate their work more effectively.`,
      'Would you be open to a brief conversation about whether these services could be useful to your organisation?',
      'Thank you for your time.',
    ].join('\n\n');
  } catch {
    return null;
  }
}

function parseLegacyFirstContactAction(raw: string, target: { phone: string; contact: string }): { action: Action; clean: string } | null {
  const fence = String.fromCharCode(96).repeat(3);
  const blocks = [...raw.matchAll(new RegExp(fence + '(?:json)?\\s*([\\s\\S]*?)' + fence, 'gi'))];
  const expected = target.phone.replace(/\D/g, '');
  for (const block of blocks) {
    try {
      const value = JSON.parse(block[1]) as Record<string, unknown>;
      const destination = String(value.destination ?? '').trim();
      const message = String(value.message ?? '').trim();
      if (value.action !== 'whatsapp' || value.purpose !== 'outreach' || !destination || !message) continue;
      if (destination.replace(/\D/g, '') !== expected) continue;
      const action: Action = { type: 'whatsapp', to: destination, purpose: 'outreach', contact: target.contact, text: message };
      const clean = raw.replace(/\*\*WhatsApp Outreach Action\*\*/i, '').replace(new RegExp(fence + '(?:json)?\\s*[\\s\\S]*?' + fence, 'i'), '').trim();
      return { action, clean };
    } catch {
      // Ignore unrelated or malformed JSON blocks; only the exact legacy WhatsApp shape is accepted.
    }
  }
  return null;
}

function confirmsQueuedOrSentAction(value: string): boolean {
  // Only a positively successful WhatsApp action line counts. A failure explanation may
  // contain the word 'queued' (for example, 'No customer message was queued').
  return /^\s*Actions:\s*\r?\n\s*✔\s*whatsapp:\s*[^\r\n]*\b(?:queued|sent)\b/i.test(value);
}

/** Each delegation runs in an isolated, durable room. A room closes only after its deliverable is accepted. */
export async function processHandoffs(deps: HandoffDeps, limit = 5): Promise<HandoffOutcome[]> {
  const outcomes: HandoffOutcome[] = [];
  const since = new Date(deps.now().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [recent, founderDiscoveryReviews] = await Promise.all([
    deps.store.recent(since),
    deps.store.awaitingFounderDiscoverySince(since, 250),
  ]);
  let researchQuotaExhausted = isResearchDailyQuotaExhausted(recent, deps.now());
  // Earlier CEO reviews sometimes claimed a discovery report was missing even though
  // the employee result was stored. Reconcile only reports that pass the same deterministic
  // evidence validator used for new discovery handoffs; incomplete reports remain paused.
  for (const waiting of founderDiscoveryReviews) {
    if (
      waiting.status !== 'awaiting_founder' ||
      !['lead-discovery-queue-watcher', 'lead-discovery-queue-research-review'].includes(waiting.source_duty_id ?? '') ||
      !isFalseMissingDeliverableReview(waiting.error, waiting.result) ||
      !waiting.result?.trim() ||
      !waiting.task_id
    ) continue;
    const validation = validateDiscoveryQueueDeliverable(waiting.context_summary, waiting.result);
    if (!validation.ok) continue;
    const currentStatus = await deps.tasks.getStatus(waiting.task_id);
    if (currentStatus !== 'awaiting_founder') continue;
    const recoveredAt = deps.now().toISOString();
    const recoveryResult = {
      handoffId: waiting.id,
      roomId: waiting.room_id,
      reason: 'The stored employee report was present and passed deterministic discovery validation. The previous missing-deliverable escalation was incorrect; no customer-facing action was taken.',
      validation: validation.reason,
      automaticRecovery: true,
    };
    const transitions: OrganizationTaskTransition[] = [
      { status: 'ceo_analyzing', stage: 'ceo', eventType: 'false_missing_discovery_deliverable_reconciled', roleId: 'ceo', result: recoveryResult },
      { status: 'delegated', stage: 'department', eventType: 'stored_discovery_report_revalidated', roleId: 'ceo', result: recoveryResult },
      { status: 'executing', stage: 'department', eventType: 'deterministic_discovery_review_started', roleId: 'ceo', result: recoveryResult },
      { status: 'department_review', stage: 'review', eventType: 'deterministic_discovery_review_passed', roleId: waiting.to_role_id, result: recoveryResult },
      { status: 'returned_to_ceo', stage: 'review', eventType: 'department_work_returned', roleId: waiting.to_role_id, result: recoveryResult },
      { status: 'completed', stage: 'complete', eventType: 'handoff_completed', roleId: 'ceo', completedAt: recoveredAt, result: recoveryResult },
    ];
    if (!transitions.every((transition, index) =>
      isAllowedOrganizationTaskTransition(
        index === 0 ? currentStatus : transitions[index - 1].status,
        transition.status,
      ),
    )) continue;
    await deps.tasks.advance(waiting.task_id, transitions);
    await deps.store.update(waiting.id, { status: 'completed', error: null, completed_at: recoveredAt });
    if (waiting.room_id) {
      await deps.store.updateRoom(waiting.room_id, { status: 'archived', deliverable: waiting.result.slice(0, 8000), blocker: null, closed_at: recoveredAt });
      await deps.store.roomEvent(waiting.room_id, 'false_missing_discovery_deliverable_recovered', 'ceo', recoveryResult);
      await deps.store.roomEvent(waiting.room_id, 'room_archived', 'ceo', { retained: true, automaticRecovery: true });
    }
    outcomes.push({
      handoffId: waiting.id,
      toAgent: waiting.to_agent,
      status: 'completed',
      reason: 'Stored discovery report passed deterministic validation; the false Founder escalation was reconciled without a new AI call.',
      taskId: waiting.task_id,
      roomId: waiting.room_id ?? undefined,
    });
  }
  const expiredBefore = new Date(deps.now().getTime() - HANDOFF_LEASE_TIMEOUT_MS).toISOString();
  const expired = await deps.store.expiredRunning(expiredBefore, limit);
  for (const stale of expired) {
    if (stale.to_agent === 'research' && researchQuotaExhausted) {
      const reason = 'Research is paused because the OpenRouter free-model daily quota was exhausted. This handoff is preserved for automatic retry after the cooldown; Founder input is not required.';
      const quotaError = 'free-models-per-day quota exhausted; Research handoff preserved for automatic retry after cooldown.';
      await deps.store.update(stale.id, {
        status: 'failed',
        error: quotaError,
        completed_at: deps.now().toISOString(),
        claimed_at: null,
        heartbeat_at: null,
      });
      if (stale.task_id) {
        try {
          await deps.tasks.advance(stale.task_id, [{
            status: 'failed',
            stage: 'department',
            eventType: 'research_provider_quota_paused',
            roleId: stale.to_role_id,
            result: { handoffId: stale.id, roomId: stale.room_id, reason, automaticRetryAfterCooldown: true },
          }]);
        } catch (error) {
          console.error('Could not mark quota-paused Research task failed:', error instanceof Error ? error.message : error);
        }
      }
      if (stale.room_id) {
        await deps.store.updateRoom(stale.room_id, { status: 'active', blocker: reason, closed_at: null });
        await deps.store.roomEvent(stale.room_id, 'research_provider_quota_paused', stale.to_role_id, { reason, automaticRetryAfterCooldown: true });
      }
      outcomes.push({ handoffId: stale.id, toAgent: stale.to_agent, status: 'failed', reason, taskId: stale.task_id ?? undefined, roomId: stale.room_id ?? undefined });
      continue;
    }
    const reason = 'The handoff worker lease expired. The task is marked failed and will not be retried automatically because external side effects may be uncertain. The CEO must verify the recorded outcome before issuing any new attempt; no Founder input is required.';
    if (!(await deps.store.quarantineExpired(stale.id, expiredBefore, reason))) continue;
    if (stale.task_id) {
      try {
        await deps.tasks.advance(stale.task_id, [{
          status: 'failed',
          stage: 'complete',
          eventType: 'handoff_worker_lease_expired_safe_hold',
          roleId: 'ceo',
          result: { handoffId: stale.id, roomId: stale.room_id, reason, automaticRetry: false },
        }]);
      } catch (error) {
        console.error('Could not move expired handoff task to Founder review:', error instanceof Error ? error.message : error);
      }
    }
    if (stale.room_id) {
      await deps.store.updateRoom(stale.room_id, { status: 'failed', blocker: reason, closed_at: deps.now().toISOString() });
      await deps.store.roomEvent(stale.room_id, 'worker_lease_expired', 'ceo', { reason, automaticRetry: false });
    }
    outcomes.push({ handoffId: stale.id, toAgent: stale.to_agent, status: 'waiting', reason, taskId: stale.task_id ?? undefined, roomId: stale.room_id ?? undefined });
  }
  for (const waiting of recent) {
    // Earlier deployments quarantined stale handoffs even when the task state transition
    // was rejected. Reconcile that parent task now, without re-queuing the handoff or
    // replaying any external action.
    if (
      waiting.status === 'awaiting_founder' &&
      waiting.task_id &&
      waiting.error?.includes('handoff worker lease expired')
    ) {
      const currentStatus = await deps.tasks.getStatus(waiting.task_id);
      if (
        currentStatus &&
        currentStatus !== 'failed' &&
        isAllowedOrganizationTaskTransition(currentStatus, 'failed')
      ) {
        await deps.tasks.advance(waiting.task_id, [{
          status: 'failed',
          stage: 'complete',
          eventType: 'handoff_worker_lease_expired_reconciled_to_failed',
          roleId: 'ceo',
          result: {
            handoffId: waiting.id,
            roomId: waiting.room_id,
            reason: waiting.error,
            reconciledFrom: currentStatus,
            automaticRetry: false,
          },
        }]);
        if (waiting.room_id) {
          await deps.store.roomEvent(waiting.room_id, 'parent_task_reconciled_to_safe_failure', 'ceo', {
            taskId: waiting.task_id,
            fromStatus: currentStatus,
            automaticRetry: false,
          });
        }
      }
    }
    if (waiting.source_duty_id !== 'approved-prospect-first-contact' || waiting.status !== 'awaiting_founder') continue;
    if (!/whatsapp[\s\-\u2010-\u2015]*registered/i.test(waiting.result ?? '')) continue;
    await deps.store.update(waiting.id, {
      status: 'queued',
      error: 'System resumed: the shared outbox verifies WhatsApp registration; Founder confirmation is not required.',
      completed_at: null,
    });
    if (waiting.room_id) {
      await deps.store.updateRoom(waiting.room_id, { status: 'active', blocker: null });
      await deps.store.roomEvent(waiting.room_id, 'first_contact_resumed_for_outbox_verification', null, { reason: 'WhatsApp registration is verified by the shared outbox.' });
    }
  }
  for (const h of await deps.store.queued(limit)) {
    const agent = h.to_agent as AgentName;
    if (agent === 'research' && researchQuotaExhausted) {
      outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: 'Research is paused because the free provider daily quota was exhausted. The queued handoff is preserved for retry after the cooldown.', taskId: h.task_id ?? undefined, roomId: h.room_id ?? undefined });
      continue;
    }
    const blocked = await deps.agentUnavailableReason(agent);
    if (blocked) {
      const waiting = `Waiting: ${blocked}`;
      if (h.error !== waiting) await deps.store.update(h.id, { error: waiting });
      if (h.room_id) { await deps.store.updateRoom(h.room_id, { status: 'blocked', blocker: blocked }); await deps.store.roomEvent(h.room_id, 'room_blocked', h.from_role_id, { reason: blocked }); }
      outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: blocked, roomId: h.room_id ?? undefined });
      continue;
    }
    if (!(await deps.store.claim(h.id, deps.now().toISOString()))) { outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'already_taken', roomId: h.room_id ?? undefined }); continue; }
    const attempt = h.attempts + 1;
    const previousError = h.error;
    const [sender, recipient] = await Promise.all([deps.senderLabel(h.from_role_id), deps.recipientLabel(agent)]);
    const autonomousFirstContact = agent === 'outreach' && h.source_duty_id === 'approved-prospect-first-contact';
    const taskRules = autonomousFirstContact
      ? RULES.replace(
          'Anything addressed to a customer is a DRAFT; never claim it was sent.',
          'Exception: this exact CEO-authorised first-contact may prepare one WhatsApp outreach action using ACTIONS. The shared outbox verifies the CRM lead and WhatsApp registration, then places the message in the autonomous WhatsApp outbox. Do not claim prior client work, similar customers served, testimonials or results unless approved portfolio evidence supports the exact claim. Never claim sent. All other customer-facing messages remain drafts.',
        )
      : RULES;
    const reviewRule = autonomousFirstContact
      ? 'For this CEO-authorised first-contact only, accept when the action result confirms the message was queued or sent after CRM and WhatsApp verification. Report the exact state. A queued message is not delivered; never claim sent unless the action result confirms sent.'
      : 'Accept when the requested work is complete against the supplied evidence, including a clear account of limitations and unavailable sources. Do not demand provider logs, account metrics, credentials or actions that the employee cannot access. Routine customer communication is autonomous under the standing outbox safeguards. Never approve unsafe payments, permission changes, security-sensitive changes or actions outside delegated authority. Make reasonable reversible decisions from supplied context; if no safe route exists, return SAFE_HOLD without requesting Founder input. Return REVISION_REQUIRED only when the employee omitted work or made an unsupported claim that can be corrected from the supplied context.';
    const taskId = h.task_id ?? (await deps.tasks.begin(`[Room ${h.room_id ?? h.id}] [Handoff from ${sender}] ${h.request.slice(0, 160)}`)).taskId;
    let leaseLost = false;
    const heartbeatTimer = setInterval(() => {
      void deps.store.heartbeat(h.id, deps.now().toISOString()).then((active) => {
        if (!active) leaseLost = true;
      }).catch((error: unknown) => {
        leaseLost = true;
        console.error('Handoff worker heartbeat failed; stopping side-effect execution:', error instanceof Error ? error.message : error);
      });
    }, HANDOFF_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
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
      const firstContactTarget = autonomousFirstContact ? approvedFirstContactTarget(h.context_summary) : null;
      if (autonomousFirstContact && !firstContactTarget) throw new Error('Approved first-contact is missing its CRM destination or verified organisation name.');
      const discoveryQueueTask = ['lead-discovery-queue-watcher', 'lead-discovery-queue-research-review'].includes(h.source_duty_id ?? '');
      const automationIncident = agent === 'automation' && /^AUTOMATIC (?:AI & AUTOMATION )?INCIDENT/i.test(h.request);
      const discoveryQueueFormat = discoveryQueueTask
        ? [
            'MANDATORY DISCOVERY QUEUE REPORT FORMAT — use these exact headings and keep the Recommendation section last:',
            'Organisation Name: [exact name from the supplied record]',
            'Queue Record ID: [exact UUID from the supplied record]',
            'Service-Fit Evidence: [supported Tambala services and the supplied evidence]',
            'Source URLs: [at least one exact URL copied verbatim from the supplied record]',
            'Public Organisational Contact Evidence: [exact public email and/or phone from the supplied record, or explicitly state None supplied]',
            'Verification Gaps: [specific gaps, or None identified]',
            'Recommendation: QUALIFY | INVESTIGATE | REJECT',
            'Use the exact label Recommendation:, not Decision: and not a bare status. QUALIFY only when the record is verified and a supplied public WhatsApp phone number is reproduced exactly. If no valid public phone is supplied, choose INVESTIGATE. Never invent a contact or source.',
          ].join('\n')
        : '';
      const prompt = [
        'TASK ROOM ASSIGNMENT', `You are ${recipient}. ${sender} has assigned this work to your room.`, taskRules,
        `ROOM ID: ${h.room_id ?? 'not recorded'}`, `REQUEST: ${h.request}`,
        previousError ? `PREVIOUS ATTEMPT FEEDBACK: ${previousError}` : '',
        autonomousFirstContact && firstContactTarget
          ? `MANDATORY FIRST-CONTACT ACTION: send exactly one WhatsApp outreach action to ${firstContactTarget.phone}; use ${firstContactTarget.contact} as the contact label. Do not use another number. A draft-only answer is invalid. Do not claim prior client work, similar customers served, testimonials or results unless approved portfolio evidence supports the exact claim.`
          : '',
        h.context_summary ? `CONTEXT FROM ${sender.toUpperCase()}:\n${h.context_summary}` : '',
        discoveryQueueFormat,
        automationIncident ? [
          'READ-ONLY INCIDENT DIAGNOSTIC: Do not use tools, actions, or ACTIONS blocks. Do not change configuration, credentials, models, permissions, or production state.',
          'Use only the incident metadata and available records in the context. Separate observed facts from hypotheses. Never ask the Founder for logs or clarification.',
          'Return exactly these headings, each on its own line: Severity:, Evidence:, Diagnosis:, Confidence:, Safe next step:, Action taken:. State explicitly that no change was made unless a change is independently verified.',
          'The first line must be exactly SELF_REVIEW: PASS. This is a diagnostic report, not a request for permission.',
        ].join('\n') : '',
        actionHelp(agent),
        'SELF-REVIEW BEFORE SUBMISSION: Check the original request, every required deliverable field, factual support in the supplied context, source URLs, arithmetic, consistency, customer-facing wording, and every proposed ACTIONS item. Correct omissions and unsupported claims yourself before submitting. Do not execute actions. Return exactly SELF_REVIEW: PASS as the first line only when the final work passes; if a missing Founder-controlled fact or decision prevents completion, return SELF_REVIEW: BLOCKED as the first line and clearly ask one precise question under Clarification Required. Never mark unverified work as passed.',
        'Keep the final work under 300 words, plain and scannable. Say what you did, what you found, and anything blocked.',
      ].filter(Boolean).join('\n\n');
      const contextPacket = await deps.buildContext();
      if (h.room_id) await deps.store.updateRoom(h.room_id, { context_packet: { context_summary: h.context_summary, source_duty_id: h.source_duty_id, organization_context: contextPacket } });
      let acted: ReturnType<typeof parseActions>;
      let result: string;
      if (autonomousFirstContact && firstContactTarget) {
        // CEO-qualified prospect records already contain verified contact and service-fit data.
        // Build the one permitted first-contact action deterministically instead of asking an LLM
        // to re-confirm WhatsApp registration or permission. The shared outbox still performs
        // CRM, WhatsApp-registration, opt-out, cooldown and daily-limit checks before sending.
        const message = approvedFirstContactMessage(h.context_summary, firstContactTarget);
        if (!message) throw new Error('Approved first-contact has no safe message or supported service fit in its verified prospect record.');
        acted = {
          clean: `Prepared the approved first-contact message for ${firstContactTarget.contact}.`,
          actions: [{ type: 'whatsapp' as const, to: firstContactTarget.phone, purpose: 'outreach' as const, contact: firstContactTarget.contact, text: message }],
          rejected: [],
        };
        result = acted.clean;
      } else {
        const raw = (await deps.askAgent(agent, prompt, contextPacket)).trim();
        const selfReview = raw.match(/^\s*SELF_REVIEW:\s*(PASS|BLOCKED)\s*(?:\r?\n|$)/i);
        const selfReviewedBody = raw.replace(/^\s*SELF_REVIEW:\s*(?:PASS|BLOCKED)\s*(?:\r?\n|$)/i, '').trim();
        acted = parseActions(selfReviewedBody);
        result = acted.clean.trim();
        if (automationIncident || discoveryQueueTask) {
          if (acted.actions.length || acted.rejected.length) throw new Error(automationIncident
            ? 'AI & Automation incident reviews are read-only; no actions are permitted.'
            : 'Discovery-queue research is read-only; no actions are permitted.');
          if (automationIncident && result.length < 120) throw new Error('AI & Automation returned no usable incident diagnosis.');
          // Discovery reports have a stricter deterministic field/source validator below;
          // a model-generated SELF_REVIEW prefix is redundant and was causing false failures.
        } else if (selfReview?.[1]?.toUpperCase() !== 'PASS' && !isFounderClarificationRequest(result)) {
          throw new Error(selfReview?.[1]?.toUpperCase() === 'BLOCKED'
            ? `Employee self-review blocked the deliverable: ${result.slice(0, 400)}`
            : 'Employee omitted the required SELF_REVIEW: PASS check; no actions were executed.');
        }
      }
      if (!result && autonomousFirstContact && firstContactTarget) result = `Prepared the first-contact WhatsApp action for ${firstContactTarget.contact}.`;
      if (!result) throw new Error('The employee returned no work product.');
      if (autonomousFirstContact && isFounderClarificationRequest(result)) throw new Error('Do not ask the Founder to confirm WhatsApp registration or first-contact permission; the approved destination is supplied and the shared outbox performs verification.');
      if (leaseLost) {
        outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: 'The worker lease was lost before action execution; work remains paused for safe recovery.', taskId, roomId: h.room_id ?? undefined });
        continue;
      }
      let actionsText = '';
      // This deterministic, CEO-authorised first-contact path enters the
      // autonomous WhatsApp outbox. All other actions wait for CEO acceptance below.
      if (autonomousFirstContact) {
        actionsText = await deps.actions.run({ agent, roleId: h.to_role_id, taskId, qualifiedProspectFirstContact: true }, acted.actions, acted.rejected);
        if (leaseLost) {
          outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: 'The worker lease was lost during action execution; verify side effects before resuming.', taskId, roomId: h.room_id ?? undefined });
          continue;
        }
      }
      if (autonomousFirstContact && /✘\s*whatsapp:.*Autonomous first-contact outreach requires a matching CRM lead with a verified WhatsApp number/i.test(actionsText)) {
        const reason = 'The supplied CRM number could not be verified as a WhatsApp-registered lead. No message was queued. Correct the CRM number or verify its WhatsApp registration before retrying.';
        const blockedResult = result + '\n\n' + actionsText;
        await deps.tasks.fail(taskId, reason, agent);
        await deps.store.update(h.id, { status: 'failed', result: blockedResult.slice(0, 8000), error: reason, completed_at: deps.now().toISOString() });
        if (h.room_id) {
          await deps.store.updateRoom(h.room_id, { status: 'blocked', deliverable: blockedResult.slice(0, 8000), blocker: reason, closed_at: null });
          await deps.store.roomEvent(h.room_id, 'room_blocked', 'ceo', { reason, attempt, manualCorrectionRequired: true });
        }
        outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'failed', reason, taskId, roomId: h.room_id ?? undefined });
        continue;
      }
      if (autonomousFirstContact && !confirmsQueuedOrSentAction(actionsText)) {
        throw new Error('The WhatsApp action did not confirm a queued or sent result; no first-contact message is recorded as complete.');
      }
      const stamp = await deps.sign({ roleId: h.to_role_id, kind: 'handoff_result', subjectId: h.id, content: result });
      let stamped = `${result}${actionsText ? `\n\n${actionsText}` : ''}\n\n${stamp.block}`;
      if (h.room_id) await deps.store.roomEvent(h.room_id, 'employee_deliverable_submitted', h.to_role_id, { response: result.slice(0, 8000), actions: actionsText || null });
      if (h.room_id) {
        await deps.store.updateRoom(h.room_id, { status: 'ready_for_review', deliverable: stamped.slice(0, 8000) });
        await deps.store.roomEvent(h.room_id, 'room_ready_for_review', h.to_role_id, { taskId });
      }
      // The approved first-contact is executed deterministically through the shared outbox.
      // Once that outbox returns an explicit positive queued/sent result, the action itself is
      // the acceptance evidence. Do not ask the LLM reviewer to re-interpret it or demand a
      // second JSON block in the employee's prose; that created false failures after enqueue.
      if (autonomousFirstContact && confirmsQueuedOrSentAction(actionsText)) {
        await deps.tasks.advance(taskId, [
          { status: 'returned_to_ceo', stage: 'review', eventType: 'department_work_returned', roleId: h.to_role_id, result: { handoffId: h.id, roomId: h.room_id, summary: stamped.slice(0, 8000), outboxConfirmed: true } },
          { status: 'completed', stage: 'complete', eventType: 'handoff_completed', roleId: 'ceo', completedAt: deps.now().toISOString() },
        ]);
        await deps.store.update(h.id, { status: 'completed', result: stamped.slice(0, 8000), completed_at: deps.now().toISOString(), error: null });
        if (h.room_id) {
          await deps.store.roomEvent(h.room_id, 'ceo_review_accepted', 'ceo', { taskId, acceptedBy: 'verified_outbox_result', result: actionsText });
          await deps.store.updateRoom(h.room_id, { status: 'archived', closed_at: deps.now().toISOString(), blocker: null });
          await deps.store.roomEvent(h.room_id, 'room_archived', 'ceo', { retained: true, acceptedBy: 'verified_outbox_result' });
        }
        outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'completed', taskId, roomId: h.room_id ?? undefined });
        continue;
      }
      const reviewPrompt = [
        'CEO REVIEW — you own acceptance of this delegated work.',
        'Review only whether the employee completed the exact request. Use the request and deliverable below; do not add facts or assume missing work was done.',
        'Return exactly one first-line decision: DECISION: ACCEPT, DECISION: REVISION_REQUIRED, or DECISION: SAFE_HOLD. Follow it with a short reason. Never request Founder input; use reasonable reversible assumptions or SAFE_HOLD.',
        `ORIGINAL REQUEST: ${h.request}`,
        `EMPLOYEE SELF-REVIEWED DELIVERABLE: ${stamped.slice(0, 3500)}`,
        `PROPOSED ACTIONS — NOT YET EXECUTED: ${JSON.stringify(acted.actions).slice(0, 1800)}`,
        `REJECTED OR UNPARSED ACTIONS: ${JSON.stringify(acted.rejected).slice(0, 500)}`,
        'Check the deliverable and proposed actions independently. Do not execute or authorize any action that exceeds the employee role, the original request, or the organisation delegated safety policy.',
        reviewRule,
      ].join('\n\n');
      const discoveryReview = ['lead-discovery-queue-watcher', 'lead-discovery-queue-research-review'].includes(h.source_duty_id ?? '')
        ? validateDiscoveryQueueDeliverable(h.context_summary, result)
        : null;
      const review = discoveryReview
        ? `DECISION: ${discoveryReview.ok ? 'ACCEPT' : 'REVISION_REQUIRED'}\n${discoveryReview.reason}`
        : automationIncident
          ? hasAutomationIncidentReport(result)
            ? 'DECISION: ACCEPT\nRead-only incident report passed evidence, diagnosis and next-step checks. No actions were permitted or executed.'
            : 'DECISION: REVISION_REQUIRED\nThe diagnostic report must clearly state observed evidence, diagnosis or hypotheses, and a safe next step. No production changes or actions are permitted.'
          : (await deps.askAgent('orchestrator', reviewPrompt, {})).trim();
      const decision = review.match(/^\s*(?:\*\*)?DECISION:\s*(ACCEPT|REVISION_REQUIRED|SAFE_HOLD)\b/im)?.[1];
      if (decision !== 'ACCEPT') {
        const reason = review.slice(0, 1500) || 'CEO review did not return a recognized decision.';
        const awaitingFounder = false;
        await deps.tasks.advance(taskId, [
          { status: awaitingFounder ? 'awaiting_founder' : 'needs_more_work', stage: awaitingFounder ? 'founder' : 'ceo', eventType: decision === 'REVISION_REQUIRED' ? 'ceo_revision_requested' : 'ceo_safe_hold', roleId: 'ceo', result: { handoffId: h.id, roomId: h.room_id, review: reason } },
        ]);
        const revisionExhausted = decision === 'SAFE_HOLD' || attempt >= MAX_HANDOFF_ATTEMPTS;
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
          await deps.store.roomEvent(h.room_id, awaitingFounder ? 'ceo_safe_hold' : 'ceo_revision_requested', 'ceo', { review: reason, attempt, maxAttempts: MAX_HANDOFF_ATTEMPTS });
        }
        outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: awaitingFounder ? 'waiting' : 'retry', reason, taskId, roomId: h.room_id ?? undefined });
        continue;
      }
      if (acted.actions.length || acted.rejected.length) {
        if (leaseLost) {
          outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: 'The worker lease was lost before approved actions could run; no actions were executed.', taskId, roomId: h.room_id ?? undefined });
          continue;
        }
        actionsText = await deps.actions.run({ agent, roleId: h.to_role_id, taskId }, acted.actions, acted.rejected);
        if (leaseLost) {
          outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'waiting', reason: 'The worker lease was lost during approved action execution; verify side effects before any retry.', taskId, roomId: h.room_id ?? undefined });
          continue;
        }
        if (/^\s*Actions:\s*[\s\S]*?^\s*✘/im.test(actionsText)) {
          const reason = 'The CEO accepted the work, but one or more requested actions failed or were rejected. The action result is recorded; do not replay automatically because partial side effects may have occurred.';
          stamped = `${result}\n\n${actionsText}\n\n${stamp.block}`;
          await deps.tasks.fail(taskId, reason, agent);
          await deps.store.update(h.id, { status: 'failed', result: stamped.slice(0, 8000), error: reason, completed_at: deps.now().toISOString() });
          if (h.room_id) {
            await deps.store.updateRoom(h.room_id, { status: 'blocked', deliverable: stamped.slice(0, 8000), blocker: reason, closed_at: null });
            await deps.store.roomEvent(h.room_id, 'approved_action_failed', 'ceo', { reason, actions: actionsText, noAutomaticReplay: true });
          }
          outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'failed', reason, taskId, roomId: h.room_id ?? undefined });
          continue;
        }
        stamped = `${result}\n\n${actionsText}\n\n${stamp.block}`;
        if (h.room_id) await deps.store.roomEvent(h.room_id, 'ceo_approved_actions_executed', 'ceo', { actions: actionsText });
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
      if (agent === 'research' && /free-models-per-day/i.test(message)) researchQuotaExhausted = true;
      // An uncertain outbox result must never be replayed automatically: the message may
      // already have been accepted by WhatsApp. Missing CRM destinations also need Founder
      // correction, not another identical attempt.
      const founderActionCheck = autonomousFirstContact && (
        /WhatsApp action did not confirm a queued or sent result/i.test(message)
        || /Approved first-contact is missing its CRM destination or verified organisation name/i.test(message)
        || /Autonomous first-contact outreach requires a matching CRM lead with a verified WhatsApp number/i.test(message)
        || /CRM\/WhatsApp verification service is unavailable/i.test(message)
      );
      if (founderActionCheck) {
        const reason = /missing its CRM destination/i.test(message)
          ? 'No message was queued: the CRM destination or verified organisation name is missing. This is a data-quality block; no Founder action is required. Retry only after the CRM record is corrected and requalified.'
          : /verified WhatsApp number/i.test(message)
            ? 'No message was queued: the CRM number is not verified as WhatsApp-registered. No Founder action is required; retry only after the CRM number is verified.'
            : /verification service is unavailable/i.test(message)
              ? 'No message was queued: the CRM/WhatsApp verification service is unavailable. No Founder action is required; retry after the service is restored.'
              : 'The outbox did not confirm queued or sent. Delivery is uncertain, so this attempt is failed and must not be retried until the outbox is reconciled.';
        await deps.tasks.advance(taskId, [
          { status: 'failed', stage: 'complete', eventType: 'first_contact_blocked_without_delivery', roleId: 'ceo', result: { handoffId: h.id, roomId: h.room_id, reason, messageQueued: false, automaticRetry: false } },
        ]);
        await deps.store.update(h.id, { status: 'failed', error: reason, completed_at: deps.now().toISOString() });
        if (h.room_id) {
          await deps.store.updateRoom(h.room_id, { status: 'failed', blocker: reason, closed_at: deps.now().toISOString() });
          await deps.store.roomEvent(h.room_id, 'first_contact_blocked_without_delivery', 'ceo', { reason, attempt, automaticRetry: false });
        }
        outcomes.push({ handoffId: h.id, toAgent: h.to_agent, status: 'failed', reason, taskId, roomId: h.room_id ?? undefined });
        continue;
      }
      const final = attempt >= MAX_HANDOFF_ATTEMPTS || isPermanentAgentFailure(message);
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
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
  return outcomes;
}
