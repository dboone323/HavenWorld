#!/usr/bin/env bash
# =============================================================================
# HavenWorld — Retention Sweep (issue #75: 30-day / 7-day cleanup)
# =============================================================================
# Implements Daniel's retention policy: important artifacts 30 days,
# rinse-and-repeat artifacts 7 days, older removed as newer arrives.
#
# 7-day (rinse-and-repeat) class — regenerated every run, swept by age:
#   test-results/, playwright-report/, blob-report/          (Playwright traces/videos/screenshots, retain-on-failure)
#   apps/server/coverage/, apps/client/coverage/, .nyc_output/ (coverage, regenerated each run)
#   apps/server/dist/, apps/client/dist/, packages/*/dist/    (build outputs, rebuilt on next build)
#   tmp/, scratch/, supabase/.temp/                            (scratch by definition)
#   logs/*.log                                                 (scratch logs; logs/local/ is the 30-day class below)
#   runs/*.log, runs/*.done, runs/gate-queue/*.log            (raw per-run gate logs)
#   runs/wt-main-verify/ is NEVER swept — it is a full repo checkout from the
#   Nov 11 main-verify run (Daniel's standing order: leave it as is).
#   $TMPDIR/havenworld-ci-docker-*                             (ci-docker.sh leftovers from killed runs)
#
# 30-day (important) class:
#   logs/local/*.log          (a1_loop.log etc. — audit trail, rotated in a1_loop.sh)
#   runs/*.md                 (run summaries / reports)
#
# NEVER auto-delete (by design: the sweep only ever targets the enumerated
# paths above, never source or state):
#   .env* / .env.bak.*, havenworld.db / *.db / *.sqlite, dev docker volumes
#   node_modules/ + .pnpm-store/, ~/.cache/ms-playwright, HavenWorld-agent-work/
#   e2e specs/page-objects, prisma/seed.ts, e2e/visual <spec>-snapshots/
#   scripts/ops/recovery/a1_success.json, a1_img.txt, a1_meta.json
#
# Usage:
#   bash scripts/retention-sweep.sh        # perform the sweep
#   bash scripts/retention-sweep.sh --dry-run   # list what would be removed, remove nothing
# =============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; fi

removed=0

say() { [ "$DRY_RUN" = 1 ] && printf '[dry-run] %s\n' "$*" || printf '%s\n' "$*"; }

# Remove a single path if it exists.
remove_path() {
  local p="$1"
  if [ -e "$p" ] || [ -L "$p" ]; then
    say "remove: $p"
    if [ "$DRY_RUN" = 0 ]; then rm -rf "$p"; fi
    removed=$((removed + 1))
  fi
}

# Delete files older than $2 days under $1, then prune now-empty directories.
# The directory itself is always kept.
sweep_tree() {
  local dir="$1" days="$2" f
  [ -d "$dir" ] || return 0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    say "remove file: $f"
    if [ "$DRY_RUN" = 0 ]; then rm -f "$f"; fi
    removed=$((removed + 1))
  done < <(find "$dir" -type f -mtime +"$days" -print 2>/dev/null)
  if [ "$DRY_RUN" = 1 ]; then
    find "$dir" -mindepth 1 -type d -empty -print 2>/dev/null | while IFS= read -r f; do
      say "remove empty dir: $f"
    done
  else
    find "$dir" -mindepth 1 -type d -empty -delete 2>/dev/null || true
  fi
}

echo "==> HavenWorld retention sweep ($(date '+%F %T')) [dry-run=$DRY_RUN]"

# ── 7-day class: test artifacts ──
sweep_tree "test-results" 7
sweep_tree "playwright-report" 7
sweep_tree "blob-report" 7

# ── 7-day class: coverage ──
sweep_tree "apps/server/coverage" 7
sweep_tree "apps/client/coverage" 7
sweep_tree ".nyc_output" 7

# ── 7-day class: build outputs ──
sweep_tree "apps/server/dist" 7
sweep_tree "apps/client/dist" 7
for d in packages/*/dist; do
  [ -d "$d" ] && sweep_tree "$d" 7
done

# ── 7-day class: scratch ──
# Age-gated: delete only items older than 7 days, keep the directories
# themselves (a running gate may have just created files in them).
sweep_tree "tmp" 7
sweep_tree "scratch" 7
[ -d "supabase" ] && sweep_tree "supabase/.temp" 7

# ── 7-day class: scratch logs outside logs/local/ (logs/local/ is 30-day) ──
if [ -d "logs" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    say "remove file: $f"
    if [ "$DRY_RUN" = 0 ]; then rm -f "$f"; fi
    removed=$((removed + 1))
  done < <(find logs -maxdepth 1 -type f -name '*.log' -mtime +7 -print 2>/dev/null)
fi

# ── 7-day class: scratch logs inside logs/local/ ──
# a1_loop.log and its rotations are the 30-day class (handled below) and are
# never deleted by this sweep; everything else *.log there is scratch.
if [ -d "logs/local" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      */a1_loop.log|*/a1_loop.log.*) continue ;;
    esac
    say "remove file: $f"
    if [ "$DRY_RUN" = 0 ]; then rm -f "$f"; fi
    removed=$((removed + 1))
  done < <(find logs/local -maxdepth 1 -type f -name '*.log' -mtime +7 -print 2>/dev/null)
fi

# ── 7-day class: raw per-run gate logs under runs/ ──
# runs/wt-main-verify/ is a full repo checkout (Nov 11 main-verify run) and is
# never swept — prune it from both the log sweep and the empty-dir sweep.
if [ -d "runs" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    say "remove file: $f"
    if [ "$DRY_RUN" = 0 ]; then rm -f "$f"; fi
    removed=$((removed + 1))
  done < <(find runs -type f -not -path 'runs/wt-main-verify/*' \( -name '*.log' -o -name '*.done' \) -mtime +7 -print 2>/dev/null)
  find runs -mindepth 1 -type d -empty -not -path 'runs/wt-main-verify' -not -path 'runs/wt-main-verify/*' -delete 2>/dev/null || true
fi

# ── 30-day class: run summaries/reports ──
if [ -d "runs" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    say "remove file: $f"
    if [ "$DRY_RUN" = 0 ]; then rm -f "$f"; fi
    removed=$((removed + 1))
  done < <(find runs -maxdepth 1 -type f -name '*.md' -mtime +30 -print 2>/dev/null)
fi

# ── 30-day class: rotated a1_loop.log archives ──
if [ -d "logs/local" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    say "remove file: $f"
    if [ "$DRY_RUN" = 0 ]; then rm -f "$f"; fi
    removed=$((removed + 1))
  done < <(find logs/local -maxdepth 1 -type f -name 'a1_loop.log.*' -mtime +30 -print 2>/dev/null)
fi

# ── 7-day class: ci-docker temp dirs left behind by killed runs ──
# (the per-run trap handles clean exit; SIGKILL/OOM leftovers are orphans —
# containers are never kept, temp dirs are never kept.)
while IFS= read -r d; do
  [ -n "$d" ] || continue
  say "remove: $d"
  if [ "$DRY_RUN" = 0 ]; then rm -rf "$d"; fi
  removed=$((removed + 1))
done < <(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'havenworld-ci-docker-*' -mtime +7 -print 2>/dev/null)

echo "==> Retention sweep complete: $removed item(s) removed."
exit 0
