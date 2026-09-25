---
name: deploy-havenworld
description: >-
  Automates the complete deployment loop for HavenWorld to Oracle Cloud (server) and Cloudflare Pages (client).
  Use whenever the user asks to deploy HavenWorld, push to production, release updates, or run the deployment pipeline.
  Handles linting, testing, gating, committing, pushing, remote SSH deployment to Oracle Cloud, Cloudflare Pages deployment,
  and automatic triage/recovery for common errors without asking unnecessary prompts.
---

# HavenWorld Deployment Automation Skill

This skill defines the complete, unattended deployment pipeline for HavenWorld. When triggered, follow all steps autonomously, diagnose and fix any failures inline, and report final verification to the user.

## Target Architecture

Component | Host / Provider | URL / Access
:--- | :--- | :---
**Server API & WebSockets** | Oracle Cloud VM (`oracle-cloud`) | `https://147-224-184-148.nip.io` (`/health`, `/socket.io`)
**Client Web App** | Cloudflare Pages (`havenworld-game`) | `https://havenworld-game.pages.dev`
**Primary Database** | Supabase PostgreSQL Pooler | Shared transactional store
**Local Dev / Test DB** | Docker Compose (`docker-compose.dev.yml`) | `havenworld_dev` & `havenworld_test`

---

## Autonomous Deployment Runbook

Always run all commands from the repository root (the directory containing this skill's parent `.agents/` folder). In this workspace that is the HavenWorld checkout; do not assume or hardcode a user's home-directory path.

### Step 1: Quality Gate — Type Checking (`make lint`)
Execute:
```bash
make lint
```
- **Auto-Triage & Recovery**:
  - If a TypeScript error is encountered (e.g. strict typing or missing interface property), inspect the exact file and line number.
  - Apply the minimal functional type correction directly.
  - Re-run `make lint` until exit code is 0.

### Step 2: Quality Gate — Test Suites (`make test`)
Execute:
```bash
make test
```
This automatically boots Docker services (`postgres` + `redis`), pushes the Prisma schema to dev and test databases, seeds minimal catalogue fixtures, runs server Jest tests, runs client Vitest tests, and stops Docker.
- **Auto-Triage & Recovery**:
  - If a test fails due to schema/fixture updates (e.g., missing `isTradeable: true` or un-awaited async calls in older tests), update the test code to perform real validations.
  - Never mock, stub, or disable tests.
  - Re-run `make test` until exit code is 0.

### Step 3: Go/No-Go Gate Check (`make gate`)
Execute:
```bash
make gate
```
Verifies live infrastructure stability, TLS validity, security headers, legal pages (`privacy.html`, `terms.html`), PWA manifest, service worker, and socket handshake. Ensure exit code is 0 (`RESULT: GO`).

### Step 4: Commit and Push to Main
Stage and commit changes with a concise summary of the changes:
```bash
git add -A
git commit -m "<Descriptive message of changes>"
git push origin main
```
Confirm the push succeeds to `origin/main`.

### Step 5: Server Deployment to Oracle Cloud (`make _ssh-deploy-server`)
Execute:
```bash
make _ssh-deploy-server
```
This triggers `/opt/havenworld/scripts/remote-deploy.sh` over SSH as user `havenworld`:
```bash
ssh oracle-cloud 'sudo -u havenworld -H bash /opt/havenworld/scripts/remote-deploy.sh </dev/null'
```
- **Auto-Triage & Recovery**:
  - **Permission denied on `.git/FETCH_HEAD`**: Ensure the command runs with `sudo -u havenworld -H`.
  - **Interactive prompt hang**: Ensure stdin is closed with `</dev/null`.
  - **Prisma migrations**: Verify `prisma migrate deploy` executes cleanly. If new models or fields were added, ensure migrations or pushes are synchronized.
  - **PM2 process**: Ensure `havenworld-server` under user `havenworld` is reloaded and online.

### Step 6: Client Deployment to Cloudflare Pages (`make deploy-client`)
Execute:
```bash
make deploy-client
```
This builds the client package with Vite (`pnpm --filter client build`) and deploys `apps/client/dist` via Wrangler:
```bash
npx wrangler pages deploy apps/client/dist --project-name havenworld-game --commit-dirty=true
```
- **Auto-Triage & Recovery**:
  - If Wrangler prompts with `Need to install the following packages... Ok to proceed? (y)`, send `y\n` to stdin immediately.
  - Ensure the Cloudflare upload completes and returns the deployment URL.

### Step 7: Post-Deploy Verification
Verify that both server and client are healthy and running:
1. **Server Health API**:
   ```bash
   curl -fsS https://147-224-184-148.nip.io/health | python3 -m json.tool
   ```
   Confirm `"status": "ok"`, `"redis": "connected"`, and uptime reflects the recent restart.
2. **PM2 Process Status**:
   ```bash
   ssh oracle-cloud 'sudo -u havenworld -H pm2 list'
   ```
   Confirm `havenworld-server` status is `online`.
3. **Client HTTP Response**:
   ```bash
   curl -fsSI https://havenworld-game.pages.dev/
   ```
   Confirm HTTP 200 response with Cloudflare headers.
4. **Final Gate Pass**:
   ```bash
   make gate
   ```
   Confirm all gate categories return `PASS`.
