import { createHash, randomUUID } from 'node:crypto';
import { getAgentOperationalInfo } from '../../services/ai.js';
import { supabaseSelect } from '../../lib/supabase.js';
import { getOrganizationSnapshot } from '../service.js';
import { createOrganizationTask, updateOrganizationTask } from '../task-store.js';
import type { OrganizationalPlan, OrganizationalPlanStep } from '../runtime-contracts.js';
import {
  buildPlanProposalEvent,
  loadPlanProgressFromHandoffs,
  preparePlanStepDispatches,
  queuePreparedPlanHandoffs,
} from '../plan-task-bridge.js';
import type { StepApprovalStatus } from '../plan-coordinator.js';
import { createApprovalRequest, registerApprovalHook, type ApprovalRow } from './approvals-service.js';
import { getEmployeeProfiles } from './profiles.js';
import { SupabaseHandoffStore } from './handoffs.js';
import { dbConfigured } from './db-util.js';

const APPROVAL_SUBJECT = 'organizational_plan_step';
const PLAN_EVENT_TYPE = 'organizational_plan_proposed';

type PlanEventRow = {
  task_id: string;
  payload: unknown;
  event_key: string | null;
  created_at: string;
};

export function planFingerprint(plan: OrganizationalPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

export function planApprovalSubjectId(plan: OrganizationalPlan, step: OrganizationalPlanStep, planHash = planFingerprint(plan)): string {
  return [plan.id, String(plan.revision), step.id, planHash].join(':');
}

function parseApprovalContent(value: string | null): {
  schema: string;
  planHash: string;
  stepId: string;
  plan: OrganizationalPlan;
} | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.schema !== 'tambala.plan-step-approval.v1'
      || typeof parsed.planHash !== 'string'
      || typeof parsed.stepId !== 'string'
      || !parsed.plan || typeof parsed.plan !== 'object') return null;
    return parsed as unknown as {
      schema: string;
      planHash: string;
      stepId: string;
      plan: OrganizationalPlan;
    };
  } catch {
    return null;
  }
}

export function matchesExactPlanApproval(
  contentValue: string | null,
  subjectId: string | null,
  plan: OrganizationalPlan,
  step: OrganizationalPlanStep,
): boolean {
  const content = parseApprovalContent(contentValue);
  const hash = planFingerprint(plan);
  return Boolean(content && content.planHash === hash && content.stepId === step.id
    && content.plan.id === plan.id && content.plan.revision === plan.revision
    && planFingerprint(content.plan) === hash && subjectId === planApprovalSubjectId(plan, step, hash));
}
function planFromEvent(payload: unknown): OrganizationalPlan | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  if (root.schema !== 'tambala.organizational-plan' || root.schemaVersion !== 1
    || !root.plan || typeof root.plan !== 'object' || Array.isArray(root.plan)) return null;
  const plan = root.plan as OrganizationalPlan;
  if (typeof plan.id !== 'string' || !plan.id.trim()
    || !Number.isInteger(plan.revision) || !Array.isArray(plan.steps) || !plan.steps.length) return null;
  return plan;
}

async function createStepApprovals(taskId: string, plan: OrganizationalPlan): Promise<number> {
  const planHash = planFingerprint(plan);
  const existing = await supabaseSelect<ApprovalRow>(
    'organization_approval_requests',
    `select=*&task_id=eq.${encodeURIComponent(taskId)}&subject_type=eq.${APPROVAL_SUBJECT}&limit=200`,
  );
  let created = 0;
  for (const step of plan.steps.filter((item) => item.approvalRequired)) {
    const subjectId = planApprovalSubjectId(plan, step, planHash);
    const matches = existing.filter((row) => row.subject_id === subjectId);
    if (matches.length > 1) throw new Error(`Duplicate approval records exist for plan step ${step.id}; execution is paused for review.`);
    if (matches.length === 1) {
      const content = parseApprovalContent(matches[0]?.content ?? null);
      if (!content || content.planHash !== planHash || content.stepId !== step.id) {
        throw new Error(`The existing approval record for step ${step.id} does not match this plan revision.`);
      }
      continue;
    }
    const approvalId = await createApprovalRequest({
      actionType: 'organizational_plan_step',
      summary: `Founder approval [${step.risk}]: ${step.title}. Objective: ${step.objective}. Deliverable: ${step.expectedDeliverable}`,
      requestedByRoleId: 'ceo',
      riskLevel: step.risk,
      taskId,
      subjectType: APPROVAL_SUBJECT,
      subjectId,
      content: JSON.stringify({
        schema: 'tambala.plan-step-approval.v1',
        planHash,
        stepId: step.id,
        plan,
      }),
    });
    if (!approvalId) throw new Error('Persistent Founder approvals are unavailable; the plan was saved but no step may be dispatched.');
    created++;
  }
  return created;
}

