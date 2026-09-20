#!/usr/bin/env bash
# /opt/havenworld/scripts/remote-deploy.sh  (also piped via `make deploy-server`)
# ─────────────────────────────────────────────────────────────────────────────
# HavenWorld — server deploy script (Oracle Cloud / free-tier)
#
# Runs as user `havenworld` on the Oracle VM.
# Safe to pipe via SSH:  ssh oracle-cloud 'bash -s' < scripts/remote-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/havenworld"
LOG_DIR="$APP_DIR/logs"

# Load nvm if present (for interactive PATH when using ubuntu user)
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S') — starting"
cd "$APP_DIR"

echo "[deploy] git pull origin main"
git pull origin main

echo "[deploy] pnpm install"
pnpm install --frozen-lockfile

echo "[deploy] build shared package"
pnpm --filter '@havenworld/shared' build

echo "[deploy] prisma generate + migrate deploy"
pnpm --filter server exec prisma generate
pnpm --filter server exec prisma migrate deploy

echo "[deploy] build server"
pnpm --filter server build

mkdir -p "$LOG_DIR"

echo "[deploy] pm2 reload / start"
if pm2 describe havenworld-server > /dev/null 2>&1; then
  pm2 reload havenworld-server --update-env
else
  pm2 start "$APP_DIR/ecosystem.config.js"
fi

pm2 save

echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S') — complete ✓"
pm2 list
