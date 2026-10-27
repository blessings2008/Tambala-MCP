import * as z from 'zod/v4';

export const renderFormatSchema = z.enum(['vertical', 'landscape', 'square']);

export const renderSceneSchema = z.object({
  assetUrl: z.string().url().refine((value) => value.startsWith('https://'), {
    message: 'Scene assets must use HTTPS URLs.',
  }),
  caption: z.string().max(500).optional(),
  durationSeconds: z.number().int().min(1).max(30),
});

export const renderProjectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  format: renderFormatSchema.default('vertical'),
  fps: z.number().int().min(24).max(60).default(30),
  scenes: z.array(renderSceneSchema).min(1).max(20),
}).superRefine((project, context) => {
  const totalSeconds = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  if (totalSeconds > 120) {
    context.addIssue({
      code: 'custom',
      path: ['scenes'],
      message: 'A project cannot exceed 120 seconds in the initial foundation.',
    });
  }
});

export type RenderProjectInput = z.input<typeof renderProjectSchema>;
export type RenderProject = z.output<typeof renderProjectSchema>;

const dimensionsByFormat = {
  vertical: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
} as const;

/**
 * Validate and normalize a render request into a portable manifest.
 * This stage does not download assets or execute FFmpeg.
 */
export function prepareRenderProject(input: unknown) {
  const project = renderProjectSchema.parse(input);
  const totalDurationSeconds = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);

  return {
    status: 'prepared' as const,
    renderer: 'ffmpeg' as const,
    title: project.title,
    format: project.format,
    resolution: dimensionsByFormat[project.format],
    fps: project.fps,
    totalDurationSeconds,
    sceneCount: project.scenes.length,
    scenes: project.scenes.map((scene, index) => ({
      index: index + 1,
      assetUrl: scene.assetUrl,
      caption: scene.caption ?? '',
      durationSeconds: scene.durationSeconds,
    })),
    renderingImplemented: false,
    nextStep: 'Asset ingestion, FFmpeg execution, job tracking, and persistent output storage are not enabled yet.',
  };
}
