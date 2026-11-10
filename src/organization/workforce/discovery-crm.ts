import { supabaseRpc, supabaseSelect, supabaseUpdate } from '../../lib/supabase.js';

type DiscoveryReviewHandoff = {
  id: string;
  request: string;
  result: string | null;
};

type DiscoveryQueueReviewState = {
  id: string;
  processing_status: string;
  verification_status: string;
  public_email: string | null;
  public_phone: string | null;
};

type PromotionResult = { outcome: string; lead_id: string | null };

export type DiscoveryReviewSyncSummary = {
  promoted: number;
  duplicates: number;
  rejected: number;
  investigating: number;
  skipped: number;
  failed: number;
};

/** Extract the decision attached to the review's Recommendation heading. */
export function discoveryReviewRecommendation(result: string | null): 'qualify' | 'investigate' | 'reject' | null {
  if (!result) return null;
  const match = /recommendation[\s\S]{0,180}?\b(qualify|investigate|reject)\b/i.exec(result);
  return match ? match[1].toLowerCase() as 'qualify' | 'investigate' | 'reject' : null;
}

export function discoveryQueueIdFromReviewRequest(request: string): string | null {
  return /queue record id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(request)?.[1] ?? null;
}

/**
 * Turn completed Sales review decisions into CRM state.
 * Only verified, explicitly-qualified records with a public organisation contact
 * are promoted. The database function locks the queue row and creates the CRM
 * lead atomically, with a unique source marker for idempotency.
 */
export async function syncCompletedDiscoveryReviews(): Promise<DiscoveryReviewSyncSummary> {
  const summary: DiscoveryReviewSyncSummary = {
    promoted: 0, duplicates: 0, rejected: 0, investigating: 0, skipped: 0, failed: 0,
  };

  const queues = await supabaseSelect<DiscoveryQueueReviewState>(
    'lead_discovery_queue',
    'select=id,processing_status,verification_status,public_email,public_phone&processing_status=in.(reviewing,qualified)&order=created_at.asc&limit=200',
  );

  for (const queue of queues) {
    let handoffId: string | null = null;
    try {
      const handoffs = await supabaseSelect<DiscoveryReviewHandoff>(
        'organization_handoffs',
        'select=id,request,result&source_duty_id=eq.lead-discovery-queue-watcher&status=eq.completed&request=ilike.' +
          encodeURIComponent('*Queue record ID: ' + queue.id + '*') +
          '&order=completed_at.desc&limit=1',
      );
      const handoff = handoffs[0];
      handoffId = handoff?.id ?? null;
      if (!handoff || discoveryQueueIdFromReviewRequest(handoff.request) !== queue.id) {
        summary.skipped += 1;
        continue;
      }
      const recommendation = discoveryReviewRecommendation(handoff.result);
      if (!recommendation) {
        summary.skipped += 1;
        continue;
      }

      if (recommendation === 'investigate') {
        if (queue.processing_status === 'qualified') {
          await supabaseUpdate(
            'lead_discovery_queue',
            { processing_status: 'reviewing', updated_at: new Date().toISOString() },
            'id=eq.' + encodeURIComponent(queue.id) + '&processing_status=eq.qualified',
          );
        }
        summary.investigating += 1;
        continue;
      }

      if (recommendation === 'reject') {
        if (['reviewing', 'qualified'].includes(queue.processing_status)) {
          await supabaseUpdate(
            'lead_discovery_queue',
            { processing_status: 'rejected', updated_at: new Date().toISOString() },
            'id=eq.' + encodeURIComponent(queue.id) + '&processing_status=in.(reviewing,qualified)',
          );
          summary.rejected += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }

      if (!['reviewing', 'qualified'].includes(queue.processing_status)
          || queue.verification_status !== 'verified'
          || (!queue.public_email?.trim() && !queue.public_phone?.trim())) {
        summary.skipped += 1;
        continue;
      }

      if (queue.processing_status === 'reviewing') {
        await supabaseUpdate(
          'lead_discovery_queue',
          { processing_status: 'qualified', updated_at: new Date().toISOString() },
          'id=eq.' + encodeURIComponent(queue.id) + '&processing_status=eq.reviewing',
        );
      }

      const result = await supabaseRpc<PromotionResult>(
        'promote_qualified_discovery_prospect',
        { p_queue_id: queue.id },
      );
      const outcome = result[0]?.outcome;
      if (outcome === 'promoted') summary.promoted += 1;
      else if (outcome === 'duplicate') summary.duplicates += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      console.error('[discovery-crm] Could not sync completed Sales review:', {
        handoffId,
        queueId: queue.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (summary.promoted || summary.duplicates || summary.rejected || summary.failed) {
    console.log('[discovery-crm] Completed Sales reviews synced:', JSON.stringify(summary));
  }
  return summary;
}
