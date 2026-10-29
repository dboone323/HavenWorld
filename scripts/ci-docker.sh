#!/usr/bin/env bash
# =============================================================================
# HavenWorld — Docker-Based Local CI/CD Gate
# =============================================================================
# Executes the full verification pipeline inside isolated Docker containers:
#   1. Client lint (TypeScript + ESLint inside node:22)
#   2. Client tests (Vitest inside node:22)
#   3. Client build (Vite inside node:22 with memory tuning)
#   4. Server lint (TypeScript + ESLint inside node:22)
#   5. Server tests (Jest inside node:22 against containerized Postgres & Redis)
#
# Usage:
#   make ci-docker
#   bash scripts/ci-docker.sh
# =============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Terminal colors
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

COMPOSE_FILE="docker-compose.test.yml"
TEST_NET="havenworld_default"

# Per-step status tracking
STEP_CLIENT_LINT="PENDING"
STEP_CLIENT_TEST="PENDING"
STEP_CLIENT_BUILD="PENDING"
STEP_SERVER_LINT="PENDING"
STEP_SERVER_TEST="PENDING"

DETAIL_CLIENT_LINT=""
DETAIL_CLIENT_TEST=""
DETAIL_CLIENT_BUILD=""
DETAIL_SERVER_LINT=""
DETAIL_SERVER_TEST=""

TMP_DIR="$(mktemp -d -t havenworld-ci-docker-XXXXXX)"
cleanup() {
  local exit_code=$?
  echo ""
  echo -e "${DIM}==> Tearing down test stack containers...${RESET}"
  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
  exit $exit_code
}
trap cleanup EXIT INT TERM

echo -e "${BOLD}${CYAN}====================================================================${RESET}"
echo -e "${BOLD}${CYAN} HavenWorld Docker Local CI/CD Gate${RESET}"
echo -e "${BOLD}${CYAN}====================================================================${RESET}"

# 0. Preflight checks
echo -e "\n${BOLD}[0/5] Preflight Verification${RESET}"
if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}Error: Docker daemon is not running or accessible.${RESET}" >&2
  exit 1
fi
echo -e "  ${GREEN}✔${RESET} Docker daemon online: $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'running')"

# 1. Bring up containerized test stack
echo -e "\n${BOLD}[Test Stack] Starting Postgres + Redis test containers...${RESET}"
docker compose -f "$COMPOSE_FILE" up -d --wait >/dev/null 2>&1 || {
  echo -e "${RED}Failed to start test stack containers via ${COMPOSE_FILE}.${RESET}" >&2
  exit 1
}
echo -e "  ${GREEN}✔${RESET} PostgreSQL (havenworld_test) ready on port 5432"
echo -e "  ${GREEN}✔${RESET} Redis ready on port 6379"

# Helper to run commands in node:22 container
docker_node() {
  local net_opt=""
  if [ "${1:-}" = "--network" ]; then
    net_opt="--network $2"
    shift 2
  fi

  docker run --rm \
    $net_opt \
    -e NODE_OPTIONS="${NODE_OPTIONS:-}" \
    -e DATABASE_URL="${DATABASE_URL:-}" \
    -e REDIS_URL="${REDIS_URL:-}" \
    -e NODE_ENV="${NODE_ENV:-test}" \
    -v "$REPO_ROOT":/app \
    -w /app \
    node:22 \
    sh -c "corepack enable >/dev/null 2>&1 && corepack prepare pnpm@9.15.9 --activate >/dev/null 2>&1 && $*"
}

# Ensure shared package is built first inside container
echo -e "\n${BOLD}[Setup] Building @havenworld/shared in node:22...${RESET}"
docker_node "pnpm --filter @havenworld/shared build" >"$TMP_DIR/shared-build.log" 2>&1 || {
  echo -e "${RED}Failed to build @havenworld/shared inside container.${RESET}"
  cat "$TMP_DIR/shared-build.log"
  exit 1
}
echo -e "  ${GREEN}✔${RESET} @havenworld/shared built successfully"

# Step 1: Client Lint
echo -e "\n${BOLD}[1/5] Running Client Lint (node:22)...${RESET}"
CLIENT_LINT_LOG="$TMP_DIR/client-lint.log"
if docker_node "pnpm --filter client lint" >"$CLIENT_LINT_LOG" 2>&1; then
  STEP_CLIENT_LINT="PASS"
  DETAIL_CLIENT_LINT="0 errors (typecheck + ESLint clean)"
  echo -e "  ${GREEN}✔ PASS${RESET} — $DETAIL_CLIENT_LINT"
