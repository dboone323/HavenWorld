#!/bin/zsh
set -e
ROOT="$(cd "$(dirname "${0:A}")/../../.." && pwd)"
cd "$ROOT"
RAW=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^"//; s/"$//')
case "$RAW" in
  postgresql://*|postgres://*) ;;
  *) echo "DB_BAD len=${#RAW}"; exit 1;;
esac
JA=$(command openssl rand -hex 64)
JR=$(command openssl rand -hex 64)
OUT=apps/server/.env
{
echo "# HavenWorld server env - composed $(date +%Y-%m-%d) for instance-20260922 (Phase M5)"
echo "PORT=3000"
echo "NODE_ENV=production"
echo "DATABASE_URL=$RAW"
echo "REDIS_URL=redis://127.0.0.1:6379"
echo "JWT_ACCESS_SECRET=$JA"
echo "JWT_REFRESH_SECRET=$JR"
echo "JWT_ACCESS_EXPIRES=15m"
echo "JWT_REFRESH_EXPIRES=7d"
echo "SERVER_URL=https://147-224-145-168.nip.io"
echo "CLIENT_URL=https://havenworld-game.pages.dev"
echo "ALPHA_INVITE_ONLY=true"
} > "$OUT"
chmod 600 "$OUT"
rm -f apps/server/.env.new
echo "WROTE $(wc -l < "$OUT") lines"
echo "db_ok=$(grep -cE '^DATABASE_URL="?postgres' "$OUT") server_url_ok=$(grep -c '^SERVER_URL=https://147-224-145-168.nip.io$' "$OUT") alpha_ok=$(grep -c '^ALPHA_INVITE_ONLY=true$' "$OUT")"
grep -E '^(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)=' "$OUT" | awk -F= '{print $1" len="length($2)}'
echo "resend_sentry_refs=$(grep -c 'RESEND\|SENTRY' "$OUT" || true)"
git check-ignore "$OUT" >/dev/null && echo IGNORED_OK
ls -l "$OUT"
