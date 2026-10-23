#!/bin/sh
set -eu
source_root=${LOVECLOUD_INSTALLER_SOURCE:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
probe=$(mktemp -d /tmp/lovecloud-install.XXXXXX)
mkdir -p "$probe/scripts"
cp "$source_root/scripts/init.sh" "$probe/scripts/init.sh"
cp "$source_root/compose.yaml" "$probe/compose.yaml"
printf '%s\n' 'services: {}' > "$probe/custom.yaml"
mkdir -p "$probe/mock-bin"
cat > "$probe/mock-bin/docker" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"
case "$*" in *' exec '*wget*) printf '%s\n' '{"required":true}';; esac
exit 0
MOCK
chmod +x "$probe/mock-bin/docker"
PATH="$probe/mock-bin:$PATH"; export PATH
MOCK_DOCKER_LOG="$probe/docker-calls"; export MOCK_DOCKER_LOG
cd "$probe"
printf '%s\r\n' 'APP_ORIGIN="http://localhost:4321"' 'COMPOSE_PROJECT_NAME=lc000-fixture' 'CUSTOM_LITERAL=$(touch should-not-exist)' > .env
sh scripts/init.sh --quiet-secrets --compose-file compose.yaml --compose-file custom.yaml > first-output
test "$(tr -d '\r\n' < .secrets/setup_token | wc -c)" -eq 64
grep -q '^http://localhost:4321/setup#token=' .secrets/setup-link.txt
if grep -q '#token=' first-output; then exit 1; fi
cp .secrets/setup_token first-token
cp .secrets/database_password first-password
sh scripts/init.sh --quiet-secrets > second-output
cmp .secrets/setup_token first-token
cmp .secrets/database_password first-password
grep -q "COMPOSE_PROJECT_NAME='lc000-fixture'" .env
grep -q "COMPOSE_FILE='compose.yaml:custom.yaml'" .env
grep -q "SECURE_COOKIES='false'" .env
test ! -e should-not-exist
sh scripts/init.sh > normal-output
grep -q 'Setup link: .*setup#token=' normal-output
sh scripts/init.sh --quiet-secrets --reset-setup-token > reset-output
if cmp -s .secrets/setup_token first-token; then exit 1; fi
cmp .secrets/database_password first-password
sh scripts/init.sh --quiet-secrets --origin https://lovecloud.example > https-output
sh scripts/init.sh --quiet-secrets > https-rerun-output
grep -q "APP_ORIGIN='https://lovecloud.example'" .env
grep -q "SECURE_COOKIES='true'" .env
sh scripts/init.sh --start --quiet-secrets > startup-output
grep -q 'pull' docker-calls
grep -q 'up -d --no-build' docker-calls
if grep -q ' build$' docker-calls; then exit 1; fi
grep -q -- '-f compose.yaml -f custom.yaml' docker-calls
mv .secrets/database_password saved-database-password
if sh scripts/init.sh --quiet-secrets > missing-output 2>&1; then exit 1; fi
test ! -e .secrets/database_password
grep -q 'restore .secrets' missing-output
mv saved-database-password .secrets/database_password
if sh scripts/init.sh --origin 'https://example.test/path' --quiet-secrets > invalid-output 2>&1; then exit 1; fi
test "$(stat -c %a .secrets)" = 700
test "$(stat -c %a .secrets/setup_token)" = 644
test "$(stat -c %a .secrets/database_connection)" = 644
test "$(stat -c %a .secrets/setup-link.txt)" = 600
# Model the individual file mount outside the private host parent.
# This checks actual UID1654 read access rather than trusting mode metadata.
if [ "$(id -u)" = 0 ] && command -v setpriv >/dev/null 2>&1; then
  mounted_probe=$(mktemp -d /tmp/lovecloud-mounted.XXXXXX)
  chmod 755 "$mounted_probe"
  cp -p .secrets/setup_token "$mounted_probe/setup_token"
  setpriv --reuid=1654 --regid=1654 --clear-groups test -r "$mounted_probe/setup_token"
  if setpriv --reuid=1654 --regid=1654 --clear-groups test -r "$probe/.secrets/setup_token"; then exit 1; fi
fi
printf '%s\n' 'PASS Linux installer fixtures: literal dotenv, persistent project/overrides/origin, pull/no-build, missing-secret refusal, token idempotence/reset, permissions (Docker startup mocked)'
