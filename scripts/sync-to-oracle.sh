#!/usr/bin/env bash
# =============================================================================
# Sync HavenWorld / MiniWorld from local Mac to Oracle Cloud VM
# =============================================================================

SSH_KEY="${HOME}/.ssh/oracle_arm"
REMOTE_USER="ubuntu"
REMOTE_HOST="147.224.164.228"
REMOTE_DIR="~/miniworld"

echo "📡 Syncing MiniWorld files to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}..."

rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'miniworld.db' \
  --exclude '.DS_Store' \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  ./ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

echo "✅ Sync complete!"
echo "👉 To run or update on the remote VM:"
echo "   ssh -i ${SSH_KEY} ${REMOTE_USER}@${REMOTE_HOST} 'cd ~/miniworld && bash scripts/deploy-oracle-vm.sh'"
