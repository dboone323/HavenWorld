#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HavenWorld — download 3D assets from Cloudflare R2 (Part 9A §3.8)
#
# Restores the production asset set into apps/client/public/assets for local
# development, which is useful when assets are trimmed from the repo to keep the
# Pages bundle small.
#
# Required environment: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# Usage: ./scripts/download-assets.sh [--dry-run]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

R2_BUCKET="${R2_BUCKET:-havenworld-assets}"
R2_REMOTE="${R2_REMOTE:-havenworld-r2}"
ASSETS_DIR="${ASSETS_DIR:-apps/client/public/assets}"
DRY_RUN=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

for name in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name is not set." >&2
    exit 1
  fi
done

if ! command -v rclone >/dev/null 2>&1; then
  echo "ERROR: rclone is not installed. Install it with: brew install rclone" >&2
  exit 1
fi

rclone config create "$R2_REMOTE" s3 \
  provider Cloudflare \
  access_key_id "$R2_ACCESS_KEY_ID" \
  secret_access_key "$R2_SECRET_ACCESS_KEY" \
  endpoint "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  acl private \
  --non-interactive >/dev/null

mkdir -p "$ASSETS_DIR"

echo "==> Downloading assets into $ASSETS_DIR"
rclone copy "${R2_REMOTE}:${R2_BUCKET}/assets" "$ASSETS_DIR" \
  --transfers 8 \
  --progress \
  ${DRY_RUN}

echo "Dowloaded assets into $ASSETS_DIR"
