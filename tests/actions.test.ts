import test from 'node:test';
import assert from 'node:assert/strict';
import { actionHelp, allowedActionTypes, mayDo, parseActions, MAX_ACTIONS_PER_RUN, type Action } from '../src/organization/workforce/actions.ts';
import { describeResults, executeActions, type ActionExecDeps } from '../src/organization/workforce/actions-exec.ts';
import { extractHandoffs } from '../src/organization/workforce/handoffs.ts';
import { splitBlocks } from '../src/organization/workforce/blocks.ts';
import { InMemoryMessageStore } from '../src/channels/message-store.ts';
import type { OutboxDeps } from '../src/channels/outbox.ts';
import { runDuty, buildDutyPrompt, type DutyDeps } from '../src/organization/workforce/duty-runner.ts';
import { resolveDuties } from '../src/organization/workforce/duty-config.ts';
import { InMemoryDutyStore } from '../src/organization/workforce/duty-store.ts';
import { localTime } from '../src/organization/workforce/schedule.ts';

const FOUNDER = '265999000111';
const WA = '{"type":"whatsapp","to":"+265888123456","purpose":"followup","contact":"Lakeview Lodge","text":"Hello, checking in on the website."}';

test('blocks are split out of the visible work in any order', () => {
  const body = `Here is my work.\n\nHANDOFFS:\n- to: marketing | task: Prepare a one-page overview for lodges\nACTIONS:\n${WA}\n`;
  const { clean, blocks } = splitBlocks(body);
  assert.equal(clean, 'Here is my work.'); assert.match(blocks.HANDOFFS!, /marketing/); assert.match(blocks.ACTIONS!, /whatsapp/);
  const reversed = splitBlocks(`Work.\nACTIONS:\n${WA}\nHANDOFFS:\n- to: finance | task: Check whether the deposit arrived\n`);
  assert.match(reversed.blocks.HANDOFFS!, /finance/); assert.match(reversed.blocks.ACTIONS!, /whatsapp/);
  assert.equal(extractHandoffs(`Work.\nACTIONS:\n${WA}\nHANDOFFS:\n- to: finance | task: Check whether the deposit arrived\n`, 'outreach').handoffs[0].toAgent, 'finance');
  assert.equal(splitBlocks('**ACTIONS:**\n{"type":"notify_founder","text":"hi"}').blocks.ACTIONS!.trim(), '{"type":"notify_founder","text":"hi"}');
});

test('actions parse strictly; bad lines are reported, never silently dropped', () => {
  const p = parseActions(`Done.\nACTIONS:\n${WA}\n- {"type":"notify_founder","text":"Lakeview replied"}\nnone\nplease send a message\n{"type":"whatsapp","to":"+265888123456"}\n{not json}\n{"type":"teleport","to":"mars"}\n{"type":"invoice_link","client":{"name":"A"},"description":"x","amount":-5}`);
  assert.equal(p.clean, 'Done.');
  assert.deepEqual(p.actions.map((a) => a.type), ['whatsapp', 'notify_founder']);
  assert.equal(p.rejected.length, 5);
  assert.ok(p.rejected.some((r) => /Not JSON/.test(r)) && p.rejected.some((r) => /Invalid JSON/.test(r)));
  const many = parseActions(`ACTIONS:\n${Array.from({ length: 8 }, () => '{"type":"notify_founder","text":"ping"}').join('\n')}`);
  assert.equal(many.actions.length, MAX_ACTIONS_PER_RUN); assert.match(many.rejected.at(-1)!, /limit/);
  assert.equal(parseActions('Just text, no blocks.').clean, 'Just text, no blocks.');
});

