export interface DiscoveryQueueHandoffMarker { request: string }

/** True when either the normal watcher or recovery has already created a room for this queue row. */
export function hasDiscoveryQueueHandoff(recordId: string, handoffs: readonly DiscoveryQueueHandoffMarker[]): boolean {
  const marker = `Queue record ID: ${recordId}.`;
  return handoffs.some((item) => item.request.includes(marker));
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
