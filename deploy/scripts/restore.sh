#!/usr/bin/env bash
# Puts a backup from scripts/backup.sh back: replaces Dossier's database and
# /data volume with the backup's copies. Dossier is stopped meanwhile.
#
#   scripts/restore.sh backups/<timestamp>
set -euo pipefail
cd "$(dirname "$0")/.."

dir=${1:?usage: $0 backups/<timestamp>}
dir=${dir%/}
for file in dossier.sql.gz dossier-data.tar.gz; do
  [ -f "$dir/$file" ] || { echo "$dir/$file is missing" >&2; exit 1; }
done

read -r -p "Replace Dossier's database and files with $dir? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || { echo "Nothing changed."; exit 1; }

project=${COMPOSE_PROJECT_NAME:-mskasal}
running=$(docker compose ps -q --status running dossier)
docker compose stop dossier

docker compose exec -T db psql -qU dossier -d postgres \
  -c "DROP DATABASE IF EXISTS dossier WITH (FORCE)" \
  -c "CREATE DATABASE dossier OWNER dossier"
gunzip -c "$dir/dossier.sql.gz" | docker compose exec -T db psql -qU dossier -d dossier -v ON_ERROR_STOP=1 >/dev/null

docker run --rm -v "${project}_dossier-data:/data" -v "$PWD/$dir:/backup:ro" alpine:3.22 \
  sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/dossier-data.tar.gz -C /data'

[ -z "$running" ] || docker compose start dossier
echo "Restored $dir."
