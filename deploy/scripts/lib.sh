# Shared by backup.sh and restore.sh.

# Prints the name of this stack's dossier-data volume. The project name comes
# from Compose itself (it may be set in .env); a missing volume is an error,
# never a new empty one.
dossier_data_volume() {
  local project volume
  project=$(docker compose ps --format '{{.Project}}' db | head -n1)
  if [ -z "$project" ]; then
    echo "The db service isn't running: start the stack first (docker compose up -d)." >&2
    return 1
  fi
  volume="${project}_dossier-data"
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "Volume $volume doesn't exist: is this the right stack?" >&2
    return 1
  fi
  echo "$volume"
}
