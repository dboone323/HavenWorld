# HavenWorld Operations Scripts

This folder contains operational tooling that is separate from the application
runtime. The normal deploy path is the root `Makefile` plus
`scripts/remote-deploy.sh`.

## Layout

- `backup.sh` — database backup entry point.
- `beta-gate-check.sh` — public alpha/beta smoke gate.
- `server-setup.sh` lives in `scripts/` (not here) because it provisions the VM.
- `LiveDBShape.js`, `align.js`, `db_audit*.js`, `dump*.js`, and related probes —
  read-only database inspection/ETL utilities. Run them on Oracle with the
  server's Node modules, or locally with the workspace's modules.
- `hw_*.sh` — historical recovery probes. They write only inside the repository
  or `/opt/havenworld` on Oracle; never system `/tmp`.
- `recovery/` — incident-specific scripts retained for audit and reuse; see
  `recovery/README.md`.

## State and secrets

- Local generated state belongs in `logs/local/` (git-ignored).
- Database backups belong in `backups/` (git-ignored).
- Validation images belong in `screenshots/` (git-ignored).
- Oracle-side scratch belongs in `/opt/havenworld/tmp/`, created by
  `scripts/server-setup.sh`.
- Private keys belong in `~/.ssh/`, never in the repository.
