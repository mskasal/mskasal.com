#!/usr/bin/env bash
# oauth2-proxy (in reverse-proxy mode) matches its skip-auth routes against
# X-Forwarded-Uri when a request carries one. Caddy must therefore replace a
# client's X-Forwarded-Uri with the real request URI, or anyone could reach
# Dossier by sending "X-Forwarded-Uri: /api/health".
#
# Runs the real Caddyfile in front of a stub "oauth2-proxy" that answers with
# the X-Forwarded-Uri it received.
#
#   deploy/tests/caddy-forwarded-uri.sh
set -euo pipefail

deploy=$(cd "$(dirname "$0")/.." && pwd)
net="caddy-test-$$"
port=${CADDY_TEST_PORT:-18443}
cleanup() {
  docker rm -f "$net-front" "$net-stub" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" >/dev/null
docker run -d --name "$net-stub" --network "$net" --network-alias oauth2-proxy caddy:2.10.2 \
  caddy respond --listen :4180 --body '{http.request.header.X-Forwarded-Uri}' >/dev/null
docker run -d --name "$net-front" --network "$net" -p "127.0.0.1:$port:443" \
  -e TLS_MODE=internal -e CADDY_SCHEME=https:// \
  -e PUBLIC_DOMAIN=site.localhost -e ADMIN_DOMAIN=admin.localhost \
  -v "$deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2 >/dev/null

seen() {
  curl -sk --max-time 5 --resolve "admin.localhost:$port:127.0.0.1" "$@" "https://admin.localhost:$port/"
}
for _ in $(seq 1 30); do seen -o /dev/null && break; sleep 1; done

forwarded=$(seen -H 'X-Forwarded-Uri: /api/health')
if [ "$forwarded" != "/" ]; then
  echo "FAIL  client X-Forwarded-Uri reached oauth2-proxy as '$forwarded' (expected '/')" >&2
  exit 1
fi
echo "ok    Caddy replaces a client's X-Forwarded-Uri"
