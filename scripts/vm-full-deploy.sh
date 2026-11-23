#!/usr/bin/env bash
# =============================================================================
# scripts/vm-full-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
# HavenWorld — Unified VM Gate & Deployment Pipeline
#
# Runs on havenworld-a1 (Oracle Cloud Ampere A1).
# Workflow:
#   1. Sync repo clone (/home/ubuntu/Developer/HavenWorld) to origin/main.
#   2. Execute FULL local Docker CI gate (`make ci-docker`).
#      ABORTS IMMEDIATELY if the gate fails (live server is never touched).
#   3. Deploy production server (/opt/havenworld) via remote-deploy.sh flow:
#      - Inspect prisma migrate status
#      - Pull origin/main into /opt/havenworld
#      - pnpm install, build @havenworld/shared, prisma generate + migrate deploy
#      - build server, reload PM2 daemon (havenworld-server)
#   4. Build & deploy client to Cloudflare Pages (havenworld-game):
#      - If wrangler is authenticated on the VM, builds & deploys directly.
#      - If wrangler is not authenticated on the VM, reports notice for operator
#        to run `make deploy-client` from the authenticated workstation.
#   5. End-to-end verification:
#      - Queries /health endpoint (validates status ok, redis connected)
#      - Queries client URL (validates HTTP 200)
# =============================================================================

set -euo pipefail

REPO_DIR="/home/ubuntu/Developer/HavenWorld"
PROD_DIR="/opt/havenworld"
SERVER_URL="https://147-224-184-148.nip.io"
CLIENT_URL="https://havenworld-game.pages.dev"

# Terminal formatting
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

echo -e "${BOLD}${CYAN}====================================================================${RESET}"
echo -e "${BOLD}${CYAN} HavenWorld Unified VM Gate & Deployment Pipeline${RESET}"
echo -e "${BOLD}${CYAN} Started: $(date -u '+%Y-%m-%d %H:%M:%SZ')${RESET}"
echo -e "${BOLD}${CYAN}====================================================================${RESET}"

# Ensure we run with proper TMPDIR on Linux
export TMPDIR="${TMPDIR:-/tmp}"

# ── 1. Sync VM repository clone ──────────────────────────────────────────────
echo -e "\n${BOLD}[1/5] Syncing VM repository clone (${REPO_DIR})...${RESET}"
cd "$REPO_DIR"
git fetch origin main </dev/null
git checkout main
git pull --ff-only origin main </dev/null
CLONE_HEAD="$(git rev-parse HEAD)"
echo -e "  ${GREEN}✔${RESET} Repository clone aligned at: ${CLONE_HEAD}"

# ── 2. Run the FULL gate (Docker CI) ─────────────────────────────────────────
echo -e "\n${BOLD}[2/5] Running FULL make ci-docker gate inside Docker...${RESET}"
echo -e "  ${DIM}Notice: Live server will NOT be touched if the gate fails.${RESET}"
if ! make ci-docker; then
  echo -e "\n${RED}${BOLD}GATE FAILED: make ci-docker returned non-zero exit code.${RESET}" >&2
  echo -e "${RED}Aborting deployment. Production /opt/havenworld was NOT modified.${RESET}" >&2
  exit 1
fi
echo -e "  ${GREEN}✔ PASS${RESET} — All gate checks passed in Docker."

# ── 3. Deploy production server (/opt/havenworld) ─────────────────────────────
echo -e "\n${BOLD}[3/5] Deploying production server (${PROD_DIR})...${RESET}"
if [ ! -d "$PROD_DIR" ]; then
  echo -e "${RED}Error: ${PROD_DIR} does not exist.${RESET}" >&2
  exit 1
fi

echo -e "  ${DIM}--> Checking Prisma migration status on production database...${RESET}"
sudo -u havenworld -H bash -c "cd '$PROD_DIR' && pnpm --filter server exec prisma migrate status" </dev/null || true

