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
  if (/too large|valid JSON|Choose|Provide a prompt/i.test(message)) return 400;
  return 502;
}

function taskNeedsWebResearch(text: string): boolean {
  return /\b(research|investigate|look\s*up|find|identify|current|latest|market|competitor|prospect|hotel|lodge|tourism|association|statistics|report)\b/i.test(text);
}

const server = createHttpServer(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const requestPath = req.url?.split('?')[0] ?? '/';
  if (await handleOAuth(req, res, requestPath)) return;
  if (requestPath === '/health' && req.method === 'GET') { handleHealth(res); return; }

  if ((requestPath === '/api/chat-test/status' || requestPath === '/api/chat-test' || requestPath === '/api/chat-test/collaborate') && (req.method === 'GET' || req.method === 'POST')) {
    if (!chatTokenMatches(bearerToken(req))) { json(res, 401, { error: 'Unauthorized. Check the chat test token.' }); return; }
  }

  if (requestPath === '/api/chat-test/status' && req.method === 'GET') {
    json(res, 200, {
      agents: chatAgents.map((agent) => getAgentOperationalInfo(agent)),
      safety: 'Test requests only generate AI text. They do not send messages or execute business actions.',
      collaboration: 'The collaboration endpoint executes Founder objectives through CEO delegation, specialist execution, and CEO completion. The CEO is accountable for the final result, not merely a relay of the specialist report.',
      research: 'Research-enabled tasks run through the configured web research provider and pass returned source evidence into the specialist and final CEO completion step.',
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
        const researched = await askTambalaAIWithWebResearch(agent as AgentName, body.request.trim());
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

  if (requestPath === '/api/chat-test/collaborate' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { request?: unknown; specialist?: unknown };
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8_000) { json(res, 400, { error: 'Provide a task between 1 and 8,000 characters.' }); return; }
      if (!specialistAgents.includes(body.specialist as SpecialistAgent)) { json(res, 400, { error: 'Choose outreach or followup as the specialist.' }); return; }

      const specialist = body.specialist as SpecialistAgent;
      const founderMessage = body.request.trim();

      // Step 1: CEO interprets the Founder objective and creates a precise execution brief.
      const delegation = await askTambalaAI('orchestrator', `Founder / Bless has given you this objective:\n\n${founderMessage}\n\nAct as the CEO. You own this objective from start to finish. Decide which work must be delegated to ${getAgentOperationalInfo(specialist).title}. Create a precise execution brief for that department. Do not answer the Founder yet and do not perform the specialist's work yourself. The department must return the actual requested deliverable, not merely advice about how to do it. Include the objective, scope, constraints, required deliverable, quality bar, and what evidence or sources are required.`, { communicationType: 'Founder -> CEO', sender: 'Founder / Bless', recipient: 'Chief Executive Officer (CEO)' });

      // Step 2: specialist actually executes the delegated work, including web research when needed.
      let specialistResult: string;
      let researchEvidence: unknown = undefined;
      const specialistTask = `CEO execution brief:\n\n${delegation}\n\nExecute this task now. Produce the requested deliverable itself. Do not merely describe what should be done, do not delegate it back, and do not stop at recommendations about process. Respect every constraint in the brief. If research is required, use the supplied web research evidence and clearly preserve the source URLs. Return the completed work to the CEO, including any material blockers that genuinely prevent completion.`;

      if (taskNeedsWebResearch(`${founderMessage}\n${delegation}`)) {
        const researched = await askTambalaAIWithWebResearch(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation });
        specialistResult = researched.response;
        researchEvidence = researched.research;
      } else {
        specialistResult = await askTambalaAI(specialist, specialistTask, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation });
      }

      // Step 3: CEO consumes the completed departmental work and finishes the original objective.
      const finalResult = await askTambalaAI('orchestrator', `You are now completing the Founder objective end-to-end.\n\nORIGINAL FOUNDER OBJECTIVE:\n${founderMessage}\n\nYOUR DELEGATION:\n${delegation}\n\nDEPARTMENT'S COMPLETED WORK:\n${specialistResult}\n\nWEB RESEARCH EVIDENCE (if any):\n${JSON.stringify(researchEvidence ?? null)}\n\nDo NOT merely summarize the department report. Do NOT say what the department recommends doing. Instead, use the completed departmental work to produce the actual final deliverable requested by the Founder. You are accountable for the result. Check the work against the original objective and constraints. If something material is missing, correct it using the evidence available to you; do not invent facts. Preserve source URLs for web-supported claims. If the task asked for a list, give the list. If it asked for a plan, give the plan. If it asked for research, give the researched findings. If a genuine blocker prevents completion, clearly identify it rather than pretending the task is complete. Return only the useful final result for Founder / Bless, with concise context where necessary.`, { communicationType: 'CEO -> Founder', sender: 'Chief Executive Officer (CEO)', recipient: 'Founder / Bless', founderObjective: founderMessage, delegation, specialistResult, researchEvidence });

      json(res, 200, {
        flow: [
          { from: 'Founder / Bless', to: 'Chief Executive Officer (CEO)', type: 'objective', message: founderMessage },
          { from: 'Chief Executive Officer (CEO)', to: getAgentOperationalInfo(specialist).title, type: 'delegation', message: delegation },
          { from: getAgentOperationalInfo(specialist).title, to: 'Chief Executive Officer (CEO)', type: 'completed_work', message: specialistResult },
          { from: 'Chief Executive Officer (CEO)', to: 'Founder / Bless', type: 'final_result', message: finalResult },
        ],
        result: finalResult,
        researchEvidence,
        note: 'Live end-to-end agent test. The specialist executes delegated work, research is injected into the execution context when required, and the CEO completes and returns the original Founder objective rather than merely relaying a departmental report. Messages are not persisted and no external business action is executed.',
      });
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
