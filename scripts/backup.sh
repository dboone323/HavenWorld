#!/usr/bin/env bash
# /opt/havenworld/scripts/backup.sh — Daily encrypted backup script
set -euo pipefail

BACKUP_DIR="/var/backups/havenworld"
DATE=$(date +%Y-%m-%d_%H-%M)
FILENAME="havenworld_${DATE}.sql.gz"
PASSPHRASE_FILE="/etc/havenworld/backup-passphrase"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting HavenWorld database backup..."

# Dump database and compress
PGPASSWORD="${DB_PASSWORD:-havenworld_secret}" pg_dump \
  -h 127.0.0.1 \
  -U havenworld_user \
  -d havenworld_prod \
  --no-owner \
  --no-acl \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

# Encrypt with GPG symmetric AES256 if passphrase file exists
if [ -f "$PASSPHRASE_FILE" ]; then
  gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase-file "$PASSPHRASE_FILE" \
    "${BACKUP_DIR}/${FILENAME}"

  # Remove unencrypted backup immediately
  rm -f "${BACKUP_DIR}/${FILENAME}"
  echo "[$(date)] Encrypted backup completed: ${FILENAME}.gpg"
  logger -t havenworld-backup "Backup ${FILENAME}.gpg created and encrypted"
else
  echo "[$(date)] Backup completed (unencrypted): ${FILENAME}"
  logger -t havenworld-backup "Backup ${FILENAME} created"
fi

# ── Off-site: push to Cloudflare R2 ──────────────────────────────────────────
# Requires: rclone installed, R2_BUCKET env var set, rclone remote 'havenworld-r2' configured.
# Set R2_BUCKET in /opt/havenworld/apps/server/.env or call with:
#   R2_BUCKET=havenworld-backups bash backup.sh
if command -v rclone > /dev/null 2>&1 && [ -n "${R2_BUCKET:-}" ]; then
  echo "[$(date)] Pushing backup to Cloudflare R2 bucket: ${R2_BUCKET}/db-backups/"
  rclone copy "$BACKUP_DIR" "havenworld-r2:${R2_BUCKET}/db-backups/" \
    --include "*.gpg" \
    --include "*.sql.gz" \
    --s3-no-check-bucket \
    --transfers 2 \
    --quiet
  echo "[$(date)] R2 upload complete."
  logger -t havenworld-backup "Backup pushed to R2 ${R2_BUCKET}/db-backups/"
else
  echo "[$(date)] Skipping R2 upload (rclone not found or R2_BUCKET not set)."
fi

# Prune local backups older than 7 days
find "$BACKUP_DIR" -name "*.sql.gz*" -mtime +7 -delete
echo "[$(date)] Pruned local backups older than 7 days."

