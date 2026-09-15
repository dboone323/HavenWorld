# HavenWorld — Makefile
# Phase 1 verification recipe, modelled on FaceAlterApp's `make ci` discipline:
#   `make ci`  => tests (unit + integration) + coverage gate.
# Toolchain: Node built-in test runner (node --test) + c8 coverage gate.

NODE := node
NPM  := npm

.DEFAULT_GOAL := help
.PHONY: help install start dev test test:watch coverage lint check-supabase integration ci

help: ## Show available targets
	@awk 'BEGIN{FS=":.*##"; printf "Usage:\n  make [target]\n\nTargets:\n"} /##/{sub(/##/,"",$$1); printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	$(NPM) install

start: ## Run the multiplayer server (localhost:3000)
	$(NODE) src/server/server.js

dev: ## Run server in watch mode
	$(NODE) --watch src/server/server.js

test: ## Run the test suite
	$(NPM) test

test:watch: ## Watch tests
	$(NODE) --test --watch

coverage: ## Run tests with coverage gate (>= 70% lines, enforced by c8)
	$(NPM) run coverage

lint: ## Syntax-check server + shared modules
	$(NPM) run lint

check-supabase: ## Verify Supabase tables are live
	$(NPM) run check-supabase

integration: ## Run WebSocket integration tests (standalone runner)
	$(NODE) tests/integration-runner.mjs

ci: ## Full CI gate: tests (unit + integration) + coverage gate
	@if [ -n "$$SUPABASE_URL" ]; then $(MAKE) check-supabase; else echo "⚠️  SUPABASE_URL unset — skipping Supabase check (tests use local SQLite)."; fi
	$(MAKE) coverage
	@$(MAKE) integration
	@echo "✅ HavenWorld Phase 1 CI gate passed."
