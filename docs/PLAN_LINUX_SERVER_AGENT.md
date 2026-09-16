# Execution Plan for Linux Server Agent (Oracle Cloud via VS Code Remote-SSH)

> **Target Environment**: Oracle Cloud Infrastructure (OCI) Ampere A1 (Ubuntu 22.04/24.04 ARM64 / `aarch64`)  
> **SSH Target**: `oracle-cloud` (`ubuntu@147.224.164.228`)  
> **Repository**: `https://github.com/dboone323/HavenWorld.git`  
> **Working Directory**: `/home/ubuntu/HavenWorld`

---

## 1. Role & Operating Principles

You are operating as an autonomous DevOps & Server Agent on the Oracle Cloud Linux host.
- **Your Primary Mission**: Establish, secure, and maintain the **24/7 production multiplayer server runtime** and edge networking.
- **Architectural Boundary**:
  - **Do NOT author new game features or write application code here.** All code is written, tested, and pushed from the macOS workstation.
  - Your responsibility is **Pull ➔ Build Web Assets ➔ Run 24/7 with PM2 ➔ Expose via Cloudflare Tunnel ➔ Monitor Health**.

---

## 2. Step-by-Step Implementation Instructions

### Step 1: System Verification & Package Prerequisites
Run the following in the remote terminal to ensure the ARM64 environment is ready:

```bash
# 1. Verify architecture
uname -m # Must return aarch64

# 2. Update package index and install build essentials
sudo apt update && sudo apt install -y git curl ufw htop build-essential

# 3. Verify Node.js (Node 22 LTS or newer required)
if ! command -v node > /dev/null 2>&1 || [ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 22 ]; then
  echo "Installing Node.js LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi

node -v
npm -v
```

---

### Step 2: Repository Setup & Synchronization
Clone or update the repository at `/home/ubuntu/HavenWorld`:

```bash
cd /home/ubuntu

if [ ! -d "HavenWorld" ]; then
  git clone https://github.com/dboone323/HavenWorld.git
fi

cd /home/ubuntu/HavenWorld
git checkout main
git pull origin main
```

---

### Step 3: Production Environment Configuration (`.env`)
Create the production environment file at `/home/ubuntu/HavenWorld/.env`. Populate it with the verified production credentials:

```bash
cat << 'EOF' > /home/ubuntu/HavenWorld/.env
PORT=3000
NODE_ENV=production
SUPABASE_URL=https://ruphxzwfgwtrheprvpdq.supabase.co
SUPABASE_ANON_KEY=sb_publishable_ss7bYAmBNwMd_LUAlmpOPA_6NGF8YzO
NEXT_PUBLIC_SUPABASE_URL=https://ruphxzwfgwtrheprvpdq.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ss7bYAmBNwMd_LUAlmpOPA_6NGF8YzO
# Add your SUPABASE_SERVICE_ROLE_KEY here once copied from Supabase Dashboard
EOF

chmod 600 /home/ubuntu/HavenWorld/.env
```

---

### Step 4: Install Dependencies & Build Web Client
```bash
cd /home/ubuntu/HavenWorld

# Install clean production dependencies
npm ci

# Build the client bundle (Vite outputs to dist/)
npm run build:web
```

---

### Step 5: Process Management Setup with PM2
Install PM2 globally and configure HavenWorld to run as a persistent system daemon that automatically restarts on crashes or server reboots:

```bash
# 1. Install PM2 globally
sudo npm install -g pm2

# 2. Ensure log directory exists
mkdir -p /home/ubuntu/HavenWorld/logs

# 3. Start the application using the repo's ecosystem file
cd /home/ubuntu/HavenWorld
pm2 start deploy/ecosystem.config.cjs

# 4. Configure PM2 to launch on system boot (systemd)
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Note: PM2 will output a sudo command. Execute that exact sudo command if prompted.

# 5. Save the running process list
pm2 save
```

---

### Step 6: Cloudflare Tunnel Daemon (`cloudflared`) on Linux ARM64
To keep the public game link active 24/7 without keeping a local terminal open, install `cloudflared` as a Linux system service:

```bash
# 1. Download and install cloudflared for Linux ARM64
curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb

# 2. Verify installation
cloudflared --version

# 3. Start an ad-hoc quick tunnel in background or configure a persistent named tunnel:
# For instant testing:
# nohup cloudflared tunnel --url http://localhost:3000 > /home/ubuntu/HavenWorld/logs/tunnel.log 2>&1 &

# For production named tunnel (recommended if you have a Cloudflare domain):
# cloudflared tunnel login
# cloudflared tunnel create havenworld-prod
# cloudflared tunnel route dns havenworld-prod play.havenworld.game
# sudo cloudflared service install <TUNNEL_TOKEN>
```

---

### Step 7: Host Security & Firewall (UFW)
Because Cloudflare Tunnel makes an **outbound** encrypted connection from your server to Cloudflare, you **do not** need to open port 3000 to the public internet! Keep the server locked down:

```bash
# Allow only SSH from external
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw --force enable
sudo ufw status verbose
```

---

### Step 8: Standard Continuous Deployment Command
Whenever the macOS agent pushes new commits to `origin/main`, you can deploy the updates with a single command:

```bash
cd /home/ubuntu/HavenWorld
./deploy/deploy.sh
```

---

## 3. Verification & Health Check Checklist

Run these commands to confirm complete system health:

- [ ] `pm2 status havenworld`: Status must be `online`, restarts low, CPU/memory stable.
- [ ] `pm2 logs havenworld --lines 30`: Must display `🚀 HavenWorld Multiplayer Server Online` and `Connected to Cloud Supabase PostgreSQL`.
- [ ] `curl -I http://127.0.0.1:3000`: Must return `HTTP/1.1 200 OK`.
- [ ] `cloudflared`: Tunnel process active and reporting public tunnel URL in logs.
