const MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 60_000;

export function workerDelayAfterFailure(baseIntervalMs: number, consecutiveFailures: number): number {
  const base = Number.isFinite(baseIntervalMs) ? Math.max(1_000, Math.floor(baseIntervalMs)) : DEFAULT_INTERVAL_MS;
  const failures = Math.max(0, Math.floor(consecutiveFailures));
  if (failures === 0) return base;
  return Math.min(MAX_BACKOFF_MS, base * (2 ** Math.min(failures, 8)));
}
