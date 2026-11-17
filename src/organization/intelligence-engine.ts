import { DEPARTMENT_CAPABILITIES, routeObjective } from './capability-registry.js';
import {
  requireConfiguredRuntime,
  resolveExecutionRoute,
  type ExecutionRoute,
  type ExecutorRuntimeReadiness,
} from './execution-router.js';
import type { OrganizationDefinition, OrganizationalRole, OrganizationUnit } from './model.js';
import type { OrganizationalObjective, OrganizationalPlan } from './runtime-contracts.js';
import { validateOrganizationalPlan } from './runtime-contracts.js';

export interface ObjectiveInterpretation {
  /** The user's request, preserved without replacing it with a guessed task. */
  originalRequest: string;
  /** A concise statement of the outcome the organization should achieve. */
  desiredOutcome: string;
  /** Why the outcome matters or what success changes. */
  successDescription: string;
  /** Capability IDs proposed by the reasoning model. Unknown IDs are rejected. */
  requiredCapabilityIds: string[];
  /** Important assumptions that can be safely tested or surfaced to the Founder. */
  assumptions: string[];
  /** Questions that materially affect scope, safety or correctness. */
  unresolvedQuestions: string[];
  /** Explicit constraints extracted from the request or authoritative context. */
  constraints: string[];
}

export interface CapabilityReadiness {
  capabilityId: string;
  description: string;
  unit: OrganizationUnit | null;
  role: OrganizationalRole | null;
  route: ExecutionRoute;
  readiness: 'ready' | 'needs_configuration' | 'not_activated';
  reason: string;
}

export interface ObjectiveAssessment {
  status: 'ready_for_planning' | 'needs_clarification' | 'blocked';
  objective: OrganizationalObjective;
  interpretation: ObjectiveInterpretation;
  capabilityReadiness: CapabilityReadiness[];
  suggestedCapabilities: Array<{ capabilityId: string; score: number; description: string }>;
  blockers: string[];
  warnings: string[];
}

/**
 * Converts a model-produced interpretation into a validated organisational
 * assessment. This module never calls an AI provider and never executes tools.
 *
 * Keyword matches are suggestions only. The model's explicit capability
 * requirements drive discovery; the registry and runtime checks determine
 * whether those capabilities really exist and are ready.
 */
