#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
start=0
quiet=0
reset=0
for option in "$@"; do
  case "$option" in
    --start) start=1 ;;
    --quiet-secrets) quiet=1 ;;
    --reset-setup-token) reset=1 ;;
    *) printf 'Unknown option: %s\n' "$option" >&2; exit 2 ;;
  esac
done
umask 077
mkdir -p .secrets
for secret_name in database_password bootstrap_password; do
  if [ ! -f ".secrets/$secret_name" ]; then
    openssl rand -base64 32 > ".secrets/$secret_name"
  fi
done
if [ ! -f .secrets/database_connection ]; then
  database_secret=$(cat .secrets/database_password)
  printf '%s' "Host=db;Port=5432;Database=lovecloud;Username=lovecloud;Password=$database_secret;Include Error Detail=false" > .secrets/database_connection
  unset database_secret
fi
if [ "$reset" -eq 1 ] || [ ! -f .secrets/setup_token ]; then
  openssl rand -hex 32 > .secrets/setup_token
fi
get_setting() {
  setting=$(printenv "$1" || true)
  if [ -z "$setting" ] && [ -f .env ]; then
    setting=$(sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -n 1 | sed -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  fi
  printf '%s' "$setting"
}
public_origin=$(get_setting APP_ORIGIN)
if [ -z "$public_origin" ]; then
  public_port=$(get_setting LOVE_CLOUD_PORT)
  if [ -z "$public_port" ]; then public_port=3211; fi
  public_origin="http://localhost:$public_port"
fi
if ! printf '%s' "$public_origin" | grep -Eq '^https?://[^/?#[:space:]@]+/?$'; then
  printf '%s\n' 'APP_ORIGIN must be an absolute http(s) origin without path/query/fragment/userinfo.' >&2
  exit 2
fi
public_origin=$(printf '%s' "$public_origin" | sed 's:/$::')
setup_token=$(tr -d '\r\n' < .secrets/setup_token)
setup_link="$public_origin/setup#token=$setup_token"
printf '%s\n' "$setup_link" > .secrets/setup-link.txt
chmod 700 .secrets
find .secrets -type f -exec chmod 600 {} \;
# File-backed Compose secrets keep their host mode. Non-root API/Postgres must
# read the individual read-only mounts; the 0700 parent protects them on host.
chmod 644 .secrets/database_password .secrets/database_connection .secrets/bootstrap_password .secrets/setup_token
configured=0
if [ "$start" -eq 1 ]; then
  APP_ORIGIN="$public_origin"
  SECURE_COOKIES=false
  case "$public_origin" in https://*) SECURE_COOKIES=true ;; esac
  export APP_ORIGIN SECURE_COOKIES
  set -- -f compose.yaml
  if [ "$SECURE_COOKIES" = true ] && [ -n "$(get_setting LOVE_CLOUD_DOMAIN)" ]; then
    set -- "$@" -f compose.https.yaml
  fi
  docker compose "$@" up -d --build
  ready=0
  attempt=0
  while [ "$attempt" -lt 45 ]; do
    if docker compose "$@" exec -T gateway wget -q -O /dev/null http://127.0.0.1/api/v1/setup/status 2>/dev/null; then ready=1; break; fi
    attempt=$((attempt + 1))
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then printf '%s\n' 'Services are not ready. Check docker compose logs api gateway.' >&2; exit 1; fi
  setup_status=$(docker compose "$@" exec -T gateway wget -q -O - http://127.0.0.1/api/v1/setup/status 2>/dev/null || true)
  if printf '%s' "$setup_status" | grep -Eq '"required"[[:space:]]*:[[:space:]]*false'; then configured=1; fi
fi
printf 'Cloud address: %s\n' "$public_origin"
if [ "$configured" -eq 1 ]; then
  printf '%s\n' 'Setup is already complete. Existing accounts and settings were preserved.'
else
  printf '%s\n' 'Open the one-time setup link to choose language, accounts, avatars and a theme.'
  if [ "$quiet" -eq 0 ]; then printf 'Setup link: %s\n' "$setup_link"; fi
  printf '%s\n' 'Private link file: .secrets/setup-link.txt'
  printf '%s\n' 'The link cannot reopen a completed installation. Keep it private.'
fi
if [ "$start" -eq 0 ]; then printf '%s\n' 'Start services: docker compose up -d --build'; fi
unset setup_token setup_link