else
  STEP_CLIENT_LINT="FAIL"
  DETAIL_CLIENT_LINT="Lint errors found"
  echo -e "  ${RED}✘ FAIL${RESET} — $DETAIL_CLIENT_LINT"
  cat "$CLIENT_LINT_LOG"
fi

# Step 2: Client Tests
echo -e "\n${BOLD}[2/5] Running Client Tests (node:22)...${RESET}"
CLIENT_TEST_LOG="$TMP_DIR/client-test.log"
if docker_node "pnpm --filter client test -- --run" >"$CLIENT_TEST_LOG" 2>&1; then
  STEP_CLIENT_TEST="PASS"
  # Extract test counts from vitest output
  FILES_COUNT=$(grep -oE "Test Files +[0-9]+ passed" "$CLIENT_TEST_LOG" | awk '{print $3}' | tail -n 1)
  TESTS_COUNT=$(grep -oE "Tests +[0-9]+ passed" "$CLIENT_TEST_LOG" | awk '{print $2}' | tail -n 1)
  if [ -n "$FILES_COUNT" ] && [ -n "$TESTS_COUNT" ]; then
    DETAIL_CLIENT_TEST="$FILES_COUNT test files, $TESTS_COUNT tests passed"
  else
    DETAIL_CLIENT_TEST="All client tests passed"
  fi
  echo -e "  ${GREEN}✔ PASS${RESET} — $DETAIL_CLIENT_TEST"
else
  STEP_CLIENT_TEST="FAIL"
  DETAIL_CLIENT_TEST="Test failures occurred"
  echo -e "  ${RED}✘ FAIL${RESET} — $DETAIL_CLIENT_TEST"
  grep -A 10 -B 2 "FAIL" "$CLIENT_TEST_LOG" | head -n 30 || cat "$CLIENT_TEST_LOG"
fi

# Step 3: Client Build
echo -e "\n${BOLD}[3/5] Running Client Build (node:22, NODE_OPTIONS=--max-old-space-size=4096)...${RESET}"
CLIENT_BUILD_LOG="$TMP_DIR/client-build.log"
if NODE_OPTIONS="--max-old-space-size=4096" docker_node "pnpm --filter client build" >"$CLIENT_BUILD_LOG" 2>&1; then
  STEP_CLIENT_BUILD="PASS"
  STAMP=$(grep -oE "havenworld-[0-9a-f]+" "$CLIENT_BUILD_LOG" | tail -n 1 || echo "stamped")
  DETAIL_CLIENT_BUILD="Vite bundle clean, service worker: $STAMP"
  echo -e "  ${GREEN}✔ PASS${RESET} — $DETAIL_CLIENT_BUILD"
else
  STEP_CLIENT_BUILD="FAIL"
  DETAIL_CLIENT_BUILD="Build compilation failed"
  echo -e "  ${RED}✘ FAIL${RESET} — $DETAIL_CLIENT_BUILD"
  tail -n 30 "$CLIENT_BUILD_LOG"
fi

# Step 4: Server Lint
echo -e "\n${BOLD}[4/5] Running Server Lint (node:22)...${RESET}"
SERVER_LINT_LOG="$TMP_DIR/server-lint.log"
if docker_node "pnpm --filter server lint" >"$SERVER_LINT_LOG" 2>&1; then
  STEP_SERVER_LINT="PASS"
  DETAIL_SERVER_LINT="0 errors (typecheck + ESLint clean)"
  echo -e "  ${GREEN}✔ PASS${RESET} — $DETAIL_SERVER_LINT"
else
  STEP_SERVER_LINT="FAIL"
  DETAIL_SERVER_LINT="Lint errors found"
  echo -e "  ${RED}✘ FAIL${RESET} — $DETAIL_SERVER_LINT"
  cat "$SERVER_LINT_LOG"
fi

# Prepare Server DB inside container
echo -e "\n${BOLD}[5/5] Preparing Test DB & Running Server Tests...${RESET}"
echo -e "  ${DIM}--> Pushing Prisma schema and seeding test DB (havenworld_test)...${RESET}"
DB_PREP_LOG="$TMP_DIR/server-db-prep.log"
DATABASE_URL="postgresql://postgres:havenworld_test_password@havenworld-test-postgres:5432/havenworld_test" \
docker_node --network "$TEST_NET" "pnpm --filter server exec prisma db push --accept-data-loss && pnpm --filter server exec ts-node prisma/seed.ts" >"$DB_PREP_LOG" 2>&1 || {
  echo -e "${RED}Failed to push schema or seed test database.${RESET}"
  cat "$DB_PREP_LOG"
  STEP_SERVER_TEST="FAIL"
  DETAIL_SERVER_TEST="DB schema push / seed failed"
}