export function assessObjective(
  objective: OrganizationalObjective,
  interpretation: ObjectiveInterpretation,
  organization: OrganizationDefinition,
  runtimeReadiness: Record<string, ExecutorRuntimeReadiness>,
): ObjectiveAssessment {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const request = interpretation.originalRequest.trim();
  const outcome = interpretation.desiredOutcome.trim();

  if (!request) blockers.push('The original request is empty.');
  if (!outcome) blockers.push('The desired outcome has not been identified.');
  if (objective.id.trim().length === 0) blockers.push('The objective has no stable identifier.');

  const declaredIds = new Set(DEPARTMENT_CAPABILITIES.map((capability) => capability.id));
  const uniqueIds = [...new Set(interpretation.requiredCapabilityIds)];
  for (const id of uniqueIds) {
    if (!declaredIds.has(id)) blockers.push(`Unknown capability requested: ${id}.`);
  }
  if (uniqueIds.length === 0) {
    blockers.push('No required capabilities were identified. The CEO must clarify the approach before execution.');
  }

  const capabilityReadiness: CapabilityReadiness[] = uniqueIds
    .filter((id) => declaredIds.has(id))
    .map((id) => {
      const capability = DEPARTMENT_CAPABILITIES.find((item) => item.id === id)!;
      const unit = findUnit(organization, capability.unitTags);
      const role = findRole(organization, capability.roleTags, unit?.id ?? null);
      const route: ExecutionRoute = !unit || !role || role.activation !== 'active'
        ? {
            status: 'not_activated',
            capabilityId: id,
            department: unit?.name ?? null,
            role: role?.title ?? null,
            agent: null,
            researchQuery: capability.researchKeywords.slice(0, 4).join(', '),
            deliverableHints: capability.deliverableHints,
            reason: !unit
              ? `No active organisational unit is registered for capability ${id}.`
              : !role
                ? `No active accountable role is registered for capability ${id}.`
                : `The role ${role.title} is not active.`,
          }
        : resolveExecutionRoute({
            capabilityId: id,
            department: unit.name,
            role: role.title,
            roleActivation: role.activation,
            researchQuery: capability.researchKeywords.slice(0, 4).join(', '),
            description: capability.description,
            deliverableHints: capability.deliverableHints,
          });
      const runtime = runtimeReadiness[id] ?? {
        ready: false,
        apiKeyConfigured: false,
        apiKeyEnv: route.status === 'ready' ? `TAMBALA_${route.agent.toUpperCase()}_API_KEY` : 'AGENT_RUNTIME_CONFIGURATION',
        baseURL: null,
        model: null,
      };
      const checkedRoute = requireConfiguredRuntime(route, runtime);
      const readiness = checkedRoute.status;
      const reason = checkedRoute.status === 'needs_configuration' || checkedRoute.status === 'not_activated'
        ? checkedRoute.reason
        : 'A matching execution profile and configured runtime are available. Authorization must still be checked for each action.';
      if (readiness !== 'ready') warnings.push(`${id}: ${reason}`);
      return {
        capabilityId: id,
        description: capability.description,
        unit,
        role,
        route: checkedRoute,
        readiness,
        reason,
      };
    });

  const suggestedCapabilities = routeObjective(organization, outcome)
    .slice(0, 5)
    .map((match) => ({
      capabilityId: match.capability.id,
      score: match.score,
      description: match.capability.description,
    }))
    .filter((suggestion) => !uniqueIds.includes(suggestion.capabilityId));

  if (interpretation.unresolvedQuestions.length > 0) {
    warnings.push('The interpretation contains unresolved questions that should be answered before affected steps execute.');
  }
  if (capabilityReadiness.some((item) => item.readiness !== 'ready')) {
    warnings.push('Some requested capabilities are not executable. Do not silently substitute another department.');
  }

  const status = blockers.length > 0
    ? 'blocked'
    : interpretation.unresolvedQuestions.length > 0
      ? 'needs_clarification'
      : capabilityReadiness.some((item) => item.readiness !== 'ready')
        ? 'blocked'
        : 'ready_for_planning';

  return {
    status,
    objective: { ...objective, desiredOutcome: outcome || objective.desiredOutcome },
    interpretation,
    capabilityReadiness,
    suggestedCapabilities,
    blockers,
    warnings,
  };
}

/**
 * Validates the plan against the objective and checks that every required
 * capability was discovered and ready. It does not authorize or execute steps.
 */
export function validateAssessmentPlan(
  assessment: ObjectiveAssessment,
  plan: OrganizationalPlan,
): string[] {
  const issues = validateOrganizationalPlan(assessment.objective, plan).map((issue) => issue.message);
  const readyIds = new Set(
    assessment.capabilityReadiness
      .filter((item) => item.readiness === 'ready')
      .map((item) => item.capabilityId),
  );

  for (const step of plan.steps) {
    for (const requirement of step.capabilityRequirements) {
      const readiness = assessment.capabilityReadiness.find((item) => item.capabilityId === requirement.capabilityId);
      if (!readiness) {
        issues.push(`Step ${step.id} requires undiscovered capability ${requirement.capabilityId}.`);
      } else if (!readyIds.has(requirement.capabilityId)) {
        issues.push(`Step ${step.id} depends on unavailable capability ${requirement.capabilityId}: ${readiness.reason}`);
      }
    }
  }
  return issues;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findUnit(definition: OrganizationDefinition, tags: string[]): OrganizationUnit | null {
  const matching = definition.units.filter((unit) =>
    unit.status === 'active' &&
    tags.some((tag) => unit.tags.some((unitTag) => normalize(unitTag) === normalize(tag))),
  );
  const priority: Record<OrganizationUnit['kind'], number> = {
    department: 0,
    business_unit: 1,
    division: 2,
  };
  return matching.sort((a, b) => priority[a.kind] - priority[b.kind])[0] ?? null;
}

function findRole(
  definition: OrganizationDefinition,
  tags: string[],
  unitId: string | null,
): OrganizationalRole | null {
  return definition.roles.find((role) =>
    role.activation === 'active' &&
    (unitId === null || role.unitId === unitId) &&
    tags.some((tag) => normalize(role.title).includes(normalize(tag))),
  ) ?? null;
}
