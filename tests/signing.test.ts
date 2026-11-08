import test from 'node:test';
import assert from 'node:assert/strict';
import { signContent, verifyLedgerRow, fingerprintOf, normalizeFingerprint, identityMark, signatureBlock, signingAvailable, sha256, type LedgerFields } from '../src/organization/workforce/signing.ts';
import { signWork, verifySignature, withStamp } from '../src/organization/workforce/sign-work.ts';
import { InMemorySignatureStore } from '../src/organization/workforce/signature-ledger.ts';
import { EMPLOYEE_NUMBERS, identityForRole, labelForRole } from '../src/organization/workforce/profiles.ts';
import { runDuty, type DutyDeps } from '../src/organization/workforce/duty-runner.ts';
import { resolveDuties } from '../src/organization/workforce/duty-config.ts';
import { InMemoryDutyStore } from '../src/organization/workforce/duty-store.ts';

const SECRET = 'unit-test-signing-secret-0123456789abcdef';
function withSecret<T>(fn: () => T | Promise<T>, secret: string | null = SECRET) {
  const prev = { s: process.env.TAMBALA_SIGNING_SECRET, o: process.env.TAMBALA_OAUTH_SECRET };
  if (secret === null) delete process.env.TAMBALA_SIGNING_SECRET; else process.env.TAMBALA_SIGNING_SECRET = secret;
  delete process.env.TAMBALA_OAUTH_SECRET;
  const restore = () => { if (prev.s === undefined) delete process.env.TAMBALA_SIGNING_SECRET; else process.env.TAMBALA_SIGNING_SECRET = prev.s; if (prev.o !== undefined) process.env.TAMBALA_OAUTH_SECRET = prev.o; };
  try { const r = fn(); if (r instanceof Promise) return r.finally(restore); restore(); return r; } catch (e) { restore(); throw e; }
}
const row = (over: Partial<LedgerFields> = {}): LedgerFields => {
  const base = { employee_number: 'TT-002', kind: 'duty_result', subject_id: 'run-1', content: 'Five drafts ready.' };
  const issued = '2026-11-09T07:00:00.000Z';
  const s = signContent({ ...base, kind: 'duty_result', employeeNumber: base.employee_number, subjectId: base.subject_id, issuedAt: new Date(issued) });
  return { ...base, issued_at: issued, content_hash: s.contentHash, signature: s.signature, ...over };
};

