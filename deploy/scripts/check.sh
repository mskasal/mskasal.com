#!/usr/bin/env bash
# Checks a running stack from the outside.
#
#   scripts/check.sh <public-url> <admin-url> [--insecure]
#
# --insecure accepts Caddy's local CA (TLS_MODE=internal). Set CHECK_RESOLVE
# to an IP to send both hosts there without DNS (e.g. CHECK_RESOLVE=127.0.0.1).
# Exits non-zero at the first failed check.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <public-url> <admin-url> [--insecure]" >&2
  exit 2
fi
public=${1%/}
admin=${2%/}
curl_opts=(--silent --show-error --max-time 10)
[ "${3:-}" = "--insecure" ] && curl_opts+=(--insecure)
if [ -n "${CHECK_RESOLVE:-}" ]; then
  for url in "$public" "$admin"; do
    host=${url#*://}; host=${host%%/*}
    curl_opts+=(--resolve "$host:443:$CHECK_RESOLVE" --resolve "$host:80:$CHECK_RESOLVE")
  done
fi

ok() { echo "ok    $1"; }
fail() { echo "FAIL  $1" >&2; exit 1; }

# status_and_location <url> → "<status> <location>"
status_and_location() {
  curl "${curl_opts[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' "$1"
}

# 1. The public site answers its health check.
code=$(curl "${curl_opts[@]}" -o /dev/null -w '%{http_code}' "$public/healthz")
[ "$code" = 200 ] && ok "public site /healthz → 200" || fail "public site /healthz → $code"

# 2. The back office never serves a page without Google sign-in.
read -r code location <<<"$(status_and_location "$admin/")"
if [[ "$code" =~ ^(302|303|307|403)$ ]] && [[ "$code" = 403 || "$location" == *accounts.google.com* || "$location" == */oauth2/* ]]; then
  ok "admin / → $code (sign-in required)"
else
  fail "admin / → $code ${location:-} (expected a redirect to Google sign-in)"
fi

# 2b. A spoofed X-Forwarded-Uri doesn't open the back office either.
read -r code location <<<"$(curl "${curl_opts[@]}" -o /dev/null -w '%{http_code} %{redirect_url}' -H 'X-Forwarded-Uri: /api/health' "$admin/")"
if [[ "$code" =~ ^(302|303|307|403)$ ]] && [[ "$code" = 403 || "$location" == *accounts.google.com* || "$location" == */oauth2/* ]]; then
  ok "admin / with a spoofed X-Forwarded-Uri → $code (still guarded)"
else
  fail "admin / with X-Forwarded-Uri: /api/health → $code ${location:-} (sign-in bypassed)"
fi

# 3. The Claude connector's metadata is answered by Dossier, not the sign-in.
read -r code location <<<"$(status_and_location "$admin/.well-known/oauth-protected-resource")"
if [[ "$code" =~ ^(200|404)$ ]] && [[ "$location" != *accounts.google.com* ]]; then
  ok "admin /.well-known/oauth-protected-resource → $code (passes oauth2-proxy)"
else
  fail "admin /.well-known/oauth-protected-resource → $code ${location:-} (oauth2-proxy intercepted it)"
fi

# 4. Dossier's health check passes oauth2-proxy too.
code=$(curl "${curl_opts[@]}" -o /dev/null -w '%{http_code}' "$admin/api/health")
[ "$code" = 200 ] && ok "admin /api/health → 200" || fail "admin /api/health → $code"

# 4b. With SITE=soon the public site only answers "soon!", rooms included.
soon=0
body=$(curl "${curl_opts[@]}" "$public/" 2>/dev/null || true)
if [[ "$body" == *"<body>soon!</body>"* ]]; then
  soon=1
  ok "public site / → soon! (SITE=soon)"
fi

# 5. WebSocket rooms upgrade through Caddy.
if [ "${CHECK_SKIP_WS:-}" = 1 ]; then
  echo "skip  websocket rooms (CHECK_SKIP_WS=1)"
elif [ "$soon" = 1 ]; then
  echo "skip  websocket rooms (SITE=soon)"
else
  # macOS has no /proc; uuidgen prints uppercase there.
  room=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
  room=$(printf '%s' "$room" | tr 'A-F' 'a-f')
  code=$(curl "${curl_opts[@]}" --http1.1 --max-time 3 -o /dev/null -w '%{http_code}' \
    -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "$public/ws/room/$room" || true)
  [ "$code" = 101 ] && ok "websocket /ws/room/<uuid> → 101" || fail "websocket /ws/room/<uuid> → $code"
fi
