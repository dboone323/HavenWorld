#!/bin/zsh
set -e
ROOT="$(cd "$(dirname "${0:A}")/../../.." && pwd)"
cd "$ROOT"
echo "=== staging ==="
git add deploy/ scripts/beta-gate-check.sh Makefile e2e/live-prod-login.spec.ts .github/workflows/verify-ssh.sh .github/workflows/load-test.yml
git status --short | head -20
echo "=== staged diffstat ==="
git diff --cached --stat
echo "=== safety: no apps/ paths staged (would trigger CI) ==="
git diff --cached --name-only | grep '^apps/' && { echo "ABORT: apps/ staged"; exit 1; } || echo "OK: no apps/ staged"
echo "=== commit ==="
git commit -m "fix: standardize SSH on port 22 and repoint refs to new instance IP

- sshd_config: Port 2222->22, AllowTcpForwarding no->yes (fix Remote-SSH)
- fail2ban jail.local: sshd port 2222->22
- nginx server_name/cert paths/CSP, beta-gate-check, make health, e2e: old IP -> 147.224.145.168
- verify-ssh.sh: instance-20260922 key, user ubuntu, new IP
- load-test.yml: nightly cron disabled (workflow_dispatch only)"
echo "=== push ==="
git push origin main
echo "=== post-push: workflows (expect no NEW runs) ==="
timeout 30 gh run list --limit 5
echo "=== post-push: old IP remaining in tracked files (expect apps/client + auth.ts + docs only) ==="
git grep -n '147-224-164-228\|147\.224\.164\.228' -- . | grep -v '^docs/' || true
echo "M9_DONE"
