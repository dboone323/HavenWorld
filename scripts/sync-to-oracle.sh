#!/usr/bin/env bash
# =============================================================================
# Sync HavenWorld from local Mac to Oracle Cloud VM
# =============================================================================

SSH_KEY="${SSH_KEY:-${HOME}/.ssh/oracle_arm}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE_HOST="${ORACLE_HOST:-${REMOTE_HOST:-<your-oracle-vm-ip>}}"
REMOTE_DIR="${REMOTE_DIR:-~/havenworld}"

if [ "$REMOTE_HOST" = "<your-oracle-vm-ip>" ]; then
  echo "❌ Error: Please set ORACLE_HOST environment variable or pass REMOTE_HOST" >&2
  exit 1
fi

echo "📡 Syncing HavenWorld files to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}..."

rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'havenworld.db' \
  --exclude '.DS_Store' \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  ./ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

echo "✅ Sync complete!"
echo "👉 To run or update on the remote VM:"
echo "   ssh -i ${SSH_KEY} ${REMOTE_USER}@${REMOTE_HOST} 'cd ~/havenworld && bash scripts/deploy-oracle-vm.sh'"
