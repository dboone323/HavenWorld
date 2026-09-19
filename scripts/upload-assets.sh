#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HavenWorld — upload 3D assets to Cloudflare R2 (Part 9A §3.5)
#
# R2 is the free-tier CDN for avatars, room GLBs and furniture. Assets stay in
# the repo for local development, but production serves them from R2 so the
# Cloudflare Pages bundle stays small.
#
# Required environment (see .env.example):
#   R2_ACCOUNT_ID          Cloudflare account id
#   R2_ACCESS_KEY_ID       R2 token access key
#   R2_SECRET_ACCESS_KEY   R2 token secret
#   R2_BUCKET              bucket name (default: havenworld-assets)
#   R2_PUBLIC_URL          public base URL, e.g. https://assets.havenworld.me
#
# Usage:
#   ./scripts/upload-assets.sh              # upload changed assets only
#   ./scripts/upload-assets.sh --dry-run    # show what would be uploaded
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

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name is not set." >&2
    exit 1
  fi
}

require_env R2_ACCOUNT_ID
require_env R2_ACCESS_KEY_ID
require_env R2_SECRET_ACCESS_KEY

if ! command -v rclone >/dev/null 2>&1; then
  echo "ERROR: rclone is not installed. Install it with: brew install rclone" >&2
  exit 1
fi

if [ ! -d "$ASSETS_DIR" ]; then
  echo "ERROR: asset directory not found: $ASSETS_DIR" >&2
  exit 1
fi

echo "==> Configuring rclone remote '$R2_REMOTE' for account $R2_ACCOUNT_ID"
rclone config create "$R2_REMOTE" s3 \
  provider Cloudflare \
  access_key_id "$R2_ACCESS_KEY_ID" \
  secret_access_key "$R2_SECRET_ACCESS_KEY" \
  endpoint "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  acl private \
  --non-interactive >/dev/null

# Long-lived immutable caching: asset filenames are stable, so 1 year + immutable
# is safe and keeps repeat visits off the network entirely.
CACHE_CONTROL="public, max-age=31536000, immutable"

echo "==> Uploading GLB/WASM assets from $ASSETS_DIR"
rclone copy "$ASSETS_DIR" "${R2_REMOTE}:${R2_BUCKET}/assets" \
  --include "*.glb" --include "*.wasm" \
  --header-upload "Cache-Control: ${CACHE_CONTROL}" \
  --s3-no-check-bucket \
  --transfers 8 \
  --progress \
  ${DRY_RUN}

echo "==> Uploading texture/atlas images"
rclone copy "$ASSETS_DIR" "${R2_REMOTE}:${R2_BUCKET}/assets" \
  --include "*.png" --include "*.jpg" --include "*.webp" \
  --header-upload "Cache-Control: ${CACHE_CONTROL}" \
  --s3-no-check-bucket \
  --transfers 8 \
  ${DRY_RUN}

echo
echo "Upload complete."
echo "Set this in the Cloudflare Pages build environment:"
echo "  VITE_ASSET_BASE_URL=${R2_PUBLIC_URL:-https://<your-r2-public-domain>}"
