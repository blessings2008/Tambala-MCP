import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { prepareRenderProject } from '../rendering/project.js';

function text(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function registerRenderTools(server: McpServer): void {
  server.registerTool(
    'prepare_video_project',
    {
      description: 'Validate and prepare a video-rendering manifest for Tambala Render. This creates a plan only; it does not download media or render a video.',
      inputSchema: {
        title: z.string().trim().min(1).max(120).describe('Video project title.'),
        format: z.enum(['vertical', 'landscape', 'square']).optional().describe('Output aspect format; defaults to vertical 1080x1920.'),
        fps: z.number().int().min(24).max(60).optional().describe('Frames per second; defaults to 30.'),
        scenes: z.array(z.object({
          assetUrl: z.string().url().describe('HTTPS URL for an image or video asset.'),
          caption: z.string().max(500).optional().describe('Optional scene caption.'),
          durationSeconds: z.number().int().min(1).max(30).describe('Scene duration in seconds.'),
        })).min(1).max(20).describe('Between 1 and 20 scenes, with a total duration no longer than 120 seconds.'),
      },
    },
    async (input) => {
      try {
        return text(prepareRenderProject(input));
      } catch (error) {
        return text({
          status: 'invalid',
          error: error instanceof Error ? error.message : 'Video project validation failed.',
        });
      }
    },
  );
}
