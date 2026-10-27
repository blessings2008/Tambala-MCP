import type { OrganizationTaskStatus } from './task-store.js';

export const ORGANIZATION_TASK_TRANSITIONS: Readonly<Record<OrganizationTaskStatus, readonly OrganizationTaskStatus[]>> = {
  created: ['ceo_analyzing', 'failed'],
  ceo_analyzing: ['delegated', 'needs_more_work', 'failed'],
  delegated: ['executing', 'needs_more_work', 'failed'],
  executing: ['waiting_for_tool', 'department_review', 'returned_to_ceo', 'failed'],
  waiting_for_tool: ['executing', 'failed'],
  department_review: ['returned_to_ceo', 'needs_more_work', 'failed'],
  returned_to_ceo: ['completed', 'needs_more_work', 'failed'],
  needs_more_work: ['ceo_analyzing', 'delegated', 'failed'],
  completed: [],
  failed: ['ceo_analyzing'],
};

export function isAllowedOrganizationTaskTransition(
  from: OrganizationTaskStatus,
  to: OrganizationTaskStatus,
): boolean {
  return ORGANIZATION_TASK_TRANSITIONS[from].includes(to);
}
