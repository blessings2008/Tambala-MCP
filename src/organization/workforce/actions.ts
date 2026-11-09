import * as z from 'zod/v4';
import { splitBlocks } from './blocks.js';
import { itemInputSchema, partySchema, DOC_KINDS } from '../../documents/model.js';

/**
 * Real-world actions an employee can request at the end of their work. They are validated strictly and checked against
 * the employee's permissions. Customer-facing WhatsApp is held for Founder approval except a first-contact outreach message from the Sales & Business Development director, which may be sent autonomously only when the shared outbox verifies the destination as a CRM lead and enforces the Founder-approved daily cap, cooldown and opt-out rules.
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

/**
 * Extract complete JSON values from the ACTIONS block. Models sometimes wrap
 * actions in Markdown fences, emit pretty-printed multi-line objects, or return
 * a JSON array. Accept those harmless formatting variations while keeping the
 * action schema and per-agent permission checks strict.
 */
function extractActionValues(source: string): { values: unknown[]; rejected: string[] } {
  const text = source
    .replace(/^﻿/, '')
    .replace(/^```(?:json)?\s*$/gim, '')
    .trim();
  const values: unknown[] = [];
  const rejected: string[] = [];
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && !'{['.includes(text[cursor])) cursor += 1;
    if (cursor >= text.length) break;
    const start = cursor;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (; cursor < text.length; cursor += 1) {
      const ch = text[cursor];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') {
        const open = stack.pop();
        if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) break;
        if (stack.length === 0) {
          const raw = text.slice(start, cursor + 1);
          spans.push([start, cursor + 1]);
          try {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) values.push(...parsed);
            else values.push(parsed);
          } catch {
            rejected.push(`Invalid JSON: ${raw.slice(0, 60)}`);
          }
          cursor += 1;
          break;
        }
      }
    }
    if (cursor >= text.length && stack.length > 0) {
      spans.push([start, text.length]);
      rejected.push(`Invalid JSON: ${text.slice(start, start + 60)}`);
      break;
    }
  }
  let residueText = text;
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) {
    residueText = residueText.slice(0, start) + residueText.slice(end);
  }
  const residueLines = residueText.split('\n')
    .map((line) => line.replace(/^[\\s,;:_*\\-\\u0060]+|[\\s,;:_*\\-\\u0060]+$/g, '').trim())
    .filter((line) => line && !/^(?:none|no actions?)(?:\\.|!)?$/i.test(line));
  for (const line of residueLines) rejected.push(`Not JSON: ${line.slice(0, 60)}`);
  return { values, rejected };
}

/** Accept one object per line, pretty JSON, fenced JSON and arrays; invalid entries remain visible. */
export function parseActions(body: string): ParsedActions {
  const { clean, blocks } = splitBlocks(body);
  const actions: Action[] = [];
  const rejected: string[] = [];
  if (blocks.ACTIONS !== undefined) {
    const extracted = extractActionValues(blocks.ACTIONS);
    rejected.push(...extracted.rejected);
    for (const json of extracted.values) {
      const parsed = actionSchema.safeParse(json);
      if (!parsed.success) {
        const type = json && typeof json === 'object' && 'type' in json ? String((json as { type?: unknown }).type) : 'action';
        rejected.push(`${type}: ${parsed.error.issues[0]?.message ?? 'invalid'}`.slice(0, 120));
        continue;
      }
      if (actions.length >= MAX_ACTIONS_PER_RUN) {
        rejected.push(`Over the limit of ${MAX_ACTIONS_PER_RUN} actions per run.`);
        continue;
      }
      actions.push(parsed.data);
    }
  }
  const hasBlocks = blocks.ACTIONS !== undefined || blocks.HANDOFFS !== undefined;
  return { clean: hasBlocks ? clean : body, actions, rejected };
}

/** Text added to an employee's prompt describing what they may request. Only lists what they are allowed to do. */
export function actionHelp(agent: string): string {
  const allowed = allowedActionTypes(agent);
  const lines = [
    'You can request real actions by ending your answer with a heading line ACTIONS: followed by one JSON object per line; fenced JSON and a JSON array are also accepted. First-contact outreach may be sent autonomously only for the Sales & Business Development director and only after the shared outbox verifies the destination as a CRM lead. All follow-ups, replies, invoice reminders and other customer-facing messages remain subject to Founder approval.',
    'Use only phone numbers, names, prices and links that appear in the supplied data. Never invent them. If something you need is missing, say so in your answer instead of guessing.',
  ];
  if (allowed.includes('notify_founder')) lines.push('- Message the Founder: {"type":"notify_founder","text":"..."}  (only when he genuinely needs to know or decide something).');
  if (allowed.includes('whatsapp')) lines.push('- WhatsApp a customer: {"type":"whatsapp","to":"+265...","purpose":"outreach|followup","contact":"Name","text":"..."}  (short, polite, specific; no pressure).');
  if (allowed.includes('document')) lines.push('- Prepare a PDF: {"type":"document","kind":"quotation|invoice|letter|receipt","client":{"name":"...","phone":"..."},"items":[{"sku":"PRICE-LIST-SKU","quantity":1}],"subject":"...","notes":"...","sendTo":"+265...","message":"covering note"}  (items come from the price list by sku; a custom line needs {"description","quantity","unitPrice"} and is flagged for review; letters use "body" instead of items).');
  if (allowed.includes('invoice_link')) lines.push('- Create a payment link: {"type":"invoice_link","client":{"name":"...","phone":"..."},"description":"...","amount":0,"withPdf":true,"sendTo":"+265...","message":"..."}  (amount in MWK, from verified records only).');
  return lines.join('\n');
}