test('actions accept fenced, pretty-printed and array-form JSON without weakening validation', () => {
  const fenced = parseActions(`Work completed.
ACTIONS:
\`\`\`json
{
  "type": "notify_founder",
  "text": "The board report is ready."
}
\`\`\`
`);
  assert.equal(fenced.actions.length, 1);
  assert.equal(fenced.actions[0].type, 'notify_founder');
  assert.deepEqual(fenced.rejected, []);

  const array = parseActions(`Work completed.
ACTIONS:
[
  {"type":"notify_founder","text":"First update"},
  {"type":"notify_founder","text":"Second update"}
]
`);
  assert.equal(array.actions.length, 2);
  assert.deepEqual(array.rejected, []);

  const mixed = parseActions(`Work completed.
ACTIONS:
\`\`\`json
[
  {"type":"notify_founder","text":"Valid action"},
  {"type":"teleport","to":"mars"}
]
\`\`\`
`);
  assert.equal(mixed.actions.length, 1);
  assert.equal(mixed.rejected.length, 1);
  assert.match(mixed.rejected[0], /teleport/);
});

test('permissions: only the right roles may message customers, make documents and create payment links', () => {
  assert.deepEqual(allowedActionTypes('security'), ['notify_founder']);
  assert.deepEqual(allowedActionTypes('outreach'), ['notify_founder', 'whatsapp', 'document']);
  assert.deepEqual(allowedActionTypes('finance'), ['notify_founder', 'whatsapp', 'document', 'invoice_link']);
  const wa = parseActions(`ACTIONS:\n${WA}`).actions[0];
  assert.ok(mayDo('security', wa)); assert.equal(mayDo('followup', wa), null);
  const doc = { type: 'document', kind: 'quotation', client: { name: 'A' }, items: [], sendTo: '+265888123456' } as unknown as Action;
  assert.match(mayDo('marketing', doc)!, /not .*send/); assert.equal(mayDo('outreach', doc), null);
  assert.match(actionHelp('security'), /notify_founder/); assert.doesNotMatch(actionHelp('security'), /whatsapp|invoice_link/);
  assert.match(actionHelp('finance'), /invoice_link/);
});

function harness(over: Partial<ActionExecDeps> & { founder?: string | null } = {}) {
  const store = new InMemoryMessageStore(); const approvals: any[] = []; const docs: any[] = []; const invoices: any[] = [];
  const outbox: OutboxDeps = {
    store, now: () => new Date('2026-11-09T08:00:00Z'), founderNumber: () => (over.founder === undefined ? FOUNDER : over.founder),
    transport: { configured: () => true, sendText: async () => ({ id: 'x' }), sendDocument: async () => ({ id: 'x' }) },
    loadDocument: async () => ({ base64: 'JVBERi0=', fileName: 'x.pdf' }), verifyOutreachLead: async () => 'Lakeview Lodge (lead)', sign: async () => ({ block: '— sig', fingerprint: 'AAAA-BBBB-CCCC-DDDD' }),
    approvals: { create: async (a) => { approvals.push(a); return `abcdef12-0000-4000-8000-00000000000${approvals.length}`; } }, senderLabel: (r) => r, pauseMs: 0,
  };
  const deps: ActionExecDeps = {
    outbox, founderNumber: outbox.founderNumber,
    createDocument: async (input) => { docs.push(input); return { id: `doc-${docs.length}`, number: `TT-Q-2026-000${docs.length}`, total_minor: 79802500, hasCustomLines: JSON.stringify(input).includes('unitPrice') }; },
    createInvoice: async (input) => { invoices.push(input); return { created: true, invoice: { id: 'i1', idempotency_key: 'k', pay_invoice_id: 'inv_1', link: 'https://pay.example/c/1', amount_minor: Math.round(input.amount * 100), currency: 'MWK', client_name: input.clientName, client_phone: null, client_email: null, description: input.description, status: 'unpaid', created_by_role_id: input.roleId, signature: null, created_at: '', status_checked_at: null } }; },
    ...over,
  };
  return { deps, store, approvals, docs, invoices };
}
const ctx = (agent: string) => ({ agent, roleId: agent === 'finance' ? 'director-finance-accounting' : 'director-sales-business-development', taskId: 't1' });
const parse = (...lines: string[]) => parseActions(`ACTIONS:\n${lines.join('\n')}`).actions;

