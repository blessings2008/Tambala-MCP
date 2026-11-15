import { markDutyCycleCompleted, markDutyCycleFailed, markDutyCycleStarted } from './heartbeat.js';
import { dispatchNewDiscoveryQueue, dispatchReviewingDiscoveryQueue, dispatchQualifiedDiscoveryApprovals, runDutiesOnce } from './duty-service.js';

export interface ScheduledQueueMaintenanceDeps {
  dispatchNew: (maxCount: number) => Promise<number>;
  dispatchReviewing: (maxCount: number) => Promise<number>;
  dispatchApprovals: () => Promise<number>;
  runDuties: (options: { skipDiscoveryQueue: true }) => Promise<{ outcomes: Array<{ dutyId: string; status: string }>; handoffs: Array<{ toAgent: string; status: string }> }>;
}

/** Keep recovery and intake within the five-handoff worker budget in every scheduler mode. */
export async function runScheduledQueueMaintenance(deps: ScheduledQueueMaintenanceDeps = {
  dispatchNew: dispatchNewDiscoveryQueue,
  dispatchReviewing: dispatchReviewingDiscoveryQueue,
  dispatchApprovals: dispatchQualifiedDiscoveryApprovals,
  runDuties: runDutiesOnce,
}) {
  const recoveredReviews = await deps.dispatchReviewing(5);
  const newClaims = await deps.dispatchNew(Math.max(0, 5 - recoveredReviews));
  const promotionApprovals = await deps.dispatchApprovals();
  const cycle = await deps.runDuties({ skipDiscoveryQueue: true });
  return { newClaims, recoveredReviews, promotionApprovals, ...cycle };
}

/**
 * Optional in-process clock. Each tick runs whatever duties are due; duties are idempotent per period,
 * so ticking often is safe. For hosts that sleep when idle, call POST /api/duties/run from an external cron instead.
 */
export function startDutyScheduler(): void {
  if (process.env.TAMBALA_DUTY_SCHEDULER !== 'true') return;
  const minutes = Math.max(1, Number(process.env.TAMBALA_DUTY_INTERVAL_MINUTES) || 5);
  const tick = async () => {
    try {
      await markDutyCycleStarted().catch((error) => console.warn('Duty heartbeat start could not be stored:', error instanceof Error ? error.message : error));
      const { newClaims, recoveredReviews, promotionApprovals, outcomes, handoffs } = await runScheduledQueueMaintenance();
      await markDutyCycleCompleted().catch((error) => console.warn('Duty heartbeat completion could not be stored:', error instanceof Error ? error.message : error));
      if (newClaims) console.log('Discovery queue claimed for Research:', newClaims);
      if (recoveredReviews) console.log('Legacy discovery queue rows routed to Research:', recoveredReviews);
      if (promotionApprovals) console.log('Founder approvals created for qualified prospects:', promotionApprovals);
      const worked = [...outcomes.filter((o) => o.status !== 'skipped').map((o) => `${o.dutyId}:${o.status}`), ...handoffs.filter((h) => h.status !== 'waiting').map((h) => `handoff-${h.toAgent}:${h.status}`)];
      if (worked.length) console.log('Duty cycle:', JSON.stringify(worked));
    } catch (error) {
      await markDutyCycleFailed(error).catch((heartbeatError) => console.error('Duty heartbeat failure could not be stored:', heartbeatError instanceof Error ? heartbeatError.message : heartbeatError));
      if (!/already running/.test(error instanceof Error ? error.message : '')) console.error('Duty cycle failed:', error instanceof Error ? error.message : error);
    }
  };
  console.log(`Duty scheduler on: checking every ${minutes} min.`);
  setTimeout(tick, 15_000).unref();
  setInterval(tick, minutes * 60_000).unref();
}
