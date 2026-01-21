# Project Context (DubDub)

Last updated: 2026-01-21

This file is a stable, high-level description of the product and architecture. For the current incident and next actions, see `CURRENT_STATE.md`.

## Product

DubDub is a Telegram Mini App game where users dub pre-uploaded video scenes:
- Scenes are prepared in advance by admins.
- Players record voice takes for roles.
- A worker renders the final MP4 using FFmpeg (original audio + overlay takes).
- The rendered MP4 is delivered to users in Telegram via the bot.

## Monorepo services

- `apps/api` - Fastify API + Telegram bot (Telegraf), file proxy endpoints, auth (Telegram initData).
- `apps/worker` - BullMQ worker, downloads media from S3, renders via FFmpeg, sends result to Telegram.
- `apps/web` - Next.js WebApp (Telegram Mini App UI).
- `packages/shared` - shared types/schemas and `RU` user-facing texts.

Infra:
- PostgreSQL + Redis
- S3-compatible object storage (Yandex Object Storage in prod)
- PM2 on VPS
- Nginx reverse proxy

## Storage key conventions

- Scene video: `scenes/scene_<timestamp>_<uuid>.mp4`
- Take audio: `uploads/<sessionId>/<roleIndex>.webm`
- Render output: `renders/<sessionId>.mp4`

## Critical flows

### Render
1) Web calls API to create/play a session and upload takes.
2) API enqueues a render job.
3) Worker downloads the scene + takes from S3 and runs FFmpeg.
4) Worker uploads `renders/<sessionId>.mp4` back to S3.

### Send to Telegram
- Worker auto-sends to all participants when render becomes ready (idempotent job key: `send:${renderId}:${telegramUserId}`).
- Admin channel receives a text-only notification (no video).
- Worker sends via:
  - CDN URL method (only if compatibility checks pass), otherwise
  - direct upload method.

## API endpoints (high signal)

- Health: `GET /health`
- Version gate: `GET /meta/version`
- Polling (result page):
  - `GET /files/renders/:sessionId/send-status` (requires `X-TG-INIT-DATA`)
  - `GET /renders/:sessionId` (render status)

## Telegram WebView notes (iOS)

iOS Telegram WebView can fail direct cross-origin polling to the API for send-status, showing "Load failed".

Current workaround:
- The WebApp polls send-status through a same-origin Next.js API route under `https://app.tvotototo.ru/api/render-send-status/:id`, which server-to-server calls `https://api.tvotototo.ru/...`.
- Proxy and client use `no-store` to avoid cached status.

Debug tooling:
- Result page has an in-app debug toggle (long-press on "Show game ID") to show last API error and last poll timestamp.

## Deployment (summary)

- Primary deploy: GitHub Actions `.github/workflows/deploy-prod.yml`.
- CI builds `release.tgz` and uploads to VPS, then runs `scripts/deploy_remote.sh`.
- VPS layout:
  - `/var/www/dubdub/releases/<timestamp>` - release directories
  - `/var/www/dubdub/current` - symlink to active release
  - `/var/www/dubdub/shared/.env` - prod env

## Current priorities

See `CURRENT_STATE.md` for the current top issue and the next actions.
