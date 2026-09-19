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

# Prune backups older than 7 days
find "$BACKUP_DIR" -name "*.sql.gz*" -mtime +7 -delete
echo "[$(date)] Pruned backups older than 7 days."
