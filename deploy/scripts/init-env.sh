#!/usr/bin/env bash
# Creates deploy/.env from .env.example and fills in what can be generated:
# random secrets, CADDY_SCHEME from TLS_MODE, emails.txt from ALLOWED_EMAIL,
# and (when it's empty) the Dossier password hash, asked for interactively.
# Values that are already set are never overwritten, so it's safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

get() { grep -E "^$1=" .env | head -n1 | cut -d= -f2-; }
set_value() {
  local key=$1 value=$2
  if grep -qE "^$key=" .env; then
    # | as the sed delimiter; secrets below never contain it.
    sed -i.bak "s|^$key=.*|$key=$value|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
fill() { [ -n "$(get "$1")" ] || { set_value "$1" "$2"; echo "set $1"; }; }

fill POSTGRES_PASSWORD "$(openssl rand -hex 24)"
fill DOSSIER_SECRET "$(openssl rand -base64 32 | tr -d '\n|')"
# oauth2-proxy wants 32 bytes, URL-safe base64.
fill OAUTH2_PROXY_COOKIE_SECRET "$(openssl rand -base64 32 | tr -- '+/' '-_' | tr -d '\n')"

case "$(get TLS_MODE)" in
  tunnel) set_value CADDY_SCHEME "http://" ;;
  acme | internal | "") set_value CADDY_SCHEME "https://" ;;
  *) echo "TLS_MODE must be acme, tunnel or internal" >&2; exit 1 ;;
esac

allowed=$(get ALLOWED_EMAIL)
if [ -z "$allowed" ]; then
  echo "Set ALLOWED_EMAIL in .env first." >&2
  exit 1
fi
printf '%s\n' "$allowed" > emails.txt
echo "wrote emails.txt ($allowed)"

if [ -z "$(get DOSSIER_PASSWORD)" ]; then
  if [ -t 0 ]; then
    echo "Choose the Dossier password (asked twice):"
    hash=$(docker run --rm -it "ghcr.io/aientech/dossier:$(get DOSSIER_VERSION)" hash-password | tr -d '\r' | grep -E '^argon2id:' | tail -n1)
    [ -n "$hash" ] || { echo "No hash came back from hash-password." >&2; exit 1; }
    set_value DOSSIER_PASSWORD "$hash"
    echo "set DOSSIER_PASSWORD"
  else
    echo "DOSSIER_PASSWORD is empty: run this script in a terminal to set it." >&2
  fi
fi

missing=()
for key in ADMIN_DOMAIN OAUTH2_PROXY_CLIENT_ID OAUTH2_PROXY_CLIENT_SECRET; do
  [ -n "$(get "$key")" ] || missing+=("$key")
done
[ "$(get TLS_MODE)" = acme ] && [ -z "$(get ACME_EMAIL)" ] && missing+=(ACME_EMAIL)
if [ ${#missing[@]} -gt 0 ]; then
  echo "Still to fill in .env: ${missing[*]}"
fi
