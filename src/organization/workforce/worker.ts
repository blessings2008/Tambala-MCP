import { dbConfigured } from './db-util.js';
import { workerDelayAfterFailure } from './worker-policy.js';
import { markDutyCycleCompleted, markDutyCycleFailed, markDutyCycleStarted } from './heartbeat.js';
import { runScheduledQueueMaintenance } from './scheduler.js';

const DEFAULT_INTERVAL_MS = 60_000;

function configuredIntervalMs(): number {
  const seconds = Number(process.env.TAMBALA_ORG_WORKER_INTERVAL_SECONDS);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(30_000, Math.min(15 * 60_000, Math.floor(seconds * 1_000)));
}

let stopping = false;
let currentCycle: Promise<void> | null = null;

function requestShutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`Organization worker received ${signal}; finishing the current cycle before exit.`);
}

async function runCycle(): Promise<void> {
  await markDutyCycleStarted();
  try {
    const result = await runScheduledQueueMaintenance();
    await markDutyCycleCompleted();
    console.log('Organization worker cycle completed:', JSON.stringify({
      newClaims: result.newClaims,
      recoveredReviews: result.recoveredReviews,
      promotionApprovals: result.promotionApprovals,
      completedDuties: result.outcomes.filter((item) => item.status !== 'skipped').length,
      processedHandoffs: result.handoffs.length,
    }));
  } catch (error) {
    await markDutyCycleFailed(error).catch((heartbeatError) => {
      console.error('Could not persist organization worker failure heartbeat:', heartbeatError instanceof Error ? heartbeatError.message : heartbeatError);
    });
    throw error;
  }
}

async function sleep(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!stopping && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(1_000, deadline - Date.now())));
  }
}

async function main(): Promise<void> {
  if (!dbConfigured()) {
    throw new Error('The organization worker requires the production database configuration; refusing to run with in-memory stores.');
  }

  const intervalMs = configuredIntervalMs();
  let consecutiveFailures = 0;
  console.log(`Organization worker starting; cycle interval: ${Math.round(intervalMs / 1_000)} seconds.`);

  while (!stopping) {
    let failed = false;
    currentCycle = runCycle();
    try {
      await currentCycle;
    } catch (error) {
      failed = true;
      consecutiveFailures += 1;
      console.error('Organization worker cycle failed:', error instanceof Error ? error.message : error);
    } finally {
      currentCycle = null;
    }

    if (!failed) consecutiveFailures = 0;
    if (stopping) break;
    const delay = workerDelayAfterFailure(intervalMs, consecutiveFailures);
    await sleep(delay);
  }

  if (currentCycle) await currentCycle.catch(() => undefined);
  console.log('Organization worker stopped cleanly.');
}

process.once('SIGTERM', () => requestShutdown('SIGTERM'));
process.once('SIGINT', () => requestShutdown('SIGINT'));

void main().catch((error) => {
  console.error('Organization worker could not start:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
