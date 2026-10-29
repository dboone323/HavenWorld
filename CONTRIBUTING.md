# Contributing to HavenWorld

## Getting Started

1. Fork the repo on GitHub
2. Clone your fork: `git clone git@github.com:YOUR_USERNAME/HavenWorld.git`
3. Set up the local dev environment (see README.md)
4. Create a feature branch from develop: `git checkout -b feature/your-feature-name`

## Branching Convention

- `main` — production only (protected; PRs required)
- `develop` — integration branch (all features merge here first)
- `feature/*` — new features
- `fix/*` — bug fixes
- `hotfix/*` — emergency production fixes

## Pull Request Requirements

- PR must target the `develop` branch (not main)
- PR title format: `feat: add avatar layering` | `fix: chat rate limit` | `docs: update readme`
- All CI checks must pass (lint, type-check, tests, build)
- Include screenshots for any UI changes
- Unit tests required for new server-side logic

## Continuous Integration & Docker-Based Local Gate

- **CI Status**: GitHub Actions is currently disabled on the account, and GitLab CI quota is exhausted. As a result, all CI verification is enforced locally via Docker containers.
- **Canonical Docker Gate (`make ci-docker`)**: Every step runs inside isolated Docker containers to guarantee zero environment drift:
  1. `client-lint`: TypeScript typechecking + ESLint inside a `node:22` container.
  2. `client-tests`: Vitest suite (211+ tests across 39 files) inside a `node:22` container.
  3. `client-build`: Vite client production bundle + service worker stamping inside a `node:22` container.
  4. `server-lint`: TypeScript typechecking + ESLint inside a `node:22` container.
  5. `server-tests`: Jest test suite (460+ tests across 71 suites) inside a `node:22` container executed against an isolated containerized test stack (`havenworld-test-postgres` on PostgreSQL 16 and `havenworld-test-redis` on Redis 7 via `docker-compose.test.yml`).
- **Local Pre-Push Gate**: Every `git push` triggers the pre-push hook which invokes `make ci-docker` (delegated via `make pre-push`). If any step fails, the push is automatically blocked.
- To run the canonical verification gate manually at any time:
  ```bash
  make ci-docker
  # or
  make pre-push
  ```
- Emergency bypass (maintainers only): `PUSH_CI_SKIP=1 git push`.

## Code Style

- ESLint + Prettier enforced automatically on save
- Tab size: 2 spaces
- Line length: 100 characters maximum
