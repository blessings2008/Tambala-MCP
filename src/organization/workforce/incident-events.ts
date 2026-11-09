export type RuntimeIncident = {
  source: string;
  message: string;
  agent?: string;
  provider?: string;
  model?: string;
  category?: 'provider' | 'tpm' | 'rate_limit' | 'configuration' | 'unknown';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  statusCode?: number;
  requestId?: string;
  retryAfterSeconds?: number;
};

type IncidentHandler = (incident: RuntimeIncident) => Promise<void>;
let handler: IncidentHandler | null = null;

/** Register the workforce's durable incident dispatcher without coupling AI code to workforce modules. */
export function setRuntimeIncidentHandler(next: IncidentHandler): void {
  handler = next;
}

/** Best-effort event publication. Reporting must never hide the original provider error. */
export async function reportRuntimeIncident(incident: RuntimeIncident): Promise<void> {
  if (!handler) {
    console.error('[incident] No workforce incident handler is registered.', {
      source: incident.source, agent: incident.agent, category: incident.category,
      statusCode: incident.statusCode, message: incident.message.slice(0, 300),
    });
    return;
  }
  try {
    await handler(incident);
  } catch (error) {
    console.error('[incident] Runtime incident handler failed:', error instanceof Error ? error.message : error);
  }
}
