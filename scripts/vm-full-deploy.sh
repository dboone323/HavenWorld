#!/usr/bin/env bash
# =============================================================================
# scripts/vm-full-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
# HavenWorld — Unified VM Gate & Deployment Pipeline
#
# Runs on havenworld-a1 (Oracle Cloud Ampere A1).
# Workflow:
#   1. Sync repo clone (/home/ubuntu/Developer/HavenWorld) to origin/main.
#      ABORTS if the clone has uncommitted tracked modifications (ignoring runs/).
#   2. Execute FULL local Docker CI gate (`make ci-docker`).
#      ABORTS IMMEDIATELY if the gate fails (live server is never touched).
#   3. Deploy production server (/opt/havenworld) pinned to gated CLONE_HEAD:
#      - Ensure origin/main has not advanced during gate execution
#      - Inspect prisma migrate status
#      - Fetch & checkout CLONE_HEAD in /opt/havenworld
#      - Run remote-deploy.sh under flock (pnpm install, build shared, prisma generate + migrate deploy,
#        build server, reload PM2 havenworld-server)
#      - Assert /opt/havenworld HEAD == CLONE_HEAD
#   4. Deploy client to Cloudflare Pages (havenworld-game):
#      - Reuses gate-verified apps/client/dist (avoids root-owned build conflicts)
#      - If wrangler is authenticated on the VM, deploys directly with --branch=main
#        and --commit-hash, asserting HTTP 200 on completion.
#      - If wrangler is unauthenticated, reports client status as PENDING and prints
#        exact fallback command specifying clean worktree path, revision, and --branch=main.
#   5. End-to-end verification:
#      - Queries /health endpoint (validates status: ok AND redis: connected)
#      - In authenticated path: validates client endpoint returns HTTP 200 (fails if non-200)
#      - In fallback path: reports client verification as PENDING (verified after Mac deploy)
#
# Durability:
#   Automatically clears previous completion sentinel, logs full execution to
#   runs/vm-deploy-pipeline-YYYY-MM-DD.log, and writes a .done sentinel containing
#   exit code and UTC timestamp.
# =============================================================================

set -euo pipefail

# ── Self-contained logging and completion sentinel ───────────────────────────
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
REPO_DIR="${REPO_DIR:-/home/ubuntu/Developer/HavenWorld}"
LOG_DATE="$(date -u '+%Y-%m-%d')"
DEFAULT_LOG="${REPO_DIR}/runs/vm-deploy-pipeline-${LOG_DATE}.log"
DEPLOY_LOG="${DEPLOY_LOG:-$DEFAULT_LOG}"
SENTINEL_FILE="${DEPLOY_LOG}.done"

if [ "${VM_DEPLOY_LOGGING:-0}" != "1" ]; then
  mkdir -p "$(dirname "$DEPLOY_LOG")"
  rm -f "$SENTINEL_FILE"
  export VM_DEPLOY_LOGGING=1
  export DEPLOY_LOG
  set +e
  bash "$SCRIPT_PATH" "$@" 2>&1 | tee "$DEPLOY_LOG"
  PIPE_EXIT="${PIPESTATUS[0]}"
  TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "${PIPE_EXIT} ${TIMESTAMP}" > "$SENTINEL_FILE"
  exit "$PIPE_EXIT"
fi

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
echo -e "${BOLD}${CYAN} Started:  $(date -u '+%Y-%m-%d %H:%M:%SZ')${RESET}"
echo -e "${BOLD}${CYAN} Log file: ${DEPLOY_LOG}${RESET}"
echo -e "${BOLD}${CYAN} Sentinel: ${SENTINEL_FILE}${RESET}"
echo -e "${BOLD}${CYAN}====================================================================${RESET}"

# Ensure we run with proper TMPDIR on Linux
export TMPDIR="${TMPDIR:-/tmp}"

# ── 1. Sync VM repository clone ──────────────────────────────────────────────
echo -e "\n${BOLD}[1/5] Syncing VM repository clone (${REPO_DIR})...${RESET}"
cd "$REPO_DIR"

# Verify no tracked modifications exist in VM clone (untracked runs/ logs ignored)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${RED}${BOLD}ERROR: VM repository clone has uncommitted tracked changes.${RESET}" >&2
  echo -e "${RED}Aborting deployment. Please inspect and resolve dirty tracked state manually.${RESET}" >&2
  git status --short >&2
  exit 1
