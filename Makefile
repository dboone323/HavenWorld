# =============================================================================
# HavenWorld — Local CI/CD Makefile
# Free-tier: Oracle Cloud (server) + Cloudflare Pages (client)
# No GitHub Actions required.
#
# Prerequisites (one-time):
#   brew install act          # run GHA workflows locally via Docker
#   brew install rclone       # R2 asset + backup sync
#   brew install k6           # local load testing
#   npm install -g wrangler   # Cloudflare Pages CLI
#
# Usage:
#   make help                 # show all targets
#   make test                 # run all tests (starts Docker if needed)
#   make deploy               # deploy server + client
#   make deploy-server        # deploy server only
#   make deploy-client        # deploy client to Cloudflare Pages
#   make gate                 # run alpha→beta gate check
#   make ssh                  # open SSH session to Oracle
#   make logs                 # tail live PM2 logs
#   make backup               # trigger encrypted DB backup on Oracle
# =============================================================================

SHELL       := /bin/bash
.SHELLFLAGS := -euo pipefail -c

ORACLE_HOST ?= oracle-cloud
APP_DIR     ?= /opt/havenworld
DC_FILE     ?= docker-compose.dev.yml
# Local dev database. Schema pushes must target THIS, never the Supabase pooler that
# apps/server/.env points at (production schema changes go through `prisma migrate deploy`).
DEV_DATABASE_URL ?= postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_dev