async function approvalStatusesForPlan(
  taskId: string,
  plan: OrganizationalPlan,
): Promise<Record<string, StepApprovalStatus>> {
  const rows = await supabaseSelect<ApprovalRow>(
    'organization_approval_requests',
    `select=*&task_id=eq.${encodeURIComponent(taskId)}&subject_type=eq.${APPROVAL_SUBJECT}&limit=200`,
  );
  const hash = planFingerprint(plan);
  const statuses: Record<string, StepApprovalStatus> = {};
  for (const step of plan.steps) {
    if (!step.approvalRequired) {
      statuses[step.id] = 'not_required';
      continue;
    }
    const subjectId = approvalSubjectId(plan, step, hash);
    const matches = rows.filter((row) => row.subject_id === subjectId);
    if (matches.length !== 1) {
      statuses[step.id] = 'pending';
      continue;
    }
    const row = matches[0]!;
    const exact = matchesExactPlanApproval(row.content, row.subject_id, plan, step);
    if (!exact) {
      statuses[step.id] = 'pending';
      continue;
    }
    statuses[step.id] = row.status === 'approved' ? 'approved'
      : row.status === 'rejected' || row.status === 'cancelled' ? 'rejected'
        : 'pending';
  }
  return statuses;
}

async function reconcileOnePlan(taskId: string, plan: OrganizationalPlan): Promise<number> {
  const snapshot = await getOrganizationSnapshot();
  const activeRoleIds = new Set(snapshot.organization.roles
    .filter((role) => role.activation === 'active')
    .map((role) => role.id));
  const profiles = getEmployeeProfiles();
  const employeeRoutes = profiles.map((profile) => ({
    agent: profile.agent,
    roleId: profile.roleId,
    active: activeRoleIds.has(profile.roleId),
    runtimeReady: getAgentOperationalInfo(profile.agent).ready,
  }));
  const store = new SupabaseHandoffStore();
  const approvals = await approvalStatusesForPlan(taskId, plan);
  const progress = await loadPlanProgressFromHandoffs(plan, store, approvals);
  const prepared = preparePlanStepDispatches(plan, progress, activeRoleIds, employeeRoutes);
  const result = prepared.dispatches.length ? await queuePreparedPlanHandoffs({
    prepared,
    store,
    parentTaskId: taskId,
    actorRoleId: 'ceo',
  }) : { queued: [], blocked: prepared.blockers };
  const states = prepared.coordination.steps.map((step) => step.status);
  if (states.length && states.every((status) => status === 'completed')) {
    await updateOrganizationTask(taskId, { status: 'completed', current_stage: 'complete', completed_at: new Date().toISOString(), error_message: null });
  } else if (states.some((status) => status === 'failed' || status === 'blocked_approval_rejected' || status === 'blocked_owner_inactive')) {
    await updateOrganizationTask(taskId, { status: 'needs_more_work', current_stage: 'ceo', error_message: prepared.coordination.replanReasons.join('; ').slice(0, 1000) || 'Plan requires CEO review.' });
  } else if (result.queued.length || states.some((status) => status === 'queued' || status === 'in_progress')) {
    await updateOrganizationTask(taskId, { status: 'delegated', current_stage: 'department', error_message: null });
  } else if (states.some((status) => status === 'awaiting_approval' || status === 'awaiting_founder')) {
    await updateOrganizationTask(taskId, { status: 'awaiting_founder', current_stage: 'founder' });
  }
  return result.queued.length;
}

