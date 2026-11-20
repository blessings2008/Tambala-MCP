/** Classify configuration/policy failures that cannot improve by retrying unchanged input. */
export function isPermanentAgentFailure(message: string): boolean {
  return /AI request blocked by Tambala's free-only policy|No API key configured for the .* agent|No OpenRouter API key configured|TAMBALA_[A-Z0-9_]+_(?:MODEL|BASE_URL) must be configured|free-models-per-day/i.test(message);
}
