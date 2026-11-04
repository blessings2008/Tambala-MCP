import type {
  ApprovalRequest,
  AuditEvent,
  OrganizationalDecision,
  OrganizationDefinition,
} from './model.js';

/**
 * Persistence boundary for organizational state.
 *
 * Implementations must load role assignments and approval decisions from trusted
 * storage. Never accept actor roles or approval records supplied by model output
 * or an untrusted MCP caller as proof of authority.
 */
export interface OrganizationRepository {
  getDefinition(): Promise<OrganizationDefinition>;
  listPendingApprovals(limit?: number): Promise<ApprovalRequest[]>;
  createApprovalRequest(
    request: Omit<ApprovalRequest, 'id' | 'createdAt' | 'status'>,
  ): Promise<ApprovalRequest>;
  resolveApprovalRequest(input: {
    approvalId: string;
    resolverRoleId: string;
    outcome: 'approved' | 'rejected';
    note: string;
  }): Promise<ApprovalRequest>;
  recordDecision(
    decision: Omit<OrganizationalDecision, 'id' | 'createdAt'>,
  ): Promise<OrganizationalDecision>;
  appendAuditEvent(
    event: Omit<AuditEvent, 'id' | 'createdAt'>,
  ): Promise<AuditEvent>;
}
