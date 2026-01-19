# Current State

## Deployment
- Primary deploy: GitHub Actions workflow `deploy-prod.yml` (push to `main` + manual dispatch).
- AUTO role: VPS diagnostics/proofs (logs, checks), not manual deploy steps.
- Expected env location on VPS: `/var/www/dubdub/shared/.env`.

## Domains
- Web: https://app.tvotototo.ru
- API: https://api.tvotototo.ru
- Root: https://tvotototo.ru
- CDN: https://cdn.tvotototo.ru

## Version Gate (current)
- API endpoint: `GET /meta/version`.
- API env: `MIN_WEB_BUILD_ID`.
- Web build-time env: `NEXT_PUBLIC_WEB_BUILD_ID` (CI sets `web_${GITHUB_SHA::12}`).

## Send-to-Telegram (current rules)
- API:
  - `POST /files/renders/:sessionId/send-to-telegram` (auth) enqueues BullMQ job and writes `RenderSend`.
  - `GET /files/renders/:sessionId/send-status` (auth) for polling.
- Worker decision (apps/worker/src/send-telegram.ts):
  - If size > 50MB => `too_large`.
  - If CDN base is set => try URL send ONLY if CDN compatibility passes:
    HEAD 200, `content-type` includes `video/mp4`, Range HEAD returns 206.
  - Otherwise fallback to upload (S3 stream -> temp file -> Telegram upload -> delete).
  - 429 => `rate_limited` with `retryAfterSeconds`, delayed retry.

## Current Top Issue
- Encoding regression (“кракозябры”) in user-facing text (Telegram bot + web UI + worker keyboard labels).
