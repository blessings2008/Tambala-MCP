import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { computeTotals, formatMoney, lineAmountMinor, toMinor } from '../src/documents/model.ts';
import { createDocument, DocumentError, loadPdfForSending } from '../src/documents/service.ts';
import { InMemoryDocumentStore } from '../src/documents/store.ts';
import { pdfSafe, renderDocument } from '../src/documents/renderer.ts';
import { loadDesign } from '../src/documents/design.ts';
import { InMemorySignatureStore } from '../src/organization/workforce/signature-ledger.ts';
import { verifySignature } from '../src/organization/workforce/sign-work.ts';
import { extractCheckoutUrl, createInvoiceWithLink, invoiceIdempotencyKey, payHealth, payConfigured } from '../src/payments/tambala-pay.ts';
import { createClientInvoice, InMemoryInvoiceStore, InvoiceError, refreshOpenInvoices } from '../src/payments/invoices.ts';

const SIGNING = 'documents-test-signing-secret-0123456789ab';
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
const SALES = 'director-sales-business-development';

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('money is exact: integer minor units, VAT rounding, formatting', () => {
  assert.equal(toMinor(1234.56), 123456);
  assert.equal(toMinor(0.1 + 0.2), 30);
  assert.equal(lineAmountMinor(3, 3333), 9999);
  const items = [{ sku: null, description: 'a', quantity: 1, unitPriceMinor: 10000, amountMinor: 10000, custom: true }, { sku: null, description: 'b', quantity: 2, unitPriceMinor: 3333, amountMinor: 6666, custom: true }];
  assert.deepEqual(computeTotals(items, 16.5), { subtotalMinor: 16666, vatPercent: 16.5, vatMinor: 2750, totalMinor: 19416 });
  assert.equal(computeTotals(items, 0).totalMinor, 16666);
  assert.equal(formatMoney(79802500), 'MWK 798,025.00');
});

test('pdfSafe replaces characters the built-in fonts cannot draw', () => {
  assert.equal(pdfSafe('Café – “quoted” … €5'), 'Café – “quoted” … €5');
  assert.equal(pdfSafe('Great 👍 work ✍ done'), 'Great ? work ? done');
  assert.equal(pdfSafe('日本語'), '???');
});

test('quotations: price-list lines, custom lines, totals, numbering, signature and a real PDF', async () => {
  await withEnv({ TAMBALA_SIGNING_SECRET: SIGNING, TAMBALA_OAUTH_SECRET: undefined, TAMBALA_VAT_PERCENT: '16.5' }, async () => {
    const store = new InMemoryDocumentStore();
    await store.savePrice({ sku: 'WEB-STD', name: 'Business website', unit: 'project', unit_price_minor: 45000000, active: true });
    await store.savePrice({ sku: 'OLD', name: 'Retired service', unit: 'each', unit_price_minor: 100, active: false });
    const ledger = new InMemorySignatureStore();
    const q = await createDocument({ kind: 'quotation', client: { name: 'Chikondi Phiri', phone: '0888123456' }, items: [{ sku: 'web-std', quantity: 1 }, { description: 'Logo', quantity: 2, unitPrice: 75000.5 }], subject: 'Website' }, SALES, { store, now: () => new Date('2026-11-09T08:00:00Z') });
    assert.equal(q.number, 'TT-Q-2026-0001');
    assert.equal(q.hasCustomLines, true);
    const d = q.data as any;
    assert.equal(d.totals.subtotalMinor, 45000000 + 15000100);          // 450,000.00 + 150,001.00
    assert.equal(d.totals.vatMinor, Math.round(60000100 * 0.165)); assert.equal(q.total_minor, d.totals.totalMinor);
    assert.equal(d.validUntil.slice(0, 10), '2026-11-23');               // 14 days by default
    const pdf = Buffer.from(q.pdf_base64, 'base64');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(createHash('sha256').update(pdf).digest('hex'), q.pdf_sha256);
    assert.equal(pages(pdf), 1);
    assert.match(q.signature!, /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);

    const q2 = await createDocument({ kind: 'quotation', client: { name: 'B' }, items: [{ sku: 'WEB-STD' }] }, SALES, { store });
    const inv = await createDocument({ kind: 'invoice', client: { name: 'B' }, items: [{ sku: 'WEB-STD' }] }, SALES, { store });
    assert.equal(q2.number, 'TT-Q-2026-0002'); assert.match(inv.number, /^TT-INV-\d{4}-0001$/);
    assert.deepEqual((await loadPdfForSending(q2.id, store))!.fileName, 'TT-Q-2026-0002.pdf');
    assert.equal(await loadPdfForSending('nope', store), null);
    void ledger;
  });
});