test('a whatsapp action waits for approval, and an unauthorised role is refused', async () => {
  const h = harness();
  const [r] = await executeActions(h.deps, ctx('outreach'), parse(WA));
  assert.equal(r.ok, true); assert.match(r.detail, /awaiting Founder approval/);
  assert.equal(h.store.rows.filter((m) => m.number === '265888123456')[0].status, 'pending_approval');
  const [denied] = await executeActions(h.deps, ctx('security'), parse(WA));
  assert.equal(denied.ok, false); assert.match(denied.detail, /not allowed/);
  const [bad] = await executeActions(h.deps, ctx('outreach'), parse(WA.replace('+265888123456', 'call me please')));
  assert.equal(bad.ok, false); assert.match(bad.detail, /not a valid phone number/);
});

test('first-contact outreach action reports queued status, not Founder approval', async () => {
  const h = harness();
  const outreach = parse(WA.replace('"purpose":"followup"', '"purpose":"outreach"'));
  const [r] = await executeActions(h.deps, ctx('outreach'), outreach);
  assert.equal(r.ok, true);
  assert.match(r.detail, /queued for sending; delivery is not confirmed yet/i);
  assert.doesNotMatch(r.detail, /waiting for the Founder|awaiting Founder approval/i);
  assert.equal(h.store.rows.find((m) => m.number === '265888123456')?.status, 'queued');
});

test('notify_founder reaches the Founder immediately, and says so honestly when no number is set', async () => {
  const h = harness();
  const [ok] = await executeActions(h.deps, ctx('security'), parse('{"type":"notify_founder","text":"Three denied calls overnight."}'));
  assert.equal(ok.ok, true); assert.equal(h.store.rows[0].status, 'queued'); assert.equal(h.store.rows[0].number, FOUNDER);
  const none = harness({ founder: null });
  const [r] = await executeActions(none.deps, ctx('security'), parse('{"type":"notify_founder","text":"Hello"}'));
  assert.equal(r.ok, false); assert.match(r.detail, /TAMBALA_FOUNDER_WHATSAPP/);
});

test('documents: without sendTo the PDF goes to the Founder; with sendTo it also waits for approval; custom lines are flagged', async () => {
  const h = harness();
  const [a] = await executeActions(h.deps, ctx('outreach'), parse('{"type":"document","kind":"quotation","client":{"name":"Lakeview Lodge"},"items":[{"sku":"WEB-STD","quantity":1}]}'));
  assert.equal(a.ok, true); assert.match(a.detail, /sent to the Founder/);
  const toFounder = h.store.rows.find((m) => m.document_id === 'doc-1')!; assert.equal(toFounder.number, FOUNDER); assert.equal(toFounder.status, 'queued');
  const [b] = await executeActions(h.deps, ctx('outreach'), parse('{"type":"document","kind":"quotation","client":{"name":"Lakeview Lodge"},"items":[{"description":"Logo","quantity":1,"unitPrice":150000}],"sendTo":"0888123456"}'));
  assert.equal(b.ok, true); assert.match(b.detail, /awaits the Founder/); assert.match(b.detail, /custom-priced/);
  const toClient = h.store.rows.find((m) => m.number === '265888123456')!; assert.equal(toClient.status, 'pending_approval'); assert.equal(toClient.document_id, 'doc-2');
  const [c] = await executeActions(h.deps, ctx('marketing'), parse('{"type":"document","kind":"letter","client":{"name":"A"},"body":"Hello there","sendTo":"0888123456"}'));
  assert.equal(c.ok, false); assert.match(c.detail, /may create documents but not send/);
  const err = harness({ createDocument: async () => { throw new (await import('../src/documents/service.ts')).DocumentError('"ZZZ" is not in the price list.'); } });
  const [d] = await executeActions(err.deps, ctx('outreach'), parse('{"type":"document","kind":"quotation","client":{"name":"A"},"items":[{"sku":"ZZZ"}]}'));
  assert.equal(d.ok, false); assert.match(d.detail, /not in the price list/);
});

