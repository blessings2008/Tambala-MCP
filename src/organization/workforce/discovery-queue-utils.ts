export interface DiscoveryQueueHandoffMarker { request: string; status?: string; created_at?: string; completed_at?: string | null }

/**
 * True when a queue row already has durable work that should suppress another dispatch.
 * Failed attempts suppress redispatch only during the cooldown window; old failures must
 * not permanently strand a record in "reviewing".
 */
export function hasDiscoveryQueueHandoff(
  recordId: string,
  handoffs: readonly DiscoveryQueueHandoffMarker[],
  retryFailedBeforeIso?: string,
): boolean {
  const marker = `Queue record ID: ${recordId}.`;
  return handoffs.some((item) => {
    if (!item.request.includes(marker)) return false;
    if (item.status !== 'failed') return true;
    // Preserve the historical conservative behaviour when callers omit status/timestamps.
    const lastFailureAt = item.completed_at ?? item.created_at;
    if (!retryFailedBeforeIso || !lastFailureAt) return true;
    return lastFailureAt >= retryFailedBeforeIso;
  });
}

/** Fetch every page without silently treating the first page as the whole table. */
export async function fetchAllPages<T>(fetchPage: (offset: number, limit: number) => Promise<T[]>, pageSize = 500): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize must be a positive integer');
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
