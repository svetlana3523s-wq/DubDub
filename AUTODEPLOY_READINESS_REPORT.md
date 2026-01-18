# AUTODEPLOY READINESS REPORT

**Date:** 2026-01-18  
**Repository:** DubDub  
**Scope:** GitHub Actions autodeploy to VPS

---

## CI

* **deploy workflow:** OK
  - File: `.github/workflows/deploy-prod.yml`
  - Location: `.github/workflows/deploy-prod.yml`
  
* **trigger on main:** YES
  - Trigger: `on.push.branches: [main]`
  - Manual dispatch: YES (workflow_dispatch)
  
* **post-deploy check:** PARTIAL
  - Step exists: `Post-deploy check (TODO: set API domain)`
  - Status: TODO — API domain placeholder `<API_DOMAIN>` not replaced
  - Endpoint: `/meta/version` (correct, but URL not configured)

---

## GitHub Secrets

**Note:** Cannot verify actual existence of secrets (only usage in code). Status based on workflow references.

* **DEPLOY_HOST:** OK (referenced in workflow line 21)
* **DEPLOY_USER:** OK (referenced in workflow line 22)
* **DEPLOY_SSH_KEY:** OK (referenced in workflow line 78)
* **DEPLOY_PORT:** OK (referenced in workflow line 23, optional, defaults to 22)
* **DEPLOY_PATH:** OK (referenced in workflow line 24)
* **PROD_API_BASE_URL:** MISSING (not referenced in workflow)

**Warning:** `PROD_API_BASE_URL` is not used in workflow but may be needed for post-deploy checks.

---

## Server Expectations

* **deploy path:** `/var/www/dubdub`
  - Source: `DEPLOY.md` (line 184, 218), `ecosystem.config.cjs` (hardcoded), `PUPKA_REFERENCE.md` (line 34)
  
* **env file:** `/var/www/dubdub/shared/.env`
  - Source: `ecosystem.config.cjs` (lines 9, 18, 28), `DEPLOY.md` (line 223, 228, 235)
  - Used by: all PM2 services via `env_file` option
  
* **process manager:** PM2
  - Source: `DEPLOY.md` (throughout), `ecosystem.config.cjs`
  - Commands: `pm2 reload`, `pm2 start`, `pm2 save`
  
* **services:**
  - `dubdub-api` (script: `apps/api/dist/index.js`)
  - `dubdub-web` (script: `node_modules/next/dist/bin/next start -p 3000`)
  - `dubdub-worker` (script: `apps/worker/dist/index.js`)
  - Source: `ecosystem.config.cjs`, `DEPLOY.md` (lines 34-42)

---

## Post-deploy checks

* **health endpoint:** `/health`
  - Location: `apps/api/src/routes/health.ts`
  - Registered in: `apps/api/src/index.ts` (line 55)
  - Checks: Database (Prisma), Redis
  - Expected response: `{ status: "ok", services: { database: "ok", redis: "ok" } }`
  - Source: `DEPLOY.md` (line 74), `apps/api/src/routes/health.ts`
  
* **version endpoint:** `/meta/version`
  - Location: `apps/api/src/routes/meta.ts`
  - Registered in: `apps/api/src/index.ts` (line 54)
  - Returns: `{ minWebBuildId: string | null, recommendedAction: "refresh", messageRu: string }`
  - Purpose: Version Gate check (frontend version compatibility)
  - Source: `apps/api/src/routes/meta.ts`, `PUPKA_REFERENCE.md` (lines 86-92)

---

## Domain and API URL

* **API domain:** `https://api.tvotototo.ru`
  - Source: `PUPKA_REFERENCE.md` (line 22), `nginx-dubdub-app.conf`, `artifacts/auto_meta_before.txt`
  - Used in config: `apps/api/src/config.ts` (as `API_BASE_URL`), `apps/worker/src/config.ts`
  
* **Web domain:** `https://app.tvotototo.ru`
  - Source: `PUPKA_REFERENCE.md` (line 21), `nginx-dubdub-app.conf`

---

## Overall Status

**BLOCKED** ❌

### Blockers:

1. **Post-deploy check not configured:**
   - Workflow step `Post-deploy check` uses placeholder `<API_DOMAIN>` instead of actual domain
   - Line 99: `curl -sS -D - "https://<API_DOMAIN>/meta/version"`
   - Should be: `curl -sS -D - "https://api.tvotototo.ru/meta/version"` or use `PROD_API_BASE_URL` secret

2. **PROD_API_BASE_URL secret missing:**
   - Not referenced in workflow
   - Recommended: add as GitHub Secret and use in post-deploy check step

### Recommendations:

1. **Fix post-deploy check:**
   - Replace `<API_DOMAIN>` with `api.tvotototo.ru` (hardcoded) OR
   - Add `PROD_API_BASE_URL` secret and use `${{ secrets.PROD_API_BASE_URL }}`

2. **Verify GitHub Secrets:**
   - Confirm all secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PORT`, `DEPLOY_PATH`) are set in repository settings
   - Add `PROD_API_BASE_URL` secret if using dynamic domain

3. **Test workflow:**
   - Run manual workflow dispatch after fixes
   - Verify post-deploy check succeeds (HTTP 200 from `/meta/version`)

---

## What the human needs to know

**Current state:**
- Workflow file exists and is properly configured for push to `main`
- Server paths and services are documented and match workflow expectations
- Health and version endpoints are implemented and registered
- **Problem:** Post-deploy check will fail because API domain is not set

**Action required:**
1. Edit `.github/workflows/deploy-prod.yml` line 99
2. Replace `<API_DOMAIN>` with `api.tvotototo.ru` or use `${{ secrets.PROD_API_BASE_URL }}`
3. If using secret: Add `PROD_API_BASE_URL` = `https://api.tvotototo.ru` in GitHub repository settings → Secrets and variables → Actions
4. Verify all other secrets are set

**After fix:**
- Workflow should be ready for autodeploy
- Post-deploy check will verify `/meta/version` endpoint is accessible
- Deployment uses atomic releases with PM2 reload

---

**Artifacts:**
- Workflow file: `.github/workflows/deploy-prod.yml`
- Deploy script: `scripts/deploy_remote.sh`
- PM2 config: `ecosystem.config.cjs`
- Documentation: `DEPLOY.md`, `PUPKA_REFERENCE.md`
