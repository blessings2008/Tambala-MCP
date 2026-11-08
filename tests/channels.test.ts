import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { jidToNumber, maskNumber, normalizePhone } from '../src/channels/phone.ts';
import { CLIENT_FACING_AGENTS, decide, sendWindowOpen, validateText, withOptOut } from '../src/channels/policy.ts';
import { connectionState, EvolutionError, evolutionConfigured, sendDocument, sendText } from '../src/channels/evolution.ts';
import { InMemoryMessageStore } from '../src/channels/message-store.ts';
import { onApprovalDecided, OutboxError, processOutbox, queueMessage, sanitizeCustomerMessage, type OutboxDeps } from '../src/channels/outbox.ts';
import { handleEvolutionWebhook, messageText, senderNumber, type InboundDeps } from '../src/channels/inbound.ts';

const at = (iso: string) => new Date(iso);
const MON_10AM = '2026-11-09T08:00:00Z';   // 10:00 office time, Monday
const SUN_10AM = '2026-11-08T08:00:00Z';
const MON_8PM = '2026-11-09T18:30:00Z';    // 20:30 office time
const FOUNDER = '265999000111';

test('phone numbers normalise to international digits', () => {
  assert.equal(normalizePhone('0888 123 456'), '265888123456');
  assert.equal(normalizePhone('+265 888 123 456'), '265888123456');
  assert.equal(normalizePhone('265888123456'), '265888123456');
  assert.equal(normalizePhone('00265888123456'), '265888123456');
  assert.equal(normalizePhone('+44 7700 900123'), '447700900123');
  for (const bad of ['', 'abc', '123', '+26588812345', '0888', null, 42, '+265 8881234567890']) assert.equal(normalizePhone(bad as never), null, String(bad));
  assert.equal(jidToNumber('265888123456@s.whatsapp.net'), '265888123456');
  assert.equal(jidToNumber('265888123456:12@s.whatsapp.net'), '265888123456');
  assert.equal(jidToNumber('103899771998284@lid'), null);
  assert.equal(jidToNumber('1203630@g.us'), null);
  assert.equal(maskNumber('265888123456'), '26588***56');
});

test('policy: customers always need approval, the Founder never does, rules are enforced', () => {
  const state = { founderNumber: FOUNDER, blocked: new Set(['265888000001']) };
  const base = { purpose: 'followup' as const, agent: 'followup', text: 'Hello there', hasDocument: false };
  assert.equal(decide({ ...base, to: FOUNDER }, state).verdict, 'allow_now');
  assert.equal(decide({ ...base, to: '265888123456' }, state).verdict, 'needs_approval');
  assert.equal(decide({ ...base, to: '265888000001' }, state).verdict, 'block');                    // opted out
  assert.equal(decide({ ...base, to: '265888123456', agent: 'security' }, state).verdict, 'block');   // not a customer-facing role
  assert.equal(decide({ ...base, to: '265888123456', purpose: 'notify_founder' }, state).verdict, 'block');
  assert.equal(decide({ ...base, to: '265888123456', agent: 'founder' }, state).verdict, 'needs_approval');
  assert.deepEqual([...CLIENT_FACING_AGENTS].sort(), ['finance', 'followup', 'outreach', 'payments']);
  assert.ok(validateText('') && validateText('x'.repeat(1501)) && validateText('see http://a.com http://b.com http://c.com'));
  assert.equal(validateText('Hello'), null);
  assert.match(withOptOut('Hi, we build websites.', 'outreach'), /Reply STOP to opt out\.$/);
  assert.equal(withOptOut('Hi', 'followup'), 'Hi');
  assert.equal(withOptOut('Hi. Reply STOP to stop.', 'outreach'), 'Hi. Reply STOP to stop.');
});

test('sending window: Monday to Saturday, 07:30 to 19:30 office time', () => {
  assert.equal(sendWindowOpen(at(MON_10AM)), true);
  assert.equal(sendWindowOpen(at('2026-11-09T05:00:00Z')), false); // 07:00
  assert.equal(sendWindowOpen(at('2026-11-09T05:30:00Z')), true);  // 07:30
  assert.equal(sendWindowOpen(at(MON_8PM)), false);
  assert.equal(sendWindowOpen(at('2026-11-14T08:00:00Z')), true);  // Saturday
  assert.equal(sendWindowOpen(at(SUN_10AM)), false);
});

