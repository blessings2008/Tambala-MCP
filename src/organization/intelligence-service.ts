import { getCompactCompanyContext } from '../services/ai/context.js';
import { getAgentOperationalInfo } from '../services/ai.js';
import { getOrganizationSnapshot } from './service.js';
import { routeCapabilityById } from './capability-registry.js';
import { resolveExecutionRoute } from './execution-router.js';
import { assessObjective, type ObjectiveAssessment, type ObjectiveInterpretation } from './intelligence-engine.js';
import { interpretFounderObjective } from './intelligence-runtime.js';
import { proposeOrganizationalPlan } from './planning-runtime.js';
import type { OrganizationalObjective } from './runtime-contracts.js';

export interface FounderObjectiveAssessmentResult {
  assessment: ObjectiveAssessment;
  organizationSource: 'supabase' | 'seed-fallback';
  organizationValidation: { valid: boolean; errors: string[] };
}

/**
 * Full read-only CEO intake path:
 * natural language -> structured interpretation -> registered capability
 * discovery -> live role/runtime readiness -> objective assessment.
 *
 * This function proposes no actions and writes no database records. Its caller
 * must persist an approved plan and apply policy checks before execution.
 */
export async function assessFounderObjective(
  request: string,
  options: { objectiveId?: string; correlationId?: string; companyContext?: unknown } = {},
): Promise<FounderObjectiveAssessmentResult> {
  const originalRequest = request.trim();
  if (!originalRequest) throw new Error('The Founder request is empty.');

  const snapshot = await getOrganizationSnapshot();
  const companyContext = options.companyContext ?? await getCompactCompanyContext().catch(() => ({
    availability: 'Company context could not be loaded. Do not invent missing company facts.',
  }));
  const organizationContext = {
    mission: snapshot.organization.mission,
    units: snapshot.organization.units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      status: unit.status,
      purpose: unit.purpose,
    })),
    roles: snapshot.organization.roles.map((role) => ({
      id: role.id,
      title: role.title,
      unitId: role.unitId,
      activation: role.activation,
      purpose: role.purpose,
      capabilities: role.capabilities,
    })),
    company: companyContext,
  };

  const interpretation: ObjectiveInterpretation = await interpretFounderObjective(originalRequest, organizationContext);
  const objective: OrganizationalObjective = {
    id: options.objectiveId ?? `objective-${Date.now()}`,
    statement: originalRequest,
    desiredOutcome: interpretation.desiredOutcome,
    origin: 'founder_request',
    requestedByRoleId: 'founder',
    ownerRoleId: 'ceo',
    constraints: interpretation.constraints,
    deadline: null,
    priority: /\b(urgent|urgently|asap|immediately|critical)\b/i.test(originalRequest) ? 'urgent' : 'normal',
    createdAt: new Date().toISOString(),
    correlationId: options.correlationId ?? options.objectiveId ?? `founder-${Date.now()}`,
  };

  const runtimeReadiness: Record<string, ReturnType<typeof getAgentOperationalInfo>> = {};
  for (const capabilityId of interpretation.requiredCapabilityIds) {
    const match = routeCapabilityById(snapshot.organization, capabilityId);
    if (!match) continue;
    const route = resolveExecutionRoute({
      capabilityId,
      department: match.unit?.name ?? null,
      role: match.role?.title ?? null,
      roleActivation: match.role?.activation ?? null,
      researchQuery: match.researchQuery,
      description: match.capability.description,
      deliverableHints: match.capability.deliverableHints,
    });
    if (route.status === 'ready') runtimeReadiness[capabilityId] = getAgentOperationalInfo(route.agent);
  }

  const assessment = assessObjective(objective, interpretation, snapshot.organization, runtimeReadiness);
  return {
    assessment,
    organizationSource: snapshot.source,
    organizationValidation: snapshot.validation,
  };
}

/**
 * End-to-end read-only planning entry point for a Founder request.
 * Interprets the objective, verifies capability readiness, and asks the CEO to
 * propose a dependency-aware team plan. It does not persist or execute it.
 */
export async function planFounderObjective(
  request: string,
  options: { objectiveId?: string; correlationId?: string; companyContext?: unknown; planId?: string } = {},
) {
  const result = await assessFounderObjective(request, options);
  if (result.assessment.status !== 'ready_for_planning') return result;
  const plan = await proposeOrganizationalPlan(result.assessment, {
    planId: options.planId ?? `plan-${Date.now()}`,
  });
  return { ...result, plan };
}
