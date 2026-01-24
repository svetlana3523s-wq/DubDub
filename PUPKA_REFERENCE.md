# PUPKA_REFERENCE.md

Last updated: 2026-01-21

Single source of truth for the PUPKA coordination assistant. Update this file first, then update `CURRENT_STATE.md` if needed.

## Roles

- User: makes product decisions and validates in Telegram WebView.
- CODEX: writes code, commits, triggers GitHub Actions deploys.
- AUTO: VPS diagnostics/proofs only (no manual edits).
- PUPKA: reads repo/docs/artifacts, produces precise prompts + handoffs, keeps context docs consistent.

## Production endpoints

- WebApp: `https://app.tvotototo.ru`
- API: `https://api.tvotototo.ru`
- Root: `https://tvotototo.ru`
- CDN (prod): `https://cdn.tvotototo.ru`
- CDN (test): `https://cdn-test.tvotototo.ru`

## VPS basics

- Deploy root: `/var/www/dubdub`
- Shared env: `/var/www/dubdub/shared/.env`
- Active release: `/var/www/dubdub/current`
- Processes (PM2): `dubdub-api`, `dubdub-worker`, `dubdub-web`
- API port (prod): `3001`

## What to trust priority

1) `artifacts/*` (proofs/logs)
2) `docs/*`
3) `CURRENT_STATE.md`
4) Chat messages (least reliable)

## Current known issue (P0)

- Telegram iOS WebView: send-status must update without manual reload.
- Workaround: same-origin proxy for send-status under `https://app.tvotototo.ru/api/render-send-status/:id`.
- Ensure polling + no-store are working so status flips to `sent` automatically.
- Duo replay confirm uses same-origin replay proxies under `/api/replay/:sessionId/*`.

## Debug shortcuts

- In-app debug line: long-press (3s) on "Show game ID" on the result page.
- When reporting a bug, include:
  - sessionId (from "Show game ID")
  - screenshot with the debug line visible (if present)
  - whether it was inside Telegram WebView (iOS/Android) or external browser

## Replay confirm checks (duo)
- If confirm prompt feels slow, confirm polling interval is active (pending state = 2s polling).
- Responder should see a short “confirmation sent” message after clicking Yes.

## Quick text checks (before UI deploy)

```
node check-text-integrity.mjs
rg -n "\\?{3,}" apps/web/src
rg -n "Р’С|РќР|РІвЂ|в†ђ" apps/web/src
```

## Deploy verification (preferred)

- GitHub Actions "Deploy Prod" logs:
  - Post-deploy HTTP checks: `/health`, `/meta/version`
  - Post-deploy proof: `CURRENT_SYMLINK`, `RELEASE_SHA`, and `:3001` listener

If AUTO needs to verify on VPS (read-only):
- `readlink -f /var/www/dubdub/current`
- `cat /var/www/dubdub/current/RELEASE_SHA`
- `pm2 status`
- `ss -ltnp | grep :3001`