test('a signature verifies, and is stable for the same inputs', () => withSecret(() => {
  const a = signContent({ employeeNumber: 'TT-002', kind: 'duty_result', subjectId: 'r1', content: 'x', issuedAt: new Date('2026-11-09T07:00:00Z') });
  const b = signContent({ employeeNumber: 'TT-002', kind: 'duty_result', subjectId: 'r1', content: 'x', issuedAt: new Date('2026-11-09T07:00:00Z') });
  assert.equal(a.signature, b.signature);
  assert.match(a.fingerprint, /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  assert.equal(verifyLedgerRow(row()).valid, true);
}));

test('every worker signs uniquely: same work, different employee, different signature', () => withSecret(() => {
  const sigs = new Set(Object.values(EMPLOYEE_NUMBERS).map((n) => signContent({ employeeNumber: n, kind: 'duty_result', subjectId: 'same', content: 'same', issuedAt: new Date('2026-11-09T07:00:00Z') }).signature));
  assert.equal(sigs.size, Object.values(EMPLOYEE_NUMBERS).length);
  const marks = new Set(Object.values(EMPLOYEE_NUMBERS).map((n) => identityMark(n).mark));
  assert.equal(marks.size, Object.values(EMPLOYEE_NUMBERS).length);
  assert.equal(identityMark('TT-002').keyed, true);
}));

test('tampering with anything breaks verification', () => withSecret(() => {
  assert.equal(verifyLedgerRow(row({ content: 'Five drafts ready!' })).valid, false);                 // content edited
  assert.equal(verifyLedgerRow(row({ employee_number: 'TT-003' })).valid, false);                      // claimed by someone else
  assert.equal(verifyLedgerRow(row({ subject_id: 'run-2' })).valid, false);                            // moved to another record
  assert.equal(verifyLedgerRow(row({ kind: 'briefing' })).valid, false);                               // re-labelled
  assert.equal(verifyLedgerRow(row({ issued_at: '2026-11-09T07:00:01.000Z' })).valid, false);          // re-dated
  const forged = row(); forged.content = 'Evil'; forged.content_hash = sha256('Evil');                 // content AND hash rewritten
  assert.equal(verifyLedgerRow(forged).valid, false);
  assert.equal(verifyLedgerRow(row({ signature: 'ab'.repeat(32) })).valid, false);
}));

test('a different secret cannot verify (rotation invalidates, forgery fails)', async () => {
  const r = withSecret(() => row());
  assert.equal(withSecret(() => verifyLedgerRow(r).valid, 'another-secret-another-secret-another-0000'), false);
});

test('timestamps survive the database round trip', () => withSecret(() => {
  assert.equal(verifyLedgerRow(row({ issued_at: '2026-11-09T07:00:00+00:00' })).valid, true);
  assert.equal(verifyLedgerRow(row({ issued_at: '2026-11-09T07:00:00.000000+00:00' })).valid, true);
}));

test('fingerprints normalise for lookup', () => {
  assert.equal(fingerprintOf('7f3a91c2b0d418e6aa'.padEnd(64, '0')), '7F3A-91C2-B0D4-18E6');
  assert.equal(normalizeFingerprint('7f3a 91c2 b0d4 18e6'), '7F3A-91C2-B0D4-18E6');
  assert.equal(normalizeFingerprint('nope'), null);
});

test('without a secret nothing is signed and the work says so', () => withSecret(async () => {
  assert.equal(signingAvailable(), false);
  const store = new InMemorySignatureStore();
  const stamp = await signWork({ roleId: 'director-sales-business-development', kind: 'duty_result', subjectId: 's', content: 'x', store });
  assert.equal(stamp.signed, false);
  assert.match(stamp.block, /UNSIGNED/); assert.match(stamp.block, /TT-002/);
  assert.equal(store.rows.length, 0);
  assert.equal(identityMark('TT-002').keyed, false);
}, null));

test('signWork records an append-only ledger row that verifies by fingerprint', () => withSecret(async () => {
  const store = new InMemorySignatureStore();
  const stamp = await signWork({ roleId: 'director-sales-business-development', kind: 'duty_result', subjectId: 'run-9', content: 'Pipeline: 3 leads', store, now: new Date('2026-11-09T07:00:00Z') });
  assert.equal(stamp.signed, true);
  assert.match(stamp.block, /^— TT-002 · /); assert.match(stamp.block, new RegExp(stamp.fingerprint!));
  assert.equal(store.rows.length, 1);
  const ok = await verifySignature({ fingerprint: stamp.fingerprint!.toLowerCase().replaceAll('-', ' ') }, store);
  assert.equal(ok.found, true); assert.equal(ok.valid, true); assert.equal(ok.record!.employeeNumber, 'TT-002'); assert.equal(ok.record!.content, 'Pipeline: 3 leads');
  store.rows[0].content = 'Pipeline: 300 leads'; // someone edits the stored work
  const bad = await verifySignature({ id: store.rows[0].id }, store);
  assert.equal(bad.valid, false); assert.match(bad.problems.join(' '), /no longer matches/);
  assert.equal((await verifySignature({ fingerprint: 'AAAA-BBBB-CCCC-DDDD' }, store)).found, false);
  assert.equal(withStamp('Body', stamp), `Body\n\n${stamp.block}`);
}));

test('the Founder signs as TT-000 and role labels use employee numbers only', () => {
  assert.deepEqual(identityForRole('founder'), { employeeNumber: 'TT-000', title: 'Founder' });
  assert.match(labelForRole('ceo'), /^TT-001 /);
  assert.equal(identityForRole('no-such-role'), null);
  assert.match(signatureBlock({ employeeNumber: 'TT-002', title: 'Head of Sales', fingerprint: '7F3A-91C2-B0D4-18E6', issuedAt: '2026-11-09T07:00:00.000Z' }), /✍ 7F3A-91C2-B0D4-18E6 · signed 2026-11-09 07:00 UTC/);
});

test('finished duty work carries its signature everywhere it is stored', () => withSecret(async () => {
  const ledger = new InMemorySignatureStore(); const reports: any[] = []; const approvals: any[] = [];
  const deps: DutyDeps = {
    store: new InMemoryDutyStore(), now: () => new Date('2026-11-09T07:00:00Z'), duties: async () => resolveDuties([], []),
    employee: async () => ({ employeeNumber: 'TT-002', title: 'Head of Sales' }),
    sign: (input) => signWork({ ...input, store: ledger, now: new Date('2026-11-09T07:00:00Z') }),
    actions: { run: async () => '' },
    handoffs: { queue: async () => {} }, unavailableReason: async () => null, buildContext: async () => ({}), ask: async () => 'Five drafts ready.',
    tasks: { begin: async () => ({ taskId: 't', tracking: 'unavailable' }), advance: async () => {}, fail: async () => {} },
    approvals: { create: async (a) => { approvals.push(a); } }, reports: { save: async (r) => { reports.push(r); } },
  };
  const duty = resolveDuties([], []).find((d) => d.id === 'sales-pipeline-review')!;
  const out = await runDuty(deps, duty);
  assert.equal(out.status, 'awaiting_approval');
  assert.equal(ledger.rows.length, 1);
  const fp = ledger.rows[0].fingerprint;
  assert.match(approvals[0].content, new RegExp(fp)); assert.match(approvals[0].content, /TT-002/);
  assert.equal(ledger.rows[0].subject_id, out.runId);
  assert.equal(ledger.rows[0].content, 'Five drafts ready.'); // the ledger holds the raw work, not the sign-off
  const ceo = resolveDuties([], []).find((d) => d.id === 'ceo-daily-briefing')!;
  await runDuty({ ...deps, now: () => new Date('2026-11-09T14:45:00Z') }, ceo);
  assert.equal(ledger.rows.at(-1)!.kind, 'briefing'); assert.match(reports[0].body, /TT-001/); assert.match(reports[0].body, /✍ [0-9A-F]{4}-/);
}));

test('the signature migration is append-only', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../supabase/migrations/20261031_organization_signatures.sql', import.meta.url), 'utf8');
  for (const n of ['organization_signatures_block_change', 'before update or delete', 'before truncate', 'drop table if exists public.organization_staff_names']) assert.ok(sql.includes(n), n);
});
