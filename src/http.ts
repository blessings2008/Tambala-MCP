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

const nodeHandler = toNodeHandler(mcpHandler);
const chatAgents = ['orchestrator', 'outreach', 'followup'] as const;
type ChatAgent = typeof chatAgents[number];
const specialistAgents = ['outreach', 'followup'] as const;
type SpecialistAgent = typeof specialistAgents[number];

type ExecutionStage = 'ceo_delegate' | 'specialist_execute' | 'ceo_complete';

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
    if (size > 12_000) throw new Error('Request body is too large. Keep the prompt under 10,000 characters.');
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
  const cleaned = objective.replace(/\s+/g, ' ').trim();
  return cleaned.length <= 1200 ? cleaned : cleaned.slice(0, 1200).trim();
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

  if ((requestPath === '/api/chat-test/status' || requestPath === '/api/chat-test' || requestPath === '/api/chat-test/collaborate' || requestPath === '/api/chat-test/step') && (req.method === 'GET' || req.method === 'POST')) {
    if (!chatTokenMatches(bearerToken(req))) { json(res, 401, { error: 'Unauthorized. Check the chat test token.' }); return; }
  }

  if (requestPath === '/api/chat-test/status' && req.method === 'GET') {
    json(res, 200, {
      agents: chatAgents.map((agent) => getAgentOperationalInfo(agent)),
      safety: 'Test requests only generate AI text. They do not send messages or execute business actions.',
      collaboration: 'Organization tests execute in explicit stages: Founder objective -> CEO delegation -> specialist execution -> CEO completion.',
      research: 'Research is run during specialist execution using a bounded objective query; source evidence is passed into the specialist and CEO completion stages.',
    });
    return;
  }

  if (requestPath === '/api/chat-test' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { agent?: unknown; request?: unknown };
      if (!body || typeof body !== 'object' || !chatAgents.includes(body.agent as ChatAgent)) { json(res, 400, { error: 'Choose orchestrator, outreach, or followup.' }); return; }
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 10_000) { json(res, 400, { error: 'Provide a prompt between 1 and 10,000 characters.' }); return; }
      const agent = body.agent as ChatAgent;
      if (taskNeedsWebResearch(body.request)) {
        const researched = await askTambalaAIWithWebResearch(agent as AgentName, body.request.trim(), undefined, researchQueryFromObjective(body.request));
        json(res, 200, { agent, model: getAgentOperationalInfo(agent).model, response: researched.response, researchEvidence: researched.research });
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
      const body = await readJsonBody(req) as { stage?: unknown; request?: unknown; specialist?: unknown; delegation?: unknown; specialistResult?: unknown; researchEvidence?: unknown };
      if (!validStage(body.stage)) { json(res, 400, { error: 'Invalid stage. Use ceo_delegate, specialist_execute, or ceo_complete.' }); return; }
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8_000) { json(res, 400, { error: 'Provide a task between 1 and 8,000 characters.' }); return; }
      if (!specialistAgents.includes(body.specialist as SpecialistAgent)) { json(res, 400, { error: 'Choose outreach or followup as the specialist.' }); return; }
      const specialist = body.specialist as SpecialistAgent;
      const founderMessage = body.request.trim();

      if (body.stage === 'ceo_delegate') {
        const delegation = await askTambalaAI('orchestrator', `Founder / Bless has given you this objective:\n\n${founderMessage}\n\nAct as the CEO. Own this objective from start to finish. Decide what work must be delegated to ${getAgentOperationalInfo(specialist).title}. Create a precise execution brief. Do not complete the department's work yourself. The department must return the actual requested deliverable, not merely advice about how to do it. Do not invent facts, locations, countries, services, or requirements that are not in the Founder objective. If something is ambiguous, instruct the department to verify it with research. Include objective, scope, constraints, required deliverable, quality bar, and evidence/source requirements.`, { communicationType: 'Founder -> CEO', sender: 'Founder / Bless', recipient: 'Chief Executive Officer (CEO)' });
        return json(res, 200, { stage: body.stage, message: delegation });
      }

      if (body.stage === 'specialist_execute') {
        if (typeof body.delegation !== 'string' || !body.delegation.trim()) { return json(res, 400, { error: 'The CEO delegation is required for specialist execution.' }); }
        const specialistTask = `CEO execution brief:\n\n${truncateForModel(body.delegation, 7000)}\n\nExecute this task now. Produce the requested deliverable itself. Do not merely describe what should be done, do not delegate it back, and do not stop at process recommendations. Respect every constraint, but verify factual assumptions against research evidence rather than blindly trusting the brief. If research is required, use the web research evidence and preserve source URLs. Return completed work to the CEO, including genuine blockers only if they prevent completion.`;
        if (taskNeedsWebResearch(`${founderMessage}\n${body.delegation}`)) {
          const researched = await askTambalaAIWithWebResearch(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation: body.delegation }, researchQueryFromObjective(founderMessage));
          return json(res, 200, { stage: body.stage, message: researched.response, researchEvidence: researched.research });
        }
        const result = await askTambalaAI(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation: body.delegation });
        return json(res, 200, { stage: body.stage, message: result, researchEvidence: null });
      }

      if (typeof body.delegation !== 'string' || !body.delegation.trim() || typeof body.specialistResult !== 'string' || !body.specialistResult.trim()) { return json(res, 400, { error: 'CEO delegation and completed specialist work are required for final evaluation.' }); }
      const delegationContext = truncateForModel(body.delegation, 3500);
      const specialistContext = truncateForModel(body.specialistResult, 6000);
      const researchContext = compactResearchEvidence(body.researchEvidence);
      const finalPrompt = `Complete the Founder objective end-to-end.\n\nORIGINAL FOUNDER OBJECTIVE:\n${founderMessage}\n\nCEO DELEGATION (may contain mistakes; do not treat its factual assumptions as truth):\n${delegationContext}\n\nDEPARTMENT COMPLETED WORK:\n${specialistContext}\n\nWEB RESEARCH EVIDENCE:\n${researchContext}\n\nYou are accountable for the final result. Evaluate the department work against the original objective and every constraint. Evidence and the original Founder objective take precedence over unsupported claims in the delegation or report. Correct factual errors when the supplied evidence supports the correction. Do not merely summarize or relay the department report. Produce the actual final deliverable requested by the Founder. If research was requested, present the researched findings and preserve source URLs. If the evidence is insufficient, clearly state what remains unknown rather than fabricating it.`;
      const finalResult = await askTambalaAI('orchestrator', finalPrompt, { communicationType: 'CEO -> Founder', sender: 'Chief Executive Officer (CEO)', recipient: 'Founder / Bless', founderObjective: founderMessage, delegation: delegationContext, specialistResult: specialistContext, researchEvidence: researchContext });
      return json(res, 200, { stage: body.stage, message: finalResult });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The organization step failed.';
      console.error('Organization step failed:', message);
      return json(res, errorStatus(message), { error: message });
    }
  }

  if (requestPath === '/api/chat-test/collaborate' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { request?: unknown; specialist?: unknown };
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8_000) { json(res, 400, { error: 'Provide a task between 1 and 8,000 characters.' }); return; }
      if (!specialistAgents.includes(body.specialist as SpecialistAgent)) { json(res, 400, { error: 'Choose outreach or followup as the specialist.' }); return; }
      const specialist = body.specialist as SpecialistAgent;
      const founderMessage = body.request.trim();
      const delegation = await askTambalaAI('orchestrator', `Founder / Bless has given you this objective:\n\n${founderMessage}\n\nAct as the CEO. Own this objective from start to finish. Delegate the specialist work and create a precise execution brief. Do not invent facts, locations, countries, services, or requirements that are not in the Founder objective.`, { communicationType: 'Founder -> CEO', sender: 'Founder / Bless', recipient: 'Chief Executive Officer (CEO)' });
      let specialistResult: string;
      let researchEvidence: unknown = undefined;
      const specialistTask = `CEO execution brief:\n\n${truncateForModel(delegation, 7000)}\n\nExecute the requested deliverable completely. Do not merely describe process. Verify factual assumptions against research evidence.`;
      if (taskNeedsWebResearch(`${founderMessage}\n${delegation}`)) {
        const researched = await askTambalaAIWithWebResearch(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation }, researchQueryFromObjective(founderMessage));
        specialistResult = researched.response;
        researchEvidence = researched.research;
      } else {
        specialistResult = await askTambalaAI(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation });
      }
      const finalResult = await askTambalaAI('orchestrator', `Complete the Founder objective end-to-end. Original objective:\n${founderMessage}\nDepartment completed work:\n${truncateForModel(specialistResult, 6000)}\nResearch evidence:\n${compactResearchEvidence(researchEvidence)}\nEvaluate the work against the original objective and return the actual final deliverable. Do not merely summarize the department report. Do not invent missing facts; evidence and the original objective take precedence over unsupported delegation claims.`, { communicationType: 'CEO -> Founder', sender: 'Chief Executive Officer (CEO)', recipient: 'Founder / Bless' });
      json(res, 200, { flow: [
        { from: 'Founder / Bless', to: 'Chief Executive Officer (CEO)', type: 'objective', message: founderMessage },
        { from: 'Chief Executive Officer (CEO)', to: getAgentOperationalInfo(specialist).title, type: 'delegation', message: delegation },
        { from: getAgentOperationalInfo(specialist).title, to: 'Chief Executive Officer (CEO)', type: 'completed_work', message: specialistResult },
        { from: 'Chief Executive Officer (CEO)', to: 'Founder / Bless', type: 'final_result', message: finalResult },
      ], result: finalResult, researchEvidence });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The collaboration flow failed.';
      console.error('Live collaboration test failed:', message);
      json(res, errorStatus(message), { error: message });
    }
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

server.listen(runtimeConfig.port, runtimeConfig.host, () => {
  console.log(`Tambala MCP HTTP server listening on ${runtimeConfig.host}:${runtimeConfig.port}`);
});