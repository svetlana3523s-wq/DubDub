# Current State

Last updated: 2026-01-21

## Deployment
- Primary deploy: GitHub Actions workflow `.github/workflows/deploy-prod.yml` (push to `main` + manual dispatch).
- Deploy mechanism: build `release.tgz` -> upload to VPS -> `scripts/deploy_remote.sh` creates `releases/<timestamp>` and switches `current` symlink.
- VPS env: `/var/www/dubdub/shared/.env` (fallback `/var/www/dubdub/.env`).
- Deploy proof: workflow prints `CURRENT_SYMLINK`, `RELEASE_SHA`, and `:3001` listener after deploy.
- AUTO role: diagnostics/proofs only (no manual server edits). CODEX role: code + commits + workflow deploys.

## Domains (prod)
- WebApp: `https://app.tvotototo.ru`
- API: `https://api.tvotototo.ru`
- Root: `https://tvotototo.ru`
- CDN (prod): `https://cdn.tvotototo.ru`
- CDN (test): `https://cdn-test.tvotototo.ru`

## Version Gate
- API: `GET /meta/version`, env `MIN_WEB_BUILD_ID`.
- Web build-time env: `NEXT_PUBLIC_WEB_BUILD_ID` (CI sets `web_${GITHUB_SHA::12}`).

## Send-to-Telegram (current)
- Worker auto-sends on render ready for all participants (idempotent key `send:${renderId}:${telegramUserId}`).
- Admin channel: text-only notification (no video).
- API endpoints:
  - `POST /files/renders/:sessionId/send-to-telegram` (auth) still exists (enqueue + write `RenderSend`).
  - `GET /files/renders/:sessionId/send-status` (auth) returns status for UI polling.
- Worker send decision (apps/worker/src/send-telegram.ts):
  - If file size > 50MB => `too_large`.
  - If CDN base configured: try URL-send only if CDN compatibility passes (HEAD 200, `video/mp4`, range support).
  - Otherwise fallback to Telegram upload.
  - 429 => `rate_limited` with `retryAfterSeconds` + delayed retry.

## Bot invite links
- Source of truth: `BOT_USERNAME` from env (no hardcoded bot name).
- Example invite: `https://t.me/zlomem_bot?startapp=s_<sessionId>` (no leading `@` in URL).

## iOS Telegram WebView (important)
- Direct polling `https://api.../files/renders/:id/send-status` caused WebView network failures (`Load failed`) due to preflight/CORS behavior.
- Workaround: result page polls send-status via same-origin proxy under `https://app.tvotototo.ru/api/render-send-status/:id` (no CORS).
- Proxy and client use `no-store` to avoid cached send-status; debug shows last poll timestamp.
- Debug: long-press (3s) on "Show game ID" toggles an in-app debug line showing the last API error.

## Guardrails
- Text integrity guard is enabled in CI: `check-text-integrity.mjs` + workflow step.
- User-facing Telegram bot texts are centralized under shared `RU` exports.
- Rule: all user-facing RU strings must come from `ru.ts` (no hardcoded RU in UI).
- Do not type Russian directly in `.tsx` during large UI refactors; use `RU` keys.
- After UI refactor: run `node check-text-integrity.mjs` and `rg -n "\\?{3,}" apps/web/src`.

## Current Top Issue (P0)
- Verify send-status updates without reload in Telegram WebView (after proxy + no-store + polling start on render ready).
- If it still stalls, capture debug line (Last API error + Last send-status poll).

## Next Actions (small steps)
- CODEX: ensure proxy route returns `Cache-Control: no-store` and client polling runs on `render=ready` and updates UI without reload.
- AUTO: confirm status flips in Telegram WebView for a fresh session (no reload needed) and capture debug line if it still stalls.
