#!/usr/bin/env bash
# Brings up the whole stack (Caddy with its own CA, the site, oauth2-proxy,
# Dossier and Postgres) on site.localhost / admin.localhost and runs every
# check in scripts/check.sh against it. Google sign-in itself isn't completed
# (the OAuth client is a placeholder); the checks prove the back office
# demands it, that the connector routes and health check pass, and that
# WebSocket rooms work through Caddy.
#
#   deploy/tests/stack.sh
set -euo pipefail

src=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    (cd "$work" && docker compose ps -a && docker compose logs --tail 60) || true
  fi
  (cd "$work" && docker compose down -v >/dev/null 2>&1) || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

# The site is built from the repository, one level above deploy/.
cp -r "$src/." "$work/"
sed -i "s|build: \.\.|build: $(cd "$src/.." && pwd)|" "$work/compose.yml"
cd "$work"
rm -rf backups
cp .env.example .env
sed -i \
  -e 's|^PUBLIC_DOMAIN=.*|PUBLIC_DOMAIN=site.localhost|' \
  -e 's|^ADMIN_DOMAIN=.*|ADMIN_DOMAIN=admin.localhost|' \
  -e 's|^TLS_MODE=.*|TLS_MODE=internal|' \
  -e 's|^OAUTH2_PROXY_CLIENT_ID=.*|OAUTH2_PROXY_CLIENT_ID=stack-test.apps.googleusercontent.com|' \
  -e 's|^OAUTH2_PROXY_CLIENT_SECRET=.*|OAUTH2_PROXY_CLIENT_SECRET=stack-test|' \
  -e 's|^DOSSIER_PASSWORD=.*|DOSSIER_PASSWORD=argon2id:m=19456,t=2,p=1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|' \
  .env
./scripts/init-env.sh </dev/null
echo "COMPOSE_PROJECT_NAME=mskasal-stack-test" >> .env

docker compose up -d --build

echo "Waiting for Dossier (migrations run on first start)..."
for _ in $(seq 1 90); do
  code=$(curl -sk --max-time 5 --resolve admin.localhost:443:127.0.0.1 -o /dev/null -w '%{http_code}' \
    https://admin.localhost/api/health || true)
  [ "$code" = 200 ] && break
  sleep 5
done

CHECK_RESOLVE=127.0.0.1 ./scripts/check.sh https://site.localhost https://admin.localhost --insecure
