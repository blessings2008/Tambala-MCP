import { dbConfigured } from './db-util.js';
import { identityForRole } from './profiles.js';
import { InMemorySignatureStore, SupabaseSignatureStore, type LedgerRow, type SignatureStore } from './signature-ledger.js';
import { signContent, signatureBlock, signingAvailable, unsignedBlock, verifyLedgerRow, normalizeFingerprint, type SignatureKind } from './signing.js';

let memory: InMemorySignatureStore | null = null;
export function signatureStore(): SignatureStore {
  if (dbConfigured()) return new SupabaseSignatureStore();
  return (memory ??= new InMemorySignatureStore());
}

export interface Stamp { signed: boolean; block: string; fingerprint: string | null; recordId: string | null; employeeNumber: string }

/**
 * Sign a piece of work as a worker and record it in the ledger. Always returns a block to append to the work:
 * a real signature, or an explicit UNSIGNED marker. It never throws, so signing trouble cannot lose the work.
 */
export async function signWork(input: { roleId: string; kind: SignatureKind; subjectId: string; content: string; store?: SignatureStore; now?: Date }): Promise<Stamp> {
  const who = identityForRole(input.roleId);
  if (!who) return { signed: false, block: `— ${input.roleId}\n  ✍ UNSIGNED · unknown worker`, fingerprint: null, recordId: null, employeeNumber: input.roleId };
  if (!signingAvailable()) return { signed: false, block: unsignedBlock(who.employeeNumber, who.title), fingerprint: null, recordId: null, employeeNumber: who.employeeNumber };
  try {
    const sig = signContent({ employeeNumber: who.employeeNumber, kind: input.kind, subjectId: input.subjectId, content: input.content, issuedAt: input.now });
    const row = await (input.store ?? signatureStore()).add({
      kind: input.kind, role_id: input.roleId, employee_number: who.employeeNumber, subject_id: input.subjectId,
      issued_at: sig.issuedAt, content: input.content, content_hash: sig.contentHash, signature: sig.signature, fingerprint: sig.fingerprint,
    });
    return { signed: true, block: signatureBlock({ employeeNumber: who.employeeNumber, title: who.title, fingerprint: sig.fingerprint, issuedAt: sig.issuedAt }), fingerprint: sig.fingerprint, recordId: row.id, employeeNumber: who.employeeNumber };
  } catch (error) {
    console.error('Signing failed:', error instanceof Error ? error.message : error);
    return { signed: false, block: unsignedBlock(who.employeeNumber, who.title), fingerprint: null, recordId: null, employeeNumber: who.employeeNumber };
  }
}

export const withStamp = (body: string, stamp: Stamp): string => `${body}\n\n${stamp.block}`;

export interface Verification {
  found: boolean; valid: boolean; problems: string[];
  record?: { id: string; kind: string; employeeNumber: string; title: string | null; subjectId: string; issuedAt: string; fingerprint: string; content: string };
}

/** Look a signature up by its fingerprint (or record id) and check it against the worker's key. */
export async function verifySignature(query: { fingerprint?: string; id?: string }, store: SignatureStore = signatureStore()): Promise<Verification> {
  let rows: LedgerRow[] = [];
  if (query.id) { const r = await store.byId(query.id); rows = r ? [r] : []; }
  else if (query.fingerprint) {
    const fp = normalizeFingerprint(query.fingerprint);
    if (!fp) return { found: false, valid: false, problems: ['A fingerprint looks like 7F3A-91C2-B0D4-18E6.'] };
    rows = await store.byFingerprint(fp);
  }
  const row = rows[0];
  if (!row) return { found: false, valid: false, problems: ['No signed record has that fingerprint.'] };
  const check = verifyLedgerRow(row);
  const who = identityForRole(row.role_id);
  const problems = [...check.problems];
  if (who && who.employeeNumber !== row.employee_number) problems.push('The employee number does not belong to the role that signed.');
  return {
    found: true, valid: problems.length === 0, problems,
    record: { id: row.id, kind: row.kind, employeeNumber: row.employee_number, title: who?.title ?? null, subjectId: row.subject_id, issuedAt: new Date(row.issued_at).toISOString(), fingerprint: row.fingerprint, content: row.content },
  };
}
