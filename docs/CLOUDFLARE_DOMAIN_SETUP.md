# 🌐 Cloudflare Domain Setup & Automated Uptime Monitoring Guide

This guide details how to transition HavenWorld from a temporary Cloudflare Quick Tunnel (`trycloudflare.com`) to your permanent branded domain (**`havenworld.me`** or **`play.havenworld.me`**) with a named tunnel, automatic SSL, and 24/7 free uptime monitoring via UptimeRobot.

---

## Part 1: Prerequisites

1. **Domain Registered**: `havenworld.me` (registered on Cloudflare Registrar, Namecheap, Porkbun, or Google Domains).
2. **Cloudflare Account**: Free tier account with the domain added and active (Cloudflare nameservers assigned).
3. **Oracle Cloud ARM64 Instance**: The live production server running HavenWorld on port `3000`.

---

## Part 2: Setting Up a Named Cloudflare Tunnel

Named tunnels provide a permanent cryptographic tunnel between the Oracle Cloud VM and Cloudflare's edge network, completely bypassing open inbound firewall ports.

### Step 1: SSH into the Oracle Cloud Instance
```bash
ssh oracle-cloud
```

### Step 2: Authenticate Cloudflare Tunnel
```bash
cloudflared tunnel login
```
*This command will output a URL. Open this URL in your local browser and select `havenworld.me` to authorize the certificate (`cert.pem`).*

### Step 3: Create the Named Tunnel
```bash
cloudflared tunnel create havenworld-prod
```
*Note the Tunnel UUID output (e.g. `3d9f1a2b-4c5d-6e7f-8a9b-0c1d2e3f4a5b`).*

### Step 4: Configure the Tunnel
Create or edit `~/.cloudflared/config.yml`:
```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /home/ubuntu/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: play.havenworld.me
    service: http://localhost:3000
    originRequest:
      noTLSVerify: true
  - hostname: havenworld.me
    service: http://localhost:3000
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

### Step 5: Route DNS Records
Bind your domain hostnames to the tunnel:
```bash
cloudflared tunnel route dns havenworld-prod play.havenworld.me
cloudflared tunnel route dns havenworld-prod havenworld.me
```

### Step 6: Run Tunnel via Systemd or PM2
You can run the named tunnel alongside HavenWorld in PM2:
```bash
pm2 delete havenworld-tunnel
pm2 start "cloudflared tunnel run havenworld-prod" --name "havenworld-tunnel"
pm2 save
```

Verify status:
```bash
pm2 list
curl -I https://play.havenworld.me/api/health
```

---

## Part 3: Cloudflare Dashboard Configuration

In the [Cloudflare Dashboard](https://dash.cloudflare.com):

1. **SSL/TLS Settings**:
   - Set Encryption mode to **Full** (or **Strict** if local cert is present).
   - Under **Edge Certificates**, enable **Always Use HTTPS** and **Automatic HTTPS Rewrites**.
   - Enable **TLS 1.3** and **Minimum TLS Version: 1.2**.
2. **WebSockets**:
   - Go to **Network** settings and ensure **WebSockets** toggle is **ON** (enabled by default on Cloudflare).
3. **Caching**:
   - Create a Cache Rule for static assets:
     - Rule: `URI Path starts with "/assets/"` -> Cache Everything (TTL: 7 days).
     - Rule: `URI Path starts with "/api/"` or `URI Path starts with "/ws"` -> Bypass Cache.

---

## Part 4: Automated 24/7 Monitoring (UptimeRobot - Free Tier)

[UptimeRobot](https://uptimerobot.com) offers 50 free monitors with 5-minute checking intervals.

### Step 1: Create an Uptime Monitor
1. Sign up at [UptimeRobot](https://uptimerobot.com).
2. Click **+ Add New Monitor**.
3. **Monitor Type**: `HTTP(s)`
4. **Friendly Name**: `HavenWorld Production Health`
5. **URL (or IP)**: `https://play.havenworld.me/api/health`
6. **Monitoring Interval**: `5 minutes`
7. **Monitor Timeout**: `30 seconds`

### Step 2: Configure Health Check Keyword (Optional)
- You can set Monitor Type to **Keyword**:
  - Keyword: `"status":"ok"`
  - Alert when keyword does not exist.

### Step 3: Alert Contacts & Discord Webhook
1. Go to **My Settings -> Alert Contacts**.
2. Add your Email / SMS alert contact.
3. To alert a Discord channel:
   - In Discord: Server Settings -> Integrations -> Create Webhook -> Copy Webhook URL.
   - In UptimeRobot: Add Alert Contact -> **Webhook** -> Paste Discord Webhook URL.
   - Choose `POST` payload format.
4. Check the box to assign this alert contact to the `HavenWorld Production Health` monitor.

---

## Part 5: Verification Checklist

- [ ] `https://havenworld.me/api/health` returns `{"status":"ok", ...}`
- [ ] `https://havenworld.me/terms` renders the Terms of Service
- [ ] `https://havenworld.me/privacy` renders the Privacy Policy
- [ ] `https://havenworld.me/admin?secret=YOUR_SECRET` opens the Moderation Dashboard
- [ ] WebSocket connection `wss://havenworld.me/` connects and synchronizes game state
- [ ] UptimeRobot shows **UP (100%)** status green indicator
