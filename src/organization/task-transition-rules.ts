import type { OrganizationTaskStatus } from './task-store.js';

export const ORGANIZATION_TASK_TRANSITIONS: Readonly<Record<OrganizationTaskStatus, readonly OrganizationTaskStatus[]>> = {
  // A handoff can be quarantined before the CEO has moved a newly created or delegated
  // task into execution. Founder review is a safe pause state, not a completion shortcut.
  created: ['ceo_analyzing', 'awaiting_founder', 'failed'],
  ceo_analyzing: ['delegated', 'needs_more_work', 'failed'],
  delegated: ['executing', 'needs_more_work', 'awaiting_founder', 'failed'],
  executing: ['waiting_for_tool', 'department_review', 'returned_to_ceo', 'ceo_analyzing', 'needs_more_work', 'awaiting_founder', 'failed'],
  waiting_for_tool: ['executing', 'failed'],
  department_review: ['returned_to_ceo', 'needs_more_work', 'failed'],
  returned_to_ceo: ['completed', 'needs_more_work', 'failed'],
  needs_more_work: ['ceo_analyzing', 'delegated', 'awaiting_founder', 'failed'],
  awaiting_founder: ['ceo_analyzing', 'failed'],
  completed: [],
  failed: ['ceo_analyzing', 'awaiting_founder', 'superseded'],
  superseded: [],
};

export function isAllowedOrganizationTaskTransition(
  from: OrganizationTaskStatus,
  to: OrganizationTaskStatus,
): boolean {
  return ORGANIZATION_TASK_TRANSITIONS[from].includes(to);
}
