import { localTime, toMinutes, type LocalTime } from '../organization/workforce/schedule.js';

/**
 * Who may message whom, and when. Pure functions so the rules are easy to read and test.
 * Customers only ever hear from Tambala after the Founder approves; the Founder can be messaged by anyone.
 */
export type Purpose = 'outreach' | 'followup' | 'invoice' | 'document' | 'notify_founder' | 'reply';
export type Audience = 'founder' | 'client';

/** Agents allowed to write to clients and prospects. Everyone else may only message the Founder. */
export const CLIENT_FACING_AGENTS: ReadonlySet<string> = new Set(['outreach', 'followup', 'finance', 'payments']);

export const MAX_TEXT = 1500;
export const SEND_WINDOW = { open: '07:30', close: '19:30' } as const; // office time, Monday to Saturday

export const FOUNDER_DAILY_LIMIT = () => Number(process.env.TAMBALA_WHATSAPP_FOUNDER_DAILY_LIMIT) || 40;
export const CLIENT_DAILY_LIMIT = () => Math.min(5, Math.max(1, Number(process.env.TAMBALA_WHATSAPP_DAILY_LIMIT) || 5));

export function sendWindowOpen(now: Date): boolean {
  const lt: LocalTime = localTime(now);
  return lt.weekday <= 6 && lt.minutes >= toMinutes(SEND_WINDOW.open) && lt.minutes < toMinutes(SEND_WINDOW.close);
}

export interface PolicyInput { to: string; purpose: Purpose; agent: string | 'founder'; text: string; hasDocument: boolean }
export interface PolicyState { founderNumber: string | null; blocked: ReadonlySet<string> }
export type Verdict =
  | { verdict: 'allow_now'; audience: Audience }
  | { verdict: 'needs_approval'; audience: Audience }
  | { verdict: 'block'; audience: Audience; reason: string };

export function validateText(text: string): string | null {
  const t = text.trim();
  if (t.length < 2) return 'The message is empty.';
  if (t.length > MAX_TEXT) return `The message is longer than ${MAX_TEXT} characters.`;
  if ((t.match(/https?:\/\//gi) ?? []).length > 2) return 'Too many links in one message.';
  return null;
}

export function decide(input: PolicyInput, state: PolicyState): Verdict {
  const audience: Audience = state.founderNumber && input.to === state.founderNumber ? 'founder' : 'client';
  const bad = validateText(input.text);
  if (bad) return { verdict: 'block', audience, reason: bad };
  if (audience === 'founder') return { verdict: 'allow_now', audience };
  if (state.blocked.has(input.to)) return { verdict: 'block', audience, reason: 'This number opted out or is on the do-not-contact list.' };
  if (input.agent !== 'founder' && !CLIENT_FACING_AGENTS.has(input.agent)) return { verdict: 'block', audience, reason: `The ${input.agent} role may only message the Founder.` };
  if (input.purpose === 'notify_founder') return { verdict: 'block', audience, reason: 'notify_founder must go to the Founder number.' };
  return { verdict: 'needs_approval', audience };
}

/** Recognise clear opt-out requests without mistaking ordinary objections for consent withdrawal. */
export const OPT_OUT_PATTERN = /^\s*(?:(?:stop|unsubscribe|opt[\s-]?out|cancel|end|quit)|(?:please\s+)?(?:stop|cease)\s+(?:messaging|contacting|texting|calling|sending(?:\s+me)?(?:\s+messages?)?)(?:\s+me)?(?:\s+again)?|(?:do\s+not|don't|dont)\s+(?:message|contact|text)\s+me(?:\s+again)?|remove\s+me\s+from\s+(?:your\s+)?(?:list|mailing\s+list)|no\s+more\s+(?:messages|texts|calls))\s*[.!]*\s*$/i;
