#!/usr/bin/env bash
# Puts a backup from scripts/backup.sh back: replaces Dossier's database and
# /data volume with the backup's copies. Dossier is stopped meanwhile.
# Both archives are checked before anything changes, and the current state is
# saved with backup.sh first, so a bad restore can be undone.
#
#   scripts/restore.sh backups/<timestamp>
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

[ -n "${1:-}" ] || { echo "usage: $0 backups/<timestamp>" >&2; exit 2; }
[ -d "$1" ] || { echo "$1 is not a directory" >&2; exit 1; }
dir=$(cd "$1" && pwd)
for file in dossier.sql.gz dossier-data.tar.gz; do
  [ -f "$dir/$file" ] || { echo "$dir/$file is missing" >&2; exit 1; }
done
gzip -t "$dir/dossier.sql.gz" || { echo "$dir/dossier.sql.gz is damaged; nothing changed." >&2; exit 1; }
tar tzf "$dir/dossier-data.tar.gz" >/dev/null || { echo "$dir/dossier-data.tar.gz is damaged; nothing changed." >&2; exit 1; }

read -r -p "Replace Dossier's database and files with $dir? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || { echo "Nothing changed."; exit 1; }

volume=$(dossier_data_volume)
echo "Saving the current state first..."
safety=$(./scripts/backup.sh | tail -n1)
echo "Current state saved in $safety."

running=$(docker compose ps -q --status running dossier)
# From here on the database is being replaced: if anything fails, say how to
# go back, and bring Dossier back up if it was running.
on_failure() {
  echo "Restore failed. The state before it is saved in $safety; to go back: $0 $safety" >&2
  [ -z "$running" ] || docker compose start dossier >/dev/null 2>&1 || true
}
trap on_failure ERR
docker compose stop dossier

docker compose exec -T db psql -qU dossier -d postgres \
  -c "DROP DATABASE IF EXISTS dossier WITH (FORCE)" \
  -c "CREATE DATABASE dossier OWNER dossier"
gunzip -c "$dir/dossier.sql.gz" | docker compose exec -T db psql -qU dossier -d dossier -v ON_ERROR_STOP=1 >/dev/null

# Unpack first, then swap, so a failed unpack leaves /data as it was. --mount
# (unlike -v) fails instead of creating an empty directory for a bad path.
docker run --rm -v "$volume:/data" \
  --mount "type=bind,src=$dir,dst=/backup,readonly" alpine:3.22 \
  sh -c 'mkdir /tmp/restore && tar xzf /backup/dossier-data.tar.gz -C /tmp/restore \
    && find /data -mindepth 1 -delete && cp -a /tmp/restore/. /data/'

trap - ERR
[ -z "$running" ] || docker compose start dossier
echo "Restored $dir. (To undo: $0 $safety)"
