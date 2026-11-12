import { supabaseDelete, supabaseSelect } from '../../lib/supabase.js';
import { AGENT_DIRECTORY, type AgentName } from '../../services/ai/models.js';
import { STANDING_DUTIES, type ContextKind, type StandingDuty } from './duties.js';
import { dbConfigured, NeedsDatabaseError, upsertByKey } from './db-util.js';
import { toMinutes, type Cadence } from './schedule.js';

export class DutyConfigError extends Error {}

export interface DutyOverride { duty_id: string; enabled: boolean; time: string | null; job: string | null; deliverable: string | null }
export interface CustomDutyRow {
  id: string; agent: string; title: string; cadence_kind: 'weekdays' | 'weekly'; cadence_day: number | null; time: string;
  contexts: string[]; job: string; deliverable: string; requires_approval: boolean; enabled: boolean;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CUSTOM_CONTEXTS: readonly ContextKind[] = ['crm', 'company', 'organization', 'catalog', 'invoices', 'customer_support'];
const text = (v: unknown, min: number, max: number, label: string): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw new DutyConfigError(`${label} must be ${min} to ${max} characters.`);
  return s;
};

export function slugify(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

export function validateOverride(dutyId: string, input: unknown): DutyOverride {
  if (!STANDING_DUTIES.some((d) => d.id === dutyId)) throw new DutyConfigError('Unknown built-in duty.');
  const o = (input ?? {}) as Record<string, unknown>;
  const time = o.time === undefined || o.time === null || o.time === '' ? null : String(o.time);
  if (time !== null && !TIME.test(time)) throw new DutyConfigError('Time must look like 08:30.');
  const job = o.job === undefined || o.job === null || String(o.job).trim() === '' ? null : text(o.job, 10, 2000, 'Job');
  const deliverable = o.deliverable === undefined || o.deliverable === null || String(o.deliverable).trim() === '' ? null : text(o.deliverable, 5, 1000, 'Deliverable');
  return { duty_id: dutyId, enabled: o.enabled !== false, time, job, deliverable };
}

export function validateCustomDuty(input: unknown, takenIds: ReadonlySet<string>, editingId?: string): CustomDutyRow {
  const o = (input ?? {}) as Record<string, unknown>;
  const title = text(o.title, 3, 120, 'Title');
  const agent = String(o.agent ?? '');
  if (!(agent in AGENT_DIRECTORY)) throw new DutyConfigError('Choose an existing employee.');
  const cadence = (o.cadence ?? {}) as { kind?: unknown; day?: unknown };
  let cadence_kind: 'weekdays' | 'weekly'; let cadence_day: number | null = null;
  if (cadence.kind === 'weekdays') cadence_kind = 'weekdays';
  else if (cadence.kind === 'weekly') {
    cadence_kind = 'weekly'; cadence_day = Number(cadence.day);
    if (!Number.isInteger(cadence_day) || cadence_day < 1 || cadence_day > 7) throw new DutyConfigError('Choose a day of the week.');
  } else throw new DutyConfigError('Choose weekdays or weekly.');
  const time = String(o.time ?? '');
  if (!TIME.test(time)) throw new DutyConfigError('Time must look like 08:30.');
  if (toMinutes(time) < 6 * 60 || toMinutes(time) > 20 * 60) throw new DutyConfigError('Pick a time between 06:00 and 20:00 office time.');
  const contexts = Array.isArray(o.contexts) ? [...new Set(o.contexts.map(String))] : [];
  // Only the CEO may consume the internal briefing feed when preparing consolidated meeting minutes.
  const allowedContexts = agent === 'orchestrator' ? [...CUSTOM_CONTEXTS, 'briefing' as ContextKind] : CUSTOM_CONTEXTS;
  if (contexts.some((c) => !allowedContexts.includes(c as ContextKind))) throw new DutyConfigError('Unknown data source.');
  let id = editingId;
  if (!id) {
    const base = slugify(title);
    if (base.length < 3) throw new DutyConfigError('Title needs at least three letters or digits.');
    id = base; for (let n = 2; takenIds.has(id); n += 1) id = `${base}-${n}`;
  }
  return { id, agent, title, cadence_kind, cadence_day, time, contexts, job: text(o.job, 10, 2000, 'Job'), deliverable: text(o.deliverable, 5, 1000, 'Deliverable'), requires_approval: o.requiresApproval === true, enabled: o.enabled !== false };
}

export function resolveDuties(overrides: DutyOverride[], customs: CustomDutyRow[]): StandingDuty[] {
  const byId = new Map(overrides.map((o) => [o.duty_id, o]));
  const builtins = STANDING_DUTIES.map((d): StandingDuty => {
    const o = byId.get(d.id);
    if (!o) return { ...d, enabled: true, custom: false, edited: false };
    return { ...d, time: o.time ?? d.time, job: o.job ?? d.job, deliverable: o.deliverable ?? d.deliverable, enabled: o.enabled, custom: false, edited: !o.enabled || o.time !== null || o.job !== null || o.deliverable !== null };
  });
  const custom = customs.map((c): StandingDuty => ({
    id: c.id, agent: c.agent as AgentName, title: c.title,
    cadence: (c.cadence_kind === 'weekly' ? { kind: 'weekly', day: c.cadence_day ?? 1 } : { kind: 'weekdays' }) as Cadence,
    time: c.time, contexts: c.contexts as ContextKind[], job: c.job, deliverable: c.deliverable,
    approval: c.requires_approval ? { actionType: 'prepared_work', riskLevel: 'low', summary: 'Prepared work awaiting Founder approval' } : undefined,
    custom: true, enabled: c.enabled, edited: false,
  }));
  return [...builtins, ...custom];
}

export interface DutyConfigStore {
  overrides(): Promise<DutyOverride[]>;
  customs(): Promise<CustomDutyRow[]>;
  saveOverride(o: DutyOverride): Promise<void>;
  saveCustom(c: CustomDutyRow): Promise<void>;
  deleteCustom(id: string): Promise<void>;
}

export class SupabaseDutyConfigStore implements DutyConfigStore {
  overrides() { return supabaseSelect<DutyOverride>('organization_duty_config', 'select=duty_id,enabled,time,job,deliverable'); }
  customs() { return supabaseSelect<CustomDutyRow>('organization_custom_duties', 'select=id,agent,title,cadence_kind,cadence_day,time,contexts,job,deliverable,requires_approval,enabled&order=created_at.asc'); }
  async saveOverride(o: DutyOverride) { await upsertByKey('organization_duty_config', 'duty_id', o.duty_id, { enabled: o.enabled, time: o.time, job: o.job, deliverable: o.deliverable, updated_at: new Date().toISOString() }); }
  async saveCustom(c: CustomDutyRow) { const { id, ...rest } = c; await upsertByKey('organization_custom_duties', 'id', id, rest as unknown as Record<string, unknown>); }
  async deleteCustom(id: string) { await supabaseDelete('organization_custom_duties', `id=eq.${encodeURIComponent(id)}`); }
}

export class InMemoryDutyConfigStore implements DutyConfigStore {
  o = new Map<string, DutyOverride>(); c = new Map<string, CustomDutyRow>();
  async overrides() { return [...this.o.values()]; }
  async customs() { return [...this.c.values()]; }
  async saveOverride(o: DutyOverride) { this.o.set(o.duty_id, o); }
  async saveCustom(c: CustomDutyRow) { this.c.set(c.id, c); }
  async deleteCustom(id: string) { this.c.delete(id); }
}

export async function loadDuties(store: DutyConfigStore | null): Promise<StandingDuty[]> {
  if (!store) return resolveDuties([], []);
  return resolveDuties(await store.overrides(), await store.customs());
}

/** Config edits need a database, otherwise they would silently vanish on restart. */
export function requireConfigStore(): DutyConfigStore {
  if (!dbConfigured()) throw new NeedsDatabaseError('Editing duties');
  return new SupabaseDutyConfigStore();
}

export async function saveBuiltinOverride(store: DutyConfigStore, dutyId: string, input: unknown): Promise<void> {
  await store.saveOverride(validateOverride(dutyId, input));
}

export async function saveCustomDuty(store: DutyConfigStore, input: unknown, editingId?: string): Promise<CustomDutyRow> {
  const existing = await store.customs();
  const taken = new Set([...STANDING_DUTIES.map((d) => d.id), ...existing.map((c) => c.id)]);
  if (editingId && !existing.some((c) => c.id === editingId)) throw new DutyConfigError('That custom duty no longer exists.');
  const row = validateCustomDuty(input, taken, editingId);
  await store.saveCustom(row);
  return row;
}
