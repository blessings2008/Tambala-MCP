import { inflateSync } from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, documentInputSchema, type StoredDocument } from '../src/documents/model.ts';
import { renderDocument } from '../src/documents/renderer.ts';
import { loadDesign } from '../src/documents/design.ts';

test('quotation input accepts structured sections, milestones, recurring fees and terms bullets', () => {
  const parsed = documentInputSchema.safeParse({
    kind: 'quotation', client: { name: 'Malawi College of Health Sciences' },
    items: [{ component: 'Discovery', description: 'System design and requirements mapping', quantity: 1, unitPrice: 25000 }],
    clientCode: 'MCHS', project: 'College Management System',
    sections: [{ title: 'Project Overview', body: 'Centralised academic administration.' }],
    milestones: [{ label: 'Acceptance', percentage: 50 }, { label: 'Review', percentage: 30 }, { label: 'Handover', percentage: 20 }],
    recurringFees: [{ description: 'Routine system maintenance', included: true }, { description: 'Monthly management fee', amountMinor: 3000000, included: false }],
    termsBullets: ['Out-of-scope work is quoted separately.'],
    closingLine: 'Thank you for considering Tambala Technologies.'
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.clientCode, 'MCHS');
    assert.equal('component' in parsed.data.items[0] ? parsed.data.items[0].component : undefined, 'Discovery');
    assert.equal(parsed.data.milestones?.reduce((n, x) => n + x.percentage, 0), 100);
    assert.equal(parsed.data.recurringFees?.[0].included, true);
  }
});

test('quotation totals and milestone amounts are based on integer minor-unit totals', () => {
  const totals = computeTotals([
    { sku: null, description: 'A', quantity: 1, unitPriceMinor: 2500000, amountMinor: 2500000, custom: true },
    { sku: null, description: 'B', quantity: 1, unitPriceMinor: 17500000, amountMinor: 17500000, custom: true }
  ], 0);
  assert.equal(totals.totalMinor, 20000000);
  const milestones = [50, 30, 20];
  const amounts = milestones.map((p, i) => i === milestones.length - 1 ? totals.totalMinor - milestones.slice(0, i).reduce((s, v) => s + Math.round(totals.totalMinor * v / 100), 0) : Math.round(totals.totalMinor * p / 100));
  assert.deepEqual(amounts, [10000000, 6000000, 4000000]);
  assert.equal(amounts.reduce((s, n) => s + n, 0), totals.totalMinor);
});

test('quotation PDF renders two A4 pages and includes the MCHS reference sections and signer fingerprint', async () => {
  const doc: StoredDocument = {
    number: 'TT-Q-2026-0001', kind: 'quotation', issuedAt: '2026-11-02T08:00:00.000Z', validUntil: '2026-12-02T08:00:00.000Z',
    client: { name: 'Malawi College of Health Sciences' },
    items: [{ sku: null, component: 'System design', description: 'Architecture and requirements documentation', quantity: 1, unitPriceMinor: 2500000, amountMinor: 2500000, custom: true }],
    totals: { subtotalMinor: 2500000, vatPercent: 0, vatMinor: 0, totalMinor: 2500000 }, currency: 'MWK',
    reference: 'TT-MCHS-2026-001', project: 'College Management System',
    sections: [{ title: 'Project Overview', body: 'A centralised college management system.' }],
    milestones: [{ label: 'Upon acceptance', percentage: 50 }, { label: 'Upon review', percentage: 30 }, { label: 'Upon handover', percentage: 20 }],
    recurringFees: [{ description: 'Routine system maintenance', included: true }, { description: 'Monthly management fee', amountMinor: 3000000, included: false }],
    termsBullets: ['New modules are quoted separately.', 'Final handover follows settlement.'],
    closingLine: 'Thank you for considering Tambala Technologies.'
  };
  const pdf = await renderDocument(doc, loadDesign(), { employeeNumber: 'TT-001', title: 'Chief Executive Officer', fingerprint: 'AAAA-BBBB-CCCC-DDDD' });
  const raw = pdf.toString('latin1');
  const source = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => { try { return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { return ''; } }).join('\n');
  const decoded = [...source.matchAll(/\\[(.*?)\\]\\s*TJ/gs)]
    .map(match => [...match[1].matchAll(/<([0-9A-Fa-f]+)>/g)].map(glyph => Buffer.from(glyph[1], 'hex').toString('latin1')).join(''))
    .join('\\n');
  assert.match(decoded, /TT-MCHS-2026-001/);
  assert.match(decoded, /Project Overview/);
  assert.match(decoded, /Payment Terms/);
  assert.match(decoded, /Terms and Conditions/);
  assert.match(decoded, /Acceptance/);
  assert.match(decoded, /AAAA-BBBB-CCCC-DDDD/);
  assert.equal((raw.match(/\/Type \/Page\b(?!s)/g) ?? []).length, 2);
});
