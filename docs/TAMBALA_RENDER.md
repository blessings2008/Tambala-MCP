# Tambala Render Foundation

Tambala Render is being developed inside the existing Tambala MCP service so the organization's AI tools can eventually request video production without creating a separate, disconnected system.

## Current foundation

- Adds the `prepare_video_project` MCP tool.
- Validates project titles, scene counts, HTTPS asset URLs, per-scene durations, total duration, output format, and frame rate.
- Produces a portable render manifest with output dimensions.
- Keeps transport, authentication, tool registration, and deployment bootstrap in the existing application.
- Does not modify the existing database, OAuth flow, HTTP routes, or current Render start command.

## Explicit current limitations

This is the project-manifest foundation only. It does not yet download media, execute FFmpeg, create asynchronous jobs, store rendered files, or expose a public rendering API. The tool reports `renderingImplemented: false` so callers cannot mistake a validated plan for a completed video.

## Next implementation steps

1. Add asset ingestion with size/type limits and safe URL handling.
2. Add an FFmpeg adapter behind a renderer interface; verify FFmpeg availability in the target runtime before enabling it.
3. Add job lifecycle states and bounded concurrency so long renders do not run inside an MCP request.
4. Add persistent output storage and expiring download URLs.
5. Add tests for validation, URL restrictions, duration limits, and renderer failures.
6. Decide whether Render deployment should remain on its current runtime or use a separate worker/container. Avoid changing the existing production start command until that decision is tested.

## Initial constraints

- Maximum 20 scenes per project.
- Maximum 30 seconds per scene.
- Maximum 120 seconds total.
- Supported formats: vertical (1080x1920), landscape (1920x1080), square (1080x1080).
- Supported frame rates: 24–60 fps.
- Scene asset URLs must use HTTPS. Additional SSRF protections and media download limits are required before any asset fetching is implemented.
