import type { ObjectiveAssessment } from './intelligence-engine.js';
import { askTambalaAI } from '../services/ai.js';
import type {
  OrganizationalPlan,
  OrganizationalPlanStep,
  PlanCapabilityRequirement,
  WorkActionKind,
  WorkRisk,
} from './runtime-contracts.js';
import { validateAssessmentPlan } from './intelligence-engine.js';

/**
 * Ask the CEO runtime to compose a dependency-aware cross-functional plan.
 * The response is treated as an untrusted proposal and must pass the strict
 * parser below before it can be presented or persisted.
 */
export async function proposeOrganizationalPlan(
  assessment: ObjectiveAssessment,
  options: { planId: string; proposedByRoleId?: string; createdAt?: string },
): Promise<OrganizationalPlan> {
  if (assessment.status !== 'ready_for_planning') {
    throw new PlanProposalError('The objective is not ready for planning.');
  }
  const capabilityContext = assessment.capabilityReadiness.map((item) => ({
    capabilityId: item.capabilityId,
    description: item.description,
    accountableRoleId: item.role?.id ?? null,
    accountableRole: item.role?.title ?? null,
    department: item.unit?.name ?? null,
    readiness: item.readiness,
  }));
  const prompt = [
    'You are the CEO of Tambala Technologies. Compose a practical, dependency-aware organisational plan for the approved objective below.',
    'You are proposing a plan only. Do not execute tools, contact people, spend money, change systems, or claim that work is complete.',
    'Use only the supplied capability IDs. Every required capability must own at least one step. Do not invent employees, roles, departments, tools, data scopes, facts or permissions.',
    'Break the outcome into the smallest useful sequence of deliverables. Use parallel steps when independent work can proceed safely; use dependsOn only where an actual dependency exists.',
    'Choose actionKind accurately. external_communication, financial, sensitive_data, security_change and legal_commitment always require approval. High or critical risk and non-reversible steps also require approval.',
    'Prefer research, analysis, drafting and reversible internal preparation. Clearly define evidence and acceptance criteria for each step.',
    'For each step return: id, title, objective, capabilityId, supportingCapabilityIds, dependsOn, actionKind, requiredDataScopes, expectedEvidence, expectedDeliverable, acceptanceCriteria, risk, approvalRequired, reversible.',
    'Return ONLY JSON with rationale, assumptions, unresolvedQuestions, steps. 1–30 steps maximum. No markdown or prose.',
    'OBJECTIVE:',
    JSON.stringify({ statement: assessment.objective.statement, desiredOutcome: assessment.objective.desiredOutcome, constraints: assessment.objective.constraints, priority: assessment.objective.priority }),
    'SUCCESS:',
    assessment.interpretation.successDescription,
    'REQUIRED CAPABILITIES AND VERIFIED OWNERS:',
    JSON.stringify(capabilityContext),
    'SAFE ASSUMPTIONS:',
    JSON.stringify(assessment.interpretation.assumptions),
  ].join('\\n\\n').slice(0, 9000);

  const response = await askTambalaAI('orchestrator', prompt, {
    communicationType: 'CEO organisational planning',
    sender: 'Founder / Bless',
    recipient: 'Chief Executive Officer (CEO)',
  });
  return parseOrganizationalPlanProposal(response, assessment, options);
}

export class PlanProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanProposalError';
  }
}

interface ProposedStep {
  id: string;
  title: string;
  objective: string;
  capabilityId: string;
  supportingCapabilityIds: string[];
  dependsOn: string[];
  actionKind: WorkActionKind;
  requiredDataScopes: string[];
  expectedEvidence: string[];
  expectedDeliverable: string;
  acceptanceCriteria: string[];
  risk: WorkRisk;
  approvalRequired: boolean;
  reversible: boolean;
}

interface ProposedPlan {
  rationale: string;
  assumptions: string[];
  unresolvedQuestions: string[];
  steps: ProposedStep[];
}

/**
 * Parse a model-proposed plan and bind each step to roles already discovered by
 * the assessment. The model cannot invent employee IDs or grant authority.
 */
