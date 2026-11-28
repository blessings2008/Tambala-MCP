import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { ApprovalError, decideApproval } from '../organization/workforce/approvals-service.js';
import { assignWork, buildWorkforce, getLatestBriefing, runDutiesOnce } from '../organization/workforce/duty-service.js';
import { verifySignature } from '../organization/workforce/sign-work.js';
import { HandoffError } from '../organization/workforce/handoffs.js';
import { AGENT_DIRECTORY } from '../services/ai/models.js';
import { resolveOrganizationIdentity } from '../organization/identity-service.js';
import { proposeDutyChange, proposeRoleChange } from '../organization/workforce/governed-proposals.js';

function text(value: unknown, isError = false) {
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

const proposalEvidence = z.array(z.object({
  type: z.enum(['crm_record', 'task', 'duty_run', 'organization_report', 'web_source']),
  reference: z.string().min(3).max(300),
  summary: z.string().min(10).max(500),
  sourceUrl: z.string().url().refine((value) => value.startsWith('https://'), 'Evidence URLs must use HTTPS.').optional(),
})).min(1).max(8);

export function registerWorkforceTools(server: McpServer): void {
  server.registerTool('get_workforce_status', {
    description: 'Read the staff directory: each employee’s live operational state (available, assigned, processing, awaiting Founder input, unequipped, inactive), inbox and recent work. Calendar duties are separate from employee availability. Read-only.',
    inputSchema: {},
  }, async () => {
    const w = await buildWorkforce();
    return text({
      office: w.office, today: w.today, persistence: w.persistence,
      handoffs: w.handoffs.slice(0, 10).map((h) => ({ from: h.from, to: h.to, request: h.request, status: h.status })),
      employees: w.employees.map((e) => ({ employeeNumber: e.employeeNumber, title: e.title, status: e.status, inbox: e.inbox, week: e.week, duties: e.duties.map((d) => ({ id: d.id, title: d.title, schedule: d.schedule, state: d.state })) })),
    });
  });

  server.registerTool('run_due_organization_duties', {
    description: 'Run every standing duty that is due now (idempotent: each duty runs once per day or week). Optionally run one duty by id immediately with force. Employees only work if their role is active and their model is configured; otherwise the duty is recorded as skipped with the reason. Drafts are parked for Founder approval and never sent.',
    inputSchema: {
      dutyId: z.string().optional().describe('Run only this duty (built-in or custom id, see get_workforce_status).'),
      force: z.boolean().optional().default(false).describe('With dutyId: run now even if it already ran this period.'),
    },
  }, async ({ dutyId, force }) => {
    try { return text(await runDutiesOnce({ dutyId, force: Boolean(force && dutyId) })); }
    catch (error) { return text({ error: error instanceof Error ? error.message : 'Duty run failed.' }, true); }
  });

  server.registerTool('get_daily_briefing', {
    description: 'Read the latest daily executive briefing compiled by the CEO from the day’s duty results. Read-only.',
    inputSchema: {},
  }, async () => {
    const briefing = await getLatestBriefing();
    return text(briefing ?? { message: 'No briefing has been compiled yet. It is produced at 16:30 office time on weekdays, or run the ceo-daily-briefing duty.' });
  });

  server.registerTool('decide_organization_approval', {
    description: 'Founder decision on a pending approval request. Approving records the decision only; nothing is sent automatically. Rejecting requires a reason.',
    inputSchema: {
      approvalId: z.string().describe('Approval request id from list_pending_organization_approvals.'),
      decision: z.enum(['approved', 'rejected']),
      note: z.string().max(1000).optional().describe('Required when rejecting.'),
    },
  }, async ({ approvalId, decision, note }) => {
    try { return text(await decideApproval({ id: approvalId, decision, note })); }
    catch (error) {
      if (error instanceof ApprovalError) return text({ error: error.message }, true);
      throw error;
    }
  });

  server.registerTool('assign_work_to_employee', {
    description: 'Assign work directly to an employee as their manager. The assignment is placed in the employee inbox and processed immediately, without waiting for a scheduled duty. If the employee is inactive or unequipped, the handoff remains queued with the blocker shown. Results are internal; drafts are never sent.',
    inputSchema: {
      employee: z.enum(Object.keys(AGENT_DIRECTORY).filter((a) => a !== 'orchestrator') as [string, ...string[]]).describe('Employee key, e.g. outreach, finance, marketing.'),
      request: z.string().min(5).max(1000).describe('What you need done, in plain words.'),
    },
  }, async ({ employee, request }) => {
    try {
      const h = await assignWork(employee as keyof typeof AGENT_DIRECTORY, request);
      return text({
        handoffId: h.id, roomId: h.room_id, to: employee, request: h.request,
        status: h.status, queued: h.status === 'queued', result: h.result, blocker: h.error,
      });
    } catch (error) {
      if (error instanceof HandoffError) return text({ error: error.message }, true);
      throw error;
    }
  });

  server.registerTool('propose_organization_duty', {
    description: 'People/HR or Strategy may propose a new standing duty for an existing employee. The proposal goes to the Founder approval inbox. It is not activated until the Founder approves it. This cannot change employee permissions, trust thresholds, pricing, spending caps or regulatory policy.',
    inputSchema: {
      title: z.string().min(3).max(120),
      employee: z.enum(Object.keys(AGENT_DIRECTORY) as [string, ...string[]]),
      cadence: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('weekdays') }),
        z.object({ kind: z.literal('weekly'), day: z.number().int().min(1).max(7) }),
      ]),
      time: z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/),
      contexts: z.array(z.enum(['crm', 'company', 'organization', 'catalog', 'invoices'])).max(5),
      job: z.string().min(10).max(2000),
      deliverable: z.string().min(5).max(1000),
      evidence: proposalEvidence,
    },
  }, async ({ title, employee, cadence, time, contexts, job, deliverable, evidence }) => {
    const identity = await resolveOrganizationIdentity();
    if (!identity.authenticated || !identity.role) return text({ error: 'A trusted OAuth role binding is required.' }, true);
    try {
      const approvalId = await proposeDutyChange(identity.role.id, {
        title, agent: employee as keyof typeof AGENT_DIRECTORY, cadence, time, contexts, job, deliverable,
        requiresApproval: true, enabled: true, evidence,
      });
      return text({ status: 'pending_founder_approval', approvalId, summary: `Proposed duty “${title}” for ${employee}. It is not active until Founder approval.` });
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : 'Could not submit duty proposal.' }, true);
    }
  });

  server.registerTool('propose_organization_role', {
    description: 'People/HR or Strategy may propose a human or shared-responsibility role inside an existing unit. The proposal goes to the Founder approval inbox. After approval it is added through the persistent organization role table with no capabilities granted. This does not create an AI employee or assign an employee number.',
    inputSchema: {
      title: z.string().min(3).max(120),
      kind: z.enum(['human', 'shared_responsibility']),
      unitId: z.string().min(2).max(80),
      reportsToRoleId: z.string().min(2).max(100),
      purpose: z.string().min(10).max(1000),
      evidence: proposalEvidence,
    },
  }, async ({ title, kind, unitId, reportsToRoleId, purpose, evidence }) => {
    const identity = await resolveOrganizationIdentity();
    if (!identity.authenticated || !identity.role) return text({ error: 'A trusted OAuth role binding is required.' }, true);
    try {
      const approvalId = await proposeRoleChange(identity.role.id, { title, kind, unitId, reportsToRoleId, purpose, evidence });
      return text({ status: 'pending_founder_approval', approvalId, summary: `Proposed role “${title}”. No role is added until Founder approval.` });
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : 'Could not submit role proposal.' }, true);
    }
  });

  server.registerTool('verify_signature', {
    description: 'Check a worker signature. Give the fingerprint printed under any piece of work (like 7F3A-91C2-B0D4-18E6). Returns who signed it (employee number), what kind of record it is, when, whether it is authentic, and the exact content that was signed. Read-only.',
    inputSchema: { fingerprint: z.string().min(8).max(40).describe('The signature fingerprint, e.g. 7F3A-91C2-B0D4-18E6.') },
  }, async ({ fingerprint }) => text(await verifySignature({ fingerprint })));
}
