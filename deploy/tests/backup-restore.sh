#!/usr/bin/env bash
# Exercises scripts/backup.sh and scripts/restore.sh against a throwaway copy
# of this directory (its own Compose project and volumes), with Postgres and
# the dossier-data volume only:
#   1. a round trip with an absolute backup path restores rows and files;
#   2. a corrupt archive is refused before anything is touched.
#
#   deploy/tests/backup-restore.sh
set -euo pipefail

src=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
export COMPOSE_PROJECT_NAME="mskasal-restore-test-$$"
cleanup() {
  (cd "$work" && docker compose down -v >/dev/null 2>&1) || true
  rm -rf "$work"
}
trap cleanup EXIT

cp -r "$src/." "$work/"
cd "$work"
rm -rf backups
cp .env.example .env
sed -i \
  -e 's|^ADMIN_DOMAIN=.*|ADMIN_DOMAIN=admin.localhost|' \
  -e 's|^OAUTH2_PROXY_CLIENT_ID=.*|OAUTH2_PROXY_CLIENT_ID=test|' \
  -e 's|^OAUTH2_PROXY_CLIENT_SECRET=.*|OAUTH2_PROXY_CLIENT_SECRET=test|' \
  -e 's|^DOSSIER_PASSWORD=.*|DOSSIER_PASSWORD=argon2id:m=19456,t=2,p=1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|' \
  .env
./scripts/init-env.sh </dev/null >/dev/null 2>&1 || true

volume="${COMPOSE_PROJECT_NAME}_dossier-data"
rows() { docker compose exec -T db psql -tAU dossier -d dossier -c "select count(*) from t"; }
marker() { docker run --rm -v "$volume:/data" alpine:3.22 cat /data/marker 2>/dev/null || echo missing; }
fail() { echo "FAIL  $1" >&2; exit 1; }

docker compose up -d --wait db >/dev/null 2>&1
docker compose exec -T db psql -qU dossier -d dossier -c "create table t(x int); insert into t select generate_series(1,42);"
docker run --rm -v "$volume:/data" alpine:3.22 sh -c 'echo hello > /data/marker'

backup="$work/$(./scripts/backup.sh | tail -n1)"

# 1. Round trip with an absolute path.
docker compose down -v >/dev/null 2>&1
docker compose up -d --wait db >/dev/null 2>&1
echo y | ./scripts/restore.sh "$backup" >/dev/null
[ "$(rows)" = 42 ] || fail "rows after restore: $(rows)"
[ "$(marker)" = hello ] || fail "marker after restore: $(marker)"
echo "ok    round trip with an absolute path"

# 2. A corrupt archive is refused before anything changes.
docker compose exec -T db psql -qU dossier -d dossier -c "insert into t values (43);"
broken="$work/broken"
mkdir -p "$broken"
cp "$backup/dossier.sql.gz" "$broken/"
head -c 100 "$backup/dossier-data.tar.gz" > "$broken/dossier-data.tar.gz"
if echo y | ./scripts/restore.sh "$broken" >/dev/null 2>&1; then
  fail "restore accepted a corrupt archive"
fi
[ "$(rows)" = 43 ] || fail "database changed by a refused restore: $(rows) rows"
[ "$(marker)" = hello ] || fail "files changed by a refused restore"
echo "ok    corrupt archive refused, nothing changed"
