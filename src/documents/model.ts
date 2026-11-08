import * as z from 'zod/v4';

/** Money is handled in minor units (tambala, 1/100 kwacha) as integers, so totals can never drift from rounding. */
export const toMinor = (kwacha: number): number => Math.round(kwacha * 100);
export const fromMinor = (minor: number): number => minor / 100;
export const formatMoney = (minor: number, currency = 'MWK'): string =>
  `${currency} ${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const DOC_KINDS = ['quotation', 'invoice', 'receipt', 'letter'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const KIND_PREFIX: Record<DocKind, string> = { quotation: 'Q', invoice: 'INV', receipt: 'RC', letter: 'L' };
export const KIND_TITLE: Record<DocKind, string> = { quotation: 'QUOTATION', invoice: 'INVOICE', receipt: 'RECEIPT', letter: 'LETTER' };

const text = (max: number) => z.string().trim().max(max);
export const partySchema = z.object({
  name: text(120).min(1),
  business: text(120).optional(),
  phone: text(30).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal('').transform(() => undefined)),
  address: text(200).optional(),
});

/** A line is either a price-list item (sku + quantity) or a custom line the Founder will see flagged. */
export const itemInputSchema = z.union([
  z.object({ sku: text(40).min(1), quantity: z.number().positive().max(100000).default(1) }),
  z.object({ description: text(200).min(1), quantity: z.number().positive().max(100000).default(1), unitPrice: z.number().min(0).max(1_000_000_000) }),
]);

export const documentInputSchema = z.object({
  kind: z.enum(DOC_KINDS),
  client: partySchema,
  items: z.array(itemInputSchema).max(40).default([]),
  reference: text(80).optional(),
  subject: text(160).optional(),
  body: text(4000).optional(),        // letters
  notes: text(1500).optional(),
  terms: text(2000).optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  vatPercent: z.number().min(0).max(100).optional(),
  paymentLink: z.string().url().max(500).startsWith('https://').optional(),
  paidAt: z.string().max(40).optional(), // receipts
  paidVia: text(60).optional(),
});
export type DocumentInput = z.infer<typeof documentInputSchema>;

export interface ResolvedItem { sku: string | null; description: string; quantity: number; unitPriceMinor: number; amountMinor: number; custom: boolean }
export interface Totals { subtotalMinor: number; vatPercent: number; vatMinor: number; totalMinor: number }

export function computeTotals(items: ResolvedItem[], vatPercent: number): Totals {
  const subtotalMinor = items.reduce((sum, i) => sum + i.amountMinor, 0);
  const vatMinor = Math.round((subtotalMinor * vatPercent) / 100);
  return { subtotalMinor, vatPercent, vatMinor, totalMinor: subtotalMinor + vatMinor };
}

export const lineAmountMinor = (quantity: number, unitPriceMinor: number): number => Math.round(quantity * unitPriceMinor);

export interface StoredDocument {
  number: string; kind: DocKind; issuedAt: string; validUntil: string | null;
  client: z.infer<typeof partySchema>; items: ResolvedItem[]; totals: Totals; currency: string;
  reference?: string; subject?: string; body?: string; notes?: string; terms?: string; paymentLink?: string; paidAt?: string; paidVia?: string;
}

export const defaultVat = (): number => {
  const v = Number(process.env.TAMBALA_VAT_PERCENT);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 0;
};
