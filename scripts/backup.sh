#!/bin/sh
# Consistent encrypted snapshot. Never run init here: missing secrets are an error.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
repository="$root/backups/restic"
project=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository) repository=$2; shift 2;;
    --project) project=$2; shift 2;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2;;
  esac
done
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
for file in database_password database_connection bootstrap_password setup_token; do
  [ -s ".secrets/$file" ] || { printf 'Missing .secrets/%s. Restore it from your existing backup; do not regenerate database credentials.\n' "$file" >&2; exit 1; }
done
# Compose reads persisted .env itself. An explicit caller -p has priority.
compose() { if [ -n "$project" ]; then docker compose -p "$project" "$@"; else docker compose "$@"; fi; }
api=$(compose ps -q api); db=$(compose ps -q db)
[ -n "$api" ] && [ -n "$db" ] || { echo 'The existing API and database must be running.' >&2; exit 1; }
actual_project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$api")
backup_image=${LOVECLOUD_BACKUP_IMAGE:-}
if [ -z "$backup_image" ] && [ -f .env ]; then backup_image=$(sed -n 's/^LOVECLOUD_BACKUP_IMAGE=//p' .env | tail -n 1 | tr -d '\r' | sed -e "s/^'//;s/'$//" -e 's/^"//;s/"$//'); fi
backup_image=${backup_image:-restic/restic:0.18.0}
mkdir -p .artifacts "$repository" .secrets
mkdir .artifacts/backup.lockdir 2>/dev/null || { echo 'Another backup is running (or inspect the stale .artifacts/backup.lockdir after a crash).' >&2; exit 1; }
repository=$(CDPATH= cd -- "$repository" && pwd)
stage=$(mktemp -d "$root/.artifacts/backup.XXXXXX")
chmod 700 "$stage"
stopped=false
cleanup() {
  trap - EXIT HUP INT TERM
  code=$?
  if [ "$stopped" = true ]; then compose start api >/dev/null || code=1; fi
  # Only the just-created owned mktemp directory can be removed.
  case "$stage" in "$root"/.artifacts/backup.*) rm -rf -- "$stage";; esac
  rmdir "$root/.artifacts/backup.lockdir" || code=1
  exit "$code"
}
trap cleanup EXIT HUP INT TERM
password="$root/.secrets/backup_password"
if [ ! -s "$password" ]; then
  if [ -f "$repository/config" ]; then echo 'Existing encrypted repository has no backup_password. Restore the key; refusing to replace it.' >&2; exit 1; fi
  docker run --rm --entrypoint sh "$backup_image" -c 'head -c 48 /dev/urandom | base64' > "$password"
  chmod 600 "$password"
fi
mkdir -p "$stage/install/scripts" "$stage/install/ops" "$stage/install/.secrets" "$stage/database"
cp .secrets/database_password .secrets/database_connection .secrets/bootstrap_password .secrets/setup_token "$stage/install/.secrets/"
for file in .env VERSION release.env; do [ ! -f "$file" ] || cp "$file" "$stage/install/$file"; done
cp scripts/init.sh scripts/init.ps1 scripts/backup.sh scripts/backup.ps1 scripts/restore.sh scripts/restore.ps1 "$stage/install/scripts/"
for file in ops/*; do [ ! -f "$file" ] || cp "$file" "$stage/install/ops/"; done
# Resolve the exact Compose source list from the running container, including
# custom files outside the installation. Flatten only those external paths.
config_files=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$api")
compose_files=''; index=0; old_ifs=$IFS; IFS=,
for file in $config_files; do
  index=$((index+1)); name="compose.backup.$index.yaml"
  [ -f "$file" ] || { echo 'A Compose source file is unavailable; restore it before backup.' >&2; exit 1; }
  cp "$file" "$stage/install/$name"
  compose_files="${compose_files}${compose_files:+:}$name"
done
IFS=$old_ifs
[ -n "$compose_files" ] || { echo 'Cannot identify Compose source files.' >&2; exit 1; }
# Paths in normal source files are relative to install root, exactly as before.
# Restore uses a final override for secrets, proxy binds and isolated volumes.
printf '%s\n' "$compose_files" > "$stage/install/backup-compose-files.txt"
printf '%s\n' "$actual_project" > "$stage/install/backup-project.txt"
compose config --format json > "$stage/install/backup-effective-compose.json"
compose config --services > "$stage/install/backup-services.txt"
docker inspect --format '{{json .Mounts}}' "$api" > "$stage/install/backup-api-mounts.json"
docker inspect --format '{{json .Mounts}}' "$db" > "$stage/install/backup-db-mounts.json"
compose stop api >/dev/null; stopped=true
docker exec "$db" pg_dump -U lovecloud -d lovecloud -Fc > "$stage/database/database.dump"
restic() {
  docker run --rm --volumes-from "$api:ro" \
    --mount "type=bind,source=$repository,target=/repository" \
    --mount "type=bind,source=$password,target=/password,readonly" \
    --mount "type=bind,source=$stage,target=/source,readonly" \
    "$backup_image" --repo /repository --password-file /password "$@"
}
docker pull "$backup_image" >/dev/null
[ -f "$repository/config" ] || restic init
restic backup --tag "$actual_project" /source /data/files /data/keys
restic check
printf 'Encrypted backup verified: %s\nKeep a separate safe copy of %s\n' "$repository" "$password"