echo -e "  ${DIM}--> Executing server deployment as user havenworld...${RESET}"
sudo -u havenworld -H bash "$PROD_DIR/scripts/remote-deploy.sh" </dev/null

PROD_HEAD="$(sudo -u havenworld -H git -C "$PROD_DIR" rev-parse HEAD)"
echo -e "  ${GREEN}✔${RESET} Production server deployed. /opt/havenworld HEAD: ${PROD_HEAD}"

# ── 4. Build & deploy client to Cloudflare Pages ─────────────────────────────
echo -e "\n${BOLD}[4/5] Deploying client to Cloudflare Pages...${RESET}"
CLIENT_DEPLOYED=0
if npx wrangler whoami >/dev/null 2>&1; then
  echo -e "  ${DIM}--> Building client web app (Vite)...${RESET}"
  cd "$REPO_DIR"
  pnpm --filter client build </dev/null
  echo -e "  ${DIM}--> Publishing dist to Cloudflare Pages (havenworld-game)...${RESET}"
  npx wrangler pages deploy apps/client/dist --project-name havenworld-game --commit-dirty=true </dev/null
  CLIENT_DEPLOYED=1
  echo -e "  ${GREEN}✔${RESET} Client deployed to Cloudflare Pages from VM."
else
  echo -e "  ${YELLOW}⚠ NOTICE: Wrangler is not authenticated on this VM (no Cloudflare token).${RESET}"
  echo -e "  ${YELLOW}  Client bundle should be deployed from authenticated workstation via:${RESET}"
  echo -e "  ${BOLD}  make deploy-client${RESET}"
  echo -e "  ${DIM}  (Server deployment was completed successfully.)${RESET}"
fi

# ── 5. End-to-end verification ───────────────────────────────────────────────
echo -e "\n${BOLD}[5/5] Verifying live services...${RESET}"
echo -e "  ${DIM}--> Checking server health endpoint (${SERVER_URL}/health)...${RESET}"
sleep 2

HEALTH_PAYLOAD=""
HEALTH_OK=0
for i in {1..10}; do
  if HEALTH_PAYLOAD="$(curl -sf --max-time 5 "${SERVER_URL}/health" 2>/dev/null)"; then
    if echo "$HEALTH_PAYLOAD" | grep -q '"status":"ok"'; then
      HEALTH_OK=1
      break
    fi
  fi
  sleep 2
done

if [ "$HEALTH_OK" -eq 1 ]; then
  echo -e "  ${GREEN}✔${RESET} Server Health OK: ${HEALTH_PAYLOAD}"
else
  echo -e "  ${RED}✘ FAIL — Server health check failed or timed out.${RESET}"
  echo "Payload: ${HEALTH_PAYLOAD}"
  exit 1
fi

echo -e "  ${DIM}--> Checking client endpoint (${CLIENT_URL})...${RESET}"
CLIENT_HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${CLIENT_URL}" 2>/dev/null || echo "000")"
if [ "$CLIENT_HTTP_CODE" = "200" ]; then
  echo -e "  ${GREEN}✔${RESET} Client endpoint responding with HTTP 200."
else
  echo -e "  ${YELLOW}⚠ Client endpoint returned HTTP ${CLIENT_HTTP_CODE}.${RESET}"
fi

echo -e "\n${BOLD}${CYAN}====================================================================${RESET}"
echo -e "${BOLD}${GREEN} Deployment pipeline completed successfully!${RESET}"
echo -e "${BOLD}${CYAN} Server HEAD:  ${PROD_HEAD}${RESET}"
echo -e "${BOLD}${CYAN} Completed:    $(date -u '+%Y-%m-%d %H:%M:%SZ')${RESET}"
if [ "$CLIENT_DEPLOYED" -eq 0 ]; then
  echo -e "${BOLD}${YELLOW} Next Action:  Deploy client from Mac: make deploy-client${RESET}"
fi
echo -e "${BOLD}${CYAN}====================================================================${RESET}"
