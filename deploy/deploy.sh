#!/usr/bin/env bash
# =============================================================================
# HavenWorld — Automated Linux Server Deployment Script
# Runs on: Oracle Cloud Ubuntu ARM64 server
# =============================================================================
set -euo pipefail

APP_DIR="${HOME}/HavenWorld"

echo "===================================================="
echo "🚀 Deploying HavenWorld on Oracle Cloud..."
echo "⏰ Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "===================================================="

cd "$APP_DIR"

# 1. Pull latest code from GitHub
echo "📥 Pulling latest commits from origin/main..."
git fetch origin main
git reset --hard origin/main

# 2. Install production dependencies
echo "📦 Installing npm dependencies..."
npm ci --prefer-offline --no-audit

# 3. Build static web assets (Vite)
echo "⚡ Building static web client with Vite..."
npm run build:web

# 4. Verify logs directory exists
mkdir -p logs

# 5. Reload PM2 process with zero downtime
echo "🔄 Reloading PM2 process..."
if pm2 describe havenworld > /dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi

pm2 save

echo "===================================================="
echo "✅ HavenWorld successfully deployed and running!"
echo "📡 Status:"
pm2 status havenworld
echo "===================================================="
