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

export type DepartmentAgentName = Exclude<AgentName, 'orchestrator'>;

export type ExecutionRoute =
  | {
      status: 'ready';
      capabilityId: string;
      department: string | null;
      role: string;
      organizationRoleStatus: 'planned' | 'active' | null;
      agent: DepartmentAgentName;
      researchQuery: string;
      deliverableHints: string[];
    }
  | {
      status: 'needs_configuration';
      capabilityId: string;
      department: string | null;
      role: string;
      organizationRoleStatus: 'planned' | 'active' | null;
      agent: DepartmentAgentName;
      researchQuery: string;
      deliverableHints: string[];
      reason: string;
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

export interface ExecutorRuntimeReadiness {
  ready: boolean;
  apiKeyConfigured: boolean;
  apiKeyEnv: string;
  baseURL: string | null;
  model: string | null;
}

export function requireConfiguredRuntime(
  route: ExecutionRoute,
  runtime: ExecutorRuntimeReadiness,
): ExecutionRoute {
  if (route.status !== 'ready' || runtime.ready) return route;
  const missing: string[] = [];
  if (!runtime.apiKeyConfigured) missing.push(runtime.apiKeyEnv);
  if (!runtime.baseURL) missing.push(`TAMBALA_${route.agent.toUpperCase()}_BASE_URL`);
  if (!runtime.model) missing.push(`TAMBALA_${route.agent.toUpperCase()}_MODEL`);
  return {
    ...route,
    status: 'needs_configuration',
    reason: `${route.role} is the mapped executor, but its runtime is not ready. Configure: ${missing.join(', ')}.`,
  };
}

const AVAILABLE_EXECUTORS: Record<string, { agent: DepartmentAgentName; title: string }> = {
  sales_prospecting: {
    agent: 'outreach',
    title: 'Head of Sales & Business Development',
  },
  customer_relations: {
    agent: 'followup',
    title: 'Head of Customer Relations & Support',
  },
  web_research: {
    agent: 'research',
    title: 'Head of Central Research & Intelligence',
  },
  marketing_strategy: {
    agent: 'marketing',
    title: 'Head of Marketing & Brand Management',
  },
  media_content: {
    agent: 'content',
    title: 'Head of Media & Content Production',
  },
  finance: {
    agent: 'finance',
    title: 'Head of Finance & Accounting',
  },
  payments: {
    agent: 'payments',
    title: 'Head of Payments & Financial Operations',
  },
  technology_engineering: {
    agent: 'engineering',
    title: 'Head of Technology & Engineering',
  },
};

/**
 * Resolve a capability to its department-specific runtime profile. Runtime
 * readiness is checked separately; a mapping does not activate an org-chart role
 * or grant that agent organizational authority.
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

  if (!match.department) {
    return {
      status: 'not_activated',
      capabilityId: match.capabilityId,
      department: null,
      role: match.role,
      agent: null,
      researchQuery: match.researchQuery || null,
      deliverableHints: match.deliverableHints,
      reason: `The capability matched, but its department is missing from the loaded organization snapshot. Check the existing MCP database before executing this task.`,
    };
  }

  const mapping = AVAILABLE_EXECUTORS[match.capabilityId];
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
