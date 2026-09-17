#!/usr/bin/env bash
# =============================================================================
# HavenWorld — Automated Named Cloudflare Tunnel Setup
# Sets up a permanent named tunnel for havenworld.me & play.havenworld.me
# Runs on: Oracle Cloud Ubuntu ARM64 server
# =============================================================================
set -euo pipefail

TUNNEL_NAME="${1:-havenworld-prod}"
DOMAIN="${2:-havenworld.me}"
PLAY_DOMAIN="play.${DOMAIN}"

echo "===================================================="
echo "🌐 Configuring Named Cloudflare Tunnel: ${TUNNEL_NAME}"
echo "🎯 Domains: ${DOMAIN} & ${PLAY_DOMAIN}"
echo "===================================================="

if ! command -v cloudflared > /dev/null 2>&1; then
  echo "❌ cloudflared is not installed. Install via: sudo apt install -y cloudflared" >&2
  exit 1
fi

# 1. Verify user is logged in
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "🔑 Authenticating cloudflared... Follow the browser link below:"
  cloudflared tunnel login
fi

# 2. Check if tunnel already exists or create it
EXISTING_TUNNEL_ID=$(cloudflared tunnel list | grep -w "${TUNNEL_NAME}" | awk '{print $1}' || true)
if [ -z "${EXISTING_TUNNEL_ID}" ]; then
  echo "🔨 Creating new tunnel: ${TUNNEL_NAME}..."
  cloudflared tunnel create "${TUNNEL_NAME}"
  TUNNEL_ID=$(cloudflared tunnel list | grep -w "${TUNNEL_NAME}" | awk '{print $1}')
else
  TUNNEL_ID="${EXISTING_TUNNEL_ID}"
  echo "ℹ️  Using existing tunnel ID: ${TUNNEL_ID}"
fi

# 3. Create or update config.yml
mkdir -p "$HOME/.cloudflared"
CONFIG_FILE="$HOME/.cloudflared/config.yml"
echo "📝 Writing ${CONFIG_FILE}..."

cat <<EOF > "${CONFIG_FILE}"
tunnel: ${TUNNEL_ID}
credentials-file: ${HOME}/.cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: ${PLAY_DOMAIN}
    service: http://localhost:3000
    originRequest:
      noTLSVerify: true
  - hostname: ${DOMAIN}
    service: http://localhost:3000
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF

# 4. Route DNS hostnames
echo "🔗 Routing DNS for ${PLAY_DOMAIN} and ${DOMAIN}..."
cloudflared tunnel route dns "${TUNNEL_NAME}" "${PLAY_DOMAIN}" || true
cloudflared tunnel route dns "${TUNNEL_NAME}" "${DOMAIN}" || true

# 5. Update PM2 to use the named tunnel
echo "🔄 Updating PM2 process for named tunnel..."
PM2_CMD="pm2"
if ! command -v pm2 > /dev/null 2>&1; then
  PM2_CMD="npx pm2"
fi

$PM2_CMD delete havenworld-tunnel 2>/dev/null || true
$PM2_CMD start "cloudflared tunnel run ${TUNNEL_NAME}" --name "havenworld-tunnel"
$PM2_CMD save

echo "===================================================="
echo "✅ Named tunnel '${TUNNEL_NAME}' configured and running!"
echo "📡 Check status: $PM2_CMD status"
echo "🌐 Your game is live at: https://${PLAY_DOMAIN} and https://${DOMAIN}"
echo "===================================================="
