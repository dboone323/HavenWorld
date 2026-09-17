#!/usr/bin/env bash
# HavenWorld — Automated SQLite Database Backup Script
# Creates a snapshot of data/havenworld.db with rotation (keeps last 7 backups)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${ROOT_DIR}/data"
BACKUP_DIR="${ROOT_DIR}/backups"
DB_FILE="${DATA_DIR}/havenworld.db"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/havenworld_${TIMESTAMP}.db"

mkdir -p "${BACKUP_DIR}"

if [[ -f "${DB_FILE}" ]]; then
  # Use sqlite3 .backup if installed, or atomic cp
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "${DB_FILE}" ".backup '${BACKUP_FILE}'"
  else
    cp "${DB_FILE}" "${BACKUP_FILE}"
  fi
  echo "✅ HavenWorld SQLite backup created: ${BACKUP_FILE}"

  # Rotate: keep newest 7 backups, remove older
  ls -tp "${BACKUP_DIR}"/havenworld_*.db 2>/dev/null | tail -n +8 | xargs -I {} rm -- {} 2>/dev/null || true
  echo "🧹 Retained latest 7 backups."
else
  echo "ℹ️  No database file at ${DB_FILE} to back up."
fi
