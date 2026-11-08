import { createServer as createHttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { mcpHandler } from './index.js';
import { getOAuthAccessClientId, handleOAuth, startRevocationSync } from './oauth.js';
import { runWithRequestPrincipal } from './organization/request-context.js';
import { getOrganizationSnapshot, routeOrganizationObjective } from './organization/service.js';
import { requireConfiguredRuntime, resolveExecutionRoute, type ExecutionRoute, type RoutedCapability } from './organization/execution-router.js';
import { runtimeConfig } from './config/runtime.js';
import { ApprovalError, decideApproval } from './organization/workforce/approvals-service.js';
import { assignWork, deleteCustomDutyById, runDutiesOnce, saveDutyConfig } from './organization/workforce/duty-service.js';
import { DutyConfigError } from './organization/workforce/duty-config.js';
import { HandoffError } from './organization/workforce/handoffs.js';
import { verifySignature } from './organization/workforce/sign-work.js';
import { dbConfigured, NeedsDatabaseError } from './organization/workforce/db-util.js';
import { AGENT_DIRECTORY } from './services/ai/models.js';
import { startDutyScheduler } from './organization/workforce/scheduler.js';
import { handleWebhook, channelStatus, founderNumber, queueWhatsApp, runOutbox } from './channels/service.js';
import { OutboxError } from './channels/outbox.js';
import { createDocument, DocumentError } from './documents/service.js';
import { documentStore } from './documents/store.js';
import { toMinor } from './documents/model.js';
import { createClientInvoice, InvoiceError } from './payments/invoices.js';
import { buildDashboard } from './http/dashboard-api.js';
import { setCorsHeaders } from './http/cors.js';
import { handleHealth, handleNotFound } from './http/health.js';
import { isAuthorized, unauthorized } from './http/auth.js';
import { advanceTrackedTask, beginTrackedTask, failTrackedTask } from './organization/task-tracking.js';
import { askTambalaAI, askTambalaAIWithWebResearch, getAgentOperationalInfo, type AgentName } from './services/ai.js';
import { isCompanyStatusRequest, runCompanyStatusReport } from './channels/founder-execution.js';

const nodeHandler = toNodeHandler(mcpHandler);
const chatAgents = Object.keys(AGENT_DIRECTORY) as AgentName[];
type ChatAgent = AgentName;
const organizationRoleByAgent: Record<AgentName, string> = {
  orchestrator: 'ceo',
  outreach: 'director-sales-business-development',
  followup: 'director-customer-relations',
  research: 'director-research-intelligence',
  marketing: 'director-marketing-brand',
  content: 'director-media-content',
  finance: 'director-finance-accounting',
  payments: 'leader-fintech-ventures',
  engineering: 'director-technology-engineering',
  strategy: 'director-strategy-planning',
  product: 'director-product-innovation',
  security: 'director-cybersecurity-it',
  operations: 'director-operations-administration',
  people: 'director-people-agent-management',
  legal: 'director-legal-risk-compliance',
  procurement: 'director-procurement-resources',
  executive: 'director-executive-management',
  rnd: 'director-research-development',
  governance: 'director-board-governance',
};

type ExecutionStage = 'ceo_delegate' | 'specialist_execute' | 'ceo_complete';

function chatTokenMatches(provided: string | null): boolean {
  const expectedValue = process.env.TAMBALA_CHAT_TEST_TOKEN;
  if (!expectedValue || !provided) return false;
  const expected = Buffer.from(expectedValue, 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function schedulerTokenMatches(provided: string | null): boolean {
  const expectedValue = process.env.TAMBALA_SCHEDULER_TOKEN;
  if (!expectedValue || expectedValue.length < 24 || !provided) return false;
  const expected = Buffer.from(expectedValue, 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function webhookTokenMatches(url: string | undefined, req: import('node:http').IncomingMessage): boolean {
  const expectedValue = process.env.EVOLUTION_WEBHOOK_TOKEN;
  if (!expectedValue || expectedValue.length < 16) return false;
  const fromQuery = new URL(url ?? '/', 'http://x').searchParams.get('token');
  const header = req.headers['x-webhook-token'];
  const provided = fromQuery ?? (typeof header === 'string' ? header : null);
  if (!provided) return false;
  const a = Buffer.from(expectedValue, 'utf8'); const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(req: import('node:http').IncomingMessage): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((req.headers.authorization ?? '').trim());
  return match?.[1] ?? null;
}

function json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: import('node:http').IncomingMessage, maxBytes = 12_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('Request body is too large. Keep the prompt under 10,000 characters.');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request body must be valid JSON.'); }
}

function errorStatus(message: string): number {
  if (/No API key configured|must be configured/i.test(message)) return 503;
  if (/too large|valid JSON|Choose|Provide a prompt|Invalid stage/i.test(message)) return 400;
  return 502;
}

function taskNeedsWebResearch(text: string): boolean {
  return /\b(research|investigate|look\s*up|find|identify|current|latest|market|competitor|prospect|hotel|lodge|tourism|association|statistics|report)\b/i.test(text);
}

async function researchQueryFromObjective(objective: string): Promise<string> {
  try {
    const routes = await routeOrganizationObjective(objective);
    const selected = routes[0];
    if (selected?.researchQuery) return selected.researchQuery.slice(0, 500);
  } catch (error) {
    console.warn('Capability routing unavailable; using compact fallback research query:', error instanceof Error ? error.message : error);
  }

  const words = objective.replace(/[^a-zA-Z0-9\s-]/g, ' ').split(/\s+/).filter((word) => word.length >= 4);
  return [...new Set(words)].slice(0, 8).join(', ');
}

function resolveConfiguredExecutionRoute(match: RoutedCapability | undefined): ExecutionRoute {
  const route = resolveExecutionRoute(match);
  if (route.status !== 'ready') return route;
  return requireConfiguredRuntime(route, getAgentOperationalInfo(route.agent));
}

function truncateForModel(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[Context truncated to protect the model request size.]`;
}

function compactResearchEvidence(value: unknown): string {
  if (!value) return 'No web research evidence was returned.';
  const raw = JSON.stringify(value);
  return truncateForModel(raw, 4500);
}

function validStage(value: unknown): value is ExecutionStage {
  return value === 'ceo_delegate' || value === 'specialist_execute' || value === 'ceo_complete';
}

const server = createHttpServer(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const requestPath = req.url?.split('?')[0] ?? '/';
  if (await handleOAuth(req, res, requestPath)) return;
  if (requestPath === '/health' && req.method === 'GET') { handleHealth(res); return; }

  if (requestPath === '/webhooks/evolution' && req.method === 'POST') {
    if (!webhookTokenMatches(req.url, req)) { json(res, 401, { error: 'Unauthorized.' }); return; }
    try {
      const payload = await readJsonBody(req, 1_500_000);
      json(res, 200, { ok: true, ...(await handleWebhook(payload)) });
    } catch (error) {
      console.error('Evolution webhook failed:', error instanceof Error ? error.message : error);
      json(res, 400, { error: 'Could not process the webhook.' });
    }
    return;
  }

  if (requestPath.startsWith('/api/documents/') && requestPath.endsWith('/pdf') && req.method === 'GET') {
    if (!chatTokenMatches(bearerToken(req))) { json(res, 401, { error: 'Unauthorized.' }); return; }
    const id = requestPath.slice('/api/documents/'.length, -'/pdf'.length);
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) { json(res, 400, { error: 'Invalid document id.' }); return; }
    try {
      const doc = await documentStore().byId(id);
      if (!doc) { json(res, 404, { error: 'Document not found.' }); return; }
      const pdf = Buffer.from(doc.pdf_base64, 'base64');
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length, 'content-disposition': `inline; filename="${doc.number}.pdf"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(pdf);
    } catch (error) {
      console.error('Document fetch failed:', error instanceof Error ? error.message : error);
      json(res, 500, { error: 'The document could not be loaded.' });
    }
    return;
  }


  if ((requestPath === '/api/chat-test/status' || requestPath === '/api/chat-test' || requestPath === '/api/chat-test/collaborate' || requestPath === '/api/chat-test/step' || requestPath === '/api/dashboard' || requestPath === '/api/dashboard/approvals/decide' || requestPath.startsWith('/api/dashboard/')) && (req.method === 'GET' || req.method === 'POST')) {
    if (!chatTokenMatches(bearerToken(req))) { json(res, 401, { error: 'Unauthorized. Check the chat test token.' }); return; }
  }

  if (requestPath === '/api/chat-test/status' && req.method === 'GET') {
    const runtimeAgents = chatAgents.map((agent) => getAgentOperationalInfo(agent));
    try {
      const snapshot = await getOrganizationSnapshot();
      const agents = runtimeAgents.map((agent) => {
        const roleId = organizationRoleByAgent[agent.agent];
        const role = snapshot.organization.roles.find((candidate) => candidate.id === roleId);
        return { ...agent, roleId: role?.id ?? roleId, roleStatus: role?.activation ?? 'unassigned' };
      });
      json(res, 200, {
        agents,
        organization: {
          status: 'loaded',
          source: snapshot.source,
          valid: snapshot.validation.valid,
          validationErrors: snapshot.validation.errors,
          unitCount: snapshot.organization.units.length,
          roleCount: snapshot.organization.roles.length,
          departments: snapshot.organization.units
            .filter((unit) => unit.kind === 'department')
            .map((unit) => ({ name: unit.name, status: unit.status })),
          note: snapshot.source === 'supabase'
            ? 'Loaded from the configured Supabase organization tables.'
            : 'Using seed fallback because SUPABASE_SERVICE_ROLE_KEY is not configured; this is not a live database verification.',
        },
        safety: 'Test requests only generate AI text. They do not send messages or execute business actions.',
        collaboration: 'Organization tests execute in explicit stages: Founder objective -> CEO delegation -> specialist execution -> CEO completion.',
        research: 'Research uses the organization capability router to generate a short keyword query; the Founder prompt is not sent as the research query.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Organization snapshot could not be loaded.';
      console.error('Chat test status could not load organization snapshot:', message);
      json(res, 503, {
        agents: runtimeAgents,
        organization: {
          status: 'unavailable',
          note: 'The configured persistent organization snapshot could not be loaded; routing should not be treated as live-verified.',
        },
      });
    }
    return;
  }

  if (requestPath === '/api/chat-test' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { agent?: unknown; request?: unknown };
      if (!body || typeof body !== 'object' || !chatAgents.includes(body.agent as ChatAgent)) { json(res, 400, { error: 'Choose an agent from the configured organization directory.' }); return; }
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 10_000) { json(res, 400, { error: 'Provide a prompt between 1 and 10,000 characters.' }); return; }
      const agent = body.agent as ChatAgent;
      if (taskNeedsWebResearch(body.request)) {
        const researchQuery = await researchQueryFromObjective(body.request.trim());
        const researched = await askTambalaAIWithWebResearch(agent as AgentName, body.request.trim(), undefined, researchQuery);
        json(res, 200, { agent, model: getAgentOperationalInfo(agent).model, response: researched.response, researchQuery, researchEvidence: researched.research });
      } else {
        const response = await askTambalaAI(agent as AgentName, body.request.trim());
        json(res, 200, { agent, model: getAgentOperationalInfo(agent).model, response });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The AI provider request failed.';
      console.error('Live agent test request failed:', message);
      json(res, errorStatus(message), { error: message });
    }
    return;
  }

  // Stepwise execution endpoint. The browser calls one stage at a time so the UI can show the organization working live.
  if (requestPath === '/api/chat-test/step' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { stage?: unknown; request?: unknown; delegation?: unknown; specialistResult?: unknown; researchEvidence?: unknown };
      if (!validStage(body.stage)) { json(res, 400, { error: 'Invalid stage. Use ceo_delegate, specialist_execute, or ceo_complete.' }); return; }
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8_000) { json(res, 400, { error: 'Provide a task between 1 and 8,000 characters.' }); return; }
      const founderMessage = body.request.trim();

      // Company status reports use the dedicated four-department executor, not the
      // generic single-specialist chat flow. It returns only after each department
      // has completed or is explicitly marked outstanding.
      if (body.stage === 'ceo_delegate' && isCompanyStatusRequest(founderMessage)) {
        const receivedAt = new Date().toISOString();
        const message = await runCompanyStatusReport({
          message_id: 'chat-test-' + receivedAt.replace(/[^0-9]/g, '').slice(0, 14),
          channel: 'whatsapp',
          direction: 'inbound',
          sender: { name: 'Founder / Bless', phone: 'chat-test' },
          recipient: { role_id: 'ceo', title: 'Chief Executive Officer' },
          message_type: 'founder_instruction',
          priority: 'normal',
          content: { text: founderMessage, attachments: [] },
          routing: { assigned_by: 'inbound_gateway', department: null, capability_id: null },
          status: 'received',
          received_at: receivedAt,
        });
        const completed = message.startsWith('**Prepared for Founder / Bless —');
        return json(res, 200, {
          stage: body.stage,
          workflow: 'four_department_status_report',
          status: completed ? 'completed' : 'waiting_for_departments',
          message,
        });
      }

      let stepTaskId: unknown = (body as { taskId?: unknown }).taskId;
      try {
      if (body.stage === 'ceo_delegate') {
        const begun = await beginTrackedTask(founderMessage);
        stepTaskId = begun.taskId;
        await advanceTrackedTask(begun.taskId, [{ status: 'ceo_analyzing', stage: 'ceo', eventType: 'ceo_analysis_started' }]);
        const routing = await routeOrganizationObjective(founderMessage);
        const execution = resolveConfiguredExecutionRoute(routing[0]);
        const routingContext = routing.slice(0, 3).map((match) => `${match.department ?? 'unassigned'} / ${match.role ?? 'unassigned'} (score ${match.score}); role status: ${match.roleActivation ?? 'unknown'}; research keywords: ${match.researchQuery}`).join('\n');
        const delegation = await askTambalaAI('orchestrator', `Founder / Bless has given you this objective:\n\n${founderMessage}\n\nAct as the CEO. Own this objective from start to finish. Use the organization's capability routing below as the source of truth for departmental responsibilities:\n${routingContext || 'No capability match was found; choose an existing department and state why.'}\n\nDelegate only the specialist work. Create a precise execution brief containing ALL of these fields: task, deliverable, constraints, and short researchQuery. researchQuery must be a short keyword-style query, never a copy of the Founder objective or CEO prompt. Deterministic executor decision: ${JSON.stringify(execution)}. If status is not_activated, do not pretend a department agent is available; clearly mark the proposed handoff and what agent/configuration is missing. Do not complete the department's work yourself. The department must return the actual requested deliverable, not merely advice about how to do it. Do not invent facts, locations, countries, services, or requirements that are not in the Founder objective. If something is ambiguous, instruct the department to verify it with research.`, { communicationType: 'Founder -> CEO', sender: 'Founder / Bless', recipient: 'Chief Executive Officer (CEO)', routing });
        const tracking = await advanceTrackedTask(begun.taskId, execution.status === 'ready'
          ? [{ status: 'delegated', stage: 'ceo', eventType: 'delegated_to_department', researchQuery: execution.researchQuery, payload: { capabilityId: execution.capabilityId, agent: execution.agent, role: execution.role } }]
          : [{ status: 'needs_more_work', stage: 'ceo', eventType: 'execution_blocked', payload: { reason: execution.reason } }]);
        return json(res, 200, { stage: body.stage, taskId: begun.taskId, tracking: begun.tracking === 'recorded' ? tracking : 'unavailable', routing, execution, message: delegation });
      }

      if (body.stage === 'specialist_execute') {
        if (typeof body.delegation !== 'string' || !body.delegation.trim()) { return json(res, 400, { error: 'The CEO delegation is required for specialist execution.' }); }
        const routing = await routeOrganizationObjective(founderMessage);
        const execution = resolveConfiguredExecutionRoute(routing[0]);
        if (execution.status !== 'ready') { return json(res, 409, { error: execution.reason, execution, routing }); }
        const specialist = execution.agent;
        await advanceTrackedTask(stepTaskId, [{ status: 'executing', stage: 'department', eventType: 'department_execution_started', roleId: null }]);
        const researchQuery = execution.researchQuery || await researchQueryFromObjective(founderMessage);
        const specialistTask = `CEO execution brief:\n\n${truncateForModel(body.delegation, 7000)}\n\nExecute this task now. Produce the requested deliverable itself. Do not merely describe what should be done, do not delegate it back, and do not stop at process recommendations. Respect every constraint, but verify factual assumptions against research evidence rather than blindly trusting the brief. If research is required, use the web research evidence and preserve source URLs. Return completed work to the CEO, including genuine blockers only if they prevent completion.`;
        if (taskNeedsWebResearch(`${founderMessage}\n${body.delegation}`)) {
          const researched = await askTambalaAIWithWebResearch(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation: body.delegation }, researchQuery);
          const tracking = await advanceTrackedTask(stepTaskId, [{ status: 'returned_to_ceo', stage: 'review', eventType: 'department_work_returned', result: { summary: researched.response.slice(0, 4000) } }]);
          return json(res, 200, { stage: body.stage, tracking, message: researched.response, researchQuery, researchEvidence: researched.research });
        }
        const result = await askTambalaAI(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation: body.delegation });
        const tracking = await advanceTrackedTask(stepTaskId, [{ status: 'returned_to_ceo', stage: 'review', eventType: 'department_work_returned', result: { summary: result.slice(0, 4000) } }]);
        return json(res, 200, { stage: body.stage, tracking, message: result, researchQuery: null, researchEvidence: null });
      }

      if (typeof body.delegation !== 'string' || !body.delegation.trim() || typeof body.specialistResult !== 'string' || !body.specialistResult.trim()) { return json(res, 400, { error: 'CEO delegation and completed specialist work are required for final evaluation.' }); }
      const delegationContext = truncateForModel(body.delegation, 3500);
      const specialistContext = truncateForModel(body.specialistResult, 6000);
      const researchContext = compactResearchEvidence(body.researchEvidence);
      const finalPrompt = `Complete the Founder objective end-to-end.\n\nORIGINAL FOUNDER OBJECTIVE:\n${founderMessage}\n\nCEO DELEGATION (may contain mistakes; do not treat its factual assumptions as truth):\n${delegationContext}\n\nDEPARTMENT COMPLETED WORK:\n${specialistContext}\n\nWEB RESEARCH EVIDENCE:\n${researchContext}\n\nYou are accountable for the final result. Evaluate the department work against the original objective and every constraint. Evidence and the original Founder objective take precedence over unsupported claims in the delegation or report. Correct factual errors when the supplied evidence supports the correction. Do not merely summarize or relay the department report. Produce the actual final deliverable requested by the Founder. If research was requested, present the researched findings and preserve source URLs. If the evidence is insufficient, clearly state what remains unknown rather than fabricating it.`;
      const finalResult = await askTambalaAI('orchestrator', finalPrompt, { communicationType: 'CEO -> Founder', sender: 'Chief Executive Officer (CEO)', recipient: 'Founder / Bless', founderObjective: founderMessage, delegation: delegationContext, specialistResult: specialistContext, researchEvidence: researchContext });
      const tracking = await advanceTrackedTask(stepTaskId, [{ status: 'completed', stage: 'complete', eventType: 'ceo_completed_objective', result: { final: finalResult.slice(0, 8000) }, completedAt: new Date().toISOString() }]);
      return json(res, 200, { stage: body.stage, tracking, message: finalResult });
      } catch (stageError) {
        await failTrackedTask(stepTaskId, stageError instanceof Error ? stageError.message : 'Stage failed.');
        throw stageError;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The organization step failed.';
      console.error('Organization step failed:', message);
      return json(res, errorStatus(message), { error: message });
    }
  }

  if (requestPath === '/api/chat-test/collaborate' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { request?: unknown };
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8_000) { json(res, 400, { error: 'Provide a task between 1 and 8,000 characters.' }); return; }
      const founderMessage = body.request.trim();
      const routing = await routeOrganizationObjective(founderMessage);
      const execution = resolveConfiguredExecutionRoute(routing[0]);
      if (execution.status !== 'ready') { json(res, 409, { error: execution.reason, execution, routing }); return; }
      const specialist = execution.agent;
      const researchQuery = execution.researchQuery || await researchQueryFromObjective(founderMessage);
      const delegation = await askTambalaAI('orchestrator', `Founder / Bless has given you this objective:\n\n${founderMessage}\n\nAct as the CEO. Use this capability routing context to assign the work correctly:\n${JSON.stringify(routing.slice(0, 3))}\n\nCreate a precise execution brief with task, deliverable, constraints, and a short researchQuery. The researchQuery must contain keywords only and must not repeat the Founder prompt. Do not invent facts, locations, countries, services, or requirements that are not in the Founder objective.`, { communicationType: 'Founder -> CEO', sender: 'Founder / Bless', recipient: 'Chief Executive Officer (CEO)', routing });
      let specialistResult: string;
      let researchEvidence: unknown = undefined;
      const specialistTask = `CEO execution brief:\n\n${truncateForModel(delegation, 7000)}\n\nExecute the requested deliverable completely. Do not merely describe process. Verify factual assumptions against research evidence.`;
      if (taskNeedsWebResearch(`${founderMessage}\n${delegation}`)) {
        const researched = await askTambalaAIWithWebResearch(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation }, researchQuery);
        specialistResult = researched.response;
        researchEvidence = researched.research;
      } else {
        specialistResult = await askTambalaAI(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation });
      }
      const finalResult = await askTambalaAI('orchestrator', `Complete the Founder objective end-to-end. Original objective:\n${founderMessage}\nDepartment completed work:\n${truncateForModel(specialistResult, 6000)}\nResearch evidence:\n${compactResearchEvidence(researchEvidence)}\nEvaluate the work against the original objective and return the actual final deliverable. Do not merely summarize the department report. Do not invent missing facts; evidence and the original objective take precedence over unsupported delegation claims.`, { communicationType: 'CEO -> Founder', sender: 'Chief Executive Officer (CEO)', recipient: 'Founder / Bless' });
      json(res, 200, { execution, flow: [
        { from: 'Founder / Bless', to: 'Chief Executive Officer (CEO)', type: 'objective', message: founderMessage },
        { from: 'Chief Executive Officer (CEO)', to: getAgentOperationalInfo(specialist).title, type: 'delegation', message: delegation },
        { from: getAgentOperationalInfo(specialist).title, to: 'Chief Executive Officer (CEO)', type: 'completed_work', message: specialistResult },
        { from: 'Chief Executive Officer (CEO)', to: 'Founder / Bless', type: 'final_result', message: finalResult },
      ], routing, researchQuery, result: finalResult, researchEvidence });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The collaboration flow failed.';
      console.error('Live collaboration test failed:', message);
      json(res, errorStatus(message), { error: message });
    }
    return;
  }

  if (requestPath === '/api/dashboard/approvals/decide' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req) as { id?: unknown; decision?: unknown; note?: unknown };
      const approval = await decideApproval({ id: String(body.id ?? ''), decision: body.decision as 'approved' | 'rejected', note: typeof body.note === 'string' ? body.note : undefined });
      json(res, 200, { ok: true, approval: { id: approval.id, status: approval.status }, signature: approval.signature });
    } catch (error) {
      if (error instanceof ApprovalError) { json(res, error.status, { error: error.message }); return; }
      console.error('Approval decision failed:', error instanceof Error ? error.message : error);
      json(res, 500, { error: 'The decision could not be recorded.' });
    }
    return;
  }

  if (requestPath.startsWith('/api/dashboard/') && req.method === 'POST' && requestPath !== '/api/dashboard/approvals/decide') {
    try {
      const body = await readJsonBody(req, 60_000) as Record<string, unknown>;
      if (requestPath === '/api/dashboard/signatures/verify') {
        json(res, 200, await verifySignature({ fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint : undefined, id: typeof body.id === 'string' ? body.id : undefined }));
      } else if (requestPath === '/api/dashboard/handoffs/assign') {
        const agent = String(body.agent ?? '');
        if (!(agent in AGENT_DIRECTORY)) { json(res, 400, { error: 'Choose an employee.' }); return; }
        const h = await assignWork(agent as keyof typeof AGENT_DIRECTORY, String(body.request ?? ''));
        json(res, 200, { ok: true, handoffId: h.id });
      } else if (requestPath === '/api/dashboard/duties/save') {
        await saveDutyConfig({ dutyId: typeof body.dutyId === 'string' ? body.dutyId : undefined, override: body.override, custom: body.custom, customId: typeof body.customId === 'string' ? body.customId : undefined });
        json(res, 200, { ok: true });
      } else if (requestPath === '/api/dashboard/duties/delete') {
        await deleteCustomDutyById(String(body.id ?? ''));
        json(res, 200, { ok: true });
      } else if (requestPath === '/api/dashboard/documents/create') {
        const doc = await createDocument(body.document, 'founder');
        json(res, 200, { ok: true, id: doc.id, number: doc.number, hasCustomLines: doc.hasCustomLines });
      } else if (requestPath === '/api/dashboard/documents/send') {
        const row = await documentStore().byId(String(body.documentId ?? ''));
        if (!row) { json(res, 404, { error: 'Document not found.' }); return; }
        const toFounder = body.to === 'founder';
        const to = toFounder ? founderNumber() : String(body.to ?? '');
        if (!to) { json(res, 409, { error: 'The Founder WhatsApp number is not configured (TAMBALA_FOUNDER_WHATSAPP).' }); return; }
        const text = typeof body.text === 'string' && body.text.trim() ? body.text : `Hello ${row.client_name}, please find your ${row.kind} ${row.number} attached. Tambala Technologies.`;
        const r = await queueWhatsApp({ to, text: toFounder ? `${row.number} for ${row.client_name}` : text, purpose: 'document', roleId: 'founder', agent: 'founder', documentId: row.id, contactLabel: row.client_name, founderApproved: true });
        const sent = await runOutbox();
        json(res, 200, { ok: r.status !== 'blocked', status: r.status, reason: r.reason ?? sent.find((x) => x.id === r.id)?.reason ?? null, sent: sent.some((x) => x.id === r.id && x.status === 'sent') });
      } else if (requestPath === '/api/dashboard/prices/save') {
        if (!dbConfigured()) throw new NeedsDatabaseError('Editing the price list');
        const sku = String(body.sku ?? '').trim(); const name = String(body.name ?? '').trim(); const unitPrice = Number(body.unitPrice);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(sku)) throw new DocumentError('A code is 2 to 40 letters, digits, dots or dashes.');
        if (name.length < 2 || name.length > 200) throw new DocumentError('Give the item a name.');
        if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000_000) throw new DocumentError('Enter a price in MWK.');
        await documentStore().savePrice({ sku, name, unit: String(body.unit ?? 'each').slice(0, 30) || 'each', unit_price_minor: toMinor(unitPrice), active: body.active !== false });
        json(res, 200, { ok: true });
      } else if (requestPath === '/api/dashboard/channel/test') {
        const to = founderNumber();
        if (!to) { json(res, 409, { error: 'Set TAMBALA_FOUNDER_WHATSAPP first.' }); return; }
        const r = await queueWhatsApp({ to, text: `Test message from the Tambala Control Centre at ${new Date().toISOString().slice(11, 16)} UTC. If you can read this, employees can reach you.`, purpose: 'notify_founder', roleId: 'ceo', agent: 'orchestrator' });
        const sent = await runOutbox();
        json(res, 200, { ok: true, status: r.status, result: sent.find((x) => x.id === r.id) ?? null });
      } else if (requestPath === '/api/dashboard/channel/process') {
        json(res, 200, { ok: true, results: await runOutbox() });
      } else if (requestPath === '/api/dashboard/invoices/create') {
        const client = (body.client ?? {}) as { name?: unknown; phone?: unknown; email?: unknown };
        const { invoice, created } = await createClientInvoice({ roleId: 'founder', clientName: String(client.name ?? ''), clientPhone: typeof client.phone === 'string' ? client.phone : undefined, clientEmail: typeof client.email === 'string' && client.email ? client.email : undefined, description: String(body.description ?? ''), amount: Number(body.amount) });
        let message: { status: string; reason?: string } | null = null;
        if (typeof body.sendTo === 'string' && body.sendTo && invoice.link) {
          const r = await queueWhatsApp({ to: body.sendTo, purpose: 'invoice', roleId: 'founder', agent: 'founder', contactLabel: invoice.client_name, founderApproved: true, text: `Hello ${invoice.client_name}, here is your invoice for MWK ${(invoice.amount_minor / 100).toLocaleString('en-GB')} (${invoice.description}). You can pay securely here: ${invoice.link}` });
          await runOutbox(); message = { status: r.status, reason: r.reason };
        }
        json(res, 200, { ok: true, created, link: invoice.link, invoiceId: invoice.pay_invoice_id, message });
      } else {
        json(res, 404, { error: 'Not found.' });
      }
    } catch (error) {
      if (error instanceof NeedsDatabaseError) { json(res, 409, { error: error.message }); return; }
      if (error instanceof DutyConfigError || error instanceof HandoffError || error instanceof DocumentError || error instanceof OutboxError || error instanceof InvoiceError) { json(res, 400, { error: error.message }); return; }
      if (error instanceof Error && /Only custom duties|Nothing to save/.test(error.message)) { json(res, 400, { error: error.message }); return; }
      console.error('Dashboard action failed:', error instanceof Error ? error.message : error);
      json(res, 500, { error: 'The change could not be saved.' });
    }
    return;
  }

  // External cron endpoint for Render's free/sleeping instances. The dedicated scheduler token
  // is separate from the chat-test token and never grants access to dashboard actions.
  if (requestPath === '/api/channels/outbox/run' && req.method === 'POST') {
    if (!schedulerTokenMatches(bearerToken(req))) { json(res, 401, { error: 'Unauthorized.' }); return; }
    try {
      json(res, 200, { ok: true, results: await runOutbox() });
    } catch (error) {
      console.error('Scheduled WhatsApp outbox run failed:', error instanceof Error ? error.message : error);
      json(res, 500, { error: 'WhatsApp outbox could not be processed.' });
    }
    return;
  }

  if (requestPath === '/api/duties/run' && req.method === 'POST') {
    if (!chatTokenMatches(bearerToken(req)) && !schedulerTokenMatches(bearerToken(req))) { json(res, 401, { error: 'Unauthorized.' }); return; }
    try {
      const body = (await readJsonBody(req).catch(() => ({}))) as { dutyId?: unknown; force?: unknown; handoffsOnly?: unknown };
      const dutyId = typeof body.dutyId === 'string' ? body.dutyId : undefined;
      json(res, 200, await runDutiesOnce({ dutyId, force: body.force === true && Boolean(dutyId), handoffsOnly: body.handoffsOnly === true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Duty run failed.';
      json(res, /already running/.test(message) ? 409 : /Unknown duty/.test(message) ? 400 : 500, { error: message });
    }
    return;
  }

  if (requestPath === '/api/dashboard' && req.method === 'GET') {
    try { json(res, 200, await buildDashboard()); }
    catch (error) { console.error('Dashboard build failed:', error instanceof Error ? error.message : error); json(res, 500, { error: 'Dashboard data could not be built.' }); }
    return;
  }

  if (requestPath === '/dashboard' && req.method === 'GET') {
    try {
      const html = await readFile(new URL('../public/organization-dashboard.html', import.meta.url));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(html);
    } catch (error) { console.error('Unable to load organization dashboard:', error); json(res, 500, { error: 'Organization dashboard is unavailable.' }); }
    return;
  }

  if (requestPath === '/chat-live' && req.method === 'GET') {
    try {
      const html = await readFile(new URL('../public/organization-chat-live.html', import.meta.url));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(html);
    } catch (error) { console.error('Unable to load live agent test page:', error); json(res, 500, { error: 'Live agent test page is unavailable.' }); }
    return;
  }

  if (requestPath === '/chat' && req.method === 'GET') {
    try {
      const html = await readFile(new URL('../public/organization-chat.html', import.meta.url));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(html);
    } catch (error) { console.error('Unable to load organization chat preview:', error); json(res, 500, { error: 'Organization chat preview is unavailable.' }); }
    return;
  }

  if (requestPath === '/' || requestPath === '/mcp') {
    if (!isAuthorized(req.headers)) { unauthorized(res); return; }
    const token = bearerToken(req) ?? '';
    const clientId = token ? getOAuthAccessClientId(token) : null;
    const principal = clientId ? { kind: 'oauth' as const, clientId } : token ? { kind: 'legacy-shared-token' as const } : { kind: 'unknown' as const };
    await runWithRequestPrincipal(principal, () => nodeHandler(req, res));
    return;
  }
  handleNotFound(res);
});

startDutyScheduler();

// Keep the WhatsApp outbox moving on an always-on host. Atomic database claims make
// overlapping ticks / multiple Render instances safe; stale uncertain sends are not replayed.
if (process.env.TAMBALA_WHATSAPP_OUTBOX_SCHEDULER === 'true') {
  const intervalMinutes = Math.max(1, Number(process.env.TAMBALA_WHATSAPP_OUTBOX_INTERVAL_MINUTES) || 1);
  const tickOutbox = async () => {
    try {
      const results = await runOutbox();
      if (results.length) console.log('WhatsApp outbox cycle:', JSON.stringify(results));
    } catch (error) {
      console.error('WhatsApp outbox cycle failed:', error instanceof Error ? error.message : error);
    }
  };
  console.log(`WhatsApp outbox scheduler on: checking every ${intervalMinutes} min.`);
  setTimeout(() => void tickOutbox(), 15_000).unref();
  setInterval(() => void tickOutbox(), intervalMinutes * 60_000).unref();
}

startRevocationSync();
server.listen(runtimeConfig.port, runtimeConfig.host, () => {
  console.log(`Tambala MCP HTTP server listening on ${runtimeConfig.host}:${runtimeConfig.port}`);
});
