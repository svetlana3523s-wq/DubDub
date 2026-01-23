# AUTODEPLOY_READINESS_REPORT.md

Last updated: 2026-01-21

This document describes the production deployment pipeline (GitHub Actions -> VPS) and the minimal proof checklist. For current incidents, see `CURRENT_STATE.md`.

## Status

STATUS: PASS - Deploy Prod workflow exists and is the primary deployment mechanism.

## Where things live (prod)

- Workflow: `.github/workflows/deploy-prod.yml`
- Remote deploy script: `scripts/deploy_remote.sh`
- PM2 config: `ecosystem.config.cjs`
- Deploy root on VPS: `/var/www/dubdub`
- Shared env on VPS: `/var/www/dubdub/shared/.env`
- Active release: `/var/www/dubdub/current` (symlink)
- Releases dir: `/var/www/dubdub/releases/<timestamp>`

## How Deploy Prod works (high level)

1) GitHub Actions checks out `main` (or the provided input ref).
2) Builds the monorepo (`pnpm -r build`) and packages `release.tgz`.
3) Uploads `release.tgz` to VPS: `/tmp/release.tgz`.
4) Runs `scripts/deploy_remote.sh` on VPS which:
   - creates a new release dir `releases/<timestamp>`
   - writes `RELEASE_SHA` into the release dir (if provided)
   - symlinks `.env` from `shared/.env` (fallback to `/var/www/dubdub/.env`)
   - installs deps (including dev deps for Prisma generate/migrate), then prunes to prod deps
   - switches `/var/www/dubdub/current` symlink to the new release
   - restarts PM2 processes using `/var/www/dubdub/current/ecosystem.config.cjs`
   - performs a local smoke check against `/health` and `/meta/version` (non-blocking)

## GitHub Secrets required

- `DEPLOY_HOST` - VPS host/IP
- `DEPLOY_USER` - SSH user
- `DEPLOY_SSH_KEY` - private key contents (ed25519)
- `DEPLOY_PATH` - expected `/var/www/dubdub`
- `DEPLOY_PORT` - optional, defaults to 22
- `PROD_API_BASE_URL` - optional, used for post-deploy HTTP checks (e.g. `https://api.tvotototo.ru`)

## Proof checklist (what "OK" means)

From GitHub Actions logs (preferred):
- Text integrity guard step is green.
- "Post-deploy check" shows:
  - `GET /health` -> 200
  - `GET /meta/version` -> 200
- "Post-deploy proof (VPS state)" prints:
  - `CURRENT_SYMLINK` points to the newest release
  - `RELEASE_SHA` exists (matches the workflow SHA)
  - `ss -ltnp | grep :3001` shows API listening
  - local `curl http://127.0.0.1:3001/health` returns 200

From VPS (AUTO diagnostics only, no edits):
- `readlink -f /var/www/dubdub/current`
- `cat /var/www/dubdub/current/RELEASE_SHA` (if present)
- `pm2 status`
- `ss -ltnp | grep :3001`
- `curl -sS -D - http://127.0.0.1:3001/health -o /dev/null | head -n 5`

## Common failure modes

- "Green deploy but server still old code"
  - Check `/var/www/dubdub/current/RELEASE_SHA` and `CURRENT_SYMLINK`.
  - Ensure PM2 is started from `current/ecosystem.config.cjs` (deploy script deletes & restarts processes).
- API returns 502 from nginx
  - Usually API process crashed on startup or port is not listening.
  - Collect: `pm2 logs dubdub-api`, `ss -ltnp | grep :3001`, `/var/log/nginx/error.log`.
- Prisma failures (DATABASE_URL missing / migrations)
  - Ensure `/var/www/dubdub/shared/.env` exists and contains `DATABASE_URL`.

## Ops rule (hard)

- No manual editing of files on VPS via SSH/PowerShell.
- Any change must be done via commits + Deploy Prod workflow, or the deploy script itself.
