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

## Code Style

- ESLint + Prettier enforced automatically on save
- Tab size: 2 spaces
- Line length: 100 characters maximum