export function parseOrganizationalPlanProposal(
  response: string,
  assessment: ObjectiveAssessment,
  options: { planId: string; proposedByRoleId?: string; createdAt?: string },
): OrganizationalPlan {
  if (assessment.status !== 'ready_for_planning') {
    throw new PlanProposalError('The objective is not ready for planning. Resolve blockers or clarification first.');
  }
  const json = extractJsonObject(response);
  if (!json) throw new PlanProposalError('The CEO did not return a valid plan JSON object.');

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new PlanProposalError('The CEO returned malformed plan JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlanProposalError('The plan proposal must be a JSON object.');
  }

  const raw = value as Record<string, unknown>;
  const rationale = requiredString(raw.rationale, 'rationale', 1000);
  const assumptions = stringArray(raw.assumptions, 'assumptions', 16, 500);
  const unresolvedQuestions = stringArray(raw.unresolvedQuestions, 'unresolvedQuestions', 12, 500);
  const rawSteps = raw.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > 30) {
    throw new PlanProposalError('A plan must contain between 1 and 30 steps.');
  }

  const ready = new Map(assessment.capabilityReadiness
    .filter((item) => item.readiness === 'ready' && item.role?.id)
    .map((item) => [item.capabilityId, item]));
  const discovered = new Set(assessment.capabilityReadiness.map((item) => item.capabilityId));
  const ids = new Set<string>();
  const proposed = rawSteps.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new PlanProposalError(`Step ${index + 1} must be an object.`);
    }
    const step = item as Record<string, unknown>;
    const id = requiredString(step.id, 'step id', 80);
    if (ids.has(id)) throw new PlanProposalError(`Duplicate step id: ${id}.`);
    ids.add(id);
    const capabilityId = requiredString(step.capabilityId, 'capabilityId', 100);
    if (!discovered.has(capabilityId)) {
      throw new PlanProposalError(`Step ${id} requires undiscovered capability ${capabilityId}.`);
    }
    if (!ready.has(capabilityId)) {
      throw new PlanProposalError(`Step ${id} requires unavailable capability ${capabilityId}.`);
    }
    const supportingCapabilityIds = stringArray(step.supportingCapabilityIds, `step ${id} supportingCapabilityIds`, 10, 100);
    for (const supportId of supportingCapabilityIds) {
      if (!discovered.has(supportId) || !ready.has(supportId)) {
        throw new PlanProposalError(`Step ${id} names unavailable supporting capability ${supportId}.`);
      }
    }
    const actionKind = enumValue(step.actionKind, 'actionKind', [
      'read', 'research', 'draft', 'internal_write', 'external_communication',
      'financial', 'sensitive_data', 'security_change', 'legal_commitment',
    ] as const);
    const risk = enumValue(step.risk, 'risk', ['low', 'medium', 'high', 'critical'] as const);
    return {
      id,
      title: requiredString(step.title, 'step title', 180),
      objective: requiredString(step.objective, 'step objective', 800),
      capabilityId,
      supportingCapabilityIds,
      dependsOn: stringArray(step.dependsOn, `step ${id} dependsOn`, 30, 80),
      actionKind,
      requiredDataScopes: stringArray(step.requiredDataScopes, `step ${id} requiredDataScopes`, 20, 120),
      expectedEvidence: stringArray(step.expectedEvidence, `step ${id} expectedEvidence`, 20, 300),
      expectedDeliverable: requiredString(step.expectedDeliverable, 'expectedDeliverable', 500),
      acceptanceCriteria: stringArray(step.acceptanceCriteria, `step ${id} acceptanceCriteria`, 12, 300),
      risk,
      approvalRequired: booleanValue(step.approvalRequired, 'approvalRequired'),
      reversible: booleanValue(step.reversible, 'reversible'),
    } satisfies ProposedStep;
  });

  const covered = new Set(proposed.map((step) => step.capabilityId));
  for (const required of assessment.interpretation.requiredCapabilityIds) {
    if (!covered.has(required)) {
      throw new PlanProposalError(`The plan does not assign work to required capability ${required}.`);
    }
  }

  const steps: OrganizationalPlanStep[] = proposed.map((step) => {
    const owner = ready.get(step.capabilityId)!;
    const supportingRoles = step.supportingCapabilityIds
      .map((id) => ready.get(id)?.role?.id)
      .filter((id): id is string => Boolean(id) && id !== owner.role?.id);
    const requirement: PlanCapabilityRequirement = {
      capabilityId: step.capabilityId,
      purpose: step.objective,
      actionKind: step.actionKind,
      requiredDataScopes: step.requiredDataScopes,
      expectedEvidence: step.expectedEvidence,
    };
    return {
      id: step.id,
      title: step.title,
      objective: step.objective,
      accountableRoleId: owner.role!.id,
      supportingRoleIds: [...new Set(supportingRoles)],
      dependsOn: step.dependsOn,
      capabilityRequirements: [requirement],
      expectedDeliverable: step.expectedDeliverable,
      acceptanceCriteria: step.acceptanceCriteria,
      risk: step.risk,
      approvalRequired: step.approvalRequired,
      reversible: step.reversible,
    };
  });

  const plan: OrganizationalPlan = {
    id: options.planId,
    objectiveId: assessment.objective.id,
    rationale,
    assumptions,
    unresolvedQuestions,
    steps,
    proposedByRoleId: options.proposedByRoleId ?? 'ceo',
    createdAt: options.createdAt ?? new Date().toISOString(),
    revision: 1,
  };
  const issues = validateAssessmentPlan(assessment, plan);
  if (issues.length) throw new PlanProposalError(issues.join(' '));
  return plan;
}

function extractJsonObject(response: string): string | null {
  const text = response.trim().replace(/^\uFEFF/, '').replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/i, '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new PlanProposalError(`Missing ${field}.`);
  return value.trim().slice(0, max);
}

function stringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string')) {
    throw new PlanProposalError(`Invalid ${field} list.`);
  }
  return value.map((item) => (item as string).trim().slice(0, maxLength)).filter(Boolean);
}

function enumValue<const T extends readonly string[]>(value: unknown, field: string, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new PlanProposalError(`Invalid ${field}.`);
  return value as T[number];
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new PlanProposalError(`Invalid ${field}; expected a boolean.`);
  return value;
}
