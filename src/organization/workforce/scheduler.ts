import { dispatchNewDiscoveryQueue, runDutiesOnce } from './duty-service.js';

/**
 * Optional in-process clock. Each tick runs whatever duties are due; duties are idempotent per period,
 * so ticking often is safe. For hosts that sleep when idle, call POST /api/duties/run from an external cron instead.
 */
export function startDutyScheduler(): void {
  if (process.env.TAMBALA_DUTY_SCHEDULER !== 'true') return;
  const minutes = Math.max(1, Number(process.env.TAMBALA_DUTY_INTERVAL_MINUTES) || 5);
  const tick = async () => {
    try {
      const discoveryClaims = await dispatchNewDiscoveryQueue();
      if (discoveryClaims) console.log('Discovery queue claimed for Sales:', discoveryClaims);
      const { outcomes, handoffs } = await runDutiesOnce();
      const worked = [...outcomes.filter((o) => o.status !== 'skipped').map((o) => `${o.dutyId}:${o.status}`), ...handoffs.filter((h) => h.status !== 'waiting').map((h) => `handoff-${h.toAgent}:${h.status}`)];
      if (worked.length) console.log('Duty cycle:', JSON.stringify(worked));
    } catch (error) {
      if (!/already running/.test(error instanceof Error ? error.message : '')) console.error('Duty cycle failed:', error instanceof Error ? error.message : error);
    }
  };
  console.log(`Duty scheduler on: checking every ${minutes} min.`);
  setTimeout(tick, 15_000).unref();
  setInterval(tick, minutes * 60_000).unref();
}
