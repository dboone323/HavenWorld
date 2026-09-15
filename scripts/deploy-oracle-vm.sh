#!/usr/bin/env bash
# =============================================================================
# HavenWorld — Automated Oracle Cloud VM Deployment Script
# Targets: Ubuntu / Oracle Linux on Oracle Cloud (ARM64 / Ampere or x86_64)
# =============================================================================

set -e

echo "===================================================="
echo "🚀 HavenWorld — Oracle Cloud VM Setup"
echo "===================================================="

APP_DIR="/opt/havenworld"
USER_NAME=$(whoami)

echo "👤 Current user: ${USER_NAME}"
echo "📁 Deployment target directory: ${APP_DIR}"

# 1. Update packages and install prerequisites
echo "⏳ Updating system packages and installing curl & git..."
sudo apt-get update -y || sudo yum update -y
sudo apt-get install -y curl git ufw || sudo yum install -y curl git

# 2. Install Node.js 20 LTS if not present
if ! command -v node &> /dev/null || [[ $(node -v) != v20* && $(node -v) != v22* ]]; then
  echo "📦 Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs || sudo yum install -y nodejs
fi

echo "✅ Node.js $(node -v) & npm $(npm -v) installed."

# 3. Create Application Directory
echo "📁 Setting up ${APP_DIR}..."
sudo mkdir -p "${APP_DIR}"
sudo chown -R "${USER_NAME}:${USER_NAME}" "${APP_DIR}"

# If running directly from cloned repo, sync files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "${SCRIPT_DIR}")"

if [ -f "${PARENT_DIR}/package.json" ]; then
  echo "📦 Copying project files from ${PARENT_DIR} to ${APP_DIR}..."
  cp -r "${PARENT_DIR}"/* "${APP_DIR}/"
  cp -r "${PARENT_DIR}"/.[!.]* "${APP_DIR}/" 2>/dev/null || true
fi

cd "${APP_DIR}"

# 4. Install npm dependencies
echo "📦 Installing production dependencies..."
npm install --omit=dev

# 5. Configure Firewall (Oracle Cloud Host iptables & UFW)
echo "🛡️ Configuring host firewall for port 3000..."
if command -v ufw &> /dev/null; then
  sudo ufw allow 3000/tcp comment 'HavenWorld Game Server' || true
fi
# On Oracle Cloud Ubuntu images, default iptables rejects incoming connections:
if sudo iptables -L INPUT -n 2>/dev/null | grep -q "REJECT"; then
  echo "🔓 Adding iptables exception for port 3000 on Oracle Cloud..."
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT || true
  if command -v netfilter-persistent &> /dev/null; then
    sudo netfilter-persistent save || true
  fi
fi

# 6. Create systemd Service
echo "⚙️ Configuring systemd service (havenworld.service)..."
sudo tee /etc/systemd/system/havenworld.service > /dev/null <<EOF
[Unit]
Description=HavenWorld Multiplayer Game Server
After=network.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
ExecStart=$(which node) src/server/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable havenworld
sudo systemctl restart havenworld

echo "✅ HavenWorld systemd service started and enabled on boot!"
sudo systemctl status havenworld --no-pager

# 7. Cloudflare Tunnel Setup (Optional & Recommended)
echo ""
echo "===================================================="
echo "🌐 Cloudflare Setup for Oracle Cloud VM"
echo "===================================================="
echo "You have two easy ways to route players through Cloudflare:"
echo ""
echo "OPTION A: Cloudflare Tunnel (cloudflared) — RECOMMENDED"
echo "  1. Install cloudflared on this VM:"
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  echo "     curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb"
else
  echo "     curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
fi
echo "     sudo dpkg -i cloudflared.deb"
echo "  2. Run quick tunnel:"
echo "     cloudflared tunnel --url http://localhost:3000"
echo ""
echo "OPTION B: Direct Cloudflare DNS Proxy"
echo "  In Cloudflare Dashboard (dash.cloudflare.com):"
echo "  1. Add an A Record: name='play' (or '@'), content='147.224.164.228', Proxy=Proxied (Orange Cloud 🟠)"
echo "  2. Ensure WebSockets are ON in Network tab."
echo "  3. In Oracle Cloud VCN -> Security Lists -> Ingress Rules -> Add TCP port 3000 (or 80/443 with Nginx reverse proxy)."
echo "===================================================="
echo "🎉 Deployment setup complete!"
