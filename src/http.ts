import { createServer as createHttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { mcpHandler } from './index.js';
import { getOAuthAccessClientId, handleOAuth } from './oauth.js';
import { runWithRequestPrincipal } from './organization/request-context.js';
import { runtimeConfig } from './config/runtime.js';
import { setCorsHeaders } from './http/cors.js';
import { handleHealth, handleNotFound } from './http/health.js';
import { isAuthorized, unauthorized } from './http/auth.js';
import { askTambalaAI, askTambalaAIWithWebResearch, getAgentOperationalInfo, type AgentName } from './services/ai.js';
import { OrganizationTaskRunner } from './organization/task-runner.js';
import { publishOrganizationTaskEvent } from './organization/task-events.js';
import { openTaskEventStream } from './organization/task-sse.js';

const nodeHandler = toNodeHandler(mcpHandler);
const chatAgents = ['orchestrator', 'outreach', 'followup'] as const;
type ChatAgent = typeof chatAgents[number];
const specialistAgents = ['outreach', 'followup'] as const;
type SpecialistAgent = typeof specialistAgents[number];
type ExecutionStage = 'ceo_delegate' | 'specialist_execute' | 'ceo_complete';
type CeoDelegation = { task: string; deliverable: string; constraints: string[]; researchQuery: string; };

function chatTokenMatches(provided: string | null): boolean {
  const expectedValue = process.env.TAMBALA_CHAT_TEST_TOKEN;
  if (!expectedValue || !provided) return false;
  const expected = Buffer.from(expectedValue, 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function bearerToken(req: import('node:http').IncomingMessage): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((req.headers.authorization ?? '').trim());
  return match?.[1] ?? null;
}
function json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_000) throw new Error('Request body is too large. Keep the request payload under 32 KB.');
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
function researchQueryFromObjective(objective: string): string {
  const cleaned = objective.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  const quoted = [...cleaned.matchAll(/["“”']([^"“”']{2,120})["“”']/g)].map((m) => m[1]);
  const properPhrases = [...cleaned.matchAll(/\b(?:[A-Z][\w&'-]+(?:\s+|$)){1,5}/g)]
    .map((m) => m[0].trim()).filter((v) => v.length > 2 && !/^(The|Find|Research|Identify|Determine|Give|Tell|Please|What|How|Why|Use|Do|And|For|With|From|This|That)\b/i.test(v));
  const domainTerms = cleaned.match(/\b(?:Malawi|Malawian|Malabi|lodge|lodges|hotel|hotels|tourism|hospitality|website|websites|digital|competitor|competitors|market|prospect|prospects|opportunity|opportunities|Tambala|Exclusive)\b/gi) ?? [];
  const unique = [...new Set([...quoted, ...properPhrases, ...domainTerms.map((v) => v.toLowerCase())])];
  return (unique.join(' ').replace(/\s+/g, ' ').trim() || cleaned).slice(0, 1400).trim();
}
function truncateForModel(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[Context truncated to protect the model request size.]`;
}
function compactResearchEvidence(value: unknown): string {
  if (!value) return 'No web research evidence was returned.';
  return truncateForModel(JSON.stringify(value), 4500);
}
function parseCeoDelegation(raw: string, fallbackObjective: string): CeoDelegation {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); const source = fenced?.[1] ?? raw;
  const first = source.indexOf('{'); const last = source.lastIndexOf('}');
  let value: Record<string, unknown> = {};
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(source.slice(first, last + 1));
      if (parsed && typeof parsed === 'object') value = parsed as Record<string, unknown>;
    } catch {
      // Recover below instead of failing the whole organization task because the model wrapped its JSON imperfectly.
    }
  }
  const task = typeof value.task === 'string' && value.task.trim() ? value.task.trim() : truncateForModel(fallbackObjective, 3000);
  const deliverable = typeof value.deliverable === 'string' && value.deliverable.trim() ? value.deliverable.trim() : 'Complete the assigned objective and return the actual finished result.';
  const constraints = Array.isArray(value.constraints) ? value.constraints.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(0, 8) : [];
  const derivedQuery = researchQueryFromObjective(`${task} ${deliverable} ${fallbackObjective}`);
  const researchQuery = typeof value.researchQuery === 'string' && value.researchQuery.trim()
    ? value.researchQuery.replace(/\s+/g, ' ').trim().slice(0, 1400)
    : derivedQuery;
  return { task, deliverable, constraints, researchQuery };
}
type CeoEvaluation = { decision: 'approved' | 'rework'; feedback: string; finalResult: string };
function parseCeoEvaluation(raw: string): CeoEvaluation {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); const source = fenced?.[1] ?? raw;
  const first = source.indexOf('{'); const last = source.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('CEO evaluation did not return structured JSON. Retry the evaluation.');
  let parsed: unknown; try { parsed = JSON.parse(source.slice(first, last + 1)); } catch { throw new Error('CEO evaluation returned invalid JSON. Retry the evaluation.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('CEO evaluation response must be a JSON object.');
  const value = parsed as Record<string, unknown>;
  if (value.decision !== 'approved' && value.decision !== 'rework') throw new Error('CEO evaluation decision must be approved or rework.');
  const feedback = typeof value.feedback === 'string' ? value.feedback.trim() : '';
  const finalResult = typeof value.finalResult === 'string' ? value.finalResult.trim() : '';
  if (value.decision === 'approved' && !finalResult) throw new Error('CEO approved the work without providing the final deliverable.');
  if (value.decision === 'rework' && !feedback) throw new Error('CEO requested rework without actionable feedback.');
  return { decision: value.decision, feedback, finalResult };
}
function validStage(value: unknown): value is ExecutionStage { return value === 'ceo_delegate' || value === 'specialist_execute' || value === 'ceo_complete'; }

const liveTaskRunners = new Map<string, OrganizationTaskRunner>();
function publishRunnerEvent(event: ReturnType<OrganizationTaskRunner['startCeoAnalysis']>): void { publishOrganizationTaskEvent(event); }

const server = createHttpServer(async (req, res) => {
  setCorsHeaders(res); if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const requestPath = req.url?.split('?')[0] ?? '/';
  if (await handleOAuth(req, res, requestPath)) return;
  if (requestPath === '/health' && req.method === 'GET') { handleHealth(res); return; }
  if ((requestPath === '/api/chat-test/status' || requestPath === '/api/chat-test' || requestPath === '/api/chat-test/collaborate' || requestPath === '/api/chat-test/step' || requestPath === '/api/chat-test/tasks' || requestPath === '/api/chat-test/events') && (req.method === 'GET' || req.method === 'POST')) {
    if (!chatTokenMatches(bearerToken(req))) { json(res, 401, { error: 'Unauthorized. Check the chat test token.' }); return; }
  }
  if (requestPath === '/api/chat-test/tasks' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { request?: unknown; specialist?: unknown };
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8_000) { json(res, 400, { error: 'Provide a task between 1 and 8,000 characters.' }); return; }
      if (!specialistAgents.includes(body.specialist as SpecialistAgent)) { json(res, 400, { error: 'Choose outreach or followup as the specialist.' }); return; }
      const specialist = body.specialist as SpecialistAgent; const runner = new OrganizationTaskRunner(body.request.trim(), { specialist, departmentTitle: getAgentOperationalInfo(specialist).title });
      liveTaskRunners.set(runner.task.id, runner); const initialEvent = runner.task.events[0]; if (initialEvent) publishRunnerEvent(initialEvent);
      json(res, 201, { taskId: runner.task.id, status: runner.task.status, message: 'Organization task created. Connect to its event stream before starting execution.' });
    } catch (error) { const message = error instanceof Error ? error.message : 'Unable to create organization task.'; json(res, errorStatus(message), { error: message }); }
    return;
  }
  if (requestPath === '/api/chat-test/events' && req.method === 'GET') {
    const taskId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('taskId'); if (!taskId) { json(res, 400, { error: 'Provide a taskId query parameter.' }); return; }
    const runner = liveTaskRunners.get(taskId); if (!runner) { json(res, 404, { error: 'Organization task not found or server restarted.' }); return; }
    openTaskEventStream(res, taskId, runner.task.events); return;
  }
  if (requestPath === '/api/chat-test/status' && req.method === 'GET') {
    json(res, 200, { agents: chatAgents.map((agent) => getAgentOperationalInfo(agent)), safety: 'Test requests only generate AI text. They do not send messages or execute business actions.', collaboration: 'Organization tests execute in explicit stages: Founder objective -> CEO delegation -> specialist execution -> CEO completion.', research: 'The CEO produces a compact task plus a short researchQuery. The web provider receives only that query, never the full Founder/CEO prompt.' }); return;
  }
  if (requestPath === '/api/chat-test' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { agent?: unknown; request?: unknown };
      if (!body || typeof body !== 'object' || !chatAgents.includes(body.agent as ChatAgent)) { json(res, 400, { error: 'Choose orchestrator, outreach, or followup.' }); return; }
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 10_000) { json(res, 400, { error: 'Provide a prompt between 1 and 10,000 characters.' }); return; }
      const agent = body.agent as ChatAgent;
      if (taskNeedsWebResearch(body.request)) { const query = researchQueryFromObjective(body.request); const researched = await askTambalaAIWithWebResearch(agent as AgentName, body.request.trim(), undefined, query); json(res, 200, { agent, model: getAgentOperationalInfo(agent).model, response: researched.response, researchEvidence: researched.research, researchQuery: query }); }
      else { const response = await askTambalaAI(agent as AgentName, body.request.trim()); json(res, 200, { agent, model: getAgentOperationalInfo(agent).model, response }); }
    } catch (error) { const message = error instanceof Error ? error.message : 'The AI provider request failed.'; console.error('Live agent test request failed:', message); json(res, errorStatus(message), { error: message }); }
    return;
  }
  if (requestPath === '/api/chat-test/step' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    let activeRunner: OrganizationTaskRunner | undefined;
    try {
      const body = await readJsonBody(req) as { stage?: unknown; request?: unknown; specialist?: unknown; delegation?: unknown; specialistResult?: unknown; researchEvidence?: unknown; taskId?: unknown; attempt?: unknown };
      if (!validStage(body.stage)) { json(res, 400, { error: 'Invalid stage. Use ceo_delegate, specialist_execute, or ceo_complete.' }); return; }
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8_000) { json(res, 400, { error: 'Provide a task between 1 and 8,000 characters.' }); return; }
      if (!specialistAgents.includes(body.specialist as SpecialistAgent)) { json(res, 400, { error: 'Choose outreach or followup as the specialist.' }); return; }
      const specialist = body.specialist as SpecialistAgent; const founderMessage = body.request.trim(); const runner = typeof body.taskId === 'string' ? liveTaskRunners.get(body.taskId) : undefined; activeRunner = runner;
      if (typeof body.taskId === 'string' && !runner) return json(res, 404, { error: 'Organization task not found. Create a new task and reconnect.' });
      if (runner && runner.task.objective !== founderMessage) return json(res, 400, { error: 'The request must match the original objective for this task.' });
      if (body.stage === 'ceo_delegate') {
        if (runner) publishRunnerEvent(runner.startCeoAnalysis());
        const rawDelegation = await askTambalaAI('orchestrator', `Founder / Bless gave you this objective:\n${founderMessage}\n\nYou are the CEO and own this objective end-to-end. Decide the single responsible department and define the minimum information it needs to execute. Do NOT write the department's report. Do NOT repeat the Founder prompt. Return ONLY JSON:\n{"task":"one concise executable task for the department","deliverable":"exact result the department must return","constraints":["only essential constraints"],"researchQuery":"6-12 concise search keywords/entities, not a sentence or prompt"}\nThe department will perform the work itself. If research is needed, researchQuery must contain only search terms. Never put instructions, long prose, or the original objective inside researchQuery.`, { communicationType: 'Founder -> CEO', sender: 'Founder / Bless', recipient: 'Chief Executive Officer (CEO)' });
        const delegation = parseCeoDelegation(rawDelegation, founderMessage);
        const delegationMessage = JSON.stringify(delegation);
        if (runner) publishRunnerEvent(runner.delegate(delegationMessage)); return json(res, 200, { stage: body.stage, taskId: runner?.task.id, message: delegationMessage, delegation });
      }
      if (body.stage === 'specialist_execute') {
        if (runner) publishRunnerEvent(runner.startDepartment());
        if (typeof body.delegation !== 'string' || !body.delegation.trim()) return json(res, 400, { error: 'The CEO delegation is required for specialist execution.' });
        let delegation: CeoDelegation; try { delegation = parseCeoDelegation(body.delegation, founderMessage); } catch { delegation = { task: truncateForModel(body.delegation, 3000), deliverable: 'Complete the assigned task and return the actual result.', constraints: [], researchQuery: researchQueryFromObjective(founderMessage) }; }
        const specialistTask = `You are the ${getAgentOperationalInfo(specialist).title}. Execute the CEO task now.\n\nTASK:\n${truncateForModel(delegation.task, 5000)}\n\nREQUIRED DELIVERABLE:\n${truncateForModel(delegation.deliverable, 2500)}\n\nCONSTRAINTS:\n${delegation.constraints.map((v) => `- ${v}`).join('\n') || '- Verify facts; do not invent information.'}\n\nReturn the completed work itself. Do not return a plan for doing it, do not ask the Founder what to do, and do not simply acknowledge the delegation.`;
        if (taskNeedsWebResearch(`${delegation.task} ${delegation.deliverable}`)) {
          const query = delegation.researchQuery; if (runner) publishRunnerEvent(runner.waitForResearch(query));
          const researched = await askTambalaAIWithWebResearch(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation: { task: delegation.task, deliverable: delegation.deliverable } }, query);
          if (runner) { const evidence = researched.research as { sources?: unknown[]; results?: unknown[] } | unknown[] | null; const sourceCount = Array.isArray(evidence) ? evidence.length : evidence && typeof evidence === 'object' ? (Array.isArray(evidence.sources) ? evidence.sources.length : Array.isArray(evidence.results) ? evidence.results.length : undefined) : undefined; publishRunnerEvent(runner.researchComplete(sourceCount)); publishRunnerEvent(runner.resumeDepartment()); publishRunnerEvent(runner.submitDepartmentWork(researched.response)); publishRunnerEvent(runner.returnToCeo()); }
          return json(res, 200, { stage: body.stage, taskId: runner?.task.id, message: researched.response, researchEvidence: researched.research, researchQuery: query });
        }
        const result = await askTambalaAI(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation: { task: delegation.task, deliverable: delegation.deliverable } });
        if (runner) { publishRunnerEvent(runner.submitDepartmentWork(result)); publishRunnerEvent(runner.returnToCeo()); }
        return json(res, 200, { stage: body.stage, taskId: runner?.task.id, message: result });
      }
      const attempt = typeof body.attempt === 'number' && Number.isInteger(body.attempt) ? body.attempt : 1;
      if (attempt < 1 || attempt > 3) return json(res, 400, { error: 'Evaluation attempt must be between 1 and 3.' });
      const delegationContext = typeof body.delegation === 'string' ? truncateForModel(body.delegation, 3500) : 'No delegation was supplied.';
      const specialistContext = typeof body.specialistResult === 'string' ? truncateForModel(body.specialistResult, 6000) : 'No department result was supplied.';
      const researchContext = compactResearchEvidence(body.researchEvidence);
      const finalPrompt = `You are the CEO accountable for completing the original Founder objective. Evaluate the department's work before deciding whether it is complete.\n\nORIGINAL FOUNDER OBJECTIVE:\n${founderMessage}\n\nCEO DELEGATION:\n${delegationContext}\n\nDEPARTMENT COMPLETED WORK:\n${specialistContext}\n\nWEB RESEARCH EVIDENCE:\n${researchContext}\n\nCompare the actual work against the original objective, requested deliverable, and constraints. The original objective and supplied evidence outrank unsupported claims in the delegation. If the deliverable is genuinely sufficient, choose \"approved\" and provide the complete final deliverable in finalResult; do not merely summarize the department report. Preserve source URLs when research was requested. If there is a material, fixable gap, choose \"rework\" and provide precise, actionable feedback. Never invent facts. This is evaluation attempt ${attempt} of 3; on attempt 3, do not request another revision—approve only with clear caveats if needed, or explain any truly blocking unknown in the finalResult.\n\nReturn ONLY valid JSON with this exact shape:\n{\"decision\":\"approved\" or \"rework\",\"feedback\":\"specific revision instructions; empty when approved\",\"finalResult\":\"complete final deliverable when approved; empty when rework\"}`;
      if (runner) publishRunnerEvent(runner.beginCeoReview());
      const rawEvaluation = await askTambalaAI('orchestrator', finalPrompt, { communicationType: 'CEO evaluation', sender: 'Chief Executive Officer (CEO)', recipient: 'Founder / Bless', founderObjective: truncateForModel(founderMessage, 3500), delegation: delegationContext, specialistResult: specialistContext, researchEvidence: researchContext, attempt });
      const evaluation = parseCeoEvaluation(rawEvaluation);
      if (evaluation.decision === 'rework') { if (runner) publishRunnerEvent(runner.requestRework(evaluation.feedback)); return json(res, 200, { stage: body.stage, taskId: runner?.task.id, decision: 'rework', feedback: evaluation.feedback, message: 'CEO evaluation: the department must address the requested revisions.' }); }
      if (runner) publishRunnerEvent(runner.complete(evaluation.finalResult));
      return json(res, 200, { stage: body.stage, taskId: runner?.task.id, decision: 'approved', feedback: evaluation.feedback, message: evaluation.finalResult });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The organization stage failed.'; console.error('Organization task stage failed:', message); if (activeRunner) { try { publishRunnerEvent(activeRunner.fail(message)); } catch {} } json(res, errorStatus(message), { error: message });
    }
    return;
  }
  if (requestPath === '/chat-live' && req.method === 'GET') { try { const html = await readFile(new URL('../public/organization-chat-live.html', import.meta.url)); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" }); res.end(html); } catch (error) { console.error('Unable to load live agent test page:', error); json(res, 500, { error: 'Live agent test page is unavailable.' }); } return; }
  if (requestPath === '/chat' && req.method === 'GET') { try { const html = await readFile(new URL('../public/organization-chat.html', import.meta.url)); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" }); res.end(html); } catch (error) { console.error('Unable to load organization chat preview:', error); json(res, 500, { error: 'Organization chat preview is unavailable.' }); } return; }
  if (requestPath === '/' || requestPath === '/mcp') { if (!isAuthorized(req.headers)) { unauthorized(res); return; } const token = bearerToken(req) ?? ''; const clientId = token ? getOAuthAccessClientId(token) : null; const principal = clientId ? { kind: 'oauth' as const, clientId } : token ? { kind: 'legacy-shared-token' as const } : { kind: 'unknown' as const }; await runWithRequestPrincipal(principal, () => nodeHandler(req, res)); return; }
  handleNotFound(res);
});
server.listen(runtimeConfig.port, runtimeConfig.host, () => { console.log(`Tambala MCP HTTP server listening on ${runtimeConfig.host}:${runtimeConfig.port}`); });
