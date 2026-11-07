# HavenWorld Deployment & Infrastructure Guide

This directory houses infrastructure configuration templates, security hardening rules, and deployment guides for HavenWorld production hosting (Oracle Cloud ARM64 / Linux VM + Cloudflare edge).

---

## 1. Cloudflare Named Tunnel (`cloudflared`)

A Cloudflare named tunnel exposes the HavenWorld Express + Socket.io server to the public edge securely without opening public inbound ports.

### Setup Instructions

1. **Install `cloudflared`:**
   ```bash
   # Debian / Ubuntu ARM64
   curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
   sudo dpkg -i /tmp/cloudflared.deb
   rm /tmp/cloudflared.deb
   ```

2. **Authenticate with Cloudflare:**
   ```bash
   cloudflared tunnel login
   ```

3. **Create the Named Tunnel:**
   ```bash
   cloudflared tunnel create havenworld-prod
   ```
   Note the generated `<TUNNEL_UUID>` output by the CLI.

4. **Install Tunnel Configuration:**
   Copy the template from `deploy/cloudflared-config.example.yml`:
   ```bash
   mkdir -p ~/.cloudflared
   cp deploy/cloudflared-config.example.yml ~/.cloudflared/config.yml
   # Edit ~/.cloudflared/config.yml and replace <TUNNEL_UUID> with your tunnel UUID
   ```

5. **Route DNS Hostnames:**
   ```bash
   cloudflared tunnel route dns havenworld-prod play.havenworld.me
   cloudflared tunnel route dns havenworld-prod api.havenworld.me
   cloudflared tunnel route dns havenworld-prod havenworld.me
   ```

6. **Run via PM2 or Systemd Service:**
   ```bash
   # Via PM2:
   pm2 start "cloudflared tunnel run havenworld-prod" --name "havenworld-tunnel"
   pm2 save

   # Or install as systemd service:
   sudo cloudflared service install
   sudo systemctl enable --now cloudflared
   ```

---

## 2. Server Process Management (PM2 Cluster)

HavenWorld utilizes `ecosystem.config.js` to manage multi-worker node instances synchronized via Redis:
```bash
# Start 2 cluster workers with Redis session sync:
pm2 start ecosystem.config.js

# Monitor health:
pm2 status
pm2 logs havenworld-server
```

---

## 3. Directory Layout

- `cloudflared-config.example.yml`: Template config for named Cloudflare edge tunnels.
- `nginx/`: Nginx reverse proxy configs with WebSocket upgrade headers.
- `postgres/`: Database tuning and schema initialization scripts.
- `fail2ban/`: Jail definitions and rate-limit filter rules.
- `ssh/`: Hardened sshd configurations.
