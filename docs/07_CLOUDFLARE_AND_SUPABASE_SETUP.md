# Cloudflare & Supabase Setup Guide: HavenWorld

This guide walks you step-by-step through configuring **Supabase** (for your PostgreSQL database, player authentication, and inventory persistence) and **Cloudflare** (for edge DDoS security, free SSL/TLS encryption, automated WebSocket proxying, and instant public deployment).

---

## Architecture: How They Fit Into Your Project

```
+-------------------------------------------------------------------------------+
|                                PLAYERS (WORLDWIDE)                            |
|             (Web Browsers, macOS Desktop App, iOS Native Wrapper)             |
+-------------------------------------------------------------------------------+
                                        |  (HTTPS & WSS Encrypted)
                                        v
+-------------------------------------------------------------------------------+
|                               CLOUDFLARE EDGE                                 |
|  - Global Anycast CDN: Caches game.js, style.css, audio, and sprite sheets   |
|  - Edge Security: Layer 3/4 & Layer 7 DDoS mitigation and bot defense         |
|  - SSL / TLS Termination: Automatic HTTPS and Secure WebSockets (wss://)    |
|  - Cloudflare Tunnel: Securely connects edge traffic to your local server   |
+-------------------------------------------------------------------------------+
                                        |  (Encrypted Tunnel / Proxy)
                                        v
+-------------------------------------------------------------------------------+
|                       HAVENWORLD MULTIPLAYER SERVER (NODE.JS)                 |
|  - WebSocket Room Manager & 60 FPS spatial movement loop                     |
|  - Real-time chat speech bubble broadcasting                                  |
|  - Authoritative mini-game score validation & trade escrow                    |
+-------------------------------------------------------------------------------+
                                        |  (@supabase/supabase-js)
                                        v
+-------------------------------------------------------------------------------+
|                             SUPABASE (POSTGRESQL)                             |
|  - Auth: User logins, passwords, Google/Apple OAuth, anonymous guest tokens  |
|  - Database: Player profiles, HavenCoins/Gems, rooms, placed furniture        |
|  - Storage: Custom avatar textures and user room snapshots                    |
|  - Row Level Security (RLS): Database-level permission enforcement            |
+-------------------------------------------------------------------------------+
```

---

## PART 1: Supabase Configuration

