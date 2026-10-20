import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { askTambalaAI, getAgentModel, type AgentName } from '../services/ai.js';

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

const agent = z.enum(['orchestrator', 'outreach', 'followup']);

export function registerAITools(server: McpServer): void {
  server.registerTool('ask_tambala_ai', {
    description: 'Ask a Tambala AI specialist for read-only analysis or drafting. It does not modify business records or send messages.',
    inputSchema: {
      agent: agent.describe('AI specialist'),
      request: z.string().trim().min(1).max(10000).describe('What you want the AI specialist to do'),
    },
  }, async ({ agent: agentName, request }) => {
    const result = await askTambalaAI(agentName as AgentName, request);
    return text({ agent: agentName, model: getAgentModel(agentName as AgentName), response: result });
  });

  server.registerTool('draft_outreach', {
    description: 'Draft a personalized prospect message from supplied facts. The draft is never sent by this tool.',
    inputSchema: {
      prospect: z.string().trim().min(1).max(5000),
      goal: z.string().trim().min(1).max(2000),
      channel: z.enum(['email', 'sms', 'chat']).default('email'),
    },
  }, async ({ prospect, goal, channel }) => {
    const result = await askTambalaAI('outreach', `Draft a ${channel} message. Goal: ${goal}. Prospect facts: ${prospect}`, { prospect, goal, channel });
    return text({ channel, draft: result, requires_approval: true });
  });

  server.registerTool('analyze_followup', {
    description: 'Analyze interaction history and recommend the next follow-up. It never sends anything.',
    inputSchema: {
      history: z.string().trim().min(1).max(10000),
      goal: z.string().trim().min(1).max(2000),
    },
  }, async ({ history, goal }) => {
    const result = await askTambalaAI('followup', `Analyze this follow-up situation. Goal: ${goal}. History: ${history}`);
    return text({ recommendation: result, requires_approval: true });
  });
}
