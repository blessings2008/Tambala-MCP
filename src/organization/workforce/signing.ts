import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Worker signatures.
 *
 * Every employee has a private signing key derived from one master secret and their employee number, so no two
 * workers can ever produce the same signature, and one worker cannot sign as another. A signature covers the
 * worker, the kind of record, the record id, the time, and a hash of the content: change any of them and
 * verification fails. Without the master secret nothing can be signed, and nothing pretends to be.
 */
export const SIGNATURE_VERSION = 'tt-sig-1';
export const ALGORITHM = 'HMAC-SHA256/tt-sig-1';
export const FOUNDER_NUMBER = 'TT-000';

export type SignatureKind = 'duty_result' | 'briefing' | 'handoff_request' | 'handoff_result' | 'approval_decision' | 'document' | 'message' | 'invoice';

function masterSecret(): Buffer | null {
  const direct = process.env.TAMBALA_SIGNING_SECRET;
  if (direct && direct.length >= 32) return Buffer.from(direct, 'utf8');
  const oauth = process.env.TAMBALA_OAUTH_SECRET;
  // Reuse the OAuth secret only through a one-way, domain-separated derivation.
  if (oauth && oauth.length >= 32) return Buffer.from(hkdfSync('sha256', Buffer.from(oauth, 'utf8'), Buffer.alloc(0), 'tambala-worker-signing-v1', 32));
  return null;
}

export const signingAvailable = (): boolean => masterSecret() !== null;

function workerKey(employeeNumber: string): Buffer {
  const master = masterSecret();
  if (!master) throw new Error('Signing is not configured (set TAMBALA_SIGNING_SECRET, 32+ characters).');
  return createHmac('sha256', master).update(`worker:${employeeNumber}`).digest();
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const iso = (value: string | Date): string => new Date(value).toISOString();

function canonical(employeeNumber: string, kind: string, subjectId: string, issuedAt: string | Date, contentHash: string): string {
  return [SIGNATURE_VERSION, employeeNumber, kind, subjectId, iso(issuedAt), contentHash].join('\n');
}

/** 16 hex characters shown as XXXX-XXXX-XXXX-XXXX. Short enough to read out, long enough to be unique. */
export function fingerprintOf(signatureHex: string): string {
  return (signatureHex.slice(0, 16).toUpperCase().match(/.{4}/g) ?? []).join('-');
}

export function normalizeFingerprint(input: string): string | null {
  const hex = input.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.length === 16 ? (hex.match(/.{4}/g) as string[]).join('-') : null;
}

export interface SignedFields { signature: string; contentHash: string; fingerprint: string; issuedAt: string }

export function signContent(input: { employeeNumber: string; kind: SignatureKind; subjectId: string; content: string; issuedAt?: Date }): SignedFields {
  const issuedAt = iso(input.issuedAt ?? new Date());
  const contentHash = sha256(input.content);
  const signature = createHmac('sha256', workerKey(input.employeeNumber)).update(canonical(input.employeeNumber, input.kind, input.subjectId, issuedAt, contentHash)).digest('hex');
  return { signature, contentHash, fingerprint: fingerprintOf(signature), issuedAt };
}

export interface LedgerFields { employee_number: string; kind: string; subject_id: string; issued_at: string; content: string; content_hash: string; signature: string }

export function verifyLedgerRow(row: LedgerFields): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  if (sha256(row.content) !== row.content_hash) problems.push('The content no longer matches the hash that was signed.');
  if (!signingAvailable()) return { valid: false, problems: [...problems, 'Signing secret is not configured here, so the signature cannot be checked.'] };
  const expected = createHmac('sha256', workerKey(row.employee_number)).update(canonical(row.employee_number, row.kind, row.subject_id, row.issued_at, row.content_hash)).digest();
  const actual = Buffer.from(row.signature, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) problems.push('The signature does not match this worker, record and time.');
  return { valid: problems.length === 0, problems };
}

/**
 * A public, non-secret mark for a worker, used to draw their identity glyph. When signing is on it derives from the
 * worker's key (so it cannot be guessed or forged by someone who only knows the employee number).
 */
export function identityMark(employeeNumber: string): { mark: string; keyed: boolean } {
  if (!signingAvailable()) return { mark: sha256(`tambala-identity:${employeeNumber}`).slice(0, 16), keyed: false };
  return { mark: createHmac('sha256', workerKey(employeeNumber)).update('identity-mark').digest('hex').slice(0, 16), keyed: true };
}

const stamp = (d: string) => `${d.slice(0, 10)} ${d.slice(11, 16)} UTC`;

export function signatureBlock(input: { employeeNumber: string; title: string; fingerprint: string; issuedAt: string }): string {
  return `— ${input.employeeNumber} · ${input.title}\n  ✍ ${input.fingerprint} · signed ${stamp(input.issuedAt)}`;
}

export function unsignedBlock(employeeNumber: string, title: string): string {
  return `— ${employeeNumber} · ${title}\n  ✍ UNSIGNED · signing is not configured`;
}
