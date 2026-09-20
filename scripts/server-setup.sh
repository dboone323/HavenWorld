#!/usr/bin/env bash
# scripts/server-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
# HavenWorld — one-time Oracle Cloud VM hardening & setup script
#
# Run once as ubuntu on a fresh Oracle ARM instance, OR re-run idempotently
# to apply all fixes.
#
# Usage:
#   ssh oracle-cloud 'bash -s' < scripts/server-setup.sh
#   — or —
#   make server-setup   (see Makefile)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/havenworld"
HAVENWORLD_USER="havenworld"

ok()   { printf '\033[32m  OK\033[0m  %s\n' "$1"; }
info() { printf '\033[36m  --\033[0m  %s\n' "$1"; }
warn() { printf '\033[33m WARN\033[0m  %s\n' "$1"; }

# ── 1. Swap (2 GiB) ──────────────────────────────────────────────────────────
info "Checking swap..."
if swapon --show | grep -q swapfile 2>/dev/null || [ -f /swapfile ]; then
  ok "Swapfile already exists — skipping"
else
  info "Creating 2G swapfile..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  fi
  ok "Swap created and persisted ($(free -h | grep Swap))"
fi

# ── 2. PM2: register havenworld-server under the havenworld user ───────────────
info "Registering havenworld-server with PM2..."
if sudo -u "$HAVENWORLD_USER" pm2 describe havenworld-server > /dev/null 2>&1; then
  ok "havenworld-server already in PM2 — reloading"
  sudo -u "$HAVENWORLD_USER" bash -c "
    cd $APP_DIR
    pm2 reload havenworld-server --update-env
    pm2 save
  "
else
  info "Starting havenworld-server via ecosystem.config.js"
  # Kill the orphan process first if any
  pkill -f 'node /opt/havenworld/apps/server/dist/index.js' 2>/dev/null || true
  sleep 1
  sudo -u "$HAVENWORLD_USER" bash -c "
    cd $APP_DIR
    pm2 start $APP_DIR/ecosystem.config.js
    pm2 save
    pm2 list
  "
  ok "havenworld-server registered with PM2"
fi

# ── 3. PM2 systemd startup hook (havenworld user) ─────────────────────────────
info "Wiring PM2 systemd startup for $HAVENWORLD_USER..."
HAVENWORLD_HOME=$(getent passwd "$HAVENWORLD_USER" | cut -d: -f6)
NODE_BIN=$(sudo -u "$HAVENWORLD_USER" which node 2>/dev/null || which node)
NODE_DIR=$(dirname "$NODE_BIN")

STARTUP_CMD="sudo env PATH=$NODE_DIR:\$PATH /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $HAVENWORLD_USER --hp $HAVENWORLD_HOME"

if systemctl is-enabled "pm2-${HAVENWORLD_USER}" > /dev/null 2>&1; then
  ok "pm2-${HAVENWORLD_USER} systemd service already enabled"
else
  info "Running: $STARTUP_CMD"
  eval "$STARTUP_CMD"
  ok "PM2 systemd startup wired for $HAVENWORLD_USER"
fi

# Persist PM2 process list for havenworld user
sudo -u "$HAVENWORLD_USER" pm2 save --force
ok "PM2 dump saved for $HAVENWORLD_USER"

# ── 4. Nginx: inject rate-limit zones into http block ─────────────────────────
NGINX_CONF="/etc/nginx/nginx.conf"
RATE_LIMIT_MARKER="# havenworld-rate-limits"

info "Checking nginx rate-limit zones..."
if grep -q "$RATE_LIMIT_MARKER" "$NGINX_CONF"; then
  ok "Rate-limit zones already present in nginx.conf"
else
  info "Injecting rate-limit zones into $NGINX_CONF http block..."
  sudo sed -i "/^http {/a \\
\\t$RATE_LIMIT_MARKER\\
\\tserver_tokens off;\\
\\tlimit_req_zone \$binary_remote_addr zone=login:10m rate=5r/m;\\
\\tlimit_req_zone \$binary_remote_addr zone=api:10m rate=100r/m;\\
\\tlimit_req_zone \$binary_remote_addr zone=ws:10m rate=10r/m;" "$NGINX_CONF"
  ok "Rate-limit zones injected"
fi

# ── 5. Nginx: replace site config with hardened version ───────────────────────
SITE_SRC="$APP_DIR/deploy/nginx/havenworld-production.conf"
SITE_DEST="/etc/nginx/sites-available/havenworld"

info "Deploying hardened nginx site config..."
sudo cp "$SITE_SRC" "$SITE_DEST"
sudo ln -sf "$SITE_DEST" /etc/nginx/sites-enabled/havenworld
sudo nginx -t
sudo systemctl reload nginx
ok "Nginx config reloaded"

# ── 6. server_tokens verification ─────────────────────────────────────────────
info "Verifying server_tokens is off..."
if sudo nginx -T 2>/dev/null | grep -q 'server_tokens off'; then
  ok "server_tokens off confirmed"
else
  warn "server_tokens may not be off — verify $NGINX_CONF"
fi

# ── 7. Backup script: ensure executable ───────────────────────────────────────
info "Ensuring backup.sh is executable..."
chmod +x "$APP_DIR/scripts/backup.sh"
chmod +x "$APP_DIR/scripts/remote-deploy.sh"
chmod +x "$APP_DIR/scripts/run-load-tests.sh"
chmod +x "$APP_DIR/scripts/beta-gate-check.sh"
ok "Scripts are executable"

# ── 8. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "=============================="
echo "  Server setup complete ✓"
echo "=============================="
echo ""
sudo -u "$HAVENWORLD_USER" pm2 list
echo ""
echo "Swap:"
free -h | grep -E 'Swap|Mem'
echo ""
echo "Nginx:"
sudo nginx -t 2>&1 | tail -2
echo ""
echo "Health:"
sleep 2
curl -fsS http://127.0.0.1:3000/health 2>/dev/null | python3 -m json.tool || echo "health endpoint not ready yet"