test('documents: unknown or inactive skus, empty quotes and bad input are refused with clear reasons', async () => {
  await withEnv({ TAMBALA_SIGNING_SECRET: SIGNING }, async () => {
    const store = new InMemoryDocumentStore();
    await store.savePrice({ sku: 'OLD', name: 'Retired', unit: 'each', unit_price_minor: 100, active: false });
    await assert.rejects(createDocument({ kind: 'quotation', client: { name: 'A' }, items: [{ sku: 'NOPE' }] }, SALES, { store }), /not in the price list/);
    await assert.rejects(createDocument({ kind: 'quotation', client: { name: 'A' }, items: [{ sku: 'OLD' }] }, SALES, { store }), /not in the price list/);
    await assert.rejects(createDocument({ kind: 'quotation', client: { name: 'A' }, items: [] }, SALES, { store }), /at least one line item/);
    await assert.rejects(createDocument({ kind: 'letter', client: { name: 'A' } }, SALES, { store }), /needs a body/);
    await assert.rejects(createDocument({ kind: 'invoice', client: { name: 'A' }, items: [{ description: 'Free', quantity: 1, unitPrice: 0 }] }, SALES, { store }), /greater than zero/);
    await assert.rejects(createDocument({ kind: 'quotation', client: { name: '' }, items: [{ description: 'x', unitPrice: 1 }] }, SALES, { store }), DocumentError);
    await assert.rejects(createDocument({ kind: 'quotation', client: { name: 'A' }, items: [{ description: 'x', unitPrice: -5 }] }, SALES, { store }), DocumentError);
    await assert.rejects(createDocument({ kind: 'quotation', client: { name: 'A' }, items: [{ description: 'x', unitPrice: 5 }], paymentLink: 'http://insecure.example' }, SALES, { store }), DocumentError);
    await assert.rejects(createDocument({ kind: 'quotation', client: { name: 'A' }, items: [{ description: 'x', unitPrice: 5 }] }, 'no-such-role', { store }), /Unknown author/);
  });
});

test('long quotations paginate, letters and receipts render, odd characters do not break the PDF', async () => {
  await withEnv({ TAMBALA_SIGNING_SECRET: SIGNING }, async () => {
    const store = new InMemoryDocumentStore();
    const items = Array.from({ length: 40 }, (_, i) => ({ description: `Item ${i + 1} — a long description that wraps across more than one line to test the table layout in the generated PDF 👍`, quantity: 1, unitPrice: 1000 + i }));
    const long = await createDocument({ kind: 'quotation', client: { name: 'Big Client' }, items, notes: 'Note. '.repeat(40) }, SALES, { store });
    assert.ok(pages(Buffer.from(long.pdf_base64, 'base64')) >= 3);
    const letter = await createDocument({ kind: 'letter', client: { name: 'Mr Banda' }, subject: 'Update', body: 'Dear Mr Banda,\n\nWork has started.\n\nKind regards' }, 'ceo', { store });
    assert.equal(pages(Buffer.from(letter.pdf_base64, 'base64')), 1);
    const receipt = await createDocument({ kind: 'receipt', client: { name: 'Paying' }, items: [{ description: 'Deposit', unitPrice: 200000 }], paidAt: '2026-11-05', paidVia: 'Airtel Money' }, 'ceo', { store });
    assert.equal(pages(Buffer.from(receipt.pdf_base64, 'base64')), 1);
  });
});

test('every document is signed into the ledger and the signature verifies; unsigned documents say so', async () => {
  await withEnv({ TAMBALA_SIGNING_SECRET: SIGNING }, async () => {
    const { signatureStore } = await import('../src/organization/workforce/sign-work.ts');
    const doc = await createDocument({ kind: 'quotation', client: { name: 'Ledger Test' }, items: [{ description: 'Thing', unitPrice: 1000 }] }, SALES, { store: new InMemoryDocumentStore() });
    const v = await verifySignature({ fingerprint: doc.signature! }, signatureStore());
    assert.equal(v.valid, true); assert.equal(v.record!.kind, 'document'); assert.equal(v.record!.employeeNumber, 'TT-002'); assert.equal(v.record!.subjectId, doc.id);
  });
  await withEnv({ TAMBALA_SIGNING_SECRET: undefined, TAMBALA_OAUTH_SECRET: undefined }, async () => {
    const doc = await createDocument({ kind: 'letter', client: { name: 'X' }, body: 'Hello there, this is a letter.' }, 'ceo', { store: new InMemoryDocumentStore() });
    assert.equal(doc.signature, null);
  });
});

