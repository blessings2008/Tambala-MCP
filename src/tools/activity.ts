import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseSelect } from '../lib/supabase.js';
import { insertRow } from '../lib/database.js';

type DbRow = Record<string, unknown>;

function text(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const uuid = z.string().uuid();

export function registerActivityTools(server: McpServer): void {
  server.registerTool('record_activity', {
    description: 'Record a business activity in the Tambala history. Use this when an important business event needs to be remembered.',
    inputSchema: {
      activity_type: z.string().trim().min(2).max(80),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2000).optional(),
      entity_type: z.enum(['client', 'lead', 'project', 'task', 'service', 'product', 'business']).optional(),
      entity_id: uuid.optional(),
      actor: z.string().trim().max(100).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
  }, async (input) => text(await insertRow('activity_log', { ...input, metadata: input.metadata ?? {} })));

  server.registerTool('get_activity_timeline', {
    description: 'Get recent Tambala activity history, optionally filtered to one entity or activity type.',
    inputSchema: {
      entity_type: z.enum(['client', 'lead', 'project', 'task', 'service', 'product', 'business']).optional(),
      entity_id: uuid.optional(),
      activity_type: z.string().trim().max(80).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ entity_type, entity_id, activity_type, limit = 50 }) => {
    const filters: string[] = [];
    if (entity_type) filters.push(`entity_type=eq.${encodeURIComponent(entity_type)}`);
    if (entity_id) filters.push(`entity_id=eq.${encodeURIComponent(entity_id)}`);
    if (activity_type) filters.push(`activity_type=eq.${encodeURIComponent(activity_type)}`);
    const query = `select=*&${filters.length ? `${filters.join('&')}&` : ''}order=created_at.desc&limit=${limit}`;
    const activities = await supabaseSelect<DbRow>('activity_log', query);
    return text({ count: activities.length, activities });
  });
}
