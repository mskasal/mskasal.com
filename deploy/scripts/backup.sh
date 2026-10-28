#!/usr/bin/env bash
# Copies Dossier's database and its /data volume (uploads, nightly backups)
# into backups/<timestamp>/ and prints that directory last.
#
#   scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

project=${COMPOSE_PROJECT_NAME:-mskasal}
dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dir"

docker compose exec -T db pg_dump -U dossier --clean --if-exists dossier | gzip > "$dir/dossier.sql.gz"
docker run --rm -v "${project}_dossier-data:/data:ro" -v "$PWD/$dir:/backup" alpine:3.22 \
  tar czf /backup/dossier-data.tar.gz -C /data .

echo "$dir"
