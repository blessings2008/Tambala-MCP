import type { McpServer } from '@modelcontextprotocol/server';
import { recordAudit } from './audit.js';
import { resolveOrganizationIdentity } from './identity-service.js';
import type { OrganizationalRole } from './model.js';

/** Tools that change CRM/work records. Need a bound role with delegated workflow authority. */
export const STANDARD_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'create_client', 'update_client', 'create_project', 'update_project',
  'create_lead', 'update_lead', 'create_task', 'update_task',
  'record_activity', 'run_tambala_automation', 'run_due_organization_duties', 'assign_work_to_employee', 'create_document',
]);

/** Tools that move money, contact people, archive data or approve actions. Founder only. */
export const SENSITIVE_TOOLS: ReadonlySet<string> = new Set([
  'archive_client', 'send_daily_report', 'decide_organization_approval', 'send_whatsapp_message', 'set_price_list_item', 'create_invoice_link',
  'approve_automation_action', 'mark_automation_action_sent',
  'tambala_pay_create_invoice', 'tambala_pay_create_invoice_payment', 'tambala_pay_create_payment_request',
]);

export type GuardDecision = { allowed: boolean; reason: string; roleId: string | null };

export function enforcementEnabled(): boolean {
  return process.env.TAMBALA_ENFORCE_ROLE_BINDINGS === 'true';
}

/** Pure decision used by tests: which roles may call which class of tool. */
export function decideForRole(role: OrganizationalRole | null, tool: string): GuardDecision {
  if (!role) return { allowed: false, reason: 'No organization role is bound to this connection.', roleId: null };
  if (role.activation !== 'active') return { allowed: false, reason: `Role ${role.id} is not active.`, roleId: role.id };
  if (role.id === 'founder') return { allowed: true, reason: 'Founder role.', roleId: role.id };
  if (SENSITIVE_TOOLS.has(tool)) {
    return { allowed: false, reason: `${tool} is Founder-only: it moves money, contacts people, archives data or approves actions.`, roleId: role.id };
  }
  const delegated = role.capabilities.includes('department.workflow.manage') || role.capabilities.includes('work.delegate');
  return delegated
    ? { allowed: true, reason: 'Role holds delegated workflow authority.', roleId: role.id }
    : { allowed: false, reason: `Role ${role.id} lacks delegated workflow authority.`, roleId: role.id };
}

async function audit(tool: string, decision: GuardDecision): Promise<void> {
  await recordAudit({ actorRoleId: decision.roleId, action: `tool:${tool}`, targetType: 'mcp_tool', targetId: tool, outcome: decision.allowed ? 'success' : 'denied', reason: decision.reason });
}

export async function authorizeToolCall(tool: string): Promise<GuardDecision> {
  if (!enforcementEnabled()) return { allowed: true, reason: 'Role enforcement is off (TAMBALA_ENFORCE_ROLE_BINDINGS != true).', roleId: null };
  const identity = await resolveOrganizationIdentity();
  const decision = identity.authenticated && identity.principalType === 'oauth'
    ? decideForRole(identity.role, tool)
    : { allowed: false, reason: identity.authenticated ? 'The shared bearer token cannot identify a role. Connect through OAuth and bind the client.' : identity.reason, roleId: null };
  await audit(tool, decision);
  return decision;
}

/** Wrap registerTool so guarded tools check the caller's bound role before running. */
export function withWriteGuard(server: McpServer): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== 'registerTool') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (name: string, config: unknown, handler: (...args: unknown[]) => Promise<unknown>) => {
        const guarded = STANDARD_WRITE_TOOLS.has(name) || SENSITIVE_TOOLS.has(name);
        const wrapped = guarded
          ? async (...args: unknown[]) => {
              const decision = await authorizeToolCall(name);
              if (!decision.allowed) {
                return { isError: true, content: [{ type: 'text', text: JSON.stringify({ denied: true, tool: name, reason: decision.reason }, null, 2) }] };
              }
              return handler(...args);
            }
          : handler;
        return (target.registerTool as (...a: unknown[]) => unknown).call(target, name, config, wrapped);
      };
    },
  }) as McpServer;
}
