export interface DiscoveryQueueHandoffMarker { request: string; status?: string; created_at?: string; completed_at?: string | null }

export type DiscoveryRecommendation = 'QUALIFY' | 'INVESTIGATE' | 'REJECT';

export interface DiscoveryOutcomeRoute {
  outcome: 'QUALIFY' | 'INVESTIGATE' | 'REJECT';
  processingStatus: 'qualified' | 'reviewing' | 'rejected';
  requiresFounderApproval: boolean;
  reason: string;
}

/** Map a reviewed recommendation to the only safe next step in the existing queue schema. */
export function routeDiscoveryRecommendation(
  recommendation: DiscoveryRecommendation | null,
  verificationStatus: string,
  serviceFitCount: number,
  publicPhone: string | null | undefined,
): DiscoveryOutcomeRoute | null {
  if (!recommendation) return null;
  if (recommendation === 'REJECT') {
    return { outcome: 'REJECT', processingStatus: 'rejected', requiresFounderApproval: false, reason: 'Research rejected this prospect based on the supplied evidence.' };
  }
  if (recommendation === 'INVESTIGATE') {
    return { outcome: 'INVESTIGATE', processingStatus: 'reviewing', requiresFounderApproval: false, reason: 'Research identified evidence gaps. Do not promote or contact this prospect until those gaps are resolved.' };
  }
  const gaps = [
    verificationStatus !== 'verified' ? 'the prospect record is not fully verified' : '',
    serviceFitCount <= 0 ? 'no Tambala service fit is recorded' : '',
    (publicPhone?.replace(/\D/g, '').length ?? 0) < 8 ? 'no valid public WhatsApp phone number is available' : '',
  ].filter(Boolean);
  if (gaps.length) {
    return {
      outcome: 'INVESTIGATE',
      processingStatus: 'reviewing',
      requiresFounderApproval: false,
      reason: `The QUALIFY recommendation cannot enter WhatsApp outreach because ${gaps.join('; ')}.`,
    };
  }
  return { outcome: 'QUALIFY', processingStatus: 'qualified', requiresFounderApproval: true, reason: '' };
}

function normaliseDiscoveryText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** Extract a recommendation only when the report names the exact queue organisation. */
export function extractDiscoveryRecommendation(result: string | null | undefined, organisationName: string): DiscoveryRecommendation | null {
  if (!result?.trim() || !organisationName.trim()) return null;
  if (!normaliseDiscoveryText(result).includes(normaliseDiscoveryText(organisationName))) return null;
  const recommendation = result.match(/\b(?:recommendation|decision)\b[\s*:_-]{0,12}(QUALIFY|QUALIFIED|INVESTIGATE|REJECT)\b/i)?.[1]
    ?? result.match(/^\s*(QUALIFY|QUALIFIED|INVESTIGATE|REJECT)\s*$/im)?.[1];
  const normalized = recommendation?.toUpperCase();
  if (normalized === 'QUALIFIED') return 'QUALIFY';
  return normalized === 'QUALIFY' || normalized === 'INVESTIGATE' || normalized === 'REJECT'
    ? normalized
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
