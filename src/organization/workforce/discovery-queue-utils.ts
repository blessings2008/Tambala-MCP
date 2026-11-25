export interface DiscoveryQueueHandoffMarker { request: string; status?: string; created_at?: string; completed_at?: string | null }

export type DiscoveryRecommendation = 'QUALIFY' | 'INVESTIGATE' | 'REJECT';

function normaliseDiscoveryText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** Extract a recommendation only when the report names the exact queue organisation. */
export function extractDiscoveryRecommendation(result: string | null | undefined, organisationName: string): DiscoveryRecommendation | null {
  if (!result?.trim() || !organisationName.trim()) return null;
  if (!normaliseDiscoveryText(result).includes(normaliseDiscoveryText(organisationName))) return null;
  const recommendation = result.match(/\brecommendation\b[\s*:_-]{0,12}(QUALIFY|INVESTIGATE|REJECT)\b/i)?.[1]?.toUpperCase();
  return recommendation === 'QUALIFY' || recommendation === 'INVESTIGATE' || recommendation === 'REJECT'
    ? recommendation
    : null;
}

/** True only when a CEO review claimed the employee report was absent, despite a stored result. */
export function isFalseMissingDeliverableReview(error: string | null | undefined, result: string | null | undefined): boolean {
  if (!result?.trim()) return false;
  return /(?:no employee (?:completed )?(?:deliverable|output|report|review) (?:was )?(?:provided|included|supplied)|employee['’]s (?:completed )?(?:deliverable|output|report|review).{0,140}(?:not|never) (?:been )?(?:provided|included|supplied)|submitted (?:report|deliverable).{0,80}(?:not|never) (?:been )?(?:provided|included|supplied))/i.test(error ?? '');
}

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