fi

git fetch origin main </dev/null
git checkout main
git pull --ff-only origin main </dev/null
CLONE_HEAD="$(git rev-parse HEAD)"

# Re-verify clean tracked state after pull
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${RED}${BOLD}ERROR: VM repository clone has uncommitted tracked changes after pull.${RESET}" >&2
  exit 1
fi
echo -e "  ${GREEN}✔${RESET} Repository clone aligned at: ${CLONE_HEAD} (clean tracked state)"

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

# Ensure origin/main has not advanced while the gate was running
git -C "$REPO_DIR" fetch origin main </dev/null
LATEST_REMOTE_HEAD="$(git -C "$REPO_DIR" rev-parse origin/main)"
if [ "$LATEST_REMOTE_HEAD" != "$CLONE_HEAD" ]; then
  echo -e "${RED}FATAL: origin/main advanced during gate execution!${RESET}" >&2
  echo -e "${RED}  Gate tested revision: ${CLONE_HEAD}${RESET}" >&2
  echo -e "${RED}  Current origin/main:  ${LATEST_REMOTE_HEAD}${RESET}" >&2
  echo -e "${RED}Aborting deployment. Production /opt/havenworld was NOT modified.${RESET}" >&2
  exit 1
fi

echo -e "  ${DIM}--> Checking Prisma migration status on production database...${RESET}"
sudo -u havenworld -H bash -c "cd '$PROD_DIR' && pnpm --filter server exec prisma migrate status" </dev/null || true

echo -e "  ${DIM}--> Aligning ${PROD_DIR} to gated revision ${CLONE_HEAD}...${RESET}"
sudo -u havenworld -H bash -c "cd '$PROD_DIR' && git fetch origin '$CLONE_HEAD' </dev/null && git checkout '$CLONE_HEAD' </dev/null"

echo -e "  ${DIM}--> Executing server deployment as user havenworld (serialized via flock)...${RESET}"
sudo -u havenworld -H DEPLOY_REV="$CLONE_HEAD" bash "$PROD_DIR/scripts/remote-deploy.sh" </dev/null

PROD_HEAD="$(sudo -u havenworld -H git -C "$PROD_DIR" rev-parse HEAD)"
if [ "$PROD_HEAD" != "$CLONE_HEAD" ]; then
  echo -e "${RED}FATAL: Production HEAD (${PROD_HEAD}) does not match gated revision (${CLONE_HEAD})!${RESET}" >&2
  exit 1
fi
echo -e "  ${GREEN}✔${RESET} Production server deployed. /opt/havenworld HEAD: ${PROD_HEAD} (matches gated revision)"

# ── 4. Build & deploy client to Cloudflare Pages ─────────────────────────────
echo -e "\n${BOLD}[4/5] Deploying client to Cloudflare Pages...${RESET}"
CLIENT_DEPLOYED=0
if npx wrangler whoami 2>&1 | grep -q "You are logged in"; then
  echo -e "  ${DIM}--> Reusing gate-verified client artifact (${REPO_DIR}/apps/client/dist)...${RESET}"
  if [ ! -d "$REPO_DIR/apps/client/dist" ]; then
    echo -e "  ${DIM}--> apps/client/dist not found, building client web app...${RESET}"
    sudo chown -R "$(id -u):$(id -g)" "$REPO_DIR/apps/client" 2>/dev/null || true
    pnpm --filter client build </dev/null
  fi
  echo -e "  ${DIM}--> Publishing dist to Cloudflare Pages (havenworld-game, branch: main)...${RESET}"
  npx wrangler pages deploy apps/client/dist \
    --project-name havenworld-game \
    --branch=main \
    --commit-dirty=true \
    --commit-hash="$CLONE_HEAD" </dev/null
  CLIENT_DEPLOYED=1
  echo -e "  ${GREEN}✔${RESET} Client deployed to Cloudflare Pages from VM at revision ${CLONE_HEAD} (branch: main)."
