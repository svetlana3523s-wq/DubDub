#!/usr/bin/env bash
set -euo pipefail

TARBALL="${1:-}"
DEPLOY_PATH="${2:-}"

if [ -z "$TARBALL" ] || [ -z "$DEPLOY_PATH" ]; then
  echo "Usage: deploy_remote.sh <release.tgz> <deploy_path>"
  exit 1
fi

if [ ! -f "$TARBALL" ]; then
  echo "Release tarball not found: $TARBALL"
  exit 1
fi

RELEASES_DIR="$DEPLOY_PATH/releases"
SHARED_DIR="$DEPLOY_PATH/shared"
CURRENT_LINK="$DEPLOY_PATH/current"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$TIMESTAMP"

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$TARBALL" -C "$RELEASE_DIR"

if [ -f "$SHARED_DIR/.env" ]; then
  ln -sfn "$SHARED_DIR/.env" "$RELEASE_DIR/.env"
else
  if [ -f "$DEPLOY_PATH/.env" ]; then
    echo "Warning: $SHARED_DIR/.env not found; falling back to $DEPLOY_PATH/.env"
    ln -sfn "$DEPLOY_PATH/.env" "$RELEASE_DIR/.env"
  else
    echo "Warning: $SHARED_DIR/.env not found"
  fi
fi

cd "$RELEASE_DIR"

if [ -f "$SHARED_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$SHARED_DIR/.env"
  set +a
elif [ -f "$DEPLOY_PATH/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$DEPLOY_PATH/.env"
  set +a
fi

corepack enable
# Avoid interactive prompts in CI/non-tty contexts
export CI=1
# Prisma CLI is a devDependency in this repo; during deploy we need dev deps
# for `prisma generate/migrate`, then we prune to production dependencies.
pnpm install --frozen-lockfile --prod=false

if [ -d "prisma" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "Error: DATABASE_URL is not set (expected in $SHARED_DIR/.env)"
    exit 1
  fi
  pnpm db:generate
  if [ -d "prisma/migrations" ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
    pnpm db:migrate
  else
    echo "Warning: prisma/migrations is empty; skipping prisma migrate deploy"
  fi
fi

pnpm install --frozen-lockfile --prod --force

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --update-env || \
  (pm2 reload "$CURRENT_LINK/ecosystem.config.cjs" --update-env || pm2 start "$CURRENT_LINK/ecosystem.config.cjs" --update-env)
pm2 save

if command -v curl >/dev/null 2>&1; then
  echo "Local smoke check (non-blocking): /health and /meta/version"
  curl -fsS "http://127.0.0.1:${API_PORT:-4000}/health" | head -c 2000 || true
  echo
  curl -fsS "http://127.0.0.1:${API_PORT:-4000}/meta/version" | head -c 2000 || true
  echo
fi

KEEP="${KEEP_RELEASES:-5}"
if [ "$KEEP" -gt 0 ]; then
  ls -1dt "$RELEASES_DIR"/* | tail -n +"$((KEEP + 1))" | xargs -r rm -rf
fi