test('invoice links: finance gets a link and the client message waits for approval; no link means no message', async () => {
  const h = harness();
  const [r] = await executeActions(h.deps, ctx('finance'), parse('{"type":"invoice_link","client":{"name":"Chikondi","phone":"0888123456"},"description":"Website deposit","amount":200000,"withPdf":true,"sendTo":"0888123456"}'));
  assert.equal(r.ok, true); assert.match(r.detail, /awaits the Founder/);
  assert.equal(h.docs[0].kind, 'invoice'); assert.equal(h.docs[0].paymentLink, 'https://pay.example/c/1');
  const msg = h.store.rows.find((m) => m.number === '265888123456')!;
  assert.match(msg.text, /MWK 200,000\.00/); assert.match(msg.text, /https:\/\/pay\.example\/c\/1/); assert.equal(msg.document_id, 'doc-1'); assert.equal(msg.status, 'pending_approval');
  const [denied] = await executeActions(h.deps, ctx('outreach'), parse('{"type":"invoice_link","client":{"name":"A"},"description":"x y z","amount":10}'));
  assert.match(denied.detail, /not allowed/);
  const nolink = harness({ createInvoice: async (i) => ({ created: true, invoice: { id: 'i', idempotency_key: 'k', pay_invoice_id: 'inv_7', link: null, amount_minor: 1, currency: 'MWK', client_name: i.clientName, client_phone: null, client_email: null, description: i.description, status: 'unpaid', created_by_role_id: '', signature: null, created_at: '', status_checked_at: null } }) });
  const [n] = await executeActions(nolink.deps, ctx('finance'), parse('{"type":"invoice_link","client":{"name":"A"},"description":"thing","amount":10,"sendTo":"0888123456"}'));
  assert.equal(n.ok, false); assert.match(n.detail, /no checkout link/); assert.equal(nolink.store.rows.filter((m) => m.number === '265888123456').length, 0);
  const [self] = await executeActions(h.deps, ctx('finance'), parse('{"type":"invoice_link","client":{"name":"Chikondi"},"description":"Website deposit","amount":200000}'));
  assert.match(self.detail, /sent to the Founder/);
  assert.match(describeResults([r, n], ['bad line']), /✔ invoice_link[\s\S]*✘ invoice_link[\s\S]*✘ not understood: bad line/);
});

test('a duty that requests actions has them carried out and listed in its signed work', async () => {
  const ran: any[] = [];
  const deps: DutyDeps = {
    store: new InMemoryDutyStore(), now: () => new Date('2026-11-09T07:30:00Z'), duties: async () => resolveDuties([], []),
    employee: async () => ({ employeeNumber: 'TT-003', title: 'Head of Customer Relations' }), sign: async () => ({ block: '— TT-003\n  ✍ TEST' }),
    actions: { run: async (c, actions, rejected) => { ran.push({ c, actions, rejected }); return 'Actions:\n✔ whatsapp: Message to Lakeview Lodge is waiting for the Founder\'s approval.'; } },
    handoffs: { queue: async () => {} }, unavailableReason: async () => null, buildContext: async () => ({}),
    ask: async () => `Two follow-ups due.\n\nACTIONS:\n${WA}\n{oops}`,
    tasks: { begin: async () => ({ taskId: 't', tracking: 'unavailable' }), advance: async () => {}, fail: async () => {} },
    approvals: { create: async () => {} }, reports: { save: async () => {} },
  };
  const duty = resolveDuties([], []).find((d) => d.id === 'customer-followups')!;
  const store = deps.store as InMemoryDutyStore;
  const out = await runDuty(deps, { ...duty, approval: undefined }); // 09:30 office, due at 09:00
  assert.equal(out.status, 'completed');
  assert.equal(ran[0].actions.length, 1); assert.equal(ran[0].rejected.length, 1); assert.equal(ran[0].c.agent, 'followup');
  assert.match(store.rows[0].summary!, /Two follow-ups due\./); assert.match(store.rows[0].summary!, /✔ whatsapp/); assert.doesNotMatch(store.rows[0].summary!, /ACTIONS:|\{oops\}/);
  const prompt = buildDutyPrompt(duty, localTime(new Date('2026-11-09T07:30:00Z')), { employeeNumber: 'TT-003', title: 'Head of Customer Relations' });
  assert.match(prompt, /ACTIONS:/); assert.match(prompt, /whatsapp/);
});
