import { randomUUID } from 'node:crypto';
import { createApprovalRequest, registerApprovalHook, type ApprovalRow } from './approvals-service.js';
import { saveDutyConfig } from './duty-service.js';
import { roleIdFor } from './profiles.js';
import { validateCustomDuty } from './duty-config.js';
import { AGENT_DIRECTORY, type AgentName } from '../../services/ai/models.js';

const PROPOSER_ROLES = new Set([roleIdFor('people'), roleIdFor('strategy')]);
const SUBJECT = 'governed_duty_proposal';

export interface DutyProposal {
  title: string;
  agent: AgentName;
  cadence: { kind: 'weekdays' } | { kind: 'weekly'; day: number };
  time: string;
  contexts: string[];
  job: string;
  deliverable: string;
  requiresApproval: boolean;
  enabled: boolean;
}

export async function proposeDutyChange(proposedByRoleId: string, proposal: DutyProposal): Promise<string> {
  if (!PROPOSER_ROLES.has(proposedByRoleId)) throw new Error('Only People/HR or Strategy may propose a new standing duty.');
  if (!(proposal.agent in AGENT_DIRECTORY)) throw new Error('The proposed duty must belong to an existing employee.');
  if (proposal.enabled !== true) throw new Error('A new duty proposal must be enabled explicitly; disabling existing duties uses the Founder duty configuration path.');
  if (proposal.requiresApproval !== true) throw new Error('New standing duties must retain approval for prepared work until a separate Founder policy authorizes otherwise.');
  const content = JSON.stringify({ version: 1, proposal });
  const id = await createApprovalRequest({
    actionType: 'governed_duty_proposal',
    summary: `Proposed standing duty: ${proposal.title}`,
    requestedByRoleId: proposedByRoleId,
    riskLevel: 'low',
    taskId: null,
    content,
    subjectType: SUBJECT,
    subjectId: randomUUID(),
  });
  if (!id) throw new Error('Duty proposals require persistent approval storage. Configure Supabase first.');
  return id;
}

registerApprovalHook(SUBJECT, async (approval: ApprovalRow, decision: 'approved' | 'rejected') => {
  if (decision !== 'approved') return;
  if (!approval.content) throw new Error('Approved duty proposal has no stored content.');
  const parsed = JSON.parse(approval.content) as { version?: unknown; proposal?: unknown };
  if (parsed.version !== 1 || !parsed.proposal || typeof parsed.proposal !== 'object') throw new Error('Duty proposal content version is invalid.');
  const proposal = parsed.proposal as DutyProposal;
  const takenIds = new Set<string>();
  // The existing config path performs final validation, id allocation and persistence.
  const validated = validateCustomDuty({
    title: proposal.title,
    agent: proposal.agent,
    cadence: proposal.cadence,
    time: proposal.time,
    contexts: proposal.contexts,
    job: proposal.job,
    deliverable: proposal.deliverable,
    requiresApproval: proposal.requiresApproval,
    enabled: proposal.enabled,
  }, takenIds);
  await saveDutyConfig({ custom: validated });
});
