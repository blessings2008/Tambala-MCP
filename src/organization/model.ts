/**
 * Core organizational domain types.
 *
 * These types describe the organization independently of MCP transport,
 * AI providers, databases, and external integrations.
 */

export type OrganizationUnitKind = 'division' | 'department' | 'business_unit';
export type OrganizationUnitStatus = 'planned' | 'active' | 'paused' | 'retired';
export type RoleKind = 'human' | 'ai_agent' | 'shared_responsibility';
export type DecisionStatus = 'proposed' | 'pending_approval' | 'approved' | 'rejected' | 'superseded';
export type ApprovalAuthority = 'founder' | 'board' | 'ceo' | 'department_director';

export interface OrganizationUnit {
  id: string;
  name: string;
  kind: OrganizationUnitKind;
  parentId: string | null;
  purpose: string;
  status: OrganizationUnitStatus;
  /** Optional IDs of roles accountable for this unit. */
  accountableRoleIds: string[];
  /** Stable tags help the system find units without relying on display names. */
  tags: string[];
}

export interface OrganizationalRole {
  id: string;
  title: string;
  kind: RoleKind;
  unitId: string | null;
  reportsToRoleId: string | null;
  purpose: string;
  /** Capability names are interpreted by deterministic authorization code. */
  capabilities: string[];
  /** This describes an organizational position; it does not require a dedicated agent yet. */
  activation: 'planned' | 'active';
}

export interface StrategicObjective {
  id: string;
  title: string;
  description: string;
  ownerRoleId: string;
  status: 'proposed' | 'active' | 'paused' | 'completed' | 'cancelled';
  createdAt: string;
  reviewAt?: string;
}

export interface OrganizationalDecision {
  id: string;
  title: string;
  rationale: string;
  proposedByRoleId: string;
  status: DecisionStatus;
  requiredAuthority: ApprovalAuthority | null;
  evidenceRefs: string[];
  createdAt: string;
  decidedAt?: string;
  decidedByRoleId?: string;
}

export interface ApprovalRequest {
  id: string;
  actionType: string;
  summary: string;
  requestedByRoleId: string;
  requiredAuthority: ApprovalAuthority;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  resolvedAt?: string;
  resolvedByRoleId?: string;
}

export interface AuditEvent {
  id: string;
  actorRoleId: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: 'success' | 'denied' | 'failed';
  reason: string;
  createdAt: string;
  correlationId?: string;
}

export interface OrganizationDefinition {
  id: string;
  name: string;
  mission: string;
  ownerRoleId: string;
  ceoRoleId: string;
  boardRoleId: string;
  executiveCouncilRoleId: string;
  units: OrganizationUnit[];
  roles: OrganizationalRole[];
}