/**
 * Persist a validated CEO plan against the existing organization task/event,
 * create one exact-revision approval request per gated step, then queue only
 * dependency-ready steps that do not require approval.
 */
export async function persistFounderPlanProposal(input: {
  objective: string;
  plan: OrganizationalPlan;
}): Promise<{ taskId: string; approvalRequests: number; queuedSteps: number }> {
  if (!dbConfigured()) throw new Error('Adaptive plan execution requires the persistent organization database.');
  if (!input.objective.trim() || !input.plan.steps.length) throw new Error('A complete objective and validated plan are required.');
  const taskId = randomUUID();
  await createOrganizationTask({ id: taskId, objective: input.objective.trim().slice(0, 1000) });
  await updateOrganizationTask(taskId, { status: 'ceo_analyzing', current_stage: 'ceo' });
  await import('../task-store.js').then(({ recordOrganizationTaskEvent }) =>
    recordOrganizationTaskEvent(buildPlanProposalEvent(taskId, input.plan)),
  );
  const approvalRequests = await createStepApprovals(taskId, input.plan);
  const queuedSteps = await reconcileOnePlan(taskId, input.plan);
  await updateOrganizationTask(taskId, {
    status: queuedSteps > 0 ? 'delegated' : approvalRequests > 0 ? 'awaiting_founder' : 'ceo_analyzing',
    current_stage: queuedSteps > 0 ? 'department' : approvalRequests > 0 ? 'founder' : 'ceo',
  });
  return { taskId, approvalRequests, queuedSteps };
}

/**
 * Reconcile saved proposals on every existing workforce maintenance cycle.
 * It rebuilds approvals and handoff state from durable rows and uses the
 * existing dispatch-key uniqueness to make retries safe.
 */
export async function reconcileOrganizationalPlans(maxPlans = 40): Promise<number> {
  if (!dbConfigured()) return 0;
  const events = await supabaseSelect<PlanEventRow>(
    'organization_task_events',
    `select=task_id,payload,event_key,created_at&event_type=eq.${PLAN_EVENT_TYPE}&order=created_at.desc&limit=${Math.max(1, Math.min(100, Math.floor(maxPlans)))}`,
  );
  const latestByPlan = new Map<string, PlanEventRow>();
  for (const event of events) {
    const plan = planFromEvent(event.payload);
    if (!plan) continue;
    const key = `${event.task_id}:${plan.id}`;
    if (!latestByPlan.has(key)) latestByPlan.set(key, event);
  }
  let queued = 0;
  for (const event of latestByPlan.values()) {
    const plan = planFromEvent(event.payload);
    if (!plan) continue;
    try {
      queued += await reconcileOnePlan(event.task_id, plan);
    } catch (error) {
      console.error('Adaptive plan reconciliation held safely:', {
        taskId: event.task_id,
        planId: plan.id,
        reason: error instanceof Error ? error.message.slice(0, 240) : 'Unknown reconciliation error',
      });
    }
  }
  return queued;
}


/** An approved plan step is reconciled immediately; dependency checks still apply. */
registerApprovalHook(APPROVAL_SUBJECT, async (approval, decision) => {
  if (decision !== 'approved' || !approval.task_id) return;
  const content = parseApprovalContent(approval.content);
  const step = content?.plan.steps.find((candidate) => candidate.id === content.stepId);
  if (!content || !step || !matchesExactPlanApproval(approval.content, approval.subject_id, content.plan, step)) {
    throw new Error('The approval does not match its exact plan revision and step; no work was dispatched.');
  }
  await reconcileOnePlan(approval.task_id, content.plan);
});
