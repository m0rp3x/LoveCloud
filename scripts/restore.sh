#!/bin/sh
# Restore ONLY into a fresh directory/project. Original installation is untouched.
set -eu
repository=''; password=''; target=''; project=''; origin='http://localhost:3211'; port=3211; snapshot=latest
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repository) repository=$2; shift 2;; --password-file) password=$2; shift 2;;
    --target) target=$2; shift 2;; --project) project=$2; shift 2;;
    --origin) origin=$2; shift 2;; --port) port=$2; shift 2;; --snapshot) snapshot=$2; shift 2;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2;;
  esac
done
case "$project" in ''|*[!a-z0-9_-]*) echo 'Specify a new lowercase --project name.' >&2; exit 2;; esac
case "$port" in ''|*[!0-9]*) echo 'Invalid --port.' >&2; exit 2;; esac
[ -d "$repository" ] && [ -f "$password" ] && [ -n "$target" ] || { echo '--repository, --password-file and empty --target are required.' >&2; exit 2; }
mkdir -p "$target"; target=$(CDPATH= cd -- "$target" && pwd)
[ -z "$(ls -A "$target")" ] || { echo 'Restore target must be empty.' >&2; exit 1; }
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ] || { echo 'Restore project already has containers; choose a fresh name.' >&2; exit 1; }
for volume in pgdata files keys; do
  if docker volume inspect "${project}_restore_$volume" >/dev/null 2>&1; then echo 'Restore volume already exists; choose a fresh project.' >&2; exit 1; fi
done
repository=$(CDPATH= cd -- "$repository" && pwd)
password_dir=$(CDPATH= cd -- "$(dirname -- "$password")" && pwd); password="$password_dir/$(basename -- "$password")"
backup_image=${LOVECLOUD_BACKUP_IMAGE:-restic/restic:0.18.0}
stage=$(mktemp -d "${TMPDIR:-/tmp}/lovecloud-restore.XXXXXX"); chmod 700 "$stage"
trap 'case "$stage" in */lovecloud-restore.*) rm -rf -- "$stage";; esac' EXIT HUP INT TERM
docker run --rm --mount "type=bind,source=$repository,target=/repository,readonly" --mount "type=bind,source=$password,target=/password,readonly" --mount "type=bind,source=$stage,target=/restore" "$backup_image" --repo /repository --password-file /password restore "$snapshot" --target /restore
[ -f "$stage/source/database/database.dump" ] || { echo 'Snapshot has no LoveCloud database.' >&2; exit 1; }
cp -R "$stage/source/install/." "$target/"
cd "$target"
chmod 700 .secrets; chmod 644 .secrets/database_password .secrets/database_connection .secrets/bootstrap_password .secrets/setup_token
files=$(cat backup-compose-files.txt)
cat > compose.restore.yaml <<EOF
services:
  db:
    volumes:
      - restored_pgdata:/var/lib/postgresql
  api:
    volumes:
      - restored_files:/data/files
      - restored_keys:/data/keys
  gateway:
    volumes:
      - ./ops/nginx.conf:/etc/nginx/nginx.conf:ro
secrets:
  database_password:
    file: ./.secrets/database_password
  database_connection:
    file: ./.secrets/database_connection
  bootstrap_password:
    file: ./.secrets/bootstrap_password
  setup_token:
    file: ./.secrets/setup_token
volumes:
  restored_pgdata:
    name: ${project}_restore_pgdata
  restored_files:
    name: ${project}_restore_files
  restored_keys:
    name: ${project}_restore_keys
EOF
# Remove only the copied environment's standard settings, preserving all others.
if [ -f .env ]; then sed '/^COMPOSE_PROJECT_NAME=/d; /^COMPOSE_FILE=/d; /^COMPOSE_PATH_SEPARATOR=/d; /^APP_ORIGIN=/d; /^SECURE_COOKIES=/d; /^LOVE_CLOUD_PORT=/d; /^LOVE_CLOUD_BIND=/d' .env > .env.restore; mv .env.restore .env; fi
case "$origin" in https://*) secure=true;; http://*) secure=false;; *) echo 'Origin must use HTTP or HTTPS.' >&2; exit 2;; esac
printf '\nCOMPOSE_PROJECT_NAME=%s\nCOMPOSE_FILE=%s:compose.restore.yaml\nCOMPOSE_PATH_SEPARATOR=:\nAPP_ORIGIN=%s\nSECURE_COOKIES=%s\nLOVE_CLOUD_PORT=%s\nLOVE_CLOUD_BIND=127.0.0.1\n' "$project" "$files" "$origin" "$secure" "$port" >> .env
docker compose up -d --no-build db
db=$(docker compose ps -q db)
attempt=0; until docker exec "$db" pg_isready -U lovecloud -d lovecloud >/dev/null 2>&1; do attempt=$((attempt+1)); [ "$attempt" -lt 90 ] || { echo 'Restored database readiness failed.' >&2; exit 1; }; sleep 1; done
docker cp "$stage/source/database/database.dump" "$db:/tmp/lovecloud-restore.dump"
docker exec "$db" pg_restore -U lovecloud -d lovecloud --clean --if-exists --no-owner --exit-on-error /tmp/lovecloud-restore.dump
docker exec "$db" rm -f /tmp/lovecloud-restore.dump
# A candidate API container is created but NOT started until originals and keys exist.
docker compose create --no-build api
api=$(docker compose ps -aq api)
docker run --rm --volumes-from "$api" --mount "type=bind,source=$stage/data,target=/originals,readonly" --entrypoint sh "$backup_image" -c 'cp -a /originals/files/. /data/files/; cp -a /originals/keys/. /data/keys/'
docker compose up -d --no-build
attempt=0; until docker compose exec -T gateway wget -qO- http://127.0.0.1/health >/dev/null 2>&1; do attempt=$((attempt+1)); [ "$attempt" -lt 90 ] || { echo 'Restored app readiness failed; inspect docker compose logs --tail 100.' >&2; exit 1; }; sleep 1; done
printf 'Restored fresh project %s at %s. Verify accounts, originals and TOTP before removing any backup.\n' "$project" "$origin"
