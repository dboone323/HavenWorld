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
#      Immediately isolates gate-verified client artifact to revision-specific directory.
#   3. Deploy production server (/opt/havenworld) pinned to gated CLONE_HEAD:
#      - Ensure origin/main has not advanced during gate execution
#      - Inspect prisma migrate status
#      - Fetch & checkout CLONE_HEAD in /opt/havenworld
#      - Run remote-deploy.sh under flock (pnpm install, build shared, prisma generate + migrate deploy,
#        build server, reload PM2 havenworld-server)
#      - Assert /opt/havenworld HEAD == CLONE_HEAD
#   4. Deploy client to Cloudflare Pages (havenworld-game):
#      - Deploys from isolated revision-specific client artifact
#      - If wrangler is authenticated on the VM, deploys directly with --branch=main
#        and --commit-hash, asserting HTTP 200 on completion.
#      - If wrangler is unauthenticated, reports client status as PENDING and prints
#        exact fallback command pointing to isolated artifact path and --branch=main.
#   5. End-to-end verification:
#      - Queries /health endpoint (validates status: ok AND redis: connected)
#      - In authenticated path: validates client endpoint returns HTTP 200 (fails if non-200)
#      - In fallback path: reports client verification as PENDING (verified after Mac deploy)
#
# Durability & Concurrency:
#   Automatically uses per-run log and sentinel paths (timestamp + PID), clears previous
#   sentinel if present, and writes a .done sentinel containing exit code and UTC timestamp.
# =============================================================================

set -euo pipefail

# ── Self-contained logging and completion sentinel ───────────────────────────
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
REPO_DIR="${REPO_DIR:-/home/ubuntu/Developer/HavenWorld}"
RUN_ID="${RUN_ID:-$(date -u '+%Y%m%d-%H%M%SZ')-$$}"
DEFAULT_LOG="${REPO_DIR}/runs/vm-deploy-pipeline-${RUN_ID}.log"
DEPLOY_LOG="${DEPLOY_LOG:-$DEFAULT_LOG}"
SENTINEL_FILE="${DEPLOY_LOG}.done"

if [ "${VM_DEPLOY_LOGGING:-0}" != "1" ]; then
  mkdir -p "$(dirname "$DEPLOY_LOG")"
  rm -f "$SENTINEL_FILE"
  export VM_DEPLOY_LOGGING=1
  export RUN_ID
  export DEPLOY_LOG
  export SENTINEL_FILE
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
echo -e "${BOLD}${CYAN} Run ID:   ${RUN_ID}${RESET}"
echo -e "${BOLD}${CYAN} Log file: ${DEPLOY_LOG}${RESET}"
echo -e "${BOLD}${CYAN} Sentinel: ${SENTINEL_FILE}${RESET}"
echo -e "${BOLD}${CYAN}====================================================================${RESET}"

# Ensure we run with proper TMPDIR on Linux
export TMPDIR="${TMPDIR:-/tmp}"

# ── 1. Sync VM repository clone ──────────────────────────────────────────────
echo -e "\n${BOLD}[1/5] Syncing VM repository clone (${REPO_DIR})...${RESET}"
cd "$REPO_DIR"

# Verify repository clone is clean (both tracked changes and untracked build inputs)
check_clean_repo() {
  local phase="$1"
  # Check tracked modifications
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "${RED}${BOLD}ERROR: VM repository clone has uncommitted tracked changes (${phase}).${RESET}" >&2
    echo -e "${RED}Aborting deployment. Please inspect and resolve dirty tracked state manually.${RESET}" >&2
    git status --short >&2
    exit 1
  fi

  # Check untracked build inputs outside runs/ (runs/ is the ONLY exemption for run logs/sentinels/isolated dists;
  # scripts/vm-full-deploy.sh is exempt during pre-merge staging on main before PR #80 merges)
  local untracked_files
  untracked_files="$(git status --porcelain | grep '^\?\?' | awk '{print $2}' | grep -v '^runs/' | grep -v '^scripts/vm-full-deploy.sh$' || true)"
  if [ -n "$untracked_files" ]; then
    echo -e "${RED}${BOLD}ERROR: VM repository clone has untracked build inputs outside runs/ (${phase}):${RESET}" >&2
    echo "$untracked_files" >&2
    echo -e "${RED}Aborting deployment. Please inspect and clean untracked files manually.${RESET}" >&2
    exit 1
  fi
}

check_clean_repo "before pull"

git fetch origin main </dev/null
git checkout main
git pull --ff-only origin main </dev/null
CLONE_HEAD="$(git rev-parse HEAD)"

# Re-verify clean state (tracked + untracked) after pull
check_clean_repo "after pull"
echo -e "  ${GREEN}✔${RESET} Repository clone aligned at: ${CLONE_HEAD} (clean tracked and untracked state)"

# ── 2. Run the FULL gate (Docker CI) ─────────────────────────────────────────
echo -e "\n${BOLD}[2/5] Running FULL make ci-docker gate inside Docker...${RESET}"
echo -e "  ${DIM}Notice: Live server will NOT be touched if the gate fails.${RESET}"

if ! make ci-docker; then
  echo -e "\n${RED}${BOLD}GATE FAILED: make ci-docker returned non-zero exit code.${RESET}" >&2
  echo -e "${RED}Aborting deployment. Production /opt/havenworld was NOT modified.${RESET}" >&2
  exit 1
fi
echo -e "  ${GREEN}✔ PASS${RESET} — All gate checks passed in Docker."