if [ "$STEP_SERVER_TEST" != "FAIL" ]; then
  echo -e "  ${DIM}--> Executing server Jest test suite (node:22 against test stack)...${RESET}"
  SERVER_TEST_LOG="$TMP_DIR/server-test.log"
  if DATABASE_URL="postgresql://postgres:havenworld_test_password@havenworld-test-postgres:5432/havenworld_test" \
     REDIS_URL="redis://havenworld-test-redis:6379/1" \
     NODE_ENV="test" \
     docker_node --network "$TEST_NET" "pnpm --filter server test" >"$SERVER_TEST_LOG" 2>&1; then
    STEP_SERVER_TEST="PASS"
    SUITES_COUNT=$(grep -oE "Test Suites: +[0-9]+ passed" "$SERVER_TEST_LOG" | awk '{print $3}' | tail -n 1)
    TESTS_COUNT=$(grep -oE "Tests: +[0-9]+ passed" "$SERVER_TEST_LOG" | awk '{print $2}' | tail -n 1)
    if [ -n "$SUITES_COUNT" ] && [ -n "$TESTS_COUNT" ]; then
      DETAIL_SERVER_TEST="$SUITES_COUNT test suites, $TESTS_COUNT tests passed"
    else
      DETAIL_SERVER_TEST="All server tests passed"
    fi
    echo -e "  ${GREEN}✔ PASS${RESET} — $DETAIL_SERVER_TEST"
  else
    STEP_SERVER_TEST="FAIL"
    DETAIL_SERVER_TEST="Server test failures occurred"
    echo -e "  ${RED}✘ FAIL${RESET} — $DETAIL_SERVER_TEST"
    grep -A 10 -B 2 "FAIL" "$SERVER_TEST_LOG" | head -n 30 || tail -n 30 "$SERVER_TEST_LOG"
  fi
fi

# Summary
echo -e "\n${BOLD}${CYAN}====================================================================${RESET}"
echo -e "${BOLD}${CYAN} Docker Local CI/CD Gate Summary${RESET}"
echo -e "${BOLD}${CYAN}====================================================================${RESET}"

print_row() {
  local name="$1"
  local status="$2"
  local detail="$3"
  if [ "$status" = "PASS" ]; then
    printf "  %-18s ${GREEN}%-8s${RESET} %s\n" "$name" "[$status]" "$detail"
  else
    printf "  %-18s ${RED}%-8s${RESET} %s\n" "$name" "[$status]" "$detail"
  fi
}

print_row "Client Lint"   "$STEP_CLIENT_LINT"   "$DETAIL_CLIENT_LINT"
print_row "Client Tests"  "$STEP_CLIENT_TEST"  "$DETAIL_CLIENT_TEST"
print_row "Client Build"  "$STEP_CLIENT_BUILD"  "$DETAIL_CLIENT_BUILD"
print_row "Server Lint"   "$STEP_SERVER_LINT"   "$DETAIL_SERVER_LINT"
print_row "Server Tests"  "$STEP_SERVER_TEST"  "$DETAIL_SERVER_TEST"

echo -e "${BOLD}${CYAN}--------------------------------------------------------------------${RESET}"

if [ "$STEP_CLIENT_LINT" = "PASS" ] && \
   [ "$STEP_CLIENT_TEST" = "PASS" ] && \
   [ "$STEP_CLIENT_BUILD" = "PASS" ] && \
   [ "$STEP_SERVER_LINT" = "PASS" ] && \
   [ "$STEP_SERVER_TEST" = "PASS" ]; then
  echo -e "  ${BOLD}OVERALL RESULT:    ${GREEN}PASS — All 5 steps passed in Docker${RESET}"
  echo -e "${BOLD}${CYAN}====================================================================${RESET}\n"
  exit 0
else
  echo -e "  ${BOLD}OVERALL RESULT:    ${RED}FAIL — One or more checks failed${RESET}"
  echo -e "${BOLD}${CYAN}====================================================================${RESET}\n"
  exit 1
fi
