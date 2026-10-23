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
import { webResearch } from './services/web-research.js';

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
  if (/No API key configured|must be configured|Web research is not configured/i.test(message)) return 503;
  if (/too large|valid JSON|Choose|Provide a prompt/i.test(message)) return 400;
  return 502;
}

const server = createHttpServer(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const requestPath = req.url?.split('?')[0] ?? '/';
  if (await handleOAuth(req, res, requestPath)) return;
  if (requestPath === '/health' && req.method === 'GET') { handleHealth(res); return; }

  if ((requestPath === '/api/chat-test/status' || requestPath === '/api/chat-test' || requestPath === '/api/chat-test/collaborate' || requestPath === '/api/chat-test/research') && (req.method === 'GET' || req.method === 'POST')) {
    if (!chatTokenMatches(bearerToken(req))) { json(res, 401, { error: 'Unauthorized. Check the chat test token.' }); return; }
  }

  if (requestPath === '/api/chat-test/status' && req.method === 'GET') {
    json(res, 200, {
      agents: chatAgents.map((agent) => getAgentOperationalInfo(agent)),
      research: { provider: 'Tavily', configured: Boolean(process.env.TAMBALA_WEB_SEARCH_API_KEY), freeTier: '1,000 API credits/month on the current free plan; no credit card required.' },
      safety: 'Test requests only generate AI text. They do not send messages or execute business actions.',
      collaboration: 'The collaboration endpoint mediates Founder -> CEO -> department head -> CEO -> Founder. Messages are not persisted yet.',
    });
    return;
  }

  if (requestPath === '/api/chat-test/research' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { query?: unknown; maxResults?: unknown };
      if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 2_000) { json(res, 400, { error: 'Provide a research query between 1 and 2,000 characters.' }); return; }
      const maxResults = typeof body.maxResults === 'number' ? Math.min(Math.max(Math.floor(body.maxResults), 1), 8) : 5;
      const result = await webResearch(body.query, maxResults);
      json(res, 200, { provider: 'Tavily', query: result.query, results: result.results });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Web research failed.';
      console.error('Web research test failed:', message);
      json(res, errorStatus(message), { error: message });
    }
    return;
  }

  if (requestPath === '/api/chat-test' && req.method === 'POST') {
    if (!req.headers['content-type']?.toLowerCase().includes('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return; }
    try {
      const body = await readJsonBody(req) as { agent?: unknown; request?: unknown; useWebResearch?: unknown };
      if (!body || typeof body !== 'object' || !chatAgents.includes(body.agent as ChatAgent)) { json(res, 400, { error: 'Choose orchestrator, outreach, or followup.' }); return; }
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 10_000) { json(res, 400, { error: 'Provide a prompt between 1 and 10,000 characters.' }); return; }
      const agent = body.agent as ChatAgent;
      const useWeb = body.useWebResearch === true;
      if (useWeb) {
        const result = await askTambalaAIWithWebResearch(agent as AgentName, body.request.trim());
        json(res, 200, { agent, model: getAgentOperationalInfo(agent).model, response: result.response, research: result.research });
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
      const body = await readJsonBody(req) as { request?: unknown; specialist?: unknown; useWebResearch?: unknown };
      if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8_000) { json(res, 400, { error: 'Provide a task between 1 and 8,000 characters.' }); return; }
      if (!specialistAgents.includes(body.specialist as SpecialistAgent)) { json(res, 400, { error: 'Choose outreach or followup as the specialist.' }); return; }
      const specialist = body.specialist as SpecialistAgent;

      const founderMessage = body.request.trim();
      const delegation = await askTambalaAI('orchestrator', `Founder / Bless has sent you this objective:\n\n${founderMessage}\n\nAct as CEO. Decide what work should be delegated to ${specialist}. Write a concise internal delegation message addressed to the ${specialist} department head. Do not perform the specialist's work yourself. Include the objective, every material constraint, expected deliverable, source requirements, and what should be reported back.`, { communicationType: 'Founder -> CEO', sender: 'Founder / Bless', recipient: 'Chief Executive Officer (CEO)' });

      const shouldResearch = body.useWebResearch === true || (specialist === 'outreach' && /\b(research|find|identify|current|market|prospect|hotel|lodge|tourism|competitor)\b/i.test(founderMessage));
      let specialistReport: string;
      let researchEvidence = '';
      if (shouldResearch) {
        const researched = await askTambalaAIWithWebResearch(specialist, `Internal message from your CEO:\n\n${delegation}\n\nComplete the delegated work within your department's responsibility. Use the supplied web evidence for current external facts. Enforce every explicit constraint. Then report your findings, source URLs, deliverable, assumptions, and blockers back to the CEO. Do not address the Founder directly unless the message explicitly requires it.`, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation }, founderMessage);
        specialistReport = researched.response;
        researchEvidence = researched.research;
      } else {
        specialistReport = await askTambalaAI(specialist, `Internal message from your CEO:\n\n${delegation}\n\nComplete the delegated work within your department's responsibility. Then report your findings, deliverable, assumptions, and blockers back to the CEO. Do not address the Founder directly unless the message explicitly requires it.`, { communicationType: 'CEO -> Department Head', sender: 'Chief Executive Officer (CEO)', recipient: getAgentOperationalInfo(specialist).title, delegation });
      }

      const executiveReview = await askTambalaAI('orchestrator', `You delegated work to ${getAgentOperationalInfo(specialist).title}. Here is the specialist's report:\n\n${specialistReport}\n\nReview it as CEO against the original Founder objective and the delegation. Audit every material constraint (especially country, industry, scope, dates, and requested deliverables), source provenance, unsupported claims about Tambala's services/capabilities, fabricated contacts or URLs, and any claim that research occurred without evidence. If there is a material violation, explicitly REJECT the report and state the correction required instead of passing the error to the Founder. If it passes, briefly state what the department completed, important limitations/blockers, and your recommendation to Founder / Bless. Do not invent work that the specialist did not complete.`, { communicationType: 'Department Head -> CEO', sender: getAgentOperationalInfo(specialist).title, recipient: 'Chief Executive Officer (CEO)', specialistReport, researchEvidence });

      json(res, 200, {
        flow: [
          { from: 'Founder / Bless', to: 'Chief Executive Officer (CEO)', type: 'objective', message: founderMessage },
          { from: 'Chief Executive Officer (CEO)', to: getAgentOperationalInfo(specialist).title, type: 'delegation', message: delegation },
          { from: getAgentOperationalInfo(specialist).title, to: 'Chief Executive Officer (CEO)', type: 'report', message: specialistReport },
          { from: 'Chief Executive Officer (CEO)', to: 'Founder / Bless', type: 'executive_review', message: executiveReview },
        ],
        researchUsed: Boolean(researchEvidence),
        researchEvidence: researchEvidence || undefined,
        note: 'Live mediated agent-to-agent test. Messages are not persisted and no external business action is executed.',
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
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
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
