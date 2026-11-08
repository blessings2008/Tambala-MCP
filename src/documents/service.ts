import { createHash } from 'node:crypto';
import { identityForRole } from '../organization/workforce/profiles.js';
import { signWork } from '../organization/workforce/sign-work.js';
import { loadDesign, type DocDesign } from './design.js';
import {
  computeTotals, defaultVat, documentInputSchema, KIND_PREFIX, lineAmountMinor, toMinor,
  type DocKind, type DocumentInput, type ResolvedItem, type StoredDocument,
} from './model.js';
import { renderDocument } from './renderer.js';
import { documentStore, newDocumentId, type DocumentRow, type DocumentStore, type PriceItem } from './store.js';

export class DocumentError extends Error {}

export async function resolveItems(items: DocumentInput['items'], prices: PriceItem[]): Promise<ResolvedItem[]> {
  const bySku = new Map(prices.filter((p) => p.active).map((p) => [p.sku.toLowerCase(), p]));
  return items.map((raw) => {
    if ('sku' in raw) {
      const p = bySku.get(raw.sku.toLowerCase());
      if (!p) throw new DocumentError(`"${raw.sku}" is not in the price list. Use a listed item, or give a description and unit price (it will be flagged for review).`);
      return { sku: p.sku, description: p.name, quantity: raw.quantity, unitPriceMinor: p.unit_price_minor, amountMinor: lineAmountMinor(raw.quantity, p.unit_price_minor), custom: false };
    }
    const unit = toMinor(raw.unitPrice);
    return { sku: null, description: raw.description, quantity: raw.quantity, unitPriceMinor: unit, amountMinor: lineAmountMinor(raw.quantity, unit), custom: true };
  });
}

export interface CreateDocumentDeps { store?: DocumentStore; design?: DocDesign; now?: () => Date }

/** Build, number, sign, render and store a document. Totals are computed here, never by a model. */
export async function createDocument(input: unknown, roleId: string, deps: CreateDocumentDeps = {}): Promise<DocumentRow & { hasCustomLines: boolean }> {
  const parsed = documentInputSchema.safeParse(input);
  if (!parsed.success) throw new DocumentError(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'document'}: ${i.message}`).join('; '));
  const data = parsed.data;
  const store = deps.store ?? documentStore();
  const now = (deps.now ?? (() => new Date()))();
  const kind: DocKind = data.kind;
  if (kind === 'letter' && !data.body) throw new DocumentError('A letter needs a body.');
  if (kind !== 'letter' && data.items.length === 0) throw new DocumentError(`A ${kind} needs at least one line item.`);
  const who = identityForRole(roleId);
  if (!who) throw new DocumentError('Unknown author role.');

  const items = await resolveItems(data.items, kind === 'letter' ? [] : await store.prices());
  const vat = data.vatPercent ?? defaultVat();
  const totals = computeTotals(items, vat);
  if (kind !== 'letter' && totals.totalMinor <= 0 && kind !== 'quotation') throw new DocumentError('The total must be greater than zero.');
  const validityDays = kind === 'quotation' ? data.validityDays ?? 14 : null;
  const doc: Omit<StoredDocument, 'number'> = {
    kind, issuedAt: now.toISOString(), validUntil: validityDays ? new Date(now.getTime() + validityDays * 86_400_000).toISOString() : null,
    client: data.client, items, totals, currency: 'MWK', reference: data.reference, subject: data.subject, body: data.body,
    notes: data.notes, terms: data.terms, paymentLink: data.paymentLink, paidAt: data.paidAt, paidVia: data.paidVia,
  };

  const id = newDocumentId();
  const design = deps.design ?? loadDesign();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const number = await store.nextNumber(KIND_PREFIX[kind], now.getUTCFullYear());
    const full: StoredDocument = { ...doc, number };
    // Sign the content of the document (not the PDF bytes), so the fingerprint can be printed inside the PDF itself.
    const canonical = JSON.stringify({ number, kind, issuedAt: doc.issuedAt, client: doc.client.name, items: items.map((i) => [i.description, i.quantity, i.unitPriceMinor]), total: totals.totalMinor });
    const stamp = await signWork({ roleId, kind: 'document', subjectId: id, content: canonical, now });
    const pdf = await renderDocument(full, design, { employeeNumber: who.employeeNumber, title: who.title, fingerprint: stamp.fingerprint });
    const row: DocumentRow = {
      id, kind, number, status: 'draft', client_name: data.client.name, client_phone: data.client.phone ?? null, client_email: data.client.email ?? null,
      data: full, total_minor: totals.totalMinor, currency: 'MWK', pdf_base64: pdf.toString('base64'),
      pdf_sha256: createHash('sha256').update(pdf).digest('hex'), created_by_role_id: roleId, signature: stamp.fingerprint, created_at: now.toISOString(),
    };
    try {
      const saved = await store.add(row);
      return { ...saved, hasCustomLines: items.some((i) => i.custom) };
    } catch (error) {
      if (!/409|23505|duplicate/i.test(error instanceof Error ? error.message : '') || attempt === 4) throw error;
    }
  }
  throw new DocumentError('Could not allocate a document number.');
}

export async function loadPdfForSending(id: string, store: DocumentStore = documentStore()): Promise<{ base64: string; fileName: string } | null> {
  const row = await store.byId(id);
  return row ? { base64: row.pdf_base64, fileName: `${row.number}.pdf` } : null;
}
