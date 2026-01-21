# PROJECT_SUMMARY.md

Last updated: 2026-01-21

This is a compact product + engineering summary for quickly onboarding another AI/agent. For the current incident and next actions, see `CURRENT_STATE.md`. For stable architecture, see `PROJECT_CONTEXT.md`.

## Product in one paragraph

DubDub is a Telegram Mini App game where users dub pre-uploaded short video scenes. Players record audio takes for roles; a worker renders a final MP4 (FFmpeg) and the bot delivers the video to users in Telegram.

## Key facts

- Users do not upload scenes; scenes are admin-managed.
- Storage is S3-compatible (Yandex Object Storage in production).
- Rendering is async via BullMQ worker.
- Delivery is via Telegram Bot API (either URL-send via CDN when compatible, or direct upload).

## Monorepo layout

- `apps/api` - Fastify API + Telegram bot, auth, file proxy, polling endpoints.
- `apps/worker` - BullMQ worker, FFmpeg rendering, Telegram send flow.
- `apps/web` - Next.js 14 WebApp UI (Telegram WebView).
- `packages/shared` - shared types/schemas and `RU` user texts.

## Storage keys (canonical)

- Scenes: `scenes/scene_<timestamp>_<uuid>.mp4`
- Takes: `uploads/<sessionId>/<roleIndex>.webm`
- Renders: `renders/<sessionId>.mp4`

## Send-to-Telegram (current behavior)

- Auto-send happens on render ready (worker queues send jobs for participants).
- Admin channel gets a text-only notification (no video).
- Worker chooses URL-send via CDN only when compatibility checks pass (HEAD 200, `video/mp4`, range support); otherwise falls back to direct upload.
- API still exposes:
  - `POST /files/renders/:sessionId/send-to-telegram` (auth)
  - `GET /files/renders/:sessionId/send-status` (auth, polled by result page)

## Telegram WebView (iOS) gotcha

iOS Telegram WebView can fail direct cross-origin polling to the API for send-status, showing "Load failed".

Mitigation:
- Result page polls send-status via a same-origin Next.js API route under `https://app.tvotototo.ru/api/render-send-status/:id`, which server-to-server calls `https://api.tvotototo.ru/...`.

Debug:
- In-app debug line (long-press on "Show game ID") shows the last API error and last poll timestamp.

## Deployment (production)

- Primary deploy is GitHub Actions: `.github/workflows/deploy-prod.yml`.
- CI builds `release.tgz`, uploads it to VPS, and runs `scripts/deploy_remote.sh`.
- VPS uses `/var/www/dubdub/releases/<timestamp>` and switches `/var/www/dubdub/current` symlink.
- PM2 processes are restarted from `current/ecosystem.config.cjs`.
- CI includes:
  - text integrity guard (`check-text-integrity.mjs`)
  - post-deploy HTTP checks (`/health`, `/meta/version`)
  - post-deploy proof step (prints `CURRENT_SYMLINK`, `RELEASE_SHA`, and `:3001` listener)

## Operational rules

- No manual edits on VPS via SSH/PowerShell.
- Use commits + Deploy Prod workflow for changes.
- AUTO is used for diagnostics/proofs only.

## Known risky areas

- FFmpeg filter construction: errors -> render fail.
- File proxy: API becomes a bottleneck/SPOF if clients rely on `/files/*` only.
- Telegram WebView networking quirks (iOS) for cross-origin polling.
- Caching: CDN / browser cache can serve stale render URLs without cache-busting.

## Useful files

- Current status: `CURRENT_STATE.md`
- Context: `PROJECT_CONTEXT.md`
- Deploy details: `AUTODEPLOY_READINESS_REPORT.md`
- Workflow: `.github/workflows/deploy-prod.yml`
- Deploy script: `scripts/deploy_remote.sh`
