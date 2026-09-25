# HavenWorld Recovery Operations

This directory preserves the scripts used to recover the Oracle instance and
reconcile the legacy database during the September 2026 incident.

These are **emergency/audit tools**, not part of the normal application deploy
path. Normal deployment uses the root `Makefile` and `scripts/remote-deploy.sh`.

## Rules

- Run from the repository root, or invoke the script by its repository-relative path.
- Runtime state belongs in `logs/local/` and `backups/`; both are git-ignored.
- Database backups must never be committed.
- Private keys belong in `~/.ssh/`, never in this directory.
- Do not add new recovery helpers to `/tmp` or the home directory.

## Categories

- `a1_loop.sh`, `a1_meta.json`, `a1_success.json`: Always-Free A1 capacity loop
  and launch metadata from the original capacity recovery.
- `hw_migrate.sh`: legacy database backup/parking/migration sequence.
- `poll*.sh`, `run2.sh`, `build_any.py`, `check_agent.py`: Oracle Cloud Agent
  Run Command helpers.
- `diag*.sh`, `probe.js`, `live_*.js`, `dump2.js`, `cols.js`, `msg_cols.js`:
  read-only database/schema probes.
- `m9.sh`, `mkm5.sh`, `fix_schema.py`: historical schema experiments; retained
  for audit only and should not be run against production without review.

Several scripts contain OCIDs from the recovery incident. They are identifiers,
not credentials, but they may refer to terminated instances and must be updated
before reuse.
