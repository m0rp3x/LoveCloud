#!/bin/sh
# Docker + Compose v2, POSIX shell and openssl; never executes dotenv as code.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
start=0 quiet=0 reset=0 source_build=0 project_arg='' origin_arg='' files_arg=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --start) start=1 ;; --quiet-secrets) quiet=1 ;; --reset-setup-token) reset=1 ;; --build) source_build=1 ;;
    --project|--origin|--compose-file)
      option=$1; shift
      [ "$#" -gt 0 ] || { printf 'Missing value for %s\n' "$option" >&2; exit 2; }
      case "$option" in --project) project_arg=$1 ;; --origin) origin_arg=$1 ;; --compose-file) files_arg="${files_arg:+$files_arg:}$1" ;; esac ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
umask 077
read_file_setting() {
  [ -f "$2" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$2" | tail -n 1 | sed -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
get_setting() {
  setting=$(printenv "$1" || true)
  [ -n "$setting" ] || setting=$(read_file_setting "$1" .env)
  [ -n "$setting" ] || setting=$(read_file_setting "$1" release.env)
  printf '%s' "$setting"
}
save_setting() {
  case "$2" in *"'"*|*'
'*) printf 'Unsupported quote/newline in setting %s\n' "$1" >&2; exit 2 ;; esac
  setting_tmp=$(mktemp .env.tmp.XXXXXX)
  if [ -f .env ]; then sed "/^[[:space:]]*$1[[:space:]]*=/d" .env > "$setting_tmp"; fi
  printf "%s='%s'\n" "$1" "$2" >> "$setting_tmp"
  mv "$setting_tmp" .env
}
project=${project_arg:-$(get_setting COMPOSE_PROJECT_NAME)}
[ -n "$project" ] || project=lovecloud
case "$project" in ''|[!a-z0-9]*|*[!a-z0-9_-]*) printf '%s\n' 'Invalid Compose project name.' >&2; exit 2 ;; esac
public_origin=${origin_arg:-$(get_setting APP_ORIGIN)}
public_port=$(get_setting LOVE_CLOUD_PORT); public_port=${public_port:-3211}
[ -n "$public_origin" ] || public_origin="http://localhost:$public_port"
if ! printf '%s' "$public_origin" | grep -Eq '^https?://[^/?#[:space:]@]+/?$'; then
  printf '%s\n' 'APP_ORIGIN must be an absolute http(s) origin without path/query/fragment/userinfo.' >&2; exit 2
fi
public_origin=$(printf '%s' "$public_origin" | sed 's:/$::')
secure=false; case "$public_origin" in https://*) secure=true ;; esac
files=${files_arg:-$(get_setting COMPOSE_FILE)}
if [ -z "$files" ]; then
  files=compose.yaml
  [ ! -f compose.images.yaml ] || files="$files:compose.images.yaml"
  if [ "$secure" = true ] && [ -n "$(get_setting LOVE_CLOUD_DOMAIN)" ]; then files="$files:compose.https.yaml"; fi
fi
if [ "$source_build" -eq 0 ] && [ -f compose.images.yaml ]; then
  case ":$files:" in *:compose.images.yaml:*) ;; *) files="$files:compose.images.yaml" ;; esac
fi
if [ "$source_build" -eq 1 ]; then
  [ -d backend ] && [ -d frontend ] || { printf '%s\n' 'Source build requires a source checkout, not an installation archive.' >&2; exit 2; }
  case ":$files:" in *:compose.dev.yaml:*) ;; *) files="$files:compose.dev.yaml" ;; esac
fi
set -- compose --project-name "$project" --env-file .env
old_ifs=$IFS; IFS=:; set -f
for compose_file in $files; do
  [ -f "$compose_file" ] || { printf 'Missing Compose file: %s\n' "$compose_file" >&2; exit 2; }
  set -- "$@" -f "$compose_file"
done
set +f; IFS=$old_ifs
[ -f .env ] || : > .env
if [ "$start" -eq 1 ]; then
  command -v docker >/dev/null || { printf '%s\n' 'Install Docker Engine/Desktop and Docker Compose v2 first.' >&2; exit 1; }
  docker compose version >/dev/null
  compose_version=$(docker compose version --short | sed 's/^v//;s/[-+].*//')
  if [ -n "$compose_version" ] && ! printf '%s\n' "$compose_version" | awk -F. '{exit !($1>2 || ($1==2 && ($2>24 || ($2==24 && $3>=4))))}'; then printf '%s\n' 'Docker Compose >=2.24.4 is required. Update the Compose plugin.' >&2; exit 1; fi
  docker info >/dev/null 2>&1 || { printf '%s\n' 'Docker unavailable. Start Docker and check permissions (docker info).' >&2; exit 1; }
fi
existing=0
[ "$(get_setting LOVECLOUD_INITIALIZED)" != true ] || existing=1
for secret in database_password database_connection bootstrap_password setup_token; do [ ! -f ".secrets/$secret" ] || existing=1; done
if command -v docker >/dev/null 2>&1; then
  existing_volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$project" 2>/dev/null || true)
  [ -z "$existing_volumes" ] || existing=1
  # Also catch externally named/unlabelled volumes selected by an override.
  # Only nonsecret resource names are extracted; never source/eval configuration.
  effective_config=$(docker "$@" config --format json 2>/dev/null || true)
  volume_names=$(printf '%s\n' "$effective_config" | sed -n 's/^[[:space:]]*"name":[[:space:]]*"\([^"]*\)".*/\1/p')
  for volume_name in $volume_names; do
    found=$(docker volume inspect "$volume_name" --format '{{.Name}}' 2>/dev/null || true)
    [ -z "$found" ] || existing=1
  done
  existing_db=$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=db 2>/dev/null || true)
  if [ -n "$existing_db" ]; then
    pg_major=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$existing_db" 2>/dev/null | sed -n 's/^PG_MAJOR=//p' | head -n 1)
    if [ "$pg_major" != 18 ]; then printf '%s\n' 'Existing database is not verified PostgreSQL18. Stop and plan a PostgreSQL migration; the installer will not change its major version.' >&2; exit 1; fi
  fi