# Ensure client artifact is built in production mode with production server URL
# (Guarantees production bundle in pre-merge runs where main's ci-docker.sh ran)
if ! grep -q "147-224-184-148.nip.io" "${REPO_DIR}/apps/client/dist/assets/main-"*.js 2>/dev/null; then
  echo -e "  ${DIM}--> Building client artifact in production mode (node:22)...${RESET}"
  docker run --rm \
    -e NODE_OPTIONS="--max-old-space-size=4096" \
    -e NODE_ENV="production" \
    -e VITE_SERVER_URL="https://147-224-184-148.nip.io" \
    -v "$REPO_DIR":/app \
    -w /app \
    node:22 \
    sh -c "corepack enable >/dev/null 2>&1 && corepack prepare pnpm@9.15.9 --activate >/dev/null 2>&1 && pnpm --filter client build"
fi

# Immediately isolate this run's gate-verified client artifact
CLONE_HEAD_SHORT="${CLONE_HEAD:0:8}"
ISOLATED_DIST_DIR="${REPO_DIR}/runs/vm-deploy-dist-${CLONE_HEAD_SHORT}-${RUN_ID}"
echo -e "  ${DIM}--> Isolating gate-verified client artifact to ${ISOLATED_DIST_DIR}...${RESET}"
rm -rf "$ISOLATED_DIST_DIR"
mkdir -p "$ISOLATED_DIST_DIR"
cp -r "${REPO_DIR}/apps/client/dist/." "$ISOLATED_DIST_DIR/"

if [ ! -f "${ISOLATED_DIST_DIR}/index.html" ]; then
  echo -e "${RED}FATAL: Failed to isolate client artifact — ${ISOLATED_DIST_DIR}/index.html missing!${RESET}" >&2
  exit 1
fi

# Verify isolated client bundle contains production server URL and NOT localhost:3000 as server URL
echo -e "  ${DIM}--> Verifying production bundle integrity in ${ISOLATED_DIST_DIR}...${RESET}"
MAIN_JS="$(find "${ISOLATED_DIST_DIR}/assets" -maxdepth 1 -name 'main-*.js' | head -n 1)"
if [ -z "$MAIN_JS" ] || [ ! -f "$MAIN_JS" ]; then
  echo -e "${RED}FATAL: Client build failed to generate assets/main-*.js in ${ISOLATED_DIST_DIR}!${RESET}" >&2
  exit 1
fi

if ! grep -q "147-224-184-148.nip.io" "$MAIN_JS"; then
  echo -e "${RED}FATAL: Isolated bundle does NOT contain production host (147-224-184-148.nip.io)!${RESET}" >&2
  exit 1
fi

if grep -q '||"http://localhost:3000"' "$MAIN_JS" || grep -q "||'http://localhost:3000'" "$MAIN_JS"; then
  echo -e "${RED}FATAL: Isolated bundle contains http://localhost:3000 as server URL fallback!${RESET}" >&2
  exit 1
fi
echo -e "  ${GREEN}✔${RESET} Client bundle verified: production host present, localhost:3000 server URL absent."
echo -e "  ${GREEN}✔${RESET} Client artifact isolated for revision ${CLONE_HEAD} (${ISOLATED_DIST_DIR})"

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

# Note on checkout locking: We do NOT perform a separate checkout here before invoking
# remote-deploy.sh. Instead, remote-deploy.sh performs its own checkout to DEPLOY_REV ($CLONE_HEAD)
# AFTER acquiring the exclusive /tmp/havenworld-deploy.lock. This ensures checkout, install, build,
# migrations, and PM2 reload are all executed atomically under ONE lock, preventing concurrent
# deployments from switching HEAD mid-operation. The pin to CLONE_HEAD still holds because:
#   (a) The pipeline above aborts if origin/main advanced past CLONE_HEAD during the gate.
#   (b) remote-deploy.sh checks out exactly DEPLOY_REV="$CLONE_HEAD".
#   (c) The assertion below verifies PROD_HEAD == CLONE_HEAD before accepting deployment.
echo -e "  ${DIM}--> Executing server deployment as user havenworld (checkout & build serialized under flock in remote-deploy.sh)...${RESET}"
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
  echo -e "  ${DIM}--> Deploying isolated client artifact (${ISOLATED_DIST_DIR})...${RESET}"
  echo -e "  ${DIM}--> Publishing dist to Cloudflare Pages (havenworld-game, branch: main)...${RESET}"
  npx wrangler pages deploy "$ISOLATED_DIST_DIR" \
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
  echo -e "  ${BOLD}  Fallback deployment command (using isolated dist from ${CLONE_HEAD}):${RESET}"
  echo -e "  ${CYAN}    rm -rf <worktree-path>/apps/client/dist && scp -r ubuntu@havenworld-a1:${ISOLATED_DIST_DIR} <worktree-path>/apps/client/dist && cd <worktree-path> && npx wrangler pages deploy apps/client/dist --project-name havenworld-game --branch=main --commit-dirty=true --commit-hash=${CLONE_HEAD}${RESET}"
  echo -e "  ${CYAN}    OR build locally: cd <worktree-path> && git checkout ${CLONE_HEAD} && NODE_ENV=production VITE_SERVER_URL=https://147-224-184-148.nip.io pnpm --filter client build && npx wrangler pages deploy apps/client/dist --project-name havenworld-game --branch=main --commit-dirty=true --commit-hash=${CLONE_HEAD}${RESET}"
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
