import * as z from 'zod/v4';
import { splitBlocks } from './blocks.js';
import { itemInputSchema, partySchema, DOC_KINDS } from '../../documents/model.js';

/**
 * Real-world actions an employee can request at the end of their work. They are validated strictly and checked against
 * the employee's permissions. Anything customer-facing is held for the Founder's approval by the messaging layer.
 */
const phone = z.string().trim().min(8).max(30);
const msg = z.string().trim().min(2).max(1500);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('whatsapp'), to: phone, text: msg, purpose: z.enum(['outreach', 'followup', 'reply']).default('followup'), contact: z.string().trim().max(120).optional() }),
  z.object({ type: z.literal('notify_founder'), text: msg }),
  z.object({
    type: z.literal('document'), kind: z.enum(DOC_KINDS).default('quotation'), client: partySchema, items: z.array(itemInputSchema).max(40).default([]),
    subject: z.string().trim().max(160).optional(), body: z.string().trim().max(4000).optional(), notes: z.string().trim().max(1500).optional(),
    terms: z.string().trim().max(2000).optional(), validityDays: z.number().int().min(1).max(365).optional(),
    sendTo: phone.optional(), message: msg.optional(),
  }),
  z.object({
    type: z.literal('invoice_link'), client: partySchema, description: z.string().trim().min(3).max(180), amount: z.number().positive().max(100_000_000),
    withPdf: z.boolean().default(false), sendTo: phone.optional(), message: msg.optional(),
  }),
]);
export type Action = z.infer<typeof actionSchema>;

export const MAX_ACTIONS_PER_RUN = 5;
const CLIENT_AGENTS = new Set(['outreach', 'followup', 'finance', 'payments']);
const DOC_AGENTS = new Set(['outreach', 'followup', 'finance', 'payments', 'marketing', 'legal', 'orchestrator']);
const INVOICE_AGENTS = new Set(['finance', 'payments']);

export function allowedActionTypes(agent: string): Action['type'][] {
  const out: Action['type'][] = ['notify_founder'];
  if (CLIENT_AGENTS.has(agent)) out.push('whatsapp');
  if (DOC_AGENTS.has(agent)) out.push('document');
  if (INVOICE_AGENTS.has(agent)) out.push('invoice_link');
  return out;
}

export function mayDo(agent: string, action: Action): string | null {
  if (!allowedActionTypes(agent).includes(action.type)) return `${agent} is not allowed to use "${action.type}".`;
  if (action.type === 'document' && action.sendTo && !CLIENT_AGENTS.has(agent)) return `${agent} may create documents but not send them to customers.`;
  if (action.type === 'invoice_link' && action.sendTo && !CLIENT_AGENTS.has(agent)) return `${agent} may not send invoices to customers.`;
  return null;
}

export interface ParsedActions { clean: string; actions: Action[]; rejected: string[] }

/** One JSON object per line inside the ACTIONS block. Bad lines are reported, never silently dropped. */
export function parseActions(body: string): ParsedActions {
  const { clean, blocks } = splitBlocks(body);
  const actions: Action[] = []; const rejected: string[] = [];
  for (const line of (blocks.ACTIONS ?? '').split('\n')) {
    const raw = line.trim().replace(/^[-*]\s*/, '');
    if (!raw || raw.toLowerCase() === 'none') continue;
    if (!raw.startsWith('{')) { rejected.push(`Not JSON: ${raw.slice(0, 60)}`); continue; }
    let json: unknown;
    try { json = JSON.parse(raw); } catch { rejected.push(`Invalid JSON: ${raw.slice(0, 60)}`); continue; }
    const parsed = actionSchema.safeParse(json);
    if (!parsed.success) { rejected.push(`${(json as { type?: string }).type ?? 'action'}: ${parsed.error.issues[0]?.message ?? 'invalid'}`.slice(0, 120)); continue; }
    if (actions.length >= MAX_ACTIONS_PER_RUN) { rejected.push(`Over the limit of ${MAX_ACTIONS_PER_RUN} actions per run.`); continue; }
    actions.push(parsed.data);
  }
  const hasBlocks = blocks.ACTIONS !== undefined || blocks.HANDOFFS !== undefined;
  return { clean: hasBlocks ? clean : body, actions, rejected };
}

/** Text added to an employee's prompt describing what they may request. Only lists what they are allowed to do. */
export function actionHelp(agent: string): string {
  const allowed = allowedActionTypes(agent);
  const lines = [
    'You can request real actions by ending your answer with a heading line ACTIONS: followed by one JSON object per line (no code fences). Customer-facing items are held for the Founder to approve; nothing reaches a customer without that.',
    'Use only phone numbers, names, prices and links that appear in the supplied data. Never invent them. If something you need is missing, say so in your answer instead of guessing.',
  ];
  if (allowed.includes('notify_founder')) lines.push('- Message the Founder: {"type":"notify_founder","text":"..."}  (only when he genuinely needs to know or decide something).');
  if (allowed.includes('whatsapp')) lines.push('- WhatsApp a customer: {"type":"whatsapp","to":"+265...","purpose":"outreach|followup","contact":"Name","text":"..."}  (short, polite, specific; no pressure).');
  if (allowed.includes('document')) lines.push('- Prepare a PDF: {"type":"document","kind":"quotation|invoice|letter|receipt","client":{"name":"...","phone":"..."},"items":[{"sku":"PRICE-LIST-SKU","quantity":1}],"subject":"...","notes":"...","sendTo":"+265...","message":"covering note"}  (items come from the price list by sku; a custom line needs {"description","quantity","unitPrice"} and is flagged for review; letters use "body" instead of items).');
  if (allowed.includes('invoice_link')) lines.push('- Create a payment link: {"type":"invoice_link","client":{"name":"...","phone":"..."},"description":"...","amount":0,"withPdf":true,"sendTo":"+265...","message":"..."}  (amount in MWK, from verified records only).');
  return lines.join('\n');
}
