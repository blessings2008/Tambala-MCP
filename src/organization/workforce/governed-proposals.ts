import { randomUUID } from 'node:crypto';
import { supabaseInsert } from '../../lib/supabase.js';
import { getPersistedOrganizationSnapshot } from '../persisted-service.js';
import { createApprovalRequest, registerApprovalHook, type ApprovalRow } from './approvals-service.js';
import { roleIdFor } from './profiles.js';
import { requireConfigStore, validateCustomDuty, type CustomDutyRow, type DutyConfigStore } from './duty-config.js';
import { STANDING_DUTIES } from './duties.js';
import { AGENT_DIRECTORY, type AgentName } from '../../services/ai/models.js';

const PROPOSER_ROLES = new Set([roleIdFor('people'), roleIdFor('strategy')]);
const SUBJECT = 'governed_duty_proposal';
const ROLE_SUBJECT = 'governed_role_proposal';

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

export async function activateApprovedDutyProposal(
  approval: Pick<ApprovalRow, 'id' | 'content'>,
  store: DutyConfigStore = requireConfigStore(),
): Promise<CustomDutyRow> {
  if (!approval.content) throw new Error('Approved duty proposal has no stored content.');
  const parsed = JSON.parse(approval.content) as { version?: unknown; proposal?: unknown };
  if (parsed.version !== 1 || !parsed.proposal || typeof parsed.proposal !== 'object') throw new Error('Duty proposal content version is invalid.');
  const stableId = `founder-approved-${approval.id.replace(/[^a-f0-9]/gi, '').toLowerCase()}`;
  const existing = await store.customs();
  const alreadyActivated = existing.find((duty) => duty.id === stableId);
  if (alreadyActivated) return alreadyActivated;
  const takenIds = new Set([...STANDING_DUTIES.map((duty) => duty.id), ...existing.map((duty) => duty.id)]);
  const validated = validateCustomDuty(parsed.proposal, takenIds, stableId);
  await store.saveCustom(validated);
  return validated;
}

registerApprovalHook(SUBJECT, async (approval: ApprovalRow, decision: 'approved' | 'rejected') => {
  if (decision !== 'approved') return;
  await activateApprovedDutyProposal(approval);
});

export interface RoleProposal {
  title: string;
  kind: 'human' | 'shared_responsibility';
  unitId: string;
  reportsToRoleId: string;
  purpose: string;
}

export async function proposeRoleChange(proposedByRoleId: string, proposal: RoleProposal): Promise<string> {
  if (!PROPOSER_ROLES.has(proposedByRoleId)) throw new Error('Only People/HR or Strategy may propose a new organizational role.');
  if (!['human', 'shared_responsibility'].includes(proposal.kind)) throw new Error('AI agent roles cannot be created through this proposal path; frozen employee numbers must be assigned through the Founder-controlled hiring process.');
  if (proposal.title.trim().length < 3 || proposal.title.length > 120 || proposal.purpose.trim().length < 10 || proposal.purpose.length > 1000) throw new Error('Role title or purpose is outside the allowed length.');
  const snapshot = await getPersistedOrganizationSnapshot();
  if (!snapshot.organization.units.some((unit) => unit.id === proposal.unitId)) throw new Error('The proposed role must belong to an existing organizational unit.');
  if (!snapshot.organization.roles.some((role) => role.id === proposal.reportsToRoleId)) throw new Error('The proposed reporting line must reference an existing role.');
  const id = `${proposal.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${randomUUID().slice(0, 8)}`;
  const content = JSON.stringify({ version: 1, id, proposal });
  const approvalId = await createApprovalRequest({
    actionType: 'governed_role_proposal',
    summary: `Proposed organizational role: ${proposal.title}`,
    requestedByRoleId: proposedByRoleId,
    riskLevel: 'medium',
    taskId: null,
    content,
    subjectType: ROLE_SUBJECT,
    subjectId: id,
  });
  if (!approvalId) throw new Error('Role proposals require persistent approval storage. Configure Supabase first.');
  return approvalId;
}

registerApprovalHook(ROLE_SUBJECT, async (approval: ApprovalRow, decision: 'approved' | 'rejected') => {
  if (decision !== 'approved') return;
  if (!approval.content) throw new Error('Approved role proposal has no stored content.');
  const parsed = JSON.parse(approval.content) as { version?: unknown; id?: unknown; proposal?: unknown };
  if (parsed.version !== 1 || typeof parsed.id !== 'string' || !parsed.proposal || typeof parsed.proposal !== 'object') throw new Error('Role proposal content version is invalid.');
  const proposal = parsed.proposal as RoleProposal;
  const snapshot = await getPersistedOrganizationSnapshot();
  if (!snapshot.organization.units.some((unit) => unit.id === proposal.unitId) || !snapshot.organization.roles.some((role) => role.id === proposal.reportsToRoleId)) {
    throw new Error('The organizational structure changed since this proposal was submitted; Founder review is required again.');
  }
  await supabaseInsert('organization_roles', {
    id: parsed.id,
    title: proposal.title,
    kind: proposal.kind,
    unit_id: proposal.unitId,
    reports_to_role_id: proposal.reportsToRoleId,
    purpose: proposal.purpose,
    capabilities: [],
    activation: 'active',
  });
});
