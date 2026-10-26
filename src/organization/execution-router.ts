import type { AgentName } from '../services/ai.js';

export interface RoutedCapability {
  capabilityId: string;
  department: string | null;
  role: string | null;
  roleActivation: 'planned' | 'active' | null;
  researchQuery: string;
  description: string;
  deliverableHints: string[];
}

export type ExecutionRoute =
  | {
      status: 'ready';
      capabilityId: string;
      department: string | null;
      role: string;
      organizationRoleStatus: 'planned' | 'active' | null;
      agent: Extract<AgentName, 'outreach' | 'followup'>;
      researchQuery: string;
      deliverableHints: string[];
    }
  | {
      status: 'not_activated';
      capabilityId: string | null;
      department: string | null;
      role: string | null;
      agent: null;
      researchQuery: string | null;
      deliverableHints: string[];
      reason: string;
    };

const ACTIVE_EXECUTORS: Record<string, { agent: 'outreach' | 'followup'; title: string }> = {
  sales_prospecting: {
    agent: 'outreach',
    title: 'Head of Sales & Business Development',
  },
  customer_relations: {
    agent: 'followup',
    title: 'Head of Customer Relations & Support',
  },
};

/**
 * Resolve a capability to an actually activated agent. Never silently send a
 * Finance, Marketing, Research, Payments, or Engineering task to Sales merely
 * because Sales is the only agent currently configured.
 */
export function resolveExecutionRoute(match: RoutedCapability | undefined): ExecutionRoute {
  if (!match) {
    return {
      status: 'not_activated',
      capabilityId: null,
      department: null,
      role: null,
      agent: null,
      researchQuery: null,
      deliverableHints: [],
      reason: 'No department capability matched this objective. The CEO must clarify ownership before execution.',
    };
  }

  const mapping = ACTIVE_EXECUTORS[match.capabilityId];
  if (!mapping) {
    return {
      status: 'not_activated',
      capabilityId: match.capabilityId,
      department: match.department,
      role: match.role,
      agent: null,
      researchQuery: match.researchQuery || null,
      deliverableHints: match.deliverableHints,
      reason: match.roleActivation === 'planned'
        ? `${match.department ?? match.capabilityId} is represented in the organization chart as planned, but no dedicated execution agent is activated yet.`
        : `${match.department ?? match.capabilityId} has no activated execution agent yet. The task is not being redirected to an unrelated department.`,
    };
  }

  return {
    status: 'ready',
    capabilityId: match.capabilityId,
    department: match.department,
    role: mapping.title,
    organizationRoleStatus: match.roleActivation,
    agent: mapping.agent,
    researchQuery: match.researchQuery,
    deliverableHints: match.deliverableHints,
  };
}