else
  echo -e "  ${YELLOW}⚠ NOTICE: Wrangler is not authenticated on this VM (no Cloudflare token).${RESET}"
  echo -e "  ${YELLOW}  Server deployment succeeded at gated revision: ${CLONE_HEAD}${RESET}"
  echo -e "  ${YELLOW}  Client bundle must be deployed from an authenticated workstation from a CLEAN worktree at revision ${CLONE_HEAD}.${RESET}"
  echo -e "  ${YELLOW}  (DO NOT deploy from a dirty personal checkout.)${RESET}"
  echo -e "  ${BOLD}  Fallback deployment command (from clean worktree at ${CLONE_HEAD}):${RESET}"
  echo -e "  ${CYAN}    cd <worktree-path> && git checkout ${CLONE_HEAD} && pnpm --filter client build && npx wrangler pages deploy apps/client/dist --project-name havenworld-game --branch=main --commit-dirty=true --commit-hash=${CLONE_HEAD}${RESET}"
  echo -e "  ${CYAN}    OR copy gate-built dist: scp -r ubuntu@havenworld-a1:${REPO_DIR}/apps/client/dist <worktree-path>/apps/client/dist && npx wrangler pages deploy <worktree-path>/apps/client/dist --project-name havenworld-game --branch=main --commit-dirty=true --commit-hash=${CLONE_HEAD}${RESET}"
fi

# ── 5. End-to-end verification ───────────────────────────────────────────────
echo -e "\n${BOLD}[5/5] Verifying live services...${RESET}"
echo -e "  ${DIM}--> Checking server health endpoint (${SERVER_URL}/health)...${RESET}"
sleep 2

HEALTH_PAYLOAD=""
HEALTH_OK=0
for i in {1..10}; do
  if HEALTH_PAYLOAD="$(curl -sf --max-time 5 "${SERVER_URL}/health" 2>/dev/null)"; then
    if echo "$HEALTH_PAYLOAD" | grep -q '"status":"ok"' && echo "$HEALTH_PAYLOAD" | grep -q '"redis":"connected"'; then
      HEALTH_OK=1
      break
    fi
  fi
  sleep 2
done

if [ "$HEALTH_OK" -eq 1 ]; then
  echo -e "  ${GREEN}✔${RESET} Server Health OK (status ok, redis connected): ${HEALTH_PAYLOAD}"
else
  echo -e "  ${RED}✘ FAIL — Server health check failed or missing redis:connected.${RESET}" >&2
  echo "Payload: ${HEALTH_PAYLOAD}" >&2
  exit 1
fi

if [ "$CLIENT_DEPLOYED" -eq 1 ]; then
  echo -e "  ${DIM}--> Checking client endpoint (${CLIENT_URL})...${RESET}"
  CLIENT_HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${CLIENT_URL}" 2>/dev/null || echo "000")"
  if [ "$CLIENT_HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✔${RESET} Client endpoint responding with HTTP 200."
  else
    echo -e "  ${RED}✘ FAIL — Client endpoint returned HTTP ${CLIENT_HTTP_CODE} (expected 200).${RESET}" >&2
    exit 1
  fi
else
  echo -e "  ${YELLOW}⚠ Client verification: PENDING${RESET}"
  echo -e "  ${YELLOW}  Server deployed; client deploy PENDING — run the fallback from the clean worktree, then verify.${RESET}"
fi

echo -e "\n${BOLD}${CYAN}====================================================================${RESET}"
if [ "$CLIENT_DEPLOYED" -eq 1 ]; then
  echo -e "${BOLD}${GREEN} Full deployment pipeline completed successfully!${RESET}"
else
  echo -e "${BOLD}${YELLOW} Server deployment completed; Client deploy PENDING!${RESET}"
fi
echo -e "${BOLD}${CYAN} Server HEAD:  ${PROD_HEAD}${RESET}"
echo -e "${BOLD}${CYAN} Completed:    $(date -u '+%Y-%m-%d %H:%M:%SZ')${RESET}"
echo -e "${BOLD}${CYAN} Log saved:    ${DEPLOY_LOG}${RESET}"
echo -e "${BOLD}${CYAN} Sentinel:     ${SENTINEL_FILE}${RESET}"
if [ "$CLIENT_DEPLOYED" -eq 0 ]; then
  echo -e "${BOLD}${YELLOW} Next Action:  Deploy client from clean worktree at ${CLONE_HEAD}, then verify.${RESET}"
fi
echo -e "${BOLD}${CYAN}====================================================================${RESET}"