fi
if [ "$existing" -eq 1 ]; then
  missing=''
  for secret in database_password database_connection bootstrap_password setup_token; do
    if [ "$secret" = setup_token ] && [ "$reset" -eq 1 ]; then continue; fi
    [ -s ".secrets/$secret" ] || missing="$missing $secret"
  done
  if [ -n "$missing" ]; then
    printf 'Existing installation is missing required secrets:%s\n' "$missing" >&2
    printf '%s\n' 'STOP: restore .secrets from the matching encrypted backup; do not generate a new database password or remove volumes. See docs/OPERATIONS.md.' >&2; exit 1
  fi
fi
command -v openssl >/dev/null || { printf '%s\n' 'Install openssl (secure random installation secrets).' >&2; exit 1; }
mkdir -p .secrets
for secret in database_password bootstrap_password; do [ -f ".secrets/$secret" ] || openssl rand -base64 32 > ".secrets/$secret"; done
if [ ! -f .secrets/database_connection ]; then
  database_secret=$(cat .secrets/database_password)
  printf '%s' "Host=db;Port=5432;Database=lovecloud;Username=lovecloud;Password=$database_secret;Include Error Detail=false" > .secrets/database_connection
  unset database_secret
fi
if [ "$reset" -eq 1 ] || [ ! -f .secrets/setup_token ]; then openssl rand -hex 32 > .secrets/setup_token; fi
chmod 700 .secrets
find .secrets -type f -exec chmod 600 {} \;
# Bind-mount secrets retain host mode; non-root API/Postgres need read access.
# Other host users cannot traverse the 0700 parent directory.
chmod 644 .secrets/database_password .secrets/database_connection .secrets/bootstrap_password .secrets/setup_token
save_setting COMPOSE_PROJECT_NAME "$project"
save_setting COMPOSE_FILE "$files"
save_setting COMPOSE_PATH_SEPARATOR ':'
save_setting APP_ORIGIN "$public_origin"
save_setting SECURE_COOKIES "$secure"
save_setting LOVE_CLOUD_PORT "$public_port"
save_setting LOVECLOUD_INITIALIZED true
for name in LOVE_CLOUD_BIND LOVE_CLOUD_DOMAIN LOVE_CLOUD_REDIRECT_PORT LOVECLOUD_BACKUP_IMAGE; do
  value=$(get_setting "$name"); [ -z "$value" ] || save_setting "$name" "$value"
done
setup_token=$(tr -d '\r\n' < .secrets/setup_token)
setup_link="$public_origin/setup#token=$setup_token"
printf '%s\n' "$setup_link" > .secrets/setup-link.txt
configured=0
if [ "$start" -eq 1 ]; then
  APP_ORIGIN=$public_origin SECURE_COOKIES=$secure COMPOSE_PROJECT_NAME=$project COMPOSE_FILE=$files COMPOSE_PATH_SEPARATOR=:
  export APP_ORIGIN SECURE_COOKIES COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PATH_SEPARATOR
  if [ "$source_build" -eq 0 ]; then
    effective_config=$(docker "$@" config --format json)
    if printf '%s' "$effective_config" | grep -Eq '"build"[[:space:]]*:'; then
      printf '%s\n' 'Production configuration contains build sections. Remove development overrides, or explicitly use --build from a source checkout.' >&2; exit 1
    fi
  fi
  if [ "$source_build" -eq 1 ]; then docker "$@" build; else docker "$@" pull; fi
  if ! docker "$@" up -d --no-build; then printf '%s\n' 'Startup failed. Inspect docker compose ps and docker compose logs --tail=100 (keep logs private).' >&2; exit 1; fi
  ready=0; attempt=0
  while [ "$attempt" -lt 90 ]; do
    if docker "$@" exec -T gateway wget -q -O /dev/null http://127.0.0.1/api/v1/setup/status 2>/dev/null; then ready=1; break; fi
    attempt=$((attempt + 1)); sleep 1
  done
  if [ "$ready" -ne 1 ]; then printf '%s\n' 'Application not ready after 90s. Run docker compose ps and docker compose logs --tail=100 api gateway. Check mounted secret permissions and APP_ORIGIN; never share secret values.' >&2; exit 1; fi
  status=$(docker "$@" exec -T gateway wget -q -O - http://127.0.0.1/api/v1/setup/status)
  if printf '%s' "$status" | grep -Eq '"required"[[:space:]]*:[[:space:]]*false'; then configured=1; fi
fi
printf 'Cloud address: %s\nCompose project: %s\n' "$public_origin" "$project"
if [ "$configured" -eq 1 ]; then printf '%s\n' 'Setup complete. Existing accounts and settings preserved.'
else
  printf '%s\n' 'Open the one-time setup link to choose language, accounts, avatars and theme.'
  [ "$quiet" -eq 1 ] || printf 'Setup link: %s\n' "$setup_link"
  printf '%s\n' 'Private link file: .secrets/setup-link.txt. A completed installation cannot be reopened.'
fi
[ "$start" -eq 1 ] || printf '%s\n' 'Settings saved. Start with: sh scripts/init.sh --start'
unset setup_token setup_link