# Colours
BOLD  = \033[1m
GREEN = \033[0;32m
CYAN  = \033[0;36m
RESET = \033[0m

.DEFAULT_GOAL := help

# ── Help ─────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@printf "\n$(BOLD)HavenWorld — local CI/CD targets$(RESET)\n\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@printf "\n"

# ── Dev services (Docker) ────────────────────────────────────────────────────
.PHONY: dev-up
dev-up: ## Start Postgres + Redis via Docker Compose
	docker compose -f $(DC_FILE) up -d
	@printf "$(GREEN)==> Waiting for Postgres...$(RESET)\n"
	@until docker compose -f $(DC_FILE) exec postgres pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
	@printf "$(GREEN)==> Waiting for Redis...$(RESET)\n"
	@until docker compose -f $(DC_FILE) exec redis redis-cli ping 2>/dev/null | grep -q PONG; do sleep 1; done
	@printf "$(GREEN)==> Services ready.$(RESET)\n"

.PHONY: dev-down
dev-down: ## Stop Docker Compose services
	docker compose -f $(DC_FILE) down

.PHONY: dev-restart
dev-restart: dev-down dev-up ## Restart Docker Compose services

# ── Build ────────────────────────────────────────────────────────────────────
.PHONY: build-shared
build-shared: ## Build the shared package
	pnpm --filter '@havenworld/shared' build

.PHONY: build-server
build-server: build-shared ## Build the server
	pnpm --filter server exec prisma generate
	pnpm --filter server build

.PHONY: build-client
build-client: build-shared ## Build the client (Vite)
	pnpm --filter client build

.PHONY: build
build: build-shared ## Build everything
	pnpm --filter './apps/*' build

# ── Lint / Type-check ────────────────────────────────────────────────────────
.PHONY: lint
lint: ## Lint all apps (tsc --noEmit)
	pnpm --filter server lint
	pnpm --filter client lint

.PHONY: lint-server
lint-server: ## Lint server only
	pnpm --filter server lint

.PHONY: lint-client
lint-client: ## Lint client only
	pnpm --filter client lint

# ── Test ─────────────────────────────────────────────────────────────────────
.PHONY: push-schema
push-schema: dev-up ## Push Prisma schema to the LOCAL dev + test databases only
	@pnpm --filter server exec prisma generate
	@DATABASE_URL="$(DEV_DATABASE_URL)" pnpm --filter server exec prisma db push --accept-data-loss
	@set -a && . apps/server/.env.test && set +a \
	  && DATABASE_URL="$$DATABASE_URL" pnpm --filter server exec prisma db push --accept-data-loss
	@# Registration grants DEFAULT_FREE_ITEM_IDS, so an unseeded database makes
	@# POST /api/auth/register 500 *after* it has already committed the user. Seed both local DBs.
	@DATABASE_URL="$(DEV_DATABASE_URL)" pnpm --filter server exec ts-node prisma/seed.ts >/dev/null
	@set -a && . apps/server/.env.test && set +a \
	  && DATABASE_URL="$$DATABASE_URL" pnpm --filter server exec ts-node prisma/seed.ts >/dev/null

.PHONY: test-server
test-server: push-schema build-shared ## Run server Jest suite (auto-starts Docker, syncs both DBs)
	pnpm --filter server test
	$(MAKE) dev-down

.PHONY: test-server-coverage
test-server-coverage: push-schema build-shared ## Server Jest with coverage (auto-starts Docker, syncs both DBs)
	pnpm --filter server run test:coverage
	$(MAKE) dev-down

.PHONY: test-client
test-client: build-shared ## Run client Vitest suite
	pnpm --filter client test

.PHONY: test-client-coverage
test-client-coverage: build-shared ## Client Vitest with coverage
	pnpm --filter client run test:coverage

.PHONY: test-e2e
test-e2e: push-schema build-shared ## Run Playwright E2E (Chromium, auto-starts Docker)
	npx playwright test --project=chromium
	$(MAKE) dev-down

.PHONY: test-e2e-all
test-e2e-all: push-schema build-shared ## Run full Playwright matrix (all browsers)
	npx playwright test
	$(MAKE) dev-down

.PHONY: test
test: lint test-server test-client ## Run lint + server + client tests

.PHONY: audit
audit: ## pnpm security audit (high+)
	pnpm audit --audit-level=high

# ── Local CI via act ─────────────────────────────────────────────────────────
.PHONY: ci-pr
ci-pr: ## Simulate pr-check.yml locally via act (requires: brew install act)
	act pull_request -W .github/workflows/pr-check.yml --secret-file .env.test

.PHONY: ci-client
ci-client: ## Simulate client-test.yml locally via act
	act push -W .github/workflows/client-test.yml

.PHONY: ci-e2e
ci-e2e: ## Simulate e2e.yml locally via act
	act push -W .github/workflows/e2e.yml --secret-file .env.test

# ── Deploy — Server ──────────────────────────────────────────────────────────
.PHONY: deploy-server
deploy-server: lint-server test-server build-server ## Full deploy: lint→test→build→SSH push
	$(MAKE) _ssh-deploy-server

.PHONY: deploy-server-quick
deploy-server-quick: ## SSH deploy without running local tests first
	$(MAKE) _ssh-deploy-server

.PHONY: _ssh-deploy-server
_ssh-deploy-server:
	@printf "$(BOLD)==> Deploying server to Oracle Cloud...$(RESET)\n"
	ssh $(ORACLE_HOST) 'sudo -u havenworld -H bash $(APP_DIR)/scripts/remote-deploy.sh </dev/null'
	@printf "$(GREEN)==> Server deploy complete.$(RESET)\n"

# ── Deploy — Client ──────────────────────────────────────────────────────────
.PHONY: deploy-client
deploy-client: build-client ## Build + deploy client to Cloudflare Pages
	@printf "$(BOLD)==> Deploying client to Cloudflare Pages...$(RESET)\n"
	npx wrangler pages deploy apps/client/dist \
	  --project-name havenworld-game \
	  --commit-dirty=true
	@printf "$(GREEN)==> Client deploy complete.$(RESET)\n"

.PHONY: deploy
deploy: deploy-server deploy-client ## Deploy both server and client

# ── Assets ───────────────────────────────────────────────────────────────────
.PHONY: upload-assets
upload-assets: ## Upload 3D assets to Cloudflare R2 (requires rclone + env vars)
	./scripts/upload-assets.sh

.PHONY: upload-assets-dry
upload-assets-dry: ## Dry-run R2 asset upload
	./scripts/upload-assets.sh --dry-run

# ── Gate ─────────────────────────────────────────────────────────────────────
.PHONY: gate
gate: ## Run alpha→beta go/no-go gate check
	./scripts/beta-gate-check.sh

.PHONY: gate-local
gate-local: ## Run gate check in local mode
	./scripts/beta-gate-check.sh --local --url http://localhost:3000

# ── Server ops ───────────────────────────────────────────────────────────────
.PHONY: ssh
ssh: ## Open SSH session to Oracle Cloud
	ssh $(ORACLE_HOST)

.PHONY: logs
logs: ## Tail live PM2 logs on Oracle (Ctrl-C to exit)
	ssh $(ORACLE_HOST) 'sudo -u havenworld -H env PATH=/home/havenworld/.local/bin:/usr/local/bin:/usr/bin:/bin pm2 logs havenworld-server --lines 50'

.PHONY: logs-err
logs-err: ## Tail PM2 error log on Oracle
	ssh $(ORACLE_HOST) 'tail -f $(APP_DIR)/logs/err.log'

.PHONY: pm2-status
pm2-status: ## Show PM2 app list on Oracle
	ssh $(ORACLE_HOST) 'sudo -u havenworld -H env PATH=/home/havenworld/.local/bin:/usr/local/bin:/usr/bin:/bin pm2 list'

.PHONY: pm2-restart
pm2-restart: ## Graceful PM2 reload (zero-downtime) on Oracle
	ssh $(ORACLE_HOST) 'sudo -u havenworld -H env PATH=/home/havenworld/.local/bin:/usr/local/bin:/usr/bin:/bin pm2 reload havenworld-server'

.PHONY: backup
backup: ## Trigger encrypted DB backup on Oracle
	ssh $(ORACLE_HOST) 'DB_PASSWORD=$$(grep DB_PASSWORD $(APP_DIR)/apps/server/.env | cut -d= -f2) bash $(APP_DIR)/scripts/backup.sh'

.PHONY: health
health: ## Check live /health endpoint
	@curl -fsS https://147-224-184-148.nip.io/health | python3 -m json.tool

.PHONY: load-test
load-test: ## Run k6 load tests on Oracle (requires k6 on VM)
	ssh $(ORACLE_HOST) 'cd $(APP_DIR) && bash scripts/run-load-tests.sh'

.PHONY: load-test-local
load-test-local: dev-up ## Run k6 WebSocket load test locally (requires k6 locally)
	k6 run load-tests/ws-concurrent.js --env BASE_URL=http://localhost:3000

# ── Cleanup ───────────────────────────────────────────────────────────────────
.PHONY: clean
clean: ## Remove dist/ and coverage/ directories
	rm -rf apps/server/dist apps/server/coverage apps/client/dist apps/client/coverage
	rm -rf playwright-report test-results

.PHONY: reset-db
reset-db: dev-up ## Drop and recreate test database schema
	pnpm --filter server exec prisma db push --force-reset
	@printf "$(GREEN)==> Test DB reset.$(RESET)\n"

# ── Server bootstrap (one-time / idempotent) ─────────────────────────────────
.PHONY: server-setup
server-setup: ## Apply all server hardening to Oracle (idempotent): swap, PM2, nginx
	@printf "$(BOLD)==> Running server-setup.sh on Oracle Cloud...$(RESET)\n"
	ssh $(ORACLE_HOST) 'bash -s' < scripts/server-setup.sh

.PHONY: server-setup-dry
server-setup-dry: ## Validate server-setup.sh without executing destructive steps (bash -n)
	bash -n scripts/server-setup.sh && printf "$(GREEN)Syntax OK$(RESET)\n"

# ── Dependency management ────────────────────────────────────────────────────
.PHONY: install
install: ## Install all dependencies (respects pnpm overrides)
	pnpm install --frozen-lockfile

.PHONY: update-deps
update-deps: ## Update all pnpm dependencies interactively
	pnpm update --interactive --recursive

# ── Wrangler / Cloudflare ────────────────────────────────────────────────────
.PHONY: wrangler-login
wrangler-login: ## Authenticate Wrangler CLI with Cloudflare
	npx wrangler login