// ---- Evolution client against a real local server ----
function mockEvolution(handler: (req: IncomingMessage, body: string) => { status: number; json: unknown }) {
  const seen: { method?: string; url?: string; headers: IncomingMessage['headers']; body: any }[] = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const out = handler(req, raw);
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.writeHead(out.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out.json));
    });
  });
  return new Promise<{ url: string; seen: typeof seen; close: () => void }>((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    resolve({ url: `http://127.0.0.1:${port}`, seen, close: () => server.close() });
  }));
}
async function withEvolution<T>(handler: Parameters<typeof mockEvolution>[0], fn: (m: Awaited<ReturnType<typeof mockEvolution>>) => Promise<T>) {
  const m = await mockEvolution(handler);
  const prev = { u: process.env.EVOLUTION_API_URL, k: process.env.EVOLUTION_API_KEY, i: process.env.EVOLUTION_INSTANCE };
  process.env.EVOLUTION_API_URL = m.url + '/'; process.env.EVOLUTION_API_KEY = 'secret-key'; process.env.EVOLUTION_INSTANCE = 'tambala main';
  try { return await fn(m); } finally {
    for (const [k, v] of [['EVOLUTION_API_URL', prev.u], ['EVOLUTION_API_KEY', prev.k], ['EVOLUTION_INSTANCE', prev.i]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    m.close();
  }
}

test('Evolution client: sendText, sendDocument and connection state use the documented shapes', async () => {
  await withEvolution(() => ({ status: 201, json: { key: { id: 'WA-123' }, status: 'PENDING' } }), async (m) => {
    assert.equal(evolutionConfigured(), true);
    assert.deepEqual(await sendText('265888123456', 'Hello'), { id: 'WA-123' });
    assert.equal(m.seen[0].url, '/message/sendText/tambala%20main');
    assert.equal(m.seen[0].headers.apikey, 'secret-key');
    assert.equal(m.seen[0].body.number, '265888123456'); assert.equal(m.seen[0].body.text, 'Hello');
    await sendDocument('265888123456', 'JVBERi0=', 'TT-Q-2026-0001.pdf', 'Your quotation');
    assert.equal(m.seen[1].url, '/message/sendMedia/tambala%20main');
    assert.deepEqual({ ...m.seen[1].body, delay: undefined }, { number: '265888123456', mediatype: 'document', mimetype: 'application/pdf', caption: 'Your quotation', media: 'JVBERi0=', fileName: 'TT-Q-2026-0001.pdf', delay: undefined });
  });
  await withEvolution(() => ({ status: 200, json: { instance: { instanceName: 'x', state: 'open' } } }), async () => assert.deepEqual(await connectionState(), { state: 'open' }));
  await withEvolution(() => ({ status: 200, json: { state: 'close' } }), async () => assert.deepEqual(await connectionState(), { state: 'close' }));
});

test('Evolution client: bad numbers are not retried, server errors are, and unconfigured is explicit', async () => {
  await withEvolution(() => ({ status: 400, json: { response: { message: [{ exists: false, number: '1' }] } } }), async () => {
    await assert.rejects(sendText('1', 'x'), (e: unknown) => e instanceof EvolutionError && e.retryable === false && /400/.test(e.message));
  });
  await withEvolution(() => ({ status: 503, json: { error: 'down' } }), async () => {
    await assert.rejects(sendText('265888123456', 'x'), (e: unknown) => e instanceof EvolutionError && e.retryable === true);
  });
  await withEvolution(() => ({ status: 429, json: {} }), async () => assert.rejects(sendText('265888123456', 'x'), (e: unknown) => e instanceof EvolutionError && e.retryable));
  assert.equal(evolutionConfigured(), false);
  await assert.rejects(sendText('265888123456', 'x'), /not configured/);
});

// ---- outbox ----
function outboxHarness(over: Partial<OutboxDeps> & { nowIso?: string; founder?: string | null; configured?: boolean } = {}) {
  const store = new InMemoryMessageStore();
  const sent: { kind: string; number: string; text: string; file?: string }[] = [];
  const approvals: any[] = [];
  let nowIso = over.nowIso ?? MON_10AM;
  const deps: OutboxDeps = {
    store, now: () => at(nowIso), founderNumber: () => (over.founder === undefined ? FOUNDER : over.founder),
    transport: {
      configured: () => over.configured ?? true,
      sendText: async (n, t) => { sent.push({ kind: 'text', number: n, text: t }); return { id: `id-${sent.length}` }; },
      sendDocument: async (n, _b, f, c) => { sent.push({ kind: 'doc', number: n, text: c, file: f }); return { id: `id-${sent.length}` }; },
    },
    loadDocument: async (id) => (id === 'doc-1' ? { base64: 'JVBERi0=', fileName: 'TT-Q-2026-0001.pdf' } : null),
    sign: async () => ({ block: '— TT-002 · Head of Sales\n  ✍ AAAA-BBBB-CCCC-DDDD', fingerprint: 'AAAA-BBBB-CCCC-DDDD' }),
    approvals: { create: async (a) => { approvals.push(a); return `abcdef12-0000-4000-8000-000000000${approvals.length}`; } },
    senderLabel: (r) => `TT-002 ${r}`, pauseMs: 0, ...over,
  };
  return { deps, store, sent, approvals, setNow: (v: string) => { nowIso = v; } };
}
const sales = { roleId: 'director-sales-business-development', agent: 'outreach' };

test('outbox: customer follow-ups wait for approval, tell the Founder, and go out only after approval', async () => {
  const h = outboxHarness();
  const r = await queueMessage(h.deps, { ...sales, to: '0888 123 456', text: 'Hello Chikondi, following up on the website.', purpose: 'followup', contactLabel: 'Lakeview Lodge' });
  assert.equal(r.status, 'pending_approval');
  assert.equal(h.approvals.length, 1); assert.equal(h.approvals[0].subjectType, 'outbox_message'); assert.equal(h.approvals[0].subjectId, r.id);
  const row = (await h.store.byId(r.id))!;
  assert.match(row.text, /Reply STOP to opt out\.$/); assert.equal(row.signature, 'AAAA-BBBB-CCCC-DDDD'); assert.equal(row.number, '265888123456');
  // the Founder is told right away, with a code he can reply to
  const notice = h.store.rows.find((x) => x.number === FOUNDER)!;
  assert.equal(notice.status, 'queued'); assert.match(notice.text, /Reply YES abcdef NO abcdef|YES abcdef/);
  assert.match(notice.text, /✍ AAAA-BBBB-CCCC-DDDD/); assert.match(notice.text, /^\[TT-002/);
  // nothing reaches the customer yet
  await processOutbox(h.deps);
  assert.deepEqual(h.sent.map((s) => s.number), [FOUNDER]);
  await onApprovalDecided(h.deps, r.id, 'approved', null);
  const out = await processOutbox(h.deps);
  assert.equal(out.find((o) => o.id === r.id)!.status, 'sent');
  assert.equal(h.sent.at(-1)!.number, '265888123456');
  assert.equal((await h.store.byId(r.id))!.status, 'sent');
});

test('outbox: first-contact Outreach is queued autonomously and strips internal employee metadata', async () => {
  const h = outboxHarness({ cooldownMs: 90_000 });
  const r = await queueMessage(h.deps, {
    ...sales, to: '0888123456',
    text: 'Hello Lakeview Lodge, we build professional websites for businesses.\n\nPrepared by CEO · TT-001',
    purpose: 'outreach', contactLabel: 'Lakeview Lodge (lead)',
  });
  assert.equal(r.status, 'queued');
  assert.equal(h.approvals.length, 0);
  const row = (await h.store.byId(r.id))!;
  assert.match(row.text, /professional websites/);
  assert.match(row.text, /Reply STOP to opt out/);
  assert.doesNotMatch(row.text, /CEO|TT[- ]?001|Prepared by/i);
  const sent = await processOutbox(h.deps);
  assert.equal(sent.find((item) => item.id === r.id)?.status, 'sent');
  assert.doesNotMatch(h.sent.at(-1)!.text, /CEO|TT[- ]?001|Prepared by/i);
});

test('outbox: customer cooldown is enforced between separate worker runs', async () => {
  const h = outboxHarness({ cooldownMs: 90_000 });
  const first = await queueMessage(h.deps, { ...sales, to: '0888123456', text: 'Hello first prospect.', purpose: 'outreach', contactLabel: 'First Lodge' });
  await processOutbox(h.deps);
  assert.equal((await h.store.byId(first.id))!.status, 'sent');
  const second = await queueMessage(h.deps, { ...sales, to: '0888777888', text: 'Hello second prospect.', purpose: 'outreach', contactLabel: 'Second Lodge' });
  const early = await processOutbox(h.deps);
  assert.equal(early.find((item) => item.id === second.id)?.status, 'waiting');
  assert.match(early.find((item) => item.id === second.id)?.reason ?? '', /cooldown/i);
  h.setNow('2026-11-09T08:01:30Z');
  const later = await processOutbox(h.deps);
  assert.equal(later.find((item) => item.id === second.id)?.status, 'sent');
});

test('outbox: customer message sanitizer removes employee identifiers and internal attribution', () => {
  const clean = sanitizeCustomerMessage('Hello, we can help with your website.\n\nBy CEO TT 001\nPrepared by CEO · TT-001');
  assert.equal(clean, 'Hello, we can help with your website.');
  assert.doesNotMatch(clean, /CEO|TT[- ]?001/i);
});

test('outbox: rejection retires the message; the Founder dashboard send skips approval but only for the Founder', async () => {
  const h = outboxHarness();
  const r = await queueMessage(h.deps, { ...sales, to: '0888123456', text: 'Hello again, quick question.', purpose: 'followup' });
  await onApprovalDecided(h.deps, r.id, 'rejected', 'Too pushy');
  const row = (await h.store.byId(r.id))!; assert.equal(row.status, 'rejected'); assert.equal(row.reason, 'Too pushy');
  assert.equal((await processOutbox(h.deps)).filter((o) => o.id === r.id).length, 0);
  const direct = await queueMessage(h.deps, { roleId: 'founder', agent: 'founder', to: '0888111222', text: 'Hi, your quotation is attached.', purpose: 'document', founderApproved: true });
  assert.equal(direct.status, 'queued');
  const faked = await queueMessage(h.deps, { ...sales, to: '0888333444', text: 'Hi there friend.', purpose: 'followup', founderApproved: true });
  assert.equal(faked.status, 'pending_approval'); // an employee cannot claim Founder approval
});

test('outbox: the sending window, daily limit, opt-outs and duplicates are enforced', async () => {
  const h = outboxHarness({ nowIso: SUN_10AM });
  const a = await queueMessage(h.deps, { ...sales, to: '0888123456', text: 'Hello Banda, checking in.', purpose: 'followup' });
  await onApprovalDecided(h.deps, a.id, 'approved', null);
  let out = await processOutbox(h.deps);
  assert.equal(out.find((o) => o.id === a.id)!.status, 'waiting'); assert.match(out[0].reason!, /sending window/);
  assert.equal(h.sent.filter((s) => s.number !== FOUNDER).length, 0);
  h.setNow(MON_10AM);
  out = await processOutbox(h.deps); assert.equal(out.find((o) => o.id === a.id)!.status, 'sent');

  const dup = await queueMessage(h.deps, { ...sales, to: '0888123456', text: 'Hello Banda, checking in.', purpose: 'followup' });
  assert.equal(dup.status, 'blocked'); assert.equal(dup.reason, 'duplicate');

  await h.store.addBlock('265888555666', 'STOP');
  const stopped = await queueMessage(h.deps, { ...sales, to: '0888555666', text: 'Hello Mr Stop.', purpose: 'followup' });
  assert.equal(stopped.status, 'blocked'); assert.match(stopped.reason!, /opted out/);

  process.env.TAMBALA_WHATSAPP_DAILY_LIMIT = '1';
  try {
    const b = await queueMessage(h.deps, { ...sales, to: '0888777888', text: 'Hello Phiri, checking in.', purpose: 'followup' });
    await onApprovalDecided(h.deps, b.id, 'approved', null);
    out = await processOutbox(h.deps);
    assert.equal(out.find((o) => o.id === b.id)!.status, 'waiting'); assert.match(out.find((o) => o.id === b.id)!.reason!, /Daily customer limit/);
  } finally { delete process.env.TAMBALA_WHATSAPP_DAILY_LIMIT; }
});

test('outbox: a number that opts out after approval is not messaged', async () => {
  const h = outboxHarness();
  const r = await queueMessage(h.deps, { ...sales, to: '0888999000', text: 'Hello Mwale, quick note.', purpose: 'followup' });
  await onApprovalDecided(h.deps, r.id, 'approved', null);
  await h.store.addBlock('265888999000', 'STOP');
  const out = await processOutbox(h.deps);
  assert.equal(out.find((o) => o.id === r.id)!.status, 'blocked');
  assert.equal(h.sent.some((s) => s.number === '265888999000'), false);
});

test('outbox: documents are sent as attachments; missing documents fail cleanly; unconfigured WhatsApp waits', async () => {
  const h = outboxHarness();
  const r = await queueMessage(h.deps, { roleId: 'founder', agent: 'founder', to: FOUNDER, text: 'TT-Q-2026-0001 for Lakeview', purpose: 'document', documentId: 'doc-1' });
  await processOutbox(h.deps);
  assert.equal(h.sent.find((s) => s.kind === 'doc')!.file, 'TT-Q-2026-0001.pdf'); assert.equal((await h.store.byId(r.id))!.status, 'sent');
  const missing = await queueMessage(h.deps, { roleId: 'founder', agent: 'founder', to: FOUNDER, text: 'gone', purpose: 'document', documentId: 'nope' });
  await processOutbox(h.deps); assert.equal((await h.store.byId(missing.id))!.status, 'failed');
  const off = outboxHarness({ configured: false });
  const q = await queueMessage(off.deps, { roleId: 'ceo', agent: 'orchestrator', to: FOUNDER, text: 'Hello Boss', purpose: 'notify_founder' });
  assert.equal((await processOutbox(off.deps))[0].status, 'waiting'); assert.equal((await off.store.byId(q.id))!.status, 'queued');
});

test('outbox: transient failures retry three times then fail; permanent ones fail at once', async () => {
  let n = 0;
  const h = outboxHarness({ transport: { configured: () => true, sendDocument: async () => ({ id: null }), sendText: async () => { n += 1; throw new EvolutionError('Evolution API 503', true); } } });
  const q = await queueMessage(h.deps, { roleId: 'ceo', agent: 'orchestrator', to: FOUNDER, text: 'Hello Boss', purpose: 'notify_founder' });
  for (let i = 0; i < 5; i += 1) await processOutbox(h.deps);
  assert.equal(n, 3); assert.equal((await h.store.byId(q.id))!.status, 'failed');
  const p = outboxHarness({ transport: { configured: () => true, sendDocument: async () => ({ id: null }), sendText: async () => { throw new EvolutionError('Evolution API 400', false); } } });
  const q2 = await queueMessage(p.deps, { roleId: 'ceo', agent: 'orchestrator', to: FOUNDER, text: 'Hello Boss', purpose: 'notify_founder' });
  await processOutbox(p.deps); assert.equal((await p.store.byId(q2.id))!.status, 'failed'); assert.equal((await p.store.byId(q2.id))!.attempts, 1);
});

test('outbox: concurrent workers cannot claim the same in-memory queue row', async () => {
  const h = outboxHarness();
  const q = await queueMessage(h.deps, { roleId: 'ceo', agent: 'orchestrator', to: FOUNDER, text: 'Single delivery only', purpose: 'notify_founder' });
  const [a, b] = await Promise.all([processOutbox(h.deps), processOutbox(h.deps)]);
  assert.equal(a.concat(b).filter((x) => x.id === q.id && x.status === 'sent').length, 1);
  assert.equal(h.sent.filter((x) => x.text.includes('Single delivery only')).length, 1);
});

test('outbox: invalid numbers are refused up front', async () => {
  const h = outboxHarness();
  await assert.rejects(queueMessage(h.deps, { ...sales, to: 'call me', text: 'Hello there', purpose: 'followup' }), OutboxError);
});

// ---- inbound ----
function inboundHarness(extra: Partial<InboundDeps> = {}) {
  const store = new InMemoryMessageStore(); const replies: string[] = []; const told: string[] = []; const decisions: any[] = [];
  const deps: InboundDeps = {
    store, now: () => at(MON_10AM), founderNumber: () => FOUNDER, instance: () => 'tambala main',
    reply: async (_n, t) => { replies.push(t); }, tellFounder: async (t) => { told.push(t); }, contactLookup: async (n) => (n === '265888123456' ? 'Lakeview Lodge (lead)' : null),
    approvals: {
      pending: async () => [{ id: 'abcdef12-0000-4000-8000-000000000001', summary: 'WhatsApp followup to Lakeview' }],
      decide: async (prefix, decision, note) => { decisions.push({ prefix, decision, note }); return { ok: true, message: `${decision} ${prefix}` }; },
    }, ...extra,
  };
  return { deps, store, replies, told, decisions };
}
const evt = (jid: string, text: string, id = 'MSG1', extra: any = {}) => ({ event: 'messages.upsert', instance: 'tambala main', data: { key: { remoteJid: jid, fromMe: false, id }, pushName: 'Chikondi', message: { conversation: text }, ...extra } });

test('inbound: customer replies are stored, matched to the CRM and forwarded to the Founder', async () => {
  const h = inboundHarness();
  const s = await handleEvolutionWebhook(h.deps, evt('265888123456@s.whatsapp.net', 'Yes please send the quote'));
  assert.equal(s.stored, 1); assert.equal(s.forwarded, 1);
  assert.equal(h.store.rows[0].contact_label, 'Lakeview Lodge (lead)'); assert.match(h.told[0], /Lakeview Lodge \(lead\)/); assert.match(h.told[0], /send the quote/);
  assert.equal((await handleEvolutionWebhook(h.deps, evt('265888123456@s.whatsapp.net', 'Yes please send the quote'))).duplicates, 1);
});

test('inbound: STOP opts the customer out, confirms, and tells the Founder', async () => {
  const h = inboundHarness();
  for (const word of ['STOP', ' stop. ', 'Unsubscribe']) {
    const s = await handleEvolutionWebhook(h.deps, evt('265888777000@s.whatsapp.net', word, `M-${word}`));
    assert.equal(s.optOuts, 1);
  }
  assert.ok((await h.store.blockedNumbers()).has('265888777000'));
  assert.match(h.replies[0], /unsubscribed/);
  const s2 = await handleEvolutionWebhook(h.deps, evt('265888777000@s.whatsapp.net', 'please stop calling me about this', 'M9'));
  assert.equal(s2.optOuts, 0); // only a bare STOP is a keyword; free text is forwarded to a human
});

test('inbound: only the Founder number can approve or reject by WhatsApp', async () => {
  const h = inboundHarness();
  await handleEvolutionWebhook(h.deps, evt(`${FOUNDER}@s.whatsapp.net`, 'YES abcdef', 'F1'));
  await handleEvolutionWebhook(h.deps, evt(`${FOUNDER}@s.whatsapp.net`, 'no abcdef too pushy for a first message', 'F2'));
  await handleEvolutionWebhook(h.deps, evt(`${FOUNDER}@s.whatsapp.net`, 'PENDING', 'F3'));
  await handleEvolutionWebhook(h.deps, evt(`${FOUNDER}@s.whatsapp.net`, 'hello?', 'F4'));
  assert.deepEqual(h.decisions, [{ prefix: 'abcdef', decision: 'approved', note: 'Approved by WhatsApp' }, { prefix: 'abcdef', decision: 'rejected', note: 'too pushy for a first message' }]);
  assert.match(h.replies[2], /abcdef · WhatsApp followup/); assert.match(h.replies[3], /Commands:/);
  const stranger = inboundHarness();
  const s = await handleEvolutionWebhook(stranger.deps, evt('265888000999@s.whatsapp.net', 'YES abcdef', 'S1'));
  assert.equal(stranger.decisions.length, 0); assert.equal(s.founderCommands, 0); assert.equal(s.forwarded, 1);
});

test('inbound: private @lid senders, echoes, other events and other instances are handled safely', async () => {
  const h = inboundHarness();
  let s = await handleEvolutionWebhook(h.deps, evt('103899771998284@lid', 'YES abcdef', 'L1'));
  assert.equal(s.unresolved, 1); assert.equal(h.decisions.length, 0); assert.equal(h.told.length, 0); // cannot act on someone we cannot identify
  s = await handleEvolutionWebhook(h.deps, evt('103899771998284@lid', 'hello', 'L2', { key: { remoteJid: '1038@lid', remoteJidAlt: '265888123456@s.whatsapp.net', fromMe: false, id: 'L2' } }));
  assert.equal(s.forwarded, 1);
  s = await handleEvolutionWebhook(h.deps, { ...evt('265888123456@s.whatsapp.net', 'x', 'E1'), data: { key: { remoteJid: '265888123456@s.whatsapp.net', fromMe: true, id: 'E1' }, message: { conversation: 'our own message' } } });
  assert.equal(s.ignored, 1);
  assert.equal((await handleEvolutionWebhook(h.deps, { event: 'CONNECTION_UPDATE', data: {} })).ignored, 1);
  assert.equal((await handleEvolutionWebhook(h.deps, { ...evt('265888123456@s.whatsapp.net', 'hi', 'O1'), instance: 'someone else' })).ignored, 1);
  assert.equal((await handleEvolutionWebhook(h.deps, { event: 'MESSAGES_UPSERT', instance: 'tambala main', data: [{ key: { remoteJid: '265888123456@s.whatsapp.net', fromMe: false, id: 'A1' }, message: { extendedTextMessage: { text: 'array and upper-case event' } } }] })).stored, 1);
  assert.equal(messageText({ imageMessage: { caption: 'photo caption' } }), 'photo caption');
  assert.equal(senderNumber({ key: { remoteJid: 'x@lid' }, senderPn: '265888123456@s.whatsapp.net' }), '265888123456');
});


test('inbound: ordinary Founder messages are delivered to the CEO as structured instructions', async () => {
  const envelopes: any[] = [];
  const h = inboundHarness({
    handleFounderInstruction: async (envelope) => {
      envelopes.push(envelope);
      return 'CEO received your instruction and reviewed the department route.';
    },
  });
  const s = await handleEvolutionWebhook(h.deps, evt(`${FOUNDER}@s.whatsapp.net`, 'URGENT: prepare a sales pipeline report', 'F5'));
  assert.equal(s.stored, 1);
  assert.equal(s.routedToOrganization, 1);
  assert.equal(s.founderCommands, 0);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].channel, 'whatsapp');
  assert.equal(envelopes[0].recipient.role_id, 'ceo');
  assert.equal(envelopes[0].message_type, 'founder_instruction');
  assert.equal(envelopes[0].priority, 'high');
  assert.match(envelopes[0].content.text, /sales pipeline report/);
  assert.match(h.replies[0], /CEO received/);
  const founderStop = await handleEvolutionWebhook(h.deps, evt(`${FOUNDER}@s.whatsapp.net`, 'STOP', 'F6'));
  assert.equal(founderStop.optOuts, 0);
  assert.equal(founderStop.routedToOrganization, 1);
});

test('inbound: media without captions is retained as a readable inbound message', () => {
  assert.equal(messageText({ imageMessage: {} }), '[Incoming image attachment]');
  assert.equal(messageText({ videoMessage: { fileName: 'brief.mp4' } }), '[Incoming video attachment: brief.mp4]');
  assert.equal(messageText({ audioMessage: { ptt: true } }), '[Incoming audio message]');
  assert.equal(messageText({ ephemeralMessage: { message: { documentMessage: { fileName: 'quote.pdf' } } } }), '[Incoming document attachment: quote.pdf]');
});