### Step 1: Create Your Supabase Project
1. Log in to [Supabase](https://supabase.com/dashboard).
2. Click **"New Project"** and select your organization.
3. Fill in the project details:
   - **Name**: `havenworld-game` (or `miniworld-game`)
   - **Database Password**: Generate a secure password and save it in a password manager.
   - **Region**: Choose a region geographically close to you (e.g., `East US (North Virginia) - us-east-1` or `Central US`).
   - **Pricing Plan**: Free tier (includes 500MB database, 50,000 monthly active users, and 1GB storage).
4. Click **"Create new project"** and wait ~2 minutes for PostgreSQL provisioning to complete.

### Step 2: Copy Your Project API Credentials
1. In your Supabase project dashboard, click on the **Settings** icon (gear icon) on the left sidebar.
2. Navigate to **"API"** under Configuration.
3. Locate the following three values:
   - **Project URL**: Format looks like `https://abcdefghijklmnopqrst.supabase.co`
   - **Project API Keys -> `anon` (public)**: Safe for client-side queries.
   - **Project API Keys -> `service_role` (secret)**: Bypasses Row Level Security. **Never expose this to clients!** It is used exclusively by your authoritative Node.js backend.

### Step 3: Run the Initial Database Schema Migration
We have already prepared the complete database schema in your repository:
1. In your Supabase Dashboard, click on **"SQL Editor"** in the left navigation menu.
2. Click **"New query"**.
3. Open the file [`supabase/schema.sql`](file:///Users/danielstevens/Developer/HavenWorld/supabase/schema.sql) in your project.
4. Copy the entire contents of `supabase/schema.sql` and paste it into the Supabase SQL Editor.
5. Click **"Run"** (or press `Cmd + Enter`).
6. **What this creates automatically**:
   - `public.profiles`: Stores usernames, HavenCoins, and HavenGems balances.
   - `public.avatar_profiles`: Stores skin tones, hair styles, and clothing colors.
   - `public.rooms`: Stores personal player lofts, room codes, and public status.
   - `public.placed_furniture`: Stores furniture coordinates `(x, y)`, rotation, and surface parenting hierarchy.
   - `public.user_inventory`: Stores owned items.
   - **Automated Trigger (`on_auth_user_created`)**: Automatically provisions a default profile, starter avatar, and a personal starter loft with initial furniture whenever a player signs up!
   - **Row Level Security (RLS)**: Enforces that only room owners can delete or place furniture.

### Step 4: Configure Local Project Environment (`.env`)
1. In your terminal inside `/Users/danielstevens/Developer/HavenWorld`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and paste your Supabase keys:
   ```ini
   PORT=3000
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOi...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
   ```
3. Your server's database helper [`src/server/db.js`](file:///Users/danielstevens/Developer/HavenWorld/src/server/db.js) will now automatically connect to your live PostgreSQL database on launch!

---

## PART 2: Cloudflare Configuration

You have two options with Cloudflare:
- **Option A (Instant & Easiest)**: **Cloudflare Tunnel (`cloudflared`)**. Expose your local game server running on your Mac to the global internet in 60 seconds with full HTTPS & WSS, with zero port forwarding or router configuration needed!
- **Option B (Production Domain)**: Point your custom domain (e.g., `play.havenworld.com`) through Cloudflare's CDN & DNS proxy.

---

### Option A: The 60-Second Cloudflare Tunnel (Recommended for Development & Testing)

Cloudflare provides a lightweight daemon called `cloudflared` that creates a secure, encrypted tunnel from your Mac directly to Cloudflare's edge network:

1. **Install `cloudflared` on your Mac** (via Homebrew):
   ```bash
   brew install cloudflared
   ```
2. **Start your HavenWorld game server** in one terminal:
   ```bash
   cd /Users/danielstevens/Developer/HavenWorld
   npm start
   ```
3. **Launch the Cloudflare Tunnel** in a second terminal:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
4. **Cloudflare will output a public URL**, for example:
   ```text
   +--------------------------------------------------------------------------------------------+
   | Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
   | https://breeze-sunset-vintage-orbit.trycloudflare.com                                      |
   +--------------------------------------------------------------------------------------------+
   ```
5. **You're live!**
   - That link is accessible to anyone in the world over standard **HTTPS**.
   - Cloudflare automatically proxies the WebSocket connection (`wss://`) through the tunnel.
   - You can send this link to friends or test it on your iPhone/iPad over cellular!

---

### Option B: Production Custom Domain Setup (e.g. `havenworld.game`)

When you are ready to bind a real domain name:

1. **Add Your Domain to Cloudflare**:
   - In the Cloudflare Dashboard, click **"Add a Site"** and enter your registered domain.
   - Select the **Free** plan.
   - Update your domain registrar's nameservers (GoDaddy, Namecheap, Google Domains) to the two Cloudflare nameservers provided.

2. **Add DNS Records**:
   - In Cloudflare Dashboard -> **DNS** -> **Records**:
   - Add an `A` record or `CNAME` pointing your subdomain (e.g., `play`) to your server IP or hosting provider.
   - **Crucial**: Ensure the proxy toggle is set to **"Proxied"** (the cloud icon is **Orange** 🟠). This routes all traffic through Cloudflare's DDoS shield and CDN.

3. **Verify WebSocket Proxying is Enabled**:
   - In Cloudflare Dashboard, navigate to **Network** on the left menu.
   - Ensure the **WebSockets** toggle is set to **On** (Cloudflare enables this by default on all plans).
   - This allows players' persistent game socket connections (`wss://play.havenworld.game`) to flow uninterrupted with minimal latency.

4. **Configure SSL/TLS Encryption**:
   - In Cloudflare Dashboard, navigate to **SSL/TLS**.
   - Set the encryption mode to **Full** or **Full (Strict)**.
   - Cloudflare will automatically generate and renew a free universal edge SSL certificate for your domain.

5. **Enable Edge Asset Caching (Speed Optimization)**:
   - In Cloudflare Dashboard, navigate to **Caching** -> **Configuration**.
   - Under **Browser Cache TTL**, choose `Respect Existing Headers` or `4 hours`.
   - Cloudflare will automatically cache your static game assets (`style.css`, `game.js`, background music, and sprite textures) on 300+ global edge servers. When 500 players connect simultaneously, your Node.js origin server will only handle lightweight WebSocket movement packets!

---

## Summary of Completed Files in Your Repo

- [`supabase/schema.sql`](file:///Users/danielstevens/Developer/HavenWorld/supabase/schema.sql): Complete SQL tables, automated triggers, starter furniture, and RLS policies.
- [`.env.example`](file:///Users/danielstevens/Developer/HavenWorld/.env.example): Environment variable template for your Supabase keys.
- [`src/server/db.js`](file:///Users/danielstevens/Developer/HavenWorld/src/server/db.js): Modular database client supporting both Supabase persistence and instant local memory fallback.
- [`package.json`](file:///Users/danielstevens/Developer/HavenWorld/package.json): Updated with `@supabase/supabase-js` and `dotenv`.