test('the design can be swapped without touching layout code', async () => {
  const d = loadDesign();
  assert.equal(d.colors.primary, '#2563eb'); assert.equal(d.colors.accent, '#38bdf8');
  const custom = { ...d, company: { ...d.company, name: 'Custom Co' }, colors: { ...d.colors, primary: '#ff0000' } };
  const pdf = await renderDocument({ number: 'X-1', kind: 'letter', issuedAt: '2026-11-09T00:00:00Z', validUntil: null, client: { name: 'A' }, items: [], totals: { subtotalMinor: 0, vatPercent: 0, vatMinor: 0, totalMinor: 0 }, currency: 'MWK', body: 'Hi' }, custom, { employeeNumber: 'TT-001', title: 'CEO', fingerprint: null });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

// ---- Tambala Pay ----
function mockPay(handler: (req: IncomingMessage, body: any) => { status: number; json: unknown }) {
  const seen: { method?: string; url?: string; auth?: string; body: any }[] = [];
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null; const out = handler(req, body);
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.writeHead(out.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out.json));
    });
  });
  return new Promise<{ url: string; seen: typeof seen; close: () => void }>((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(server.address() as any).port}`, seen, close: () => server.close() })));
}
const TOKEN = 'p'.repeat(40);
async function withPay<T>(handler: Parameters<typeof mockPay>[0], fn: (m: Awaited<ReturnType<typeof mockPay>>) => Promise<T>) {
  const m = await mockPay(handler);
  try { return await withEnv({ TAMBALA_PAY_API_URL: m.url, TAMBALA_PAY_API_TOKEN: TOKEN, TAMBALA_SIGNING_SECRET: SIGNING }, () => fn(m)); } finally { m.close(); }
}

test('checkout links are found in common response shapes, https only, never guessed', () => {
  assert.equal(extractCheckoutUrl({ checkout_url: 'https://pay.example/c/1' }), 'https://pay.example/c/1');
  assert.equal(extractCheckoutUrl({ data: { link: 'https://pay.example/c/2' } }), 'https://pay.example/c/2');
  assert.equal(extractCheckoutUrl({ payment: { paymentUrl: 'https://pay.example/c/3' } }), 'https://pay.example/c/3');
  assert.equal(extractCheckoutUrl({ checkout_url: 'http://insecure.example' }), null);
  assert.equal(extractCheckoutUrl({ checkout_url: 'javascript:alert(1)' }), null);
  assert.equal(extractCheckoutUrl({ id: 'inv_1', status: 'unpaid' }), null);
  assert.equal(extractCheckoutUrl('https://x.example'), null);
});

test('invoice link: creates the invoice, then the hosted checkout, using the Bearer token', async () => {
  await withPay((req) => {
    if (req.method === 'POST' && req.url === '/api/invoices') return { status: 201, json: { id: 'inv_1', status: 'unpaid' } };
    if (req.url === '/api/invoices/inv_1/payments') return { status: 201, json: { payment: { tx_ref: 'tx1' }, checkout_url: 'https://pay.example/c/inv_1' } };
    return { status: 404, json: { error: 'nope' } };
  }, async (m) => {
    const r = await createInvoiceWithLink({ description: 'Website deposit', amount: 200000, customerName: 'Chikondi' });
    assert.deepEqual({ id: r.invoiceId, link: r.link }, { id: 'inv_1', link: 'https://pay.example/c/inv_1' });
    assert.equal(m.seen[0].auth, `Bearer ${TOKEN}`); assert.deepEqual(m.seen[0].body, { description: 'Website deposit', totalAmount: 200000, customerName: 'Chikondi' });
    assert.deepEqual(m.seen[1].body, { amount: 200000 });
  });
});

test('invoice links are created once per client, description, amount and day', async () => {
  await withPay((req) => req.url === '/api/invoices' ? { status: 201, json: { id: `inv_${Math.random().toString(36).slice(2, 6)}`, checkout_url: 'https://pay.example/c/x' } } : { status: 404, json: {} }, async (m) => {
    const store = new InMemoryInvoiceStore(); const now = new Date('2026-11-09T08:00:00Z');
    const a = await createClientInvoice({ roleId: 'director-finance-accounting', clientName: 'Chikondi', description: 'Website deposit', amount: 200000, store, now });
    const b = await createClientInvoice({ roleId: 'director-finance-accounting', clientName: 'Chikondi', description: 'website deposit', amount: 200000, store, now: new Date('2026-11-09T15:00:00Z') });
    assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.invoice.id, b.invoice.id);
    assert.equal(m.seen.filter((s) => s.url === '/api/invoices').length, 1);
    assert.equal(a.invoice.amount_minor, 20000000); assert.match(a.invoice.signature!, /^[0-9A-F]{4}-/);
    const next = await createClientInvoice({ roleId: 'director-finance-accounting', clientName: 'Chikondi', description: 'Website deposit', amount: 200000, store, now: new Date('2026-11-10T08:00:00Z') });
    assert.equal(next.created, true);
    assert.notEqual(invoiceIdempotencyKey({ description: 'x', amount: 1, customerName: 'A' }, '2026-11-09'), invoiceIdempotencyKey({ description: 'x', amount: 2, customerName: 'A' }, '2026-11-09'));
  });
});

test('when Pay returns no checkout link we say so instead of inventing one', async () => {
  await withPay((req) => req.url === '/api/invoices' ? { status: 201, json: { id: 'inv_9' } } : { status: 201, json: { attempt: 'created', tx_ref: 't' } }, async () => {
    const r = await createInvoiceWithLink({ description: 'Thing', amount: 1000 });
    assert.equal(r.link, null); assert.deepEqual(r.responseKeys, ['attempt', 'tx_ref']);
    const row = await createClientInvoice({ roleId: 'ceo', clientName: 'X', description: 'Thing two', amount: 1000, store: new InMemoryInvoiceStore() });
    assert.equal(row.invoice.link, null);
  });
  await withPay(() => ({ status: 201, json: { status: 'created' } }), async () => assert.rejects(createInvoiceWithLink({ description: 'Thing', amount: 1000 }), /returned no id/));
});

test('Pay failures and bad amounts surface clearly', async () => {
  await withPay(() => ({ status: 401, json: { error: 'bad token' } }), async () => assert.rejects(createInvoiceWithLink({ description: 'x', amount: 5 }), /Tambala Pay API 401: bad token/));
  await withPay(() => ({ status: 200, json: {} }), async () => {
    for (const amount of [0, -5, 100_000_001, NaN]) await assert.rejects(createClientInvoice({ roleId: 'ceo', clientName: 'X', description: 'Thing', amount, store: new InMemoryInvoiceStore() }), InvoiceError);
    await assert.rejects(createClientInvoice({ roleId: 'ceo', clientName: 'X', description: '  ', amount: 10, store: new InMemoryInvoiceStore() }), InvoiceError);
  });
  await withEnv({ TAMBALA_PAY_API_TOKEN: 'short' }, async () => { assert.equal(payConfigured(), false); await assert.rejects(createInvoiceWithLink({ description: 'x', amount: 5 }), /not configured/); });
});

test('payment health reports reachable, rejected token, and unreachable', async () => {
  await withPay(() => ({ status: 200, json: { ok: true } }), async () => { const h = await payHealth(); assert.equal(h.reachable, true); assert.equal(h.authorised, true); });
  await withPay((req) => req.url === '/api/health' ? { status: 200, json: {} } : { status: 403, json: { error: 'forbidden' } }, async () => { const h = await payHealth(); assert.deepEqual([h.reachable, h.authorised], [true, false]); assert.match(h.detail, /rejected/); });
  await withEnv({ TAMBALA_PAY_API_URL: 'http://127.0.0.1:1', TAMBALA_PAY_API_TOKEN: TOKEN }, async () => { const h = await payHealth(); assert.equal(h.reachable, false); });
  await withEnv({ TAMBALA_PAY_API_TOKEN: undefined }, async () => assert.equal((await payHealth()).configured, false));
});

test('unpaid invoices are refreshed from Pay and marked paid when Pay says so', async () => {
  await withPay((req) => req.url === '/api/invoices/inv_a' ? { status: 200, json: { invoice: { status: 'PAID' } } } : req.url === '/api/invoices/inv_b' ? { status: 200, json: { status: 'partially_paid' } } : { status: 500, json: {} }, async () => {
    const store = new InMemoryInvoiceStore(); const now = new Date('2026-11-09T08:00:00Z');
    const mk = (id: string, pay: string) => store.add({ id, idempotency_key: id, pay_invoice_id: pay, link: 'https://x.example', amount_minor: 100, currency: 'MWK', client_name: id, client_phone: null, client_email: null, description: 'd', status: 'unpaid', created_by_role_id: 'ceo', signature: null, created_at: '2026-11-01T00:00:00Z', status_checked_at: null });
    await mk('a', 'inv_a'); await mk('b', 'inv_b'); await mk('c', 'inv_c');
    assert.equal(await refreshOpenInvoices(store, now), 2);                     // inv_c fails and is left alone
    const by = Object.fromEntries(store.rows.map((r) => [r.id, r.status]));
    assert.deepEqual(by, { a: 'paid', b: 'partially_paid', c: 'unpaid' });
  });
});
