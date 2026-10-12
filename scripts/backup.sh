#!/usr/bin/env bash
# /opt/havenworld/scripts/backup.sh — Daily encrypted backup script (Supabase DB + VM Configs/Secrets)
set -euo pipefail

BACKUP_DIR="/var/backups/havenworld"
APP_DIR="/opt/havenworld"
ENV_FILE="${APP_DIR}/apps/server/.env"
DATE=$(date +%Y-%m-%d_%H-%M)
DB_FILENAME="havenworld_db_${DATE}.sql.gz"
CFG_FILENAME="havenworld_vm_configs_${DATE}.tar.gz"
PASSPHRASE_FILE="/etc/havenworld/backup-passphrase"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[$(date)] Starting HavenWorld daily production backup..."

# ── 1. Load DATABASE_URL from production .env if not already in environment ───
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export DATABASE_URL
fi

# ── 2. Dump live PostgreSQL database (Supabase Pooler or local fallback) ──────
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[$(date)] Dumping production PostgreSQL via DATABASE_URL..."
  pg_dump "$DATABASE_URL" \
    --no-owner \
    --no-acl \
    | gzip > "${BACKUP_DIR}/${DB_FILENAME}"
else
  echo "[$(date)] DATABASE_URL not found; falling back to local pg_dump..."
  PGPASSWORD="${DB_PASSWORD:-havenworld_secret}" pg_dump \
    -h 127.0.0.1 \
    -U havenworld_user \
    -d havenworld_prod \
    --no-owner \
    --no-acl \
    | gzip > "${BACKUP_DIR}/${DB_FILENAME}"
fi

# ── 3. Bundle VM production configs, .env secrets, Nginx, PM2, and Redis RDB ──
echo "[$(date)] Archiving VM production configs and secrets..."
TAR_TARGETS=()
for path in \
  "$ENV_FILE" \
  "${APP_DIR}/.env" \
  "${APP_DIR}/ecosystem.config.js" \
  "/etc/nginx/sites-available/havenworld" \
  "/etc/nginx/nginx.conf" \
  "/var/lib/redis/dump.rdb"; do
  [ -e "$path" ] && TAR_TARGETS+=("$path")
done

if [ "${#TAR_TARGETS[@]}" -gt 0 ]; then
  tar -czf "${BACKUP_DIR}/${CFG_FILENAME}" "${TAR_TARGETS[@]}" 2>/dev/null || true
fi

# ── 4. Encrypt archives with GPG symmetric AES-256 ────────────────────────────
if [ -f "$PASSPHRASE_FILE" ]; then
  for file in "${BACKUP_DIR}/${DB_FILENAME}" "${BACKUP_DIR}/${CFG_FILENAME}"; do
    if [ -f "$file" ]; then
      gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_FILE" \
        "$file"
      rm -f "$file"
    fi
  done
  echo "[$(date)] Encrypted backups completed: ${DB_FILENAME}.gpg & ${CFG_FILENAME}.gpg"
  logger -t havenworld-backup "Encrypted backup ${DB_FILENAME}.gpg created"
else
  echo "[$(date)] WARNING: Passphrase file missing; backups stored unencrypted."
  logger -t havenworld-backup "Unencrypted backup ${DB_FILENAME} created"
fi

# ── 5. Off-site push: Oracle Cloud Object Storage (oci-backups) or Cloudflare R2
OCI_REMOTE="${OCI_REMOTE:-oci-backups}"
OCI_BUCKET="${OCI_BUCKET:-developer-backups}"

if command -v rclone > /dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^${OCI_REMOTE}:"; then
  echo "[$(date)] Pushing encrypted backups to Oracle Cloud Object Storage (${OCI_REMOTE}:${OCI_BUCKET}/havenworld-vm/)..."
  rclone copy "$BACKUP_DIR" "${OCI_REMOTE}:${OCI_BUCKET}/havenworld-vm/" \
    --include "*.gpg" \
    --include "*.gz" \
    --transfers 2 \
    --quiet
  echo "[$(date)] OCI Object Storage upload complete."
  logger -t havenworld-backup "Backup pushed to ${OCI_REMOTE}:${OCI_BUCKET}/havenworld-vm/"
fi

if command -v rclone > /dev/null 2>&1 && [ -n "${R2_BUCKET:-}" ] && rclone listremotes 2>/dev/null | grep -q "^havenworld-r2:"; then
  echo "[$(date)] Pushing backup to Cloudflare R2 bucket: ${R2_BUCKET}/db-backups/"
  rclone copy "$BACKUP_DIR" "havenworld-r2:${R2_BUCKET}/db-backups/" \
    --include "*.gpg" \
    --include "*.sql.gz" \
    --s3-no-check-bucket \
    --transfers 2 \
    --quiet
  echo "[$(date)] R2 upload complete."
  logger -t havenworld-backup "Backup pushed to R2 ${R2_BUCKET}/db-backups/"
fi

# ── 6. Prune local backups older than 7 days ──────────────────────────────────
find "$BACKUP_DIR" -type f \( -name "*.gpg" -o -name "*.gz" \) -mtime +7 -delete
echo "[$(date)] Pruned local backups older than 7 days."
