import type { DocumentStore } from './store.js';

export interface QuotationAcceptanceInput {
  messageId: string;
  acceptedAt: string;
  customerText: string;
}

/** Only a sent quotation can become accepted, and only from an explicit customer acceptance message. */
export async function recordQuotationAcceptance(
  documentId: string,
  input: QuotationAcceptanceInput,
  store: DocumentStore,
): Promise<boolean> {
  const document = await store.byId(documentId);
  if (!document || document.kind !== 'quotation' || document.status !== 'sent') return false;
  await store.update(documentId, {
    status: 'accepted',
    accepted_at: input.acceptedAt,
    accepted_by_message_id: input.messageId,
    acceptance_text: input.customerText.trim().slice(0, 1000),
  });
  return true;
}
