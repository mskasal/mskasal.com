#!/usr/bin/env bash
# Creates deploy/.env from .env.example and fills in what can be generated:
# random secrets, CADDY_SCHEME from TLS_MODE, emails.txt from ALLOWED_EMAIL,
# and (when it's empty) the Dossier password hash, asked for interactively.
# Values that are already set are never overwritten, so it's safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env
# It holds every secret below.
chmod 600 .env

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
# oauth2-proxy reads it as another user, whatever umask this ran under.
chmod 644 emails.txt
echo "wrote emails.txt ($allowed)"

if [ -z "$(get DOSSIER_PASSWORD)" ]; then
  if [ -t 0 ]; then
    # The published image is amd64-only; on arm64 use the one compose.arm64.yml builds.
    image="ghcr.io/aientech/dossier:$(get DOSSIER_VERSION)"
    if docker image inspect "dossier-local:$(get DOSSIER_VERSION)" >/dev/null 2>&1; then
      image="dossier-local:$(get DOSSIER_VERSION)"
    fi
    # Asked here rather than by the container: a captured `docker run -it` hides
    # its prompt and can miss the Enter key.
    read -rsp "Dossier password: " pw; echo
    read -rsp "Again: " pw2; echo
    [ -n "$pw" ] && [ "$pw" = "$pw2" ] || { echo "Passwords are empty or don't match." >&2; exit 1; }
    out=$(printf '%s\n' "$pw" | docker run --rm -i "$image" hash-password 2>&1 | tr -d '\r')
    unset pw pw2
    hash=$(printf '%s\n' "$out" | grep -E '^argon2id:' | tail -n1)
    [ -n "$hash" ] || { printf 'No hash came back from hash-password:\n%s\n' "$out" >&2; exit 1; }
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
